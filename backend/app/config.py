import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root or backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def normalize_username(raw: str) -> str:
    """Normalize 'ad\\jdoe', 'AD\\JDoe', or 'jdoe' -> 'jdoe'."""
    val = (raw or "").strip().lower()
    if "\\" in val:
        val = val.split("\\", 1)[1]
    if "@" in val:
        val = val.split("@", 1)[0]
    return val.strip()


def parse_initial_admins() -> set[str]:
    """Parse INITIAL_ADMINS env var (e.g., 'ad\\jdoe,ad\\asmith') into normalized usernames."""
    raw = os.getenv("INITIAL_ADMINS", "")
    result: set[str] = set()
    for part in raw.split(","):
        norm = normalize_username(part)
        if norm:
            result.add(norm)
    return result


DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(BASE_DIR / 'data' / 'signal.db').as_posix()}")
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY", "signal-dev-secret-change-me")
SESSION_COOKIE_NAME = "signal_session"
SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# Environment defaults for LDAP & Twilio (can also be managed via Admin Settings in SQLite)
ENV_DEFAULTS = {
    "LDAP_ENABLED": os.getenv("LDAP_ENABLED", "false"),
    "LDAP_HOST": os.getenv("LDAP_HOST", ""),
    "LDAP_PORT": os.getenv("LDAP_PORT", "636"),
    "LDAP_USE_SSL": os.getenv("LDAP_USE_SSL", "true"),
    "LDAP_USER_DOMAIN": os.getenv("LDAP_USER_DOMAIN", "ad"),
    "LDAP_AUTH_TYPE": os.getenv("LDAP_AUTH_TYPE", "SIMPLE"),
    "TWILIO_ACCOUNT_SID": os.getenv("TWILIO_ACCOUNT_SID", ""),
    "TWILIO_API_KEY_SID": os.getenv("TWILIO_API_KEY_SID", ""),
    "TWILIO_API_KEY_SECRET": os.getenv("TWILIO_API_KEY_SECRET", ""),
    "TWILIO_AUTH_TOKEN": os.getenv("TWILIO_AUTH_TOKEN", ""),
    "TWILIO_MESSAGING_SERVICE_SID": os.getenv("TWILIO_MESSAGING_SERVICE_SID", ""),
    "TWILIO_FROM_NUMBER": os.getenv("TWILIO_FROM_NUMBER", ""),
    "EVENT_RETENTION_DAYS": os.getenv("EVENT_RETENTION_DAYS", "90"),
    "AUDIT_RETENTION_DAYS": os.getenv("AUDIT_RETENTION_DAYS", "365"),
    "PUBLIC_BASE_URL": os.getenv("PUBLIC_BASE_URL", ""),
}
