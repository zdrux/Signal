from datetime import datetime, timezone
from sqlmodel import Session, select
from app.models import AppConfig
from app.config import ENV_DEFAULTS


def get_all_config(session: Session) -> dict[str, str]:
    """Return merged config: SQLite AppConfig overrides ENV_DEFAULTS when non-empty."""
    merged = dict(ENV_DEFAULTS)
    rows = session.exec(select(AppConfig)).all()
    for row in rows:
        merged[row.key] = row.value
    return merged


def get_config_value(session: Session, key: str, default: str = "") -> str:
    row = session.exec(select(AppConfig).where(AppConfig.key == key)).first()
    if row is not None:
        return row.value
    return ENV_DEFAULTS.get(key, default)


def set_config_values(session: Session, updates: dict[str, str]) -> None:
    now = datetime.now(timezone.utc)
    for key, value in updates.items():
        row = session.exec(select(AppConfig).where(AppConfig.key == key)).first()
        if row:
            row.value = str(value)
            row.updated_at = now
        else:
            session.add(AppConfig(key=key, value=str(value), updated_at=now))
    session.commit()


def is_ldap_enabled(session: Session) -> bool:
    cfg = get_all_config(session)
    enabled = str(cfg.get("LDAP_ENABLED", "")).strip().lower() in ("true", "1", "yes")
    host = str(cfg.get("LDAP_HOST", "")).strip()
    return enabled and bool(host)
