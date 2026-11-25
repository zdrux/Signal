from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import (
    SESSION_COOKIE_NAME,
    SESSION_COOKIE_MAX_AGE,
    COOKIE_SECURE,
    normalize_username,
    parse_initial_admins,
)
from app.database import get_session
from app.dependencies import serializer, get_current_user, get_current_user_optional
from app.models import User
from app.services.auth import authenticate_ldap
from app.services.config_store import is_ldap_enabled, get_config_value
from app.services.audit import record_audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.get("/me")
def get_me(session: Session = Depends(get_session), user: User | None = Depends(get_current_user_optional)):
    ldap_enabled = is_ldap_enabled(session)
    domain = get_config_value(session, "LDAP_USER_DOMAIN", "ad")
    public_base_url = (get_config_value(session, "PUBLIC_BASE_URL", "") or "").strip().rstrip("/")
    if not user:
        return {
            "authenticated": False,
            "ldap_enabled": ldap_enabled,
            "ldap_domain": domain,
            "public_base_url": public_base_url,
            "user": None,
        }
    return {
        "authenticated": True,
        "ldap_enabled": ldap_enabled,
        "ldap_domain": domain,
        "public_base_url": public_base_url,
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name or user.username,
            "role": user.role,
            "is_admin": user.is_admin,
        },
    }


@router.get("/users-directory")
def users_directory(session: Session = Depends(get_session), _: User = Depends(get_current_user)):
    """List logged-in/registered users so assigned app members can add colleagues to their apps."""
    users = session.exec(select(User).order_by(User.username)).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name or u.username,
            "role": u.role,
        }
        for u in users
    ]


@router.post("/login")
def login(payload: LoginRequest, response: Response, session: Session = Depends(get_session)):
    if not is_ldap_enabled(session):
        return {"ok": True, "message": "LDAP is not enabled; local admin mode is active."}

    raw_username = payload.username.strip()
    username = normalize_username(raw_username)
    if not username or not payload.password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    ok, display_name = authenticate_ldap(raw_username, payload.password, session)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid Active Directory credentials")

    initial_admins = parse_initial_admins()
    db_user = session.exec(select(User).where(User.username == username)).first()
    now = datetime.now(timezone.utc)

    if not db_user:
        has_any_admin = session.exec(select(User).where(User.role == "admin")).first()
        role = "admin" if (username in initial_admins or not has_any_admin) else "user"
        db_user = User(username=username, display_name=display_name or username, role=role, last_login_at=now)
        session.add(db_user)
    else:
        if username in initial_admins and db_user.role != "admin":
            db_user.role = "admin"
        if display_name:
            db_user.display_name = display_name
        db_user.last_login_at = now
        session.add(db_user)

    session.commit()
    session.refresh(db_user)
    record_audit(session, actor=db_user.username, action="USER_LOGIN", target=db_user.username, details=f"role={db_user.role}")

    token = serializer.dumps(db_user.username)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )
    return {
        "ok": True,
        "user": {
            "id": db_user.id,
            "username": db_user.username,
            "display_name": db_user.display_name or db_user.username,
            "role": db_user.role,
            "is_admin": db_user.is_admin,
        },
    }


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"ok": True}
