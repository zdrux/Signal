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


# ==================== PII / TOKEN / SECRETS / HOSTNAME FILTER ====================

# 1. PEM private keys
_PEM_KEY_RE = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----"
)

# 2. Database & service connection strings with embedded credentials
_CONN_STR_URI_RE = re.compile(
    r"(?i)\b(?:postgres(?:ql)?|mysql|mariadb|mssql|sqlserver|mongodb(?:\+srv)?|redis|rediss|amqps?|ldaps?|sftp|ftp|smb|oracle|jdbc:[a-z0-9:]+)://[^\s,;'\"<>]+"
)
_ADO_CONN_SECRET_RE = re.compile(
    r"(?i)\b(Password|Pwd|User\s*ID|UID|AccountKey|SharedAccessKey)\s*=\s*(?!\[REDACTED)[^;\s,'\"]+"
)

# 3. JWTs
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")

# 4. Authorization schemes & known provider tokens
_AUTH_SCHEME_RE = re.compile(
    r"(?i)\b((?:bearer|basic|token|apikey|api-key|digest)\s+)(?!\[REDACTED)[A-Za-z0-9\-._~+/=]{6,}"
)
_KNOWN_TOKEN_RE = re.compile(
    r"\b(?:"
    r"sig_(?:live|demo|test)_[A-Za-z0-9_-]+"
    r"|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+"
    r"|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}"
    r"|gh[pousr]_[A-Za-z0-9]{20,}"
    r"|github_pat_[A-Za-z0-9_]{20,}"
    r"|glpat-[A-Za-z0-9_-]{20,}"
    r"|(?:AKIA|ASIA)[0-9A-Z]{16}"
    r"|AIza[0-9A-Za-z\-_]{35}"
    r"|xox[baprs]-[0-9A-Za-z-]{10,}"
    r"|sha256~[A-Za-z0-9_-]{20,}"
    r"|(?:SK|AC)[a-fA-F0-9]{32}"
    r")\b"
)
_AZURE_SAS_SIG_RE = re.compile(r"(?i)([?&]sig=)(?!\[REDACTED)[A-Za-z0-9%+/=]{16,}")

# 5. Labeled secrets / passwords / tokens (supports key=val, key: val, and JSON "key": "val")
_KV_SECRET_RE = re.compile(
    r"(?i)(['\"]?\b(?:password|passwd|pwd|passphrase|secret|client[_-]?secret|api[_-]?key|apikey"
    r"|auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?(?:id|token)"
    r"|private[_-]?key|signing[_-]?key|encryption[_-]?key|bearer[_-]?token|token|credential|creds|cookie)\b['\"]?)"
    r"(\s*[:=]\s*)(?!\[REDACTED)(['\"]?)[^\s,'\"&;}\]]+\3"
)

# 6. PII: Emails, SSN, Canadian SIN, DOB, Bank/Routing/IBAN, Credit Cards (Luhn), Phone Numbers
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_SSN_LABELED_RE = re.compile(r"(?i)\b(ssn)\s*([:=#]?)\s*\d{9}\b")
_SIN_RE = re.compile(r"\b\d{3}-\d{3}-\d{3}\b")
_SIN_LABELED_RE = re.compile(r"(?i)\b(sin)\s*([:=#]?)\s*\d{3}[\s-]?\d{3}[\s-]?\d{3}\b")
_DOB_LABELED_RE = re.compile(
    r"(?i)\b(dob|date[_ ]of[_ ]birth|birth[_ ]?date)\s*([:=])\s*['\"]?[0-9A-Za-z/\-, ]{6,20}['\"]?"
)
_IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")
_ACCOUNT_LABELED_RE = re.compile(
    r"(?i)\b(account(?:[_\s-]?(?:num|number|no|id))?|acct(?:[_\s-]?(?:num|no|#))?"
    r"|routing(?:[_\s-]?num)?|transit(?:[_\s-]?num)?|iban)\s*([:=#])\s*[A-Za-z0-9-]{5,24}\b"
)
_PAN_CANDIDATE_RE = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]\d{4}(?!\d)"
    r"|(?<!\d)\+[1-9]\d{9,14}(?!\d)"
)

