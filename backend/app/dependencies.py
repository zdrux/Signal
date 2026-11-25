from typing import Optional
from fastapi import Request, HTTPException, Depends
from itsdangerous import URLSafeSerializer, BadSignature
from sqlmodel import Session, select

from app.config import SESSION_SECRET_KEY, SESSION_COOKIE_NAME, normalize_username, parse_initial_admins
from app.database import get_session
from app.models import User, AppUserLink
from app.services.config_store import is_ldap_enabled

serializer = URLSafeSerializer(SESSION_SECRET_KEY, salt="signal-auth-session")


def ensure_local_admin(session: Session) -> User:
    """When LDAP is not configured, provide a persistent local-admin user for full access."""
    user = session.exec(select(User).where(User.username == "local-admin")).first()
    if not user:
        user = User(username="local-admin", display_name="Local Admin (LDAP Unconfigured)", role="admin")
        session.add(user)
        session.commit()
        session.refresh(user)
    elif user.role != "admin":
        user.role = "admin"
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


def get_current_user_optional(request: Request, session: Session = Depends(get_session)) -> Optional[User]:
    if not is_ldap_enabled(session):
        return ensure_local_admin(session)

    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None

    try:
        username = normalize_username(serializer.loads(token))
    except BadSignature:
        return None

    user = session.exec(select(User).where(User.username == username)).first()
    if user and username in parse_initial_admins() and user.role != "admin":
        user.role = "admin"
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


def get_current_user(user: Optional[User] = Depends(get_current_user_optional)) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def admin_required(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return user


def assert_can_manage_app(session: Session, user: User, app_id: int) -> None:
    """Admins can manage any app; assigned users can self-manage their own apps."""
    if user.is_admin:
        return
    link = session.exec(
        select(AppUserLink).where(AppUserLink.app_id == app_id, AppUserLink.user_id == user.id)
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="You are not assigned to this application")


def get_accessible_app_ids(session: Session, user: User) -> Optional[list[int]]:
    """Return None for admins (all apps), or list of assigned app_ids for regular users."""
    if user.is_admin:
        return None
    links = session.exec(select(AppUserLink).where(AppUserLink.user_id == user.id)).all()
    return [lnk.app_id for lnk in links]
