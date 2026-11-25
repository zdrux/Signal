from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from app.database import get_session
from app.dependencies import (
    get_current_user,
    assert_can_manage_app,
    get_accessible_app_ids,
)
from app.models import Application, AppPhoneContact, WebhookEvent, SmsDelivery, User
from app.services.twilio_sms import format_sms_body, send_twilio_sms

router = APIRouter(tags=["webhooks"])


def _now_est() -> datetime:
    try:
        return datetime.now(ZoneInfo("America/New_York"))
    except ZoneInfoNotFoundError:
        return datetime.now(timezone(timedelta(hours=-5)))


def is_contact_within_est_window(contact: AppPhoneContact, now_est: datetime | None = None) -> bool:
    """Return True if contact has no schedule or current EST time is within [start, end]."""
    start = (contact.active_start_est or "").strip()
    end = (contact.active_end_est or "").strip()
    if not start or not end:
        return True
    try:
        sh, sm = map(int, start.split(":"))
        eh, em = map(int, end.split(":"))
    except ValueError:
        return True
    cur = now_est or _now_est()
    now_mins = cur.hour * 60 + cur.minute
    start_mins = sh * 60 + sm
    end_mins = eh * 60 + em
    if start_mins <= end_mins:
        return start_mins <= now_mins <= end_mins
    # Overnight window (e.g. 22:00 -> 06:00)
    return now_mins >= start_mins or now_mins <= end_mins


def _parse_alertmanager_payload(metadata: dict[str, Any]) -> tuple[str, str, str] | None:
    """Detect and parse OpenShift / Prometheus Alertmanager webhook payloads."""
    alerts = metadata.get("alerts")
    if not isinstance(alerts, list) or ("commonLabels" not in metadata and "groupLabels" not in metadata):
        return None

    common_labels = metadata.get("commonLabels") or {}
    common_annotations = metadata.get("commonAnnotations") or {}
    first_alert = alerts[0] if alerts and isinstance(alerts[0], dict) else {}
    first_labels = first_alert.get("labels") or {}
    first_annotations = first_alert.get("annotations") or {}

    status = str(metadata.get("status") or first_alert.get("status") or "firing").strip().upper()
    raw_sev = str(common_labels.get("severity") or first_labels.get("severity") or "INFO").strip().upper()
    if status == "RESOLVED":
        severity = "RESOLVED"
    elif raw_sev in ("CRITICAL", "HIGH", "WARN", "WARNING", "INFO"):
        severity = "WARN" if raw_sev == "WARNING" else raw_sev
    else:
        severity = raw_sev or "INFO"

    alertname = str(
        common_labels.get("alertname")
        or first_labels.get("alertname")
        or "OCP_ALERT"
    ).strip()
    namespace = str(common_labels.get("namespace") or first_labels.get("namespace") or "").strip()
    summary = str(
        common_annotations.get("summary")
        or common_annotations.get("message")
        or common_annotations.get("description")
        or first_annotations.get("summary")
        or first_annotations.get("message")
        or first_annotations.get("description")
        or ""
    ).strip()

    extra_count = f" (+{len(alerts) - 1} more)" if len(alerts) > 1 else ""
    ns_prefix = f"[{namespace}] " if namespace else ""
    log_string = f"{ns_prefix}{summary or status}{extra_count}".strip()
    error_code = f"{status}:{alertname}" if status == "RESOLVED" else alertname
    return severity, error_code, log_string


