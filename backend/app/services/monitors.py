import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import re
import socket
import ssl
import time
from urllib.parse import urlparse

import requests
import urllib3
from cryptography import x509
from sqlmodel import Session, select

from app.database import engine
from app.models import Application, UrlMonitor, CertMonitor
from app.routers.webhooks import _dispatch_for_app
from app.services.maintenance import prune_old_records

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CERT_REALERT_COOLDOWN = timedelta(hours=24)
_LAST_AUTO_PRUNE: datetime | None = None


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_host_port(raw_url: str) -> tuple[str, int]:
    """Parse 'https://host:8443/path', 'host:8443', or 'host' -> (host, port)."""
    val = (raw_url or "").strip()
    if "://" not in val:
        val = "https://" + val
    parsed = urlparse(val)
    host = parsed.hostname or ""
    if not host:
        raise ValueError(f"Invalid endpoint URL: {raw_url}")
    port = parsed.port or (80 if parsed.scheme == "http" else 443)
    return host, port


def run_url_monitor_check(session: Session, monitor: UrlMonitor) -> dict:
    """Execute a single URL monitor check (TLS verify skipped) and alert on state change."""
    app = session.get(Application, monitor.app_id)
    if not app:
        return {"ok": False, "error": "Application not found"}

    prev_status = monitor.last_status
    now = datetime.now(timezone.utc)

    headers: dict[str, str] = {}
    if monitor.headers_json:
        try:
            parsed = json.loads(monitor.headers_json)
            if isinstance(parsed, dict):
                headers = {str(k): str(v) for k, v in parsed.items()}
        except json.JSONDecodeError:
            pass

    auth = None
    if monitor.auth_type == "bearer" and monitor.auth_secret:
        headers["Authorization"] = f"Bearer {monitor.auth_secret}"
    elif monitor.auth_type == "basic" and (monitor.auth_username or monitor.auth_secret):
        auth = (monitor.auth_username, monitor.auth_secret)

    t0 = time.monotonic()
    http_code = None
    error_msg = ""
    is_ok = False

    try:
        resp = requests.request(
            method=(monitor.method or "GET").upper(),
            url=monitor.url,
            headers=headers,
            auth=auth,
            verify=False,  # Always skip TLS verification for internal/self-signed URLs
            timeout=monitor.timeout_seconds or 10,
        )
        http_code = resp.status_code
        expected = monitor.expected_status or 0
        status_ok = (http_code == expected) if expected > 0 else (200 <= http_code < 300)
        if not status_ok:
            exp_label = str(expected) if expected > 0 else "2xx"
            error_msg = f"HTTP {http_code} (expected {exp_label})"
        elif monitor.expected_body:
            body_text = resp.text or ""
            if (monitor.expected_body_mode or "contains") == "regex":
                try:
                    matched = bool(re.search(monitor.expected_body, body_text))
                except re.error as regex_err:
                    matched = False
                    error_msg = f"Invalid regex pattern: {regex_err}"
                if not matched and not error_msg:
                    error_msg = f"Response body did not match regex: /{monitor.expected_body[:40]}/"
                elif matched:
                    is_ok = True
            else:
                if monitor.expected_body not in body_text:
                    error_msg = f"Response body missing expected text: '{monitor.expected_body[:40]}'"
                else:
                    is_ok = True
        else:
            is_ok = True
    except Exception as exc:
        error_msg = str(exc)[:240]

    latency_ms = int((time.monotonic() - t0) * 1000)
    if is_ok and (monitor.max_latency_ms or 0) > 0 and latency_ms > monitor.max_latency_ms:
        is_ok = False
        error_msg = f"Slow response: {latency_ms}ms (limit {monitor.max_latency_ms}ms)"
    new_status = "ok" if is_ok else "failing"

    monitor.last_status = new_status
    monitor.last_http_code = http_code
    monitor.last_latency_ms = latency_ms
    monitor.last_error = error_msg
    monitor.last_checked_at = now

    alert_dispatched = False
    label = monitor.name or monitor.url

    if new_status == "failing" and prev_status != "failing":
        _dispatch_for_app(
            session,
            app,
            {
                "source": "url_monitor",
                "monitor_id": monitor.id,
                "url": monitor.url,
                "severity": "CRITICAL",
                "error_code": "URL_DOWN",
                "log_string": f"{label}: {error_msg}",
            },
            bypass_guards=False,
        )
        monitor.last_alerted_at = now
        alert_dispatched = True
    elif new_status == "ok" and prev_status == "failing":
        _dispatch_for_app(
            session,
            app,
            {
                "source": "url_monitor",
                "monitor_id": monitor.id,
                "url": monitor.url,
                "severity": "RESOLVED",
                "error_code": "URL_RECOVERED",
                "log_string": f"{label} recovered (HTTP {http_code}, {latency_ms}ms)",
            },
            bypass_guards=False,
        )
        monitor.last_alerted_at = now
        alert_dispatched = True

    session.add(monitor)
    session.commit()
    return {
        "id": monitor.id,
        "status": new_status,
        "http_code": http_code,
        "latency_ms": latency_ms,
        "error": error_msg,
        "alert_dispatched": alert_dispatched,
    }