# 7. Network & Server Identifiers: UNC paths, URLs, IPv4, IPv6, labeled hosts, FQDNs, enterprise hostnames
_UNC_PATH_RE = re.compile(r"\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._\\-]+")
_URL_RE = re.compile(r"(?i)\bhttps?://[^\s,;'\"<>)\]]+")
_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{1,5})?\b"
)
_IPV6_RE = re.compile(
    r"(?<![A-Za-z0-9:])(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}(?![A-Za-z0-9:])"
    r"|(?<![A-Za-z0-9:])::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,5}(?![A-Za-z0-9:])"
)
_LABELED_HOST_RE = re.compile(
    r"(?i)\b(server|host(?:name)?|node|fqdn|machine|vm|instance|cluster|db[_-]?host|endpoint)\s*([:=])\s*(['\"]?)[A-Za-z0-9._:/-]+\3"
)
_FQDN_RE = re.compile(
    r"(?i)\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"(?:internal|local|localdomain|corp|lan|intra|intranet|private|home|cluster|svc"
    r"|com|net|org|io|ca|co|gov|edu|cloud|bank|app|dev|prod|uat|sit|qa|stg|np)(?::\d{1,5})?\b"
)
_ENTERPRISE_HOST_RE = re.compile(
    r"(?i)\b(?:srv|svr|prd|prod|uat|dev|sit|qa|stg|dr|db|sql|ora|mq|app|web|api|gw|fw|lb|ocp|k8s"
    r"|node|wrk|worker|master|infra|vm|esx|win|lnx|rhel|aix|unix|host)"
    r"(?:[-_][a-z0-9]+)*[-_]?\d{1,4}(?:[-_][a-z0-9]+)*\b"
)


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


DLP_RULES: list[dict] = [
    # --- Secrets & Tokens ---
    {
        "id": "pem_private_key",
        "category": "Secrets & Tokens",
        "name": "PEM Private Keys",
        "replacement": "[REDACTED_PRIVATE_KEY]",
        "description": "RSA, EC, DSA, and OpenSSH PEM-encoded private key blocks.",
        "example": "-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----",
        "regex": _PEM_KEY_RE,
        "sub": "[REDACTED_PRIVATE_KEY]",
    },
    {
        "id": "conn_string_uri",
        "category": "Secrets & Tokens",
        "name": "Database & Service Connection URIs",
        "replacement": "[REDACTED_CONN_STR]",
        "description": "Postgres, MySQL, MongoDB, Redis, MSSQL, AMQP, LDAPS, SFTP, and JDBC URIs.",
        "example": "postgres://admin:secret@db01.internal:5432/prod",
        "regex": _CONN_STR_URI_RE,
        "sub": "[REDACTED_CONN_STR]",
    },
    {
        "id": "ado_conn_secret",
        "category": "Secrets & Tokens",
        "name": "ADO / Key-Value Connection Secrets",
        "replacement": "[REDACTED]",
        "description": "Embedded Password=, Pwd=, UID=, AccountKey=, and SharedAccessKey= parameters.",
        "example": "Server=db01;Password=MyDbPass123;",
        "regex": _ADO_CONN_SECRET_RE,
        "sub": r"\1=[REDACTED]",
    },
    {
        "id": "jwt",
        "category": "Secrets & Tokens",
        "name": "JSON Web Tokens (JWT)",
        "replacement": "[REDACTED_JWT]",
        "description": "Three-segment Base64URL-encoded JWTs starting with eyJ.",
        "example": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.signature123",
        "regex": _JWT_RE,
        "sub": "[REDACTED_JWT]",
    },
    {
        "id": "auth_scheme",
        "category": "Secrets & Tokens",
        "name": "Authorization Header Credentials",
        "replacement": "[REDACTED_TOKEN]",
        "description": "Bearer, Basic, Token, ApiKey, and Digest authorization header values.",
        "example": "Bearer ey1234567890abcdef",
        "regex": _AUTH_SCHEME_RE,
        "sub": r"\1[REDACTED_TOKEN]",
    },
    {
        "id": "known_token",
        "category": "Secrets & Tokens",
        "name": "Known Provider API Keys & Tokens",
        "replacement": "[REDACTED_TOKEN]",
        "description": "Signal, Stripe, GitHub, GitLab, AWS, Google, Slack, OpenAI/Anthropic, OpenShift, and Twilio keys.",
        "example": "ghp_1234567890abcdefghij123456",
        "regex": _KNOWN_TOKEN_RE,
        "sub": "[REDACTED_TOKEN]",
    },
    {
        "id": "azure_sas",
        "category": "Secrets & Tokens",
        "name": "Azure SAS Signatures",
        "replacement": "[REDACTED_TOKEN]",
        "description": "Shared Access Signature (?sig= / &sig=) query tokens.",
        "example": "?sv=2022-11-02&sig=AbCdEfGhIjKlMnOpQrStUvWxYz",
        "regex": _AZURE_SAS_SIG_RE,
        "sub": r"\1[REDACTED_TOKEN]",
    },
    {
        "id": "kv_secret",
        "category": "Secrets & Tokens",
        "name": "Labeled Passwords, Secrets & Tokens",
        "replacement": "[REDACTED]",
        "description": "Key-value or JSON fields named password, pwd, secret, api_key, token, session_id, cookie, etc.",
        "example": 'password=SuperSecret123, "api_key": "xyz987"',
        "regex": _KV_SECRET_RE,
        "sub": r"\1\2[REDACTED]",
    },
    # --- PII & Financial ---
    {
        "id": "email",
        "category": "PII & Financial",
        "name": "Email Addresses",
        "replacement": "[REDACTED_EMAIL]",
        "description": "Standard personal and corporate email addresses.",
        "example": "jane.doe@bank.com",
        "regex": _EMAIL_RE,
        "sub": "[REDACTED_EMAIL]",
    },
    {
        "id": "us_ssn",
        "category": "PII & Financial",
        "name": "US Social Security Numbers (SSN)",
        "replacement": "[REDACTED_SSN]",
        "description": "Hyphenated ###-##-#### patterns.",
        "example": "123-45-6789",
        "regex": _SSN_RE,
        "sub": "[REDACTED_SSN]",
    },
    {
        "id": "us_ssn_labeled",
        "category": "PII & Financial",
        "name": "Labeled 9-Digit SSNs",
        "replacement": "[REDACTED_SSN]",
        "description": "Unformatted 9-digit numbers prefixed with SSN.",
        "example": "SSN: 123456789",
        "regex": _SSN_LABELED_RE,
        "sub": r"\1\2[REDACTED_SSN]",
    },
    {
        "id": "ca_sin",
        "category": "PII & Financial",
        "name": "Canadian Social Insurance Numbers (SIN)",
        "replacement": "[REDACTED_SIN]",
        "description": "Hyphenated ###-###-### patterns.",
        "example": "123-456-789",
        "regex": _SIN_RE,
        "sub": "[REDACTED_SIN]",
    },
    {
        "id": "ca_sin_labeled",
        "category": "PII & Financial",
        "name": "Labeled Canadian SINs",
        "replacement": "[REDACTED_SIN]",
        "description": "9-digit numbers prefixed with SIN.",
        "example": "SIN=123 456 789",
        "regex": _SIN_LABELED_RE,
        "sub": r"\1\2[REDACTED_SIN]",
    },
    {
        "id": "dob",
        "category": "PII & Financial",
        "name": "Dates of Birth (DOB)",
        "replacement": "[REDACTED_DOB]",
        "description": "Fields labeled dob, date_of_birth, or birth_date.",
        "example": "dob=1988-04-12",
        "regex": _DOB_LABELED_RE,
        "sub": r"\1\2[REDACTED_DOB]",
    },
    {
        "id": "bank_account",
        "category": "PII & Financial",
        "name": "Bank Account, Routing & Transit Numbers",
        "replacement": "[REDACTED_ACCT]",
        "description": "Fields labeled account, acct, routing, transit, or iban.",
        "example": "acct_no=0049182736",
        "regex": _ACCOUNT_LABELED_RE,
        "sub": r"\1\2[REDACTED_ACCT]",
    },
    {
        "id": "iban",
        "category": "PII & Financial",
        "name": "IBAN Numbers",
        "replacement": "[REDACTED_ACCT]",
        "description": "International Bank Account Numbers (2-letter country + 2 check digits + BBAN).",
        "example": "GB29NWBK60161331926819",
        "regex": _IBAN_RE,
        "sub": "[REDACTED_ACCT]",
    },
    {
        "id": "credit_card",
        "category": "PII & Financial",
        "name": "Credit / Debit Card Numbers (PAN)",
        "replacement": "[REDACTED_CARD]",
        "description": "13–19 digit card numbers (spaces or dashes) validated with the Luhn checksum.",
        "example": "4532-0151-1283-0366",
        "regex": _PAN_CANDIDATE_RE,
        "sub": _redact_pan,
    },
    {
        "id": "phone_number",
        "category": "PII & Financial",
        "name": "Phone Numbers",
        "replacement": "[REDACTED_PHONE]",
        "description": "North American and international E.164 phone numbers inside alert text.",
        "example": "+1-416-555-0199",
        "regex": _PHONE_RE,
        "sub": "[REDACTED_PHONE]",
    },
    # --- Servers & Network ---
    {
        "id": "unc_path",
        "category": "Servers & Network",
        "name": "Windows UNC Server Shares",
        "replacement": "[REDACTED_HOST]",
        "description": "SMB / UNC paths referencing internal server names.",
        "example": r"\\filesrv01\finance\exports",
        "regex": _UNC_PATH_RE,
        "sub": "[REDACTED_HOST]",
    },
    {
        "id": "url",
        "category": "Servers & Network",
        "name": "HTTP / HTTPS URLs",
        "replacement": "[REDACTED_URL]",
        "description": "Full web URLs (scheme, hostname, port, path, and query string).",
        "example": "https://console.apps.ocp4.corp.internal/login",
        "regex": _URL_RE,
        "sub": "[REDACTED_URL]",
    },
    {
        "id": "labeled_host",
        "category": "Servers & Network",
        "name": "Labeled Server / Host / Node Fields",
        "replacement": "[REDACTED_HOST]",
        "description": "Fields labeled server=, host=, hostname=, node=, fqdn=, vm=, cluster=, db_host=, endpoint=.",
        "example": "server=prod-db-01.corp.internal",
        "regex": _LABELED_HOST_RE,
        "sub": r"\1\2[REDACTED_HOST]",
    },
    {
        "id": "ipv4",
        "category": "Servers & Network",
        "name": "IPv4 Addresses",
        "replacement": "[REDACTED_IP]",
        "description": "IPv4 addresses with optional port numbers.",
        "example": "10.24.8.15:8443",
        "regex": _IPV4_RE,
        "sub": "[REDACTED_IP]",
    },
    {
        "id": "ipv6",
        "category": "Servers & Network",
        "name": "IPv6 Addresses",
        "replacement": "[REDACTED_IP]",
        "description": "Standard and compressed IPv6 addresses.",
        "example": "2001:db8::1",
        "regex": _IPV6_RE,
        "sub": "[REDACTED_IP]",
    },
    {
        "id": "fqdn",
        "category": "Servers & Network",
        "name": "Fully Qualified Domain Names (FQDN)",
        "replacement": "[REDACTED_HOST]",
        "description": "Multi-label internal and external hostnames (.internal, .corp, .local, .com, .cloud, .bank, etc.).",
        "example": "db-prod-01.corp.internal",
        "regex": _FQDN_RE,
        "sub": "[REDACTED_HOST]",
    },
    {
        "id": "enterprise_host",
        "category": "Servers & Network",
        "name": "Enterprise Short Server Names",
        "replacement": "[REDACTED_HOST]",
        "description": "Common server naming patterns (srv-*, prd-*, uat-*, db-*, ocp-*, lnx-*, win-*, node-* with digits).",
        "example": "prd-app02, ocp4-worker-03",
        "regex": _ENTERPRISE_HOST_RE,
        "sub": "[REDACTED_HOST]",
    },
]


def get_dlp_rules_metadata() -> list[dict]:
    """Return JSON-serializable metadata for all active DLP scrubbing rules."""
    return [
        {
            "id": r["id"],
            "category": r["category"],
            "name": r["name"],
            "replacement": r["replacement"],
            "description": r["description"],
            "example": r["example"],
            "pattern": r["regex"].pattern,
        }
        for r in DLP_RULES
    ]


def inspect_redaction(text: str) -> dict:
    """Run all DLP rules on text and report the redacted output plus per-rule match counts."""
    if not text:
        return {
            "original": text or "",
            "redacted": text or "",
            "changed": False,
            "matched_rules": [],
            "total_redactions": 0,
        }

    s = text
    matched_rules: list[dict] = []
    total_redactions = 0

    for rule in DLP_RULES:
        regex = rule["regex"]
        sub = rule["sub"]
        if callable(sub):
            count = 0

            def _counting_sub(m: re.Match) -> str:
                nonlocal count
                out = sub(m)
                if out != m.group(0):
                    count += 1
                return out

            s = regex.sub(_counting_sub, s)
        else:
            s, count = regex.subn(sub, s)

        if count > 0:
            total_redactions += count
            matched_rules.append(
                {
                    "id": rule["id"],
                    "name": rule["name"],
                    "category": rule["category"],
                    "replacement": rule["replacement"],
                    "matches": count,
                }
            )

    return {
        "original": text,
        "redacted": s,
        "changed": s != text,
        "matched_rules": matched_rules,
        "total_redactions": total_redactions,
    }


def redact_sensitive_text(text: str) -> str:
    """Scrub PII, payment cards, JWTs, tokens, passwords, secrets, IPs, URLs, and server names before SMS dispatch."""
    if not text:
        return text
    return inspect_redaction(text)["redacted"]
