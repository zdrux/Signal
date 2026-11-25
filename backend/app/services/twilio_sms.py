import requests
from dataclasses import dataclass
from sqlmodel import Session
from app.services.config_store import get_all_config
from app.services.dlp import redact_sensitive_text

MAX_SMS_LENGTH = 300


@dataclass
class TwilioSendResult:
    ok: bool
    sid: str
    status: str
    error_message: str = ""


def format_sms_body(
    app_name: str,
    map_id: int,
    severity: str,
    error_code: str,
    log_string: str,
) -> str:
    prefix = f"[Signal] [{severity}] {app_name} (MAP {map_id})"
    detail_parts = []
    if error_code:
        detail_parts.append(error_code)
    if log_string:
        detail_parts.append(log_string)
    detail = ": ".join(detail_parts) if detail_parts else "Webhook alert triggered"
    msg = redact_sensitive_text(f"{prefix} | {detail}")
    if len(msg) > MAX_SMS_LENGTH:
        msg = msg[: MAX_SMS_LENGTH - 3] + "..."
    return msg


def send_twilio_sms(session: Session, to_number: str, body: str) -> TwilioSendResult:
    """Send a real SMS via Twilio's REST API using either API Key (SK...) or Auth Token."""
    cfg = get_all_config(session)
    account_sid = (cfg.get("TWILIO_ACCOUNT_SID") or "").strip()
    api_key_sid = (cfg.get("TWILIO_API_KEY_SID") or "").strip()
    api_key_secret = (cfg.get("TWILIO_API_KEY_SECRET") or "").strip()
    auth_token = (cfg.get("TWILIO_AUTH_TOKEN") or "").strip()
    messaging_service_sid = (cfg.get("TWILIO_MESSAGING_SERVICE_SID") or "").strip()
    from_number = (cfg.get("TWILIO_FROM_NUMBER") or "").strip()

    if not account_sid:
        return TwilioSendResult(ok=False, sid="", status="failed", error_message="TWILIO_ACCOUNT_SID is not configured")

    if api_key_sid and api_key_secret:
        auth = (api_key_sid, api_key_secret)
    elif auth_token:
        auth = (account_sid, auth_token)
    else:
        return TwilioSendResult(
            ok=False,
            sid="",
            status="failed",
            error_message="Configure TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (or TWILIO_AUTH_TOKEN)",
        )

    if not messaging_service_sid and not from_number:
        return TwilioSendResult(
            ok=False,
            sid="",
            status="failed",
            error_message="Configure TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER",
        )

    # Defense-in-depth: always run DLP redaction right before Twilio API dispatch
    safe_body = redact_sensitive_text(body)
    if len(safe_body) > MAX_SMS_LENGTH:
        safe_body = safe_body[: MAX_SMS_LENGTH - 3] + "..."

    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    form_data = {"To": to_number, "Body": safe_body}
    if messaging_service_sid:
        form_data["MessagingServiceSid"] = messaging_service_sid
    else:
        form_data["From"] = from_number

    try:
        resp = requests.post(url, auth=auth, data=form_data, timeout=15)
        data = resp.json() if resp.content else {}
        if 200 <= resp.status_code < 300:
            return TwilioSendResult(
                ok=True,
                sid=data.get("sid", ""),
                status=data.get("status", "queued"),
            )
        err_msg = data.get("message") or f"Twilio HTTP {resp.status_code}"
        if data.get("code"):
            err_msg = f"[{data['code']}] {err_msg}"
        return TwilioSendResult(ok=False, sid=data.get("sid", ""), status="failed", error_message=err_msg)
    except Exception as exc:
        return TwilioSendResult(ok=False, sid="", status="failed", error_message=str(exc))
