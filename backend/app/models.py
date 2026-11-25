from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field, UniqueConstraint


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AppConfig(SQLModel, table=True):
    """Key-value configuration store (LDAP & Twilio settings), mirroring ocp-inventory."""
    key: str = Field(primary_key=True)
    value: str = Field(default="")
    updated_at: datetime = Field(default_factory=utcnow)


class User(SQLModel, table=True):
    """Authenticated user record. Roles: 'user' | 'admin'."""
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)  # normalized lowercase, without domain prefix
    display_name: str = Field(default="")
    role: str = Field(default="user")  # user, admin
    created_at: datetime = Field(default_factory=utcnow)
    last_login_at: Optional[datetime] = Field(default=None)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class Application(SQLModel, table=True):
    """Registered bank workload with a unique numeric MAP ID, webhook, and flood controls."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    map_id: int = Field(index=True, unique=True)
    description: str = Field(default="")
    webhook_id: str = Field(index=True, unique=True)
    token_hash: str  # SHA-256 hex digest of bearer token
    token_encrypted: str = Field(default="")  # Fernet-encrypted token for authorized GUI copy
    token_prefix: str  # Safe masked display prefix
    enabled: bool = Field(default=True)
    # Dedupe & flood protection (0 disables)
    dedupe_window_seconds: int = Field(default=300)  # Collapse identical alerts within 5 min
    max_per_minute: int = Field(default=5)  # Max SMS-dispatching triggers per 60s
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=utcnow)


class AppUserLink(SQLModel, table=True):
    """Assigns a logged-in User to manage an Application (self-managed app access)."""
    __table_args__ = (UniqueConstraint("app_id", "user_id", name="uq_app_user"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    app_id: int = Field(foreign_key="application.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    added_by: str = Field(default="system")
    added_at: datetime = Field(default_factory=utcnow)


class AppPhoneContact(SQLModel, table=True):
    """Phone number residing directly inside an Application (unique per app)."""
    __table_args__ = (UniqueConstraint("app_id", "phone_number", name="uq_app_phone"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    app_id: int = Field(foreign_key="application.id", index=True)
    name: str
    phone_number: str  # E.164 format e.g. +15551234567
    active: bool = Field(default=True)
    active_start_est: str = Field(default="")  # HH:MM (24h EST/America/New_York), empty = 24/7
    active_end_est: str = Field(default="")  # HH:MM (24h EST/America/New_York), empty = 24/7
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=utcnow)


class WebhookEvent(SQLModel, table=True):
    """Recorded incoming webhook trigger with ad-hoc metadata, dedupe fingerprint, and rendered SMS."""
    id: Optional[int] = Field(default=None, primary_key=True)
    app_id: int = Field(foreign_key="application.id", index=True)
    map_id: int
    environment: str = Field(default="PROD")
    app_name: str
    severity: str = Field(default="INFO")
    error_code: str = Field(default="")
    log_string: str = Field(default="")
    fingerprint: str = Field(default="", index=True)
    payload_json: str = Field(default="{}")
    rendered_sms: str = Field(default="")
    recipient_count: int = Field(default=0)
    delivered_count: int = Field(default=0)
    failed_count: int = Field(default=0)
    status: str = Field(default="Queued")  # Sent, Partial, Failed, Skipped, Deduplicated, RateLimited
    suppressed_reason: str = Field(default="")
    created_at: datetime = Field(default_factory=utcnow, index=True)


class SmsDelivery(SQLModel, table=True):
    """Individual Twilio SMS dispatch attempt for a WebhookEvent."""
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: int = Field(foreign_key="webhookevent.id", index=True)
    contact_name: str
    phone_number: str
    twilio_sid: str = Field(default="")
    status: str = Field(default="queued")
    error_message: str = Field(default="")
    created_at: datetime = Field(default_factory=utcnow)


class AuditLog(SQLModel, table=True):
    """Administrative audit trail for compliance."""
    id: Optional[int] = Field(default=None, primary_key=True)
    actor: str
    action: str
    target: str = Field(default="")
    details: str = Field(default="")
    created_at: datetime = Field(default_factory=utcnow)


class UrlMonitor(SQLModel, table=True):
    """Outgoing HTTP/HTTPS uptime & response monitor attached to an Application."""
    id: Optional[int] = Field(default=None, primary_key=True)
    app_id: int = Field(foreign_key="application.id", index=True)
    name: str = Field(default="")
    url: str
    method: str = Field(default="GET")  # GET, POST, HEAD
    auth_type: str = Field(default="none")  # none, bearer, basic
    auth_username: str = Field(default="")
    auth_secret: str = Field(default="")
    headers_json: str = Field(default="{}")
    expected_status: int = Field(default=200)  # 0 = any 2xx
    expected_body: str = Field(default="")
    expected_body_mode: str = Field(default="contains")  # contains, regex
    interval_seconds: int = Field(default=300)
    timeout_seconds: int = Field(default=10)
    max_latency_ms: int = Field(default=0)  # 0 = disabled; alert if reply exceeds threshold
    enabled: bool = Field(default=True)
    last_status: str = Field(default="unknown")  # unknown, ok, failing
    last_http_code: Optional[int] = Field(default=None)
    last_latency_ms: Optional[int] = Field(default=None)
    last_error: str = Field(default="")
    last_checked_at: Optional[datetime] = Field(default=None)
    last_alerted_at: Optional[datetime] = Field(default=None)
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=utcnow)


class CertMonitor(SQLModel, table=True):
    """Outgoing TLS certificate expiry monitor attached to an Application."""
    id: Optional[int] = Field(default=None, primary_key=True)
    app_id: int = Field(foreign_key="application.id", index=True)
    url: str
    days_before_expiry: int = Field(default=14)
    interval_seconds: int = Field(default=3600)
    enabled: bool = Field(default=True)
    last_status: str = Field(default="unknown")  # unknown, ok, expiring, expired, error
    days_remaining: Optional[int] = Field(default=None)
    cert_expires_at: Optional[datetime] = Field(default=None)
    cert_subject: str = Field(default="")
    cert_issuer: str = Field(default="")
    last_error: str = Field(default="")
    last_checked_at: Optional[datetime] = Field(default=None)
    last_alerted_at: Optional[datetime] = Field(default=None)
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=utcnow)
