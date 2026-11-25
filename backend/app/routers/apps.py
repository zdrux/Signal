import hashlib
import re
import secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.dependencies import (
    get_current_user,
    admin_required,
    assert_can_manage_app,
    get_accessible_app_ids,
)
from app.models import Application, AppUserLink, AppPhoneContact, UrlMonitor, CertMonitor, WebhookEvent, SmsDelivery, User
from app.services.audit import record_audit
from app.services.dlp import encrypt_secret, decrypt_secret

router = APIRouter(prefix="/api/apps", tags=["apps"])

E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def normalize_hhmm(raw: str | None) -> str:
    val = (raw or "").strip()
    if not val:
        return ""
    if not HHMM_RE.match(val):
        raise HTTPException(status_code=400, detail="Time must be in 24-hour HH:MM format (e.g. 08:00 or 18:30)")
    return val


def normalize_phone(raw: str) -> str:
    cleaned = re.sub(r"[\s\-().]", "", raw.strip())
    if not cleaned.startswith("+") and len(cleaned) == 10 and cleaned.isdigit():
        cleaned = "+1" + cleaned
    if not E164_RE.match(cleaned):
        raise HTTPException(status_code=400, detail="Phone number must be valid E.164 format (e.g. +15551234567)")
    return cleaned


def generate_webhook_credentials() -> tuple[str, str, str, str]:
    webhook_id = "wh_" + secrets.token_hex(6)
    plaintext = "sig_live_" + secrets.token_hex(24)
    token_hash = hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
    token_prefix = f"{plaintext[:14]}...{plaintext[-4:]}"
    return webhook_id, plaintext, token_hash, token_prefix


class CreateAppRequest(BaseModel):
    name: str
    map_id: int
    description: str = ""
    user_ids: list[int] = []
    dedupe_window_seconds: int = 300
    max_per_minute: int = 5


class UpdateAppRequest(BaseModel):
    name: str | None = None
    map_id: int | None = None
    description: str | None = None
    enabled: bool | None = None
    dedupe_window_seconds: int | None = None
    max_per_minute: int | None = None


class AddAppUserRequest(BaseModel):
    user_id: int


class AddAppContactRequest(BaseModel):
    name: str
    phone_number: str
    active_start_est: str = ""
    active_end_est: str = ""


class UpdateAppContactRequest(BaseModel):
    name: str | None = None
    phone_number: str | None = None
    active: bool | None = None
    active_start_est: str | None = None
    active_end_est: str | None = None


