from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import parse_initial_admins
from app.database import get_session
from app.dependencies import admin_required
from app.models import User, AuditLog
from app.services.config_store import get_all_config, set_config_values
from app.services.audit import record_audit
from app.services.maintenance import get_database_stats, prune_old_records

router = APIRouter(prefix="/api/admin", tags=["admin"])

VALID_ROLES = {"user", "admin"}


class UpdateRoleRequest(BaseModel):
    role: str


class LdapSettingsRequest(BaseModel):
    LDAP_ENABLED: bool
    LDAP_HOST: str = ""
    LDAP_PORT: int = 636
    LDAP_USE_SSL: bool = True
    LDAP_USER_DOMAIN: str = "ad"
    LDAP_AUTH_TYPE: str = "SIMPLE"


class TwilioSettingsRequest(BaseModel):
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_API_KEY_SID: str = ""
    TWILIO_API_KEY_SECRET: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_MESSAGING_SERVICE_SID: str = ""
    TWILIO_FROM_NUMBER: str = ""


@router.get("/users")
def list_users(session: Session = Depends(get_session), _: User = Depends(admin_required)):
    users = session.exec(select(User).order_by(User.created_at.desc())).all()
    initial_admins = parse_initial_admins()
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name or u.username,
            "role": u.role,
            "from_configmap": u.username in initial_admins,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: UpdateRoleRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(admin_required),
):
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {sorted(VALID_ROLES)}")
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username in parse_initial_admins() and payload.role != "admin":
        raise HTTPException(status_code=400, detail="Cannot demote a ConfigMap initial admin")

    old_role = user.role
    user.role = payload.role
    session.add(user)
    session.commit()
    record_audit(session, actor.username, "USER_ROLE_UPDATED", target=user.username, details=f"{old_role} -> {user.role}")
    return {"id": user.id, "username": user.username, "role": user.role}


@router.get("/settings")
def get_settings(session: Session = Depends(get_session), _: User = Depends(admin_required)):
    cfg = get_all_config(session)
    return {
        "ldap": {
            "LDAP_ENABLED": str(cfg.get("LDAP_ENABLED", "false")).lower() in ("true", "1", "yes"),
            "LDAP_HOST": cfg.get("LDAP_HOST", ""),
            "LDAP_PORT": int(cfg.get("LDAP_PORT") or 636),
            "LDAP_USE_SSL": str(cfg.get("LDAP_USE_SSL", "true")).lower() in ("true", "1", "yes"),
            "LDAP_USER_DOMAIN": cfg.get("LDAP_USER_DOMAIN", "ad"),
            "LDAP_AUTH_TYPE": cfg.get("LDAP_AUTH_TYPE", "SIMPLE"),
        },
        "twilio": {
            "TWILIO_ACCOUNT_SID": cfg.get("TWILIO_ACCOUNT_SID", ""),
            "TWILIO_API_KEY_SID": cfg.get("TWILIO_API_KEY_SID", ""),
            "has_api_key_secret": bool(cfg.get("TWILIO_API_KEY_SECRET", "").strip()),
            "has_auth_token": bool(cfg.get("TWILIO_AUTH_TOKEN", "").strip()),
            "TWILIO_MESSAGING_SERVICE_SID": cfg.get("TWILIO_MESSAGING_SERVICE_SID", ""),
            "TWILIO_FROM_NUMBER": cfg.get("TWILIO_FROM_NUMBER", ""),
            "configured": bool(
                cfg.get("TWILIO_ACCOUNT_SID", "").strip()
                and (
                    (cfg.get("TWILIO_API_KEY_SID", "").strip() and cfg.get("TWILIO_API_KEY_SECRET", "").strip())
                    or cfg.get("TWILIO_AUTH_TOKEN", "").strip()
                )
                and (cfg.get("TWILIO_MESSAGING_SERVICE_SID", "").strip() or cfg.get("TWILIO_FROM_NUMBER", "").strip())
            ),
        },
        "initial_admins": sorted(parse_initial_admins()),
        "public_base_url": (cfg.get("PUBLIC_BASE_URL") or "").strip().rstrip("/"),
    }


class GeneralSettingsRequest(BaseModel):
    PUBLIC_BASE_URL: str = ""


