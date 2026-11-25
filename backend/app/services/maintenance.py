from datetime import datetime, timedelta, timezone
from pathlib import Path
from sqlmodel import Session, select, func, text

from app.config import DATABASE_URL
from app.database import engine
from app.models import (
    Application,
    User,
    AppPhoneContact,
    UrlMonitor,
    CertMonitor,
    WebhookEvent,
    SmsDelivery,
    AuditLog,
)
from app.services.config_store import get_all_config, set_config_values


def get_sqlite_file_size() -> tuple[str, int]:
    """Return (db_path, total_bytes including -wal and -shm)."""
    if not DATABASE_URL.startswith("sqlite:///"):
        return DATABASE_URL, 0
    raw_path = DATABASE_URL.replace("sqlite:///", "", 1)
    if not raw_path or raw_path == ":memory:":
        return ":memory:", 0
    base = Path(raw_path)
    total = 0
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(base) + suffix)
        if p.is_file():
            total += p.stat().st_size
    return str(base), total


def get_database_stats(session: Session) -> dict:
    cfg = get_all_config(session)
    db_path, db_bytes = get_sqlite_file_size()

    def _count(model):
        return int(session.exec(select(func.count()).select_from(model)).one())

    return {
        "db_path": db_path,
        "db_size_bytes": db_bytes,
        "event_retention_days": int(cfg.get("EVENT_RETENTION_DAYS") or 0),
        "audit_retention_days": int(cfg.get("AUDIT_RETENTION_DAYS") or 0),
        "last_pruned_at": cfg.get("LAST_PRUNED_AT", ""),
        "counts": {
            "applications": _count(Application),
            "users": _count(User),
            "phone_contacts": _count(AppPhoneContact),
            "url_monitors": _count(UrlMonitor),
            "cert_monitors": _count(CertMonitor),
            "webhook_events": _count(WebhookEvent),
            "sms_deliveries": _count(SmsDelivery),
            "audit_logs": _count(AuditLog),
        },
    }


def prune_old_records(session: Session, vacuum: bool = True) -> dict:
    """Delete webhook events, SMS deliveries, and audit logs older than configured retention days."""
    cfg = get_all_config(session)
    event_days = int(cfg.get("EVENT_RETENTION_DAYS") or 0)
    audit_days = int(cfg.get("AUDIT_RETENTION_DAYS") or 0)
    now = datetime.now(timezone.utc)

    deleted_events = 0
    deleted_deliveries = 0
    deleted_audit = 0

    if event_days > 0:
        cutoff = now - timedelta(days=event_days)
        old_events = session.exec(select(WebhookEvent).where(WebhookEvent.created_at < cutoff)).all()
        if old_events:
            old_ids = [e.id for e in old_events]
            old_deliveries = session.exec(select(SmsDelivery).where(SmsDelivery.event_id.in_(old_ids))).all()
            for d in old_deliveries:
                session.delete(d)
                deleted_deliveries += 1
            for e in old_events:
                session.delete(e)
                deleted_events += 1

    if audit_days > 0:
        audit_cutoff = now - timedelta(days=audit_days)
        old_audits = session.exec(select(AuditLog).where(AuditLog.created_at < audit_cutoff)).all()
        for a in old_audits:
            session.delete(a)
            deleted_audit += 1

    session.commit()
    set_config_values(session, {"LAST_PRUNED_AT": now.isoformat()})

    if vacuum and DATABASE_URL.startswith("sqlite:///") and ":memory:" not in DATABASE_URL:
        try:
            with engine.connect() as conn:
                conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE);"))
                conn.execute(text("VACUUM;"))
                conn.commit()
        except Exception as exc:
            print(f"SQLite VACUUM skipped: {exc}")

    _, new_size = get_sqlite_file_size()
    return {
        "deleted_events": deleted_events,
        "deleted_deliveries": deleted_deliveries,
        "deleted_audit_logs": deleted_audit,
        "db_size_bytes": new_size,
        "pruned_at": now.isoformat(),
    }
