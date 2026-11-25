from sqlmodel import Session
from app.models import AuditLog


def record_audit(session: Session, actor: str, action: str, target: str = "", details: str = "") -> None:
    session.add(AuditLog(actor=actor, action=action, target=target, details=details))
    session.commit()