@router.put("/settings/general")
def save_general_settings(
    payload: GeneralSettingsRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(admin_required),
):
    base = payload.PUBLIC_BASE_URL.strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Base URL must start with http:// or https://")
    set_config_values(session, {"PUBLIC_BASE_URL": base})
    record_audit(
        session,
        actor.username,
        "GENERAL_SETTINGS_UPDATED",
        target="Public Base URL",
        details=base or "(browser origin fallback)",
    )
    return {"ok": True, "public_base_url": base}


@router.put("/settings/ldap")
def save_ldap_settings(
    payload: LdapSettingsRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(admin_required),
):
    set_config_values(
        session,
        {
            "LDAP_ENABLED": "true" if payload.LDAP_ENABLED else "false",
            "LDAP_HOST": payload.LDAP_HOST.strip(),
            "LDAP_PORT": str(payload.LDAP_PORT),
            "LDAP_USE_SSL": "true" if payload.LDAP_USE_SSL else "false",
            "LDAP_USER_DOMAIN": payload.LDAP_USER_DOMAIN.strip(),
            "LDAP_AUTH_TYPE": payload.LDAP_AUTH_TYPE.strip().upper(),
        },
    )
    record_audit(
        session,
        actor.username,
        "LDAP_SETTINGS_UPDATED",
        target=payload.LDAP_HOST or "disabled",
        details=f"enabled={payload.LDAP_ENABLED}, port={payload.LDAP_PORT}, ssl={payload.LDAP_USE_SSL}",
    )
    return {"ok": True}


@router.put("/settings/twilio")
def save_twilio_settings(
    payload: TwilioSettingsRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(admin_required),
):
    updates = {
        "TWILIO_ACCOUNT_SID": payload.TWILIO_ACCOUNT_SID.strip(),
        "TWILIO_API_KEY_SID": payload.TWILIO_API_KEY_SID.strip(),
        "TWILIO_MESSAGING_SERVICE_SID": payload.TWILIO_MESSAGING_SERVICE_SID.strip(),
        "TWILIO_FROM_NUMBER": payload.TWILIO_FROM_NUMBER.strip(),
    }
    if payload.TWILIO_API_KEY_SECRET.strip():
        updates["TWILIO_API_KEY_SECRET"] = payload.TWILIO_API_KEY_SECRET.strip()
    if payload.TWILIO_AUTH_TOKEN.strip():
        updates["TWILIO_AUTH_TOKEN"] = payload.TWILIO_AUTH_TOKEN.strip()

    set_config_values(session, updates)
    record_audit(session, actor.username, "TWILIO_SETTINGS_UPDATED", target=payload.TWILIO_ACCOUNT_SID.strip())
    return {"ok": True}


class RetentionSettingsRequest(BaseModel):
    EVENT_RETENTION_DAYS: int = 90
    AUDIT_RETENTION_DAYS: int = 365


@router.get("/database")
def get_database_info(session: Session = Depends(get_session), _: User = Depends(admin_required)):
    return get_database_stats(session)


@router.put("/settings/retention")
def save_retention_settings(
    payload: RetentionSettingsRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(admin_required),
):
    if payload.EVENT_RETENTION_DAYS < 0 or payload.AUDIT_RETENTION_DAYS < 0:
        raise HTTPException(status_code=400, detail="Retention days must be >= 0 (0 = keep forever)")
    set_config_values(
        session,
        {
            "EVENT_RETENTION_DAYS": str(payload.EVENT_RETENTION_DAYS),
            "AUDIT_RETENTION_DAYS": str(payload.AUDIT_RETENTION_DAYS),
        },
    )
    record_audit(
        session,
        actor.username,
        "RETENTION_POLICY_UPDATED",
        target="SQLite Database",
        details=f"events={payload.EVENT_RETENTION_DAYS}d, audit={payload.AUDIT_RETENTION_DAYS}d",
    )
    return {"ok": True}


@router.post("/database/prune")
def prune_database_now(session: Session = Depends(get_session), actor: User = Depends(admin_required)):
    res = prune_old_records(session, vacuum=True)
    record_audit(
        session,
        actor.username,
        "DATABASE_PRUNED",
        target="SQLite Database",
        details=f"deleted events={res['deleted_events']}, deliveries={res['deleted_deliveries']}, audit={res['deleted_audit_logs']}",
    )
    return res


@router.get("/audit")
def list_audit_logs(limit: int = 100, session: Session = Depends(get_session), _: User = Depends(admin_required)):
    rows = session.exec(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)).all()
    return [
        {
            "id": r.id,
            "actor": r.actor,
            "action": r.action,
            "target": r.target,
            "details": r.details,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