def fetch_peer_certificate(host: str, port: int, timeout: int = 10) -> x509.Certificate:
    """Connect over TLS (ignoring CA validation so internal/self-signed certs work) and parse X.509 cert."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            der = ssock.getpeercert(binary_form=True)
            if not der:
                raise ValueError("Server did not present a TLS certificate")
            return x509.load_der_x509_certificate(der)


def run_cert_monitor_check(session: Session, monitor: CertMonitor) -> dict:
    """Inspect TLS certificate expiry and alert on failure/expiry (at most once per 24h) or recovery."""
    app = session.get(Application, monitor.app_id)
    if not app:
        return {"ok": False, "error": "Application not found"}

    prev_status = monitor.last_status
    now = datetime.now(timezone.utc)
    days_remaining = None
    expires_at = None
    subject = ""
    issuer = ""
    error_msg = ""

    try:
        host, port = parse_host_port(monitor.url)
        cert = fetch_peer_certificate(host, port)
        expires_at = cert.not_valid_after_utc
        days_remaining = int((expires_at - now).total_seconds() // 86400)
        subject = cert.subject.rfc4514_string()
        issuer = cert.issuer.rfc4514_string()

        if days_remaining <= 0:
            new_status = "expired"
            error_msg = f"Certificate expired {abs(days_remaining)}d ago ({expires_at.strftime('%Y-%m-%d')})"
        elif days_remaining <= monitor.days_before_expiry:
            new_status = "expiring"
            error_msg = f"Certificate expires in {days_remaining}d ({expires_at.strftime('%Y-%m-%d')})"
        else:
            new_status = "ok"
    except Exception as exc:
        new_status = "error"
        error_msg = str(exc)[:240]

    monitor.last_status = new_status
    monitor.days_remaining = days_remaining
    monitor.cert_expires_at = expires_at
    monitor.cert_subject = subject
    monitor.cert_issuer = issuer
    monitor.last_error = error_msg
    monitor.last_checked_at = now

    alert_dispatched = False
    last_alerted = _as_utc(monitor.last_alerted_at)
    cooldown_elapsed = (last_alerted is None) or ((now - last_alerted) >= CERT_REALERT_COOLDOWN)

    if new_status in ("expired", "expiring", "error"):
        should_alert = (prev_status in ("unknown", "ok")) or cooldown_elapsed
        if should_alert:
            sev = "CRITICAL" if new_status in ("expired", "error") else "HIGH"
            code = "CERT_EXPIRED" if new_status == "expired" else ("CERT_EXPIRING" if new_status == "expiring" else "CERT_CHECK_ERROR")
            _dispatch_for_app(
                session,
                app,
                {
                    "source": "cert_monitor",
                    "monitor_id": monitor.id,
                    "url": monitor.url,
                    "days_remaining": days_remaining,
                    "severity": sev,
                    "error_code": code,
                    "log_string": f"{monitor.url}: {error_msg}",
                },
                bypass_guards=False,
            )
            monitor.last_alerted_at = now
            alert_dispatched = True
    elif new_status == "ok" and prev_status in ("expired", "expiring", "error"):
        _dispatch_for_app(
            session,
            app,
            {
                "source": "cert_monitor",
                "monitor_id": monitor.id,
                "url": monitor.url,
                "days_remaining": days_remaining,
                "severity": "RESOLVED",
                "error_code": "CERT_RENEWED",
                "log_string": f"{monitor.url} certificate healthy ({days_remaining}d remaining)",
            },
            bypass_guards=False,
        )
        monitor.last_alerted_at = now
        alert_dispatched = True

    session.add(monitor)
    session.commit()
    return {
        "id": monitor.id,
        "status": new_status,
        "days_remaining": days_remaining,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "error": error_msg,
        "alert_dispatched": alert_dispatched,
    }


def _run_url_check_isolated(monitor_id: int) -> None:
    with Session(engine) as session:
        m = session.get(UrlMonitor, monitor_id)
        if m and m.enabled:
            try:
                run_url_monitor_check(session, m)
            except Exception as exc:
                print(f"URL monitor {monitor_id} error: {exc}")


def _run_cert_check_isolated(monitor_id: int) -> None:
    with Session(engine) as session:
        cm = session.get(CertMonitor, monitor_id)
        if cm and cm.enabled:
            try:
                run_cert_monitor_check(session, cm)
            except Exception as exc:
                print(f"Cert monitor {monitor_id} error: {exc}")


def _tick_due_monitors() -> None:
    """Collect due monitor IDs quickly, then run network checks concurrently without holding a DB lock."""
    global _LAST_AUTO_PRUNE
    now = datetime.now(timezone.utc)
    due_url_ids: list[int] = []
    due_cert_ids: list[int] = []

    with Session(engine) as session:
        if _LAST_AUTO_PRUNE is None or (now - _LAST_AUTO_PRUNE) >= timedelta(hours=24):
            try:
                prune_old_records(session, vacuum=False)
                _LAST_AUTO_PRUNE = now
            except Exception as exc:
                print(f"Auto-prune skipped: {exc}")

        for m in session.exec(select(UrlMonitor).where(UrlMonitor.enabled == True)).all():  # noqa: E712
            last = _as_utc(m.last_checked_at)
            if last is None or (now - last).total_seconds() >= max(30, m.interval_seconds):
                due_url_ids.append(m.id)

        for cm in session.exec(select(CertMonitor).where(CertMonitor.enabled == True)).all():  # noqa: E712
            last = _as_utc(cm.last_checked_at)
            if last is None or (now - last).total_seconds() >= max(60, cm.interval_seconds):
                due_cert_ids.append(cm.id)

    if not due_url_ids and not due_cert_ids:
        return

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(_run_url_check_isolated, mid) for mid in due_url_ids]
        futures += [pool.submit(_run_cert_check_isolated, cid) for cid in due_cert_ids]
        for fut in futures:
            try:
                fut.result()
            except Exception as exc:
                print(f"Monitor worker error: {exc}")


async def monitor_scheduler_loop(stop_event: asyncio.Event) -> None:
    """Background loop checking due monitors every 15 seconds."""
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(_tick_due_monitors)
        except Exception as exc:
            print(f"Monitor scheduler tick error: {exc}")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass
