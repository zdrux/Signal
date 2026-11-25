import base64
import hashlib
import re
from cryptography.fernet import Fernet, InvalidToken

from app.config import SESSION_SECRET_KEY

# ==================== TOKEN ENCRYPTION AT REST ====================

def _get_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(SESSION_SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""


# ==================== PII / TOKEN / SECRETS FILTER ====================

_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_BEARER_RE = re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9\-._~+/]+=*")
_KNOWN_TOKEN_RE = re.compile(
    r"\b(?:sig_live_[A-Za-z0-9]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|SK[a-fA-F0-9]{32})\b"
)
_KV_SECRET_RE = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)\s*([:=])\s*(['\"]?)[^\s,'\"&;]+\3"
)
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_ACCOUNT_LABELED_RE = re.compile(
    r"(?i)\b(account(?:[_\s-]?(?:num|number|no|id))?|acct(?:[_\s-]?(?:num|no|#))?|routing(?:[_\s-]?num)?)\s*([:=#])\s*\d{6,17}\b"
)
_PAN_CANDIDATE_RE = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _passes_luhn(digits: str) -> bool:
    total = 0
    reverse = digits[::-1]
    for i, ch in enumerate(reverse):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _redact_pan(match: re.Match) -> str:
    raw = match.group(0)
    digits = re.sub(r"\D", "", raw)
    if 13 <= len(digits) <= 19 and _passes_luhn(digits):
        return "[REDACTED_CARD]"
    return raw


def redact_sensitive_text(text: str) -> str:
    """Scrub PII, payment cards, JWTs, bearer tokens, API keys, and labeled secrets before SMS dispatch."""
    if not text:
        return text
    s = _JWT_RE.sub("[REDACTED_JWT]", text)
    s = _BEARER_RE.sub(r"\1[REDACTED_TOKEN]", s)
    s = _KNOWN_TOKEN_RE.sub("[REDACTED_TOKEN]", s)
    s = _KV_SECRET_RE.sub(r"\1\2[REDACTED]", s)
    s = _SSN_RE.sub("[REDACTED_SSN]", s)
    s = _ACCOUNT_LABELED_RE.sub(r"\1\2[REDACTED_ACCT]", s)
    s = _EMAIL_RE.sub("[REDACTED_EMAIL]", s)
    s = _PAN_CANDIDATE_RE.sub(_redact_pan, s)
    return s