def _compute_fingerprint(app_id: int, severity: str, error_code: str, log_string: str) -> str:
    raw = f"{app_id}|{severity.upper()}|{error_code.strip().lower()}|{log_string.strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _dispatch_for_app(
    session: Session,
    app: Application,
    metadata: dict[str, Any],
    bypass_guards: bool = False,
) -> tuple[int, dict]:
    am_parsed = _parse_alertmanager_payload(metadata)
    if am_parsed:
        severity, error_code, log_string = am_parsed
    else:
        severity = str(metadata.get("severity") or "INFO").strip().upper()
        error_code = str(metadata.get("error_code") or metadata.get("errorCode") or "").strip()
        log_string = str(
            metadata.get("log_string")
            or metadata.get("logString")
            or metadata.get("message")
            or ""
        ).strip()

    rendered_sms = format_sms_body(
        app_name=app.name,
        map_id=app.map_id,
        severity=severity,
        error_code=error_code,
        log_string=log_string,
    )
    fingerprint = _compute_fingerprint(app.id, severity, error_code, log_string)

    all_active_contacts = session.exec(
        select(AppPhoneContact).where(AppPhoneContact.app_id == app.id, AppPhoneContact.active == True)  # noqa: E712
    ).all()
    if bypass_guards:
        contacts = all_active_contacts
    else:
        now_est = _now_est()
        contacts = [c for c in all_active_contacts if is_contact_within_est_window(c, now_est)]

    now = datetime.now(timezone.utc)

    # Guard 1: Paused app
    if not app.enabled:
        event = WebhookEvent(
            app_id=app.id,
            map_id=app.map_id,
            app_name=app.name,
            severity=severity,
            error_code=error_code,
            log_string=log_string,
            fingerprint=fingerprint,
            payload_json=json.dumps(metadata, default=str),
            rendered_sms=rendered_sms,
            recipient_count=len(contacts),
            status="Skipped",
            suppressed_reason="Application webhook is paused",
        )
        session.add(event)
        session.commit()
        session.refresh(event)
        return 200, {
            "event_id": event.id,
            "status": "Skipped",
            "reason": event.suppressed_reason,
            "rendered_sms": rendered_sms,
            "deliveries": [],
        }

    # Guard 2: Deduplication window (collapse identical alerts within N seconds)
    if not bypass_guards and app.dedupe_window_seconds > 0:
        dedupe_since = now - timedelta(seconds=app.dedupe_window_seconds)
        recent_dup = session.exec(
            select(WebhookEvent)
            .where(
                WebhookEvent.app_id == app.id,
                WebhookEvent.fingerprint == fingerprint,
                WebhookEvent.status.in_(["Sent", "Partial"]),
                WebhookEvent.created_at >= dedupe_since,
            )
            .order_by(WebhookEvent.created_at.desc())
        ).first()
        if recent_dup:
            reason = f"Duplicate alert suppressed (same alert dispatched within {app.dedupe_window_seconds}s window)"
            event = WebhookEvent(
                app_id=app.id,
                map_id=app.map_id,
                app_name=app.name,
                severity=severity,
                error_code=error_code,
                log_string=log_string,
                fingerprint=fingerprint,
                payload_json=json.dumps(metadata, default=str),
                rendered_sms=rendered_sms,
                recipient_count=len(contacts),
                status="Deduplicated",
                suppressed_reason=reason,
            )
            session.add(event)
            session.commit()
            session.refresh(event)
            return 200, {
                "event_id": event.id,
                "status": "Deduplicated",
                "reason": reason,
                "rendered_sms": rendered_sms,
                "deliveries": [],
            }

    # Guard 3: Per-app flood protection (max dispatched alerts per 60s)
    if not bypass_guards and app.max_per_minute > 0:
        rate_since = now - timedelta(seconds=60)
        recent_dispatches = session.exec(
            select(WebhookEvent).where(
                WebhookEvent.app_id == app.id,
                WebhookEvent.status.in_(["Sent", "Partial"]),
                WebhookEvent.created_at >= rate_since,
            )
        ).all()
        if len(recent_dispatches) >= app.max_per_minute:
            reason = f"Flood protection triggered ({app.max_per_minute} alerts/min limit reached)"
            event = WebhookEvent(
                app_id=app.id,
                map_id=app.map_id,
                app_name=app.name,
                severity=severity,
                error_code=error_code,
                log_string=log_string,
                fingerprint=fingerprint,
                payload_json=json.dumps(metadata, default=str),
                rendered_sms=rendered_sms,
                recipient_count=len(contacts),
                status="RateLimited",
                suppressed_reason=reason,
            )
            session.add(event)
            session.commit()
            session.refresh(event)
            return 429, {
                "event_id": event.id,
                "status": "RateLimited",
                "reason": reason,
                "rendered_sms": rendered_sms,
                "deliveries": [],
            }

    # Guard 4: No active phone contacts
    if not contacts:
        event = WebhookEvent(
            app_id=app.id,
            map_id=app.map_id,
            app_name=app.name,
            severity=severity,
            error_code=error_code,
            log_string=log_string,
            fingerprint=fingerprint,
            payload_json=json.dumps(metadata, default=str),
            rendered_sms=rendered_sms,
            recipient_count=0,
            status="Skipped",
            suppressed_reason="No active phone numbers configured on this application",
        )
        session.add(event)
        session.commit()
        session.refresh(event)
        return 200, {
            "event_id": event.id,
            "status": "Skipped",
            "reason": event.suppressed_reason,
            "rendered_sms": rendered_sms,
            "deliveries": [],
        }

    # Dispatch real SMS via Twilio
    event = WebhookEvent(
        app_id=app.id,
        map_id=app.map_id,
        app_name=app.name,
        severity=severity,
        error_code=error_code,
        log_string=log_string,
        fingerprint=fingerprint,
        payload_json=json.dumps(metadata, default=str),
        rendered_sms=rendered_sms,
        recipient_count=len(contacts),
        status="Processing",
    )
    session.add(event)
    session.commit()
    session.refresh(event)

    delivered = 0
    failed = 0
    delivery_results = []
    for contact in contacts:
        res = send_twilio_sms(session, contact.phone_number, rendered_sms)
        if res.ok:
            delivered += 1
        else:
            failed += 1
        d = SmsDelivery(
            event_id=event.id,
            contact_name=contact.name,
            phone_number=contact.phone_number,
            twilio_sid=res.sid,
            status=res.status,
            error_message=res.error_message,
        )
        session.add(d)
        delivery_results.append({
            "contact_name": contact.name,
            "phone_number": contact.phone_number,
            "twilio_sid": res.sid,
            "status": res.status,
            "error_message": res.error_message,
        })

    event.delivered_count = delivered
    event.failed_count = failed
    if delivered > 0 and failed == 0:
        event.status = "Sent"
    elif delivered > 0 and failed > 0:
        event.status = "Partial"
    else:
        event.status = "Failed"

    session.add(event)
    session.commit()

    return 200, {
        "event_id": event.id,
        "status": event.status,
        "rendered_sms": rendered_sms,
        "delivered": delivered,
        "failed": failed,
        "deliveries": delivery_results,
    }