@router.get("")
def list_apps(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    accessible = get_accessible_app_ids(session, user)
    stmt = select(Application)
    if accessible is not None:
        if not accessible:
            return []
        stmt = stmt.where(Application.id.in_(accessible))

    apps = session.exec(stmt.order_by(Application.created_at.desc())).all()
    users_map = {u.id: u for u in session.exec(select(User)).all()}
    user_links = session.exec(select(AppUserLink)).all()
    contacts = session.exec(select(AppPhoneContact).order_by(AppPhoneContact.name)).all()
    url_monitors = session.exec(select(UrlMonitor).order_by(UrlMonitor.created_at.desc())).all()
    cert_monitors = session.exec(select(CertMonitor).order_by(CertMonitor.created_at.desc())).all()

    users_by_app: dict[int, list[dict]] = {}
    for lnk in user_links:
        u = users_map.get(lnk.user_id)
        if u:
            users_by_app.setdefault(lnk.app_id, []).append({
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name or u.username,
                "role": u.role,
            })

    # Latest Twilio delivery status per (app_id, phone_number) so UI can flag failed numbers
    latest_delivery_by_app_phone: dict[tuple[int, str], tuple[str, str]] = {}
    recent_events = session.exec(select(WebhookEvent).order_by(WebhookEvent.created_at.desc()).limit(200)).all()
    if recent_events:
        ev_app_map = {ev.id: ev.app_id for ev in recent_events}
        deliveries = session.exec(
            select(SmsDelivery)
            .where(SmsDelivery.event_id.in_(list(ev_app_map.keys())))
            .order_by(SmsDelivery.created_at.desc())
        ).all()
        for d in deliveries:
            key = (ev_app_map[d.event_id], d.phone_number)
            if key not in latest_delivery_by_app_phone:
                latest_delivery_by_app_phone[key] = (d.status, d.error_message)

    contacts_by_app: dict[int, list[dict]] = {}
    for c in contacts:
        last_status, last_err = latest_delivery_by_app_phone.get((c.app_id, c.phone_number), ("", ""))
        contacts_by_app.setdefault(c.app_id, []).append({
            "id": c.id,
            "name": c.name,
            "phone_number": c.phone_number,
            "active": c.active,
            "active_start_est": c.active_start_est,
            "active_end_est": c.active_end_est,
            "last_delivery_status": last_status,
            "last_delivery_error": last_err,
        })

    url_monitors_by_app: dict[int, list[dict]] = {}
    for um in url_monitors:
        url_monitors_by_app.setdefault(um.app_id, []).append({
            "id": um.id,
            "name": um.name,
            "url": um.url,
            "method": um.method,
            "auth_type": um.auth_type,
            "auth_username": um.auth_username,
            "has_auth_secret": bool(um.auth_secret),
            "headers_json": um.headers_json,
            "expected_status": um.expected_status,
            "expected_body": um.expected_body,
            "expected_body_mode": um.expected_body_mode,
            "interval_seconds": um.interval_seconds,
            "timeout_seconds": um.timeout_seconds,
            "max_latency_ms": um.max_latency_ms,
            "enabled": um.enabled,
            "last_status": um.last_status,
            "last_http_code": um.last_http_code,
            "last_latency_ms": um.last_latency_ms,
            "last_error": um.last_error,
            "last_checked_at": um.last_checked_at.isoformat() if um.last_checked_at else None,
        })

    cert_monitors_by_app: dict[int, list[dict]] = {}
    for cm in cert_monitors:
        cert_monitors_by_app.setdefault(cm.app_id, []).append({
            "id": cm.id,
            "url": cm.url,
            "days_before_expiry": cm.days_before_expiry,
            "interval_seconds": cm.interval_seconds,
            "enabled": cm.enabled,
            "last_status": cm.last_status,
            "days_remaining": cm.days_remaining,
            "cert_expires_at": cm.cert_expires_at.isoformat() if cm.cert_expires_at else None,
            "cert_subject": cm.cert_subject,
            "cert_issuer": cm.cert_issuer,
            "last_error": cm.last_error,
            "last_checked_at": cm.last_checked_at.isoformat() if cm.last_checked_at else None,
        })

    return [
        {
            "id": a.id,
            "name": a.name,
            "map_id": a.map_id,
            "description": a.description,
            "webhook_id": a.webhook_id,
            "webhook_path": f"/api/v1/hooks/{a.webhook_id}",
            "token_prefix": a.token_prefix,
            "can_copy_token": bool(a.token_encrypted),
            "enabled": a.enabled,
            "dedupe_window_seconds": a.dedupe_window_seconds,
            "max_per_minute": a.max_per_minute,
            "users": users_by_app.get(a.id, []),
            "contacts": contacts_by_app.get(a.id, []),
            "url_monitors": url_monitors_by_app.get(a.id, []),
            "cert_monitors": cert_monitors_by_app.get(a.id, []),
            "created_by": a.created_by,
            "created_at": a.created_at.isoformat(),
        }
        for a in apps
    ]


@router.post("")
def create_app(
    payload: CreateAppRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(admin_required),
):
    """Admins only can create new Apps (unique MAP ID) and assign initial logged-in users."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Application name is required")
    if payload.map_id <= 0:
        raise HTTPException(status_code=400, detail="MAP ID must be a positive integer")
    if payload.dedupe_window_seconds < 0 or payload.max_per_minute < 0:
        raise HTTPException(status_code=400, detail="Dedupe window and rate limit must be >= 0")

    existing_map = session.exec(select(Application).where(Application.map_id == payload.map_id)).first()
    if existing_map:
        raise HTTPException(
            status_code=409,
            detail=f"An application with MAP ID {payload.map_id} already exists ({existing_map.name})",
        )

    webhook_id, plaintext_token, token_hash, token_prefix = generate_webhook_credentials()
    app = Application(
        name=name,
        map_id=payload.map_id,
        description=payload.description.strip(),
        webhook_id=webhook_id,
        token_hash=token_hash,
        token_encrypted=encrypt_secret(plaintext_token),
        token_prefix=token_prefix,
        enabled=True,
        dedupe_window_seconds=payload.dedupe_window_seconds,
        max_per_minute=payload.max_per_minute,
        created_by=actor.username,
    )
    session.add(app)
    session.commit()
    session.refresh(app)

    for uid in set(payload.user_ids):
        target = session.get(User, uid)
        if target:
            session.add(AppUserLink(app_id=app.id, user_id=target.id, added_by=actor.username))
    session.commit()

    record_audit(
        session,
        actor.username,
        "APP_CREATED",
        target=f"{app.name} (MAP {app.map_id})",
        details=f"webhook={app.webhook_id}, dedupe={app.dedupe_window_seconds}s, max_per_min={app.max_per_minute}",
    )

    return {
        "id": app.id,
        "name": app.name,
        "map_id": app.map_id,
        "webhook_id": app.webhook_id,
        "webhook_path": f"/api/v1/hooks/{app.webhook_id}",
        "bearer_token": plaintext_token,
        "token_prefix": app.token_prefix,
    }


@router.patch("/{app_id}")
def update_app(
    app_id: int,
    payload: UpdateAppRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    changes: list[str] = []
    if payload.name is not None and payload.name.strip() != app.name:
        changes.append(f"name: '{app.name}' -> '{payload.name.strip()}'")
        app.name = payload.name.strip()
    if payload.map_id is not None:
        if payload.map_id <= 0:
            raise HTTPException(status_code=400, detail="MAP ID must be a positive integer")
        if payload.map_id != app.map_id:
            dup = session.exec(select(Application).where(Application.map_id == payload.map_id)).first()
            if dup:
                raise HTTPException(status_code=409, detail=f"MAP ID {payload.map_id} is already used by {dup.name}")
            changes.append(f"map_id: {app.map_id} -> {payload.map_id}")
            app.map_id = payload.map_id
    if payload.description is not None and payload.description.strip() != app.description:
        changes.append("description updated")
        app.description = payload.description.strip()
    if payload.enabled is not None and payload.enabled != app.enabled:
        changes.append(f"webhook: {'Resumed' if payload.enabled else 'Paused'}")
        app.enabled = payload.enabled
    if payload.dedupe_window_seconds is not None:
        if payload.dedupe_window_seconds < 0:
            raise HTTPException(status_code=400, detail="dedupe_window_seconds must be >= 0")
        if payload.dedupe_window_seconds != app.dedupe_window_seconds:
            changes.append(f"dedupe: {app.dedupe_window_seconds}s -> {payload.dedupe_window_seconds}s")
            app.dedupe_window_seconds = payload.dedupe_window_seconds
    if payload.max_per_minute is not None:
        if payload.max_per_minute < 0:
            raise HTTPException(status_code=400, detail="max_per_minute must be >= 0")
        if payload.max_per_minute != app.max_per_minute:
            changes.append(f"flood_cap: {app.max_per_minute}/m -> {payload.max_per_minute}/m")
            app.max_per_minute = payload.max_per_minute

    session.add(app)
    session.commit()
    if changes:
        record_audit(session, actor.username, "APP_UPDATED", target=f"{app.name} (MAP {app.map_id})", details=", ".join(changes))
    return {"ok": True}


@router.get("/{app_id}/token")
def get_app_token(
    app_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    """Retrieve the decrypted Bearer token for an authorized user to copy in the GUI."""
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    token = decrypt_secret(app.token_encrypted)
    if not token:
        raise HTTPException(
            status_code=404,
            detail="Token copy is unavailable for this legacy token — click Rotate Token once to enable copying.",
        )
    record_audit(
        session,
        actor.username,
        "TOKEN_COPIED",
        target=f"{app.name} (MAP {app.map_id})",
        details="Webhook bearer token copied from web GUI",
    )
    return {"bearer_token": token}


@router.post("/{app_id}/rotate-token")
def rotate_token(
    app_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    _, plaintext_token, token_hash, token_prefix = generate_webhook_credentials()
    app.token_hash = token_hash
    app.token_encrypted = encrypt_secret(plaintext_token)
    app.token_prefix = token_prefix
    session.add(app)
    session.commit()

    record_audit(
        session,
        actor.username,
        "TOKEN_ROTATED",
        target=f"{app.name} (MAP {app.map_id})",
        details=f"Previous token invalidated; new prefix {token_prefix}",
    )
    return {"ok": True, "bearer_token": plaintext_token, "token_prefix": token_prefix}


@router.delete("/{app_id}")
def delete_app(
    app_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(admin_required),
):
    """Admins only can delete an App."""
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    for lnk in session.exec(select(AppUserLink).where(AppUserLink.app_id == app_id)).all():
        session.delete(lnk)
    for c in session.exec(select(AppPhoneContact).where(AppPhoneContact.app_id == app_id)).all():
        session.delete(c)
    for um in session.exec(select(UrlMonitor).where(UrlMonitor.app_id == app_id)).all():
        session.delete(um)
    for cm in session.exec(select(CertMonitor).where(CertMonitor.app_id == app_id)).all():
        session.delete(cm)
    session.delete(app)
    session.commit()
    record_audit(session, actor.username, "APP_DELETED", target=f"{app.name} (MAP {app.map_id})")
    return {"ok": True}


# ==================== SELF-MANAGED APP USERS ====================

@router.post("/{app_id}/users")
def add_app_user(
    app_id: int,
    payload: AddAppUserRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    """Assigned users (and admins) can assign additional already-logged-in users to the App."""
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    target = session.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found (they must log in at least once first)")

    existing = session.exec(
        select(AppUserLink).where(AppUserLink.app_id == app_id, AppUserLink.user_id == target.id)
    ).first()
    if not existing:
        session.add(AppUserLink(app_id=app_id, user_id=target.id, added_by=actor.username))
        session.commit()
        record_audit(
            session,
            actor.username,
            "APP_USER_ADDED",
            target=f"{app.name}:{target.username}",
        )
    return {"ok": True, "user_id": target.id, "username": target.username}


@router.delete("/{app_id}/users/{user_id}")
def remove_app_user(
    app_id: int,
    user_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    links = session.exec(select(AppUserLink).where(AppUserLink.app_id == app_id)).all()
    if not actor.is_admin and len(links) <= 1 and any(l.user_id == user_id for l in links):
        raise HTTPException(status_code=400, detail="Cannot remove the last assigned user from an application")

    link = next((l for l in links if l.user_id == user_id), None)
    if link:
        target = session.get(User, user_id)
        session.delete(link)
        session.commit()
        record_audit(
            session,
            actor.username,
            "APP_USER_REMOVED",
            target=f"{app.name}:{target.username if target else user_id}",
        )
    return {"ok": True}


# ==================== PER-APP PHONE CONTACTS ====================

@router.post("/{app_id}/contacts")
def add_app_contact(
    app_id: int,
    payload: AddAppContactRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Contact name is required")
    phone = normalize_phone(payload.phone_number)

    existing = session.exec(
        select(AppPhoneContact).where(AppPhoneContact.app_id == app_id, AppPhoneContact.phone_number == phone)
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Phone number {phone} is already configured on this app ({existing.name})",
        )

    contact = AppPhoneContact(
        app_id=app_id,
        name=name,
        phone_number=phone,
        active=True,
        active_start_est=normalize_hhmm(payload.active_start_est),
        active_end_est=normalize_hhmm(payload.active_end_est),
        created_by=actor.username,
    )
    session.add(contact)
    session.commit()
    session.refresh(contact)
    record_audit(session, actor.username, "APP_CONTACT_ADDED", target=f"{app.name}:{name}", details=phone)
    return {"id": contact.id, "name": contact.name, "phone_number": contact.phone_number, "active": contact.active}


@router.patch("/{app_id}/contacts/{contact_id}")
def update_app_contact(
    app_id: int,
    contact_id: int,
    payload: UpdateAppContactRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    contact = session.get(AppPhoneContact, contact_id)
    if not contact or contact.app_id != app_id:
        raise HTTPException(status_code=404, detail="Phone contact not found")
    assert_can_manage_app(session, actor, app_id)

    app = session.get(Application, app_id)
    app_label = f"{app.name} (MAP {app.map_id})" if app else f"app:{app_id}"
    changes: list[str] = []
    if payload.name is not None and payload.name.strip() != contact.name:
        changes.append(f"name: '{contact.name}' -> '{payload.name.strip()}'")
        contact.name = payload.name.strip()
    if payload.phone_number is not None:
        norm_p = normalize_phone(payload.phone_number)
        if norm_p != contact.phone_number:
            dup = session.exec(
                select(AppPhoneContact).where(AppPhoneContact.app_id == app_id, AppPhoneContact.phone_number == norm_p)
            ).first()
            if dup:
                raise HTTPException(
                    status_code=409,
                    detail=f"Phone number {norm_p} is already configured on this app ({dup.name})",
                )
            changes.append(f"phone: {contact.phone_number} -> {norm_p}")
            contact.phone_number = norm_p
    if payload.active is not None and payload.active != contact.active:
        changes.append(f"status: {'Receiving SMS' if payload.active else 'Muted'}")
        contact.active = payload.active
    if payload.active_start_est is not None:
        ns = normalize_hhmm(payload.active_start_est)
        if ns != contact.active_start_est:
            changes.append(f"start_est: '{contact.active_start_est or '24/7'}' -> '{ns or '24/7'}'")
            contact.active_start_est = ns
    if payload.active_end_est is not None:
        ne = normalize_hhmm(payload.active_end_est)
        if ne != contact.active_end_est:
            changes.append(f"end_est: '{contact.active_end_est or '24/7'}' -> '{ne or '24/7'}'")
            contact.active_end_est = ne
    session.add(contact)
    session.commit()
    if changes:
        record_audit(
            session,
            actor.username,
            "APP_CONTACT_UPDATED",
            target=f"{app_label} · {contact.name}",
            details=", ".join(changes),
        )
    return {"ok": True}


@router.delete("/{app_id}/contacts/{contact_id}")
def delete_app_contact(
    app_id: int,
    contact_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    contact = session.get(AppPhoneContact, contact_id)
    if not contact or contact.app_id != app_id:
        raise HTTPException(status_code=404, detail="Phone contact not found")
    assert_can_manage_app(session, actor, app_id)

    app = session.get(Application, app_id)
    app_label = f"{app.name} (MAP {app.map_id})" if app else f"app:{app_id}"
    name = contact.name
    phone = contact.phone_number
    session.delete(contact)
    session.commit()
    record_audit(
        session,
        actor.username,
        "APP_CONTACT_DELETED",
        target=f"{app_label} · {name}",
        details=f"Removed phone {phone}",
    )
    return {"ok": True}