@router.post("/api/v1/hooks/{webhook_id}")
async def ingest_webhook(
    webhook_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
):
    """Public workload webhook endpoint authenticated by per-app Bearer token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    token = authorization.split(" ", 1)[1].strip()
    app = session.exec(select(Application).where(Application.webhook_id == webhook_id)).first()
    if not app:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    incoming_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(incoming_hash, app.token_hash):
        raise HTTPException(status_code=401, detail="Invalid Bearer token")

    metadata: dict[str, Any] = {}
    body_bytes = await request.body()
    if body_bytes.strip():
        try:
            parsed = json.loads(body_bytes.decode("utf-8"))
            if isinstance(parsed, dict):
                metadata = parsed
            else:
                metadata = {"message": str(parsed)}
        except json.JSONDecodeError:
            metadata = {"log_string": body_bytes.decode("utf-8", errors="replace")}

    status_code, body = _dispatch_for_app(session, app, metadata, bypass_guards=False)
    headers = {"Retry-After": "60"} if status_code == 429 else {}
    return JSONResponse(status_code=status_code, content=body, headers=headers)


@router.post("/api/apps/{app_id}/test-trigger")
async def test_trigger_app(
    app_id: int,
    request: Request,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    """Trigger an app's real Twilio SMS flow directly from the Signal UI (bypasses dedupe/rate-limit)."""
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    metadata: dict[str, Any] = {}
    body_bytes = await request.body()
    if body_bytes.strip():
        try:
            parsed = json.loads(body_bytes.decode("utf-8"))
            if isinstance(parsed, dict):
                metadata = parsed
        except json.JSONDecodeError:
            pass
    metadata.setdefault("triggered_by", actor.username)
    _, body = _dispatch_for_app(session, app, metadata, bypass_guards=True)
    return body


@router.get("/api/events")
def list_events(
    app_id: int | None = None,
    severity: str | None = None,
    limit: int = 100,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    accessible = get_accessible_app_ids(session, user)
    stmt = select(WebhookEvent)
    if app_id is not None:
        if accessible is not None and app_id not in accessible:
            raise HTTPException(status_code=403, detail="No access to this application")
        stmt = stmt.where(WebhookEvent.app_id == app_id)
    elif accessible is not None:
        if not accessible:
            return []
        stmt = stmt.where(WebhookEvent.app_id.in_(accessible))

    if severity and severity != "ALL":
        stmt = stmt.where(WebhookEvent.severity == severity.upper())

    events = session.exec(stmt.order_by(WebhookEvent.created_at.desc()).limit(limit)).all()
    result = []
    for ev in events:
        deliveries = session.exec(select(SmsDelivery).where(SmsDelivery.event_id == ev.id)).all()
        try:
            payload_obj = json.loads(ev.payload_json or "{}")
        except json.JSONDecodeError:
            payload_obj = {}
        result.append({
            "id": ev.id,
            "app_id": ev.app_id,
            "map_id": ev.map_id,
            "environment": ev.environment,
            "app_name": ev.app_name,
            "severity": ev.severity,
            "error_code": ev.error_code,
            "log_string": ev.log_string,
            "payload": payload_obj,
            "rendered_sms": ev.rendered_sms,
            "recipient_count": ev.recipient_count,
            "delivered_count": ev.delivered_count,
            "failed_count": ev.failed_count,
            "status": ev.status,
            "suppressed_reason": ev.suppressed_reason,
            "created_at": ev.created_at.isoformat(),
            "deliveries": [
                {
                    "id": d.id,
                    "contact_name": d.contact_name,
                    "phone_number": d.phone_number,
                    "twilio_sid": d.twilio_sid,
                    "status": d.status,
                    "error_message": d.error_message,
                }
                for d in deliveries
            ],
        })
    return result
