import json
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.database import get_session
from app.dependencies import get_current_user, assert_can_manage_app
from app.models import Application, UrlMonitor, CertMonitor, User
from app.services.audit import record_audit
from app.services.monitors import run_url_monitor_check, run_cert_monitor_check, parse_host_port

router = APIRouter(prefix="/api/apps", tags=["monitors"])


class CreateUrlMonitorRequest(BaseModel):
    name: str = ""
    url: str
    method: str = "GET"
    auth_type: str = "none"  # none, bearer, basic
    auth_username: str = ""
    auth_secret: str = ""
    headers_json: str = "{}"
    expected_status: int = 200
    expected_body: str = ""
    expected_body_mode: str = "contains"  # contains, regex
    interval_seconds: int = 300
    timeout_seconds: int = 10
    max_latency_ms: int = 0


class UpdateUrlMonitorRequest(BaseModel):
    name: str | None = None
    url: str | None = None
    method: str | None = None
    auth_type: str | None = None
    auth_username: str | None = None
    auth_secret: str | None = None
    headers_json: str | None = None
    expected_status: int | None = None
    expected_body: str | None = None
    expected_body_mode: str | None = None
    interval_seconds: int | None = None
    max_latency_ms: int | None = None
    enabled: bool | None = None


class CreateCertMonitorsBatchRequest(BaseModel):
    urls: list[str]
    days_before_expiry: int = 14
    interval_seconds: int = 3600


class UpdateCertMonitorRequest(BaseModel):
    days_before_expiry: int | None = None
    interval_seconds: int | None = None
    enabled: bool | None = None


def _validate_headers_json(raw: str) -> str:
    val = (raw or "").strip() or "{}"
    try:
        parsed = json.loads(val)
        if not isinstance(parsed, dict):
            raise ValueError("Headers must be a JSON object")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid headers JSON: {exc}")
    return json.dumps(parsed)


# ==================== URL MONITORS ====================

@router.post("/{app_id}/url-monitors")
def create_url_monitor(
    app_id: int,
    payload: CreateUrlMonitorRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    url = payload.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
    if payload.auth_type not in ("none", "bearer", "basic"):
        raise HTTPException(status_code=400, detail="auth_type must be none, bearer, or basic")
    body_mode = (payload.expected_body_mode or "contains").strip().lower()
    if body_mode not in ("contains", "regex"):
        raise HTTPException(status_code=400, detail="expected_body_mode must be contains or regex")
    if body_mode == "regex" and payload.expected_body:
        try:
            re.compile(payload.expected_body)
        except re.error as exc:
            raise HTTPException(status_code=400, detail=f"Invalid regex pattern: {exc}")
    headers_json = _validate_headers_json(payload.headers_json)

    monitor = UrlMonitor(
        app_id=app_id,
        name=payload.name.strip(),
        url=url,
        method=(payload.method or "GET").strip().upper(),
        auth_type=payload.auth_type,
        auth_username=payload.auth_username.strip(),
        auth_secret=payload.auth_secret.strip(),
        headers_json=headers_json,
        expected_status=max(0, payload.expected_status),
        expected_body=payload.expected_body,
        expected_body_mode=body_mode,
        interval_seconds=max(30, payload.interval_seconds),
        timeout_seconds=max(2, min(60, payload.timeout_seconds)),
        max_latency_ms=max(0, payload.max_latency_ms),
        enabled=True,
        created_by=actor.username,
    )
    session.add(monitor)
    session.commit()
    session.refresh(monitor)
    record_audit(session, actor.username, "URL_MONITOR_CREATED", target=f"{app.name}:{monitor.url}")
    return {"id": monitor.id, "url": monitor.url}


@router.patch("/{app_id}/url-monitors/{monitor_id}")
def update_url_monitor(
    app_id: int,
    monitor_id: int,
    payload: UpdateUrlMonitorRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    monitor = session.get(UrlMonitor, monitor_id)
    if not monitor or monitor.app_id != app_id:
        raise HTTPException(status_code=404, detail="URL monitor not found")
    assert_can_manage_app(session, actor, app_id)

    changes: list[str] = []
    if payload.name is not None and payload.name.strip() != monitor.name:
        changes.append(f"name: '{monitor.name}' -> '{payload.name.strip()}'")
        monitor.name = payload.name.strip()
    if payload.url is not None and payload.url.strip() != monitor.url:
        url = payload.url.strip()
        if not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
        changes.append(f"url: {monitor.url} -> {url}")
        monitor.url = url
    if payload.method is not None and payload.method.strip().upper() != monitor.method:
        changes.append(f"method: {monitor.method} -> {payload.method.strip().upper()}")
        monitor.method = payload.method.strip().upper()
    if payload.auth_type is not None and payload.auth_type != monitor.auth_type:
        changes.append(f"auth: {monitor.auth_type} -> {payload.auth_type}")
        monitor.auth_type = payload.auth_type
    if payload.auth_username is not None:
        monitor.auth_username = payload.auth_username.strip()
    if payload.auth_secret is not None and payload.auth_secret.strip():
        changes.append("auth_secret updated")
        monitor.auth_secret = payload.auth_secret.strip()
    if payload.headers_json is not None:
        validated_hdrs = _validate_headers_json(payload.headers_json)
        if validated_hdrs != monitor.headers_json:
            changes.append("headers updated")
            monitor.headers_json = validated_hdrs
    if payload.expected_status is not None and max(0, payload.expected_status) != monitor.expected_status:
        changes.append(f"expected_status: {monitor.expected_status} -> {max(0, payload.expected_status)}")
        monitor.expected_status = max(0, payload.expected_status)
    if payload.expected_body is not None and payload.expected_body != monitor.expected_body:
        changes.append("expected_body updated")
        monitor.expected_body = payload.expected_body
    if payload.expected_body_mode is not None:
        bm = payload.expected_body_mode.strip().lower()
        if bm not in ("contains", "regex"):
            raise HTTPException(status_code=400, detail="expected_body_mode must be contains or regex")
        if bm != monitor.expected_body_mode:
            changes.append(f"match_mode: {monitor.expected_body_mode} -> {bm}")
            monitor.expected_body_mode = bm
    if monitor.expected_body_mode == "regex" and monitor.expected_body:
        try:
            re.compile(monitor.expected_body)
        except re.error as exc:
            raise HTTPException(status_code=400, detail=f"Invalid regex pattern: {exc}")
    if payload.interval_seconds is not None and max(30, payload.interval_seconds) != monitor.interval_seconds:
        changes.append(f"interval: {monitor.interval_seconds}s -> {max(30, payload.interval_seconds)}s")
        monitor.interval_seconds = max(30, payload.interval_seconds)
    if payload.max_latency_ms is not None and max(0, payload.max_latency_ms) != monitor.max_latency_ms:
        changes.append(f"max_latency: {monitor.max_latency_ms}ms -> {max(0, payload.max_latency_ms)}ms")
        monitor.max_latency_ms = max(0, payload.max_latency_ms)
    if payload.enabled is not None and payload.enabled != monitor.enabled:
        changes.append(f"monitor: {'Enabled' if payload.enabled else 'Paused'}")
        monitor.enabled = payload.enabled

    session.add(monitor)
    session.commit()
    if changes:
        app = session.get(Application, app_id)
        app_label = f"{app.name} (MAP {app.map_id})" if app else f"app:{app_id}"
        record_audit(
            session,
            actor.username,
            "URL_MONITOR_UPDATED",
            target=f"{app_label} · {monitor.name or monitor.url}",
            details=", ".join(changes),
        )
    return {"ok": True}


@router.post("/{app_id}/url-monitors/{monitor_id}/check")
def check_url_monitor_now(
    app_id: int,
    monitor_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    monitor = session.get(UrlMonitor, monitor_id)
    if not monitor or monitor.app_id != app_id:
        raise HTTPException(status_code=404, detail="URL monitor not found")
    assert_can_manage_app(session, actor, app_id)
    return run_url_monitor_check(session, monitor)


@router.delete("/{app_id}/url-monitors/{monitor_id}")
def delete_url_monitor(
    app_id: int,
    monitor_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    monitor = session.get(UrlMonitor, monitor_id)
    if not monitor or monitor.app_id != app_id:
        raise HTTPException(status_code=404, detail="URL monitor not found")
    assert_can_manage_app(session, actor, app_id)
    url = monitor.url
    session.delete(monitor)
    session.commit()
    record_audit(session, actor.username, "URL_MONITOR_DELETED", target=f"app:{app_id}:{url}")
    return {"ok": True}


# ==================== CERTIFICATE EXPIRY MONITORS ====================

@router.post("/{app_id}/cert-monitors")
def create_cert_monitors_batch(
    app_id: int,
    payload: CreateCertMonitorsBatchRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    """Create individual certificate expiry monitor entries from one or more pasted URLs."""
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    assert_can_manage_app(session, actor, app_id)

    cleaned_urls = []
    for raw in payload.urls:
        u = raw.strip()
        if not u:
            continue
        try:
            parse_host_port(u)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        cleaned_urls.append(u)

    if not cleaned_urls:
        raise HTTPException(status_code=400, detail="Provide at least one valid URL or hostname")

    created = []
    for u in cleaned_urls:
        cm = CertMonitor(
            app_id=app_id,
            url=u,
            days_before_expiry=max(1, payload.days_before_expiry),
            interval_seconds=max(60, payload.interval_seconds),
            enabled=True,
            created_by=actor.username,
        )
        session.add(cm)
        session.flush()
        created.append({"id": cm.id, "url": cm.url})

    session.commit()
    record_audit(
        session,
        actor.username,
        "CERT_MONITORS_CREATED",
        target=f"{app.name} ({len(created)} endpoints)",
        details=f"threshold={payload.days_before_expiry}d",
    )
    return {"created": created, "count": len(created)}


@router.patch("/{app_id}/cert-monitors/{monitor_id}")
def update_cert_monitor(
    app_id: int,
    monitor_id: int,
    payload: UpdateCertMonitorRequest,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    monitor = session.get(CertMonitor, monitor_id)
    if not monitor or monitor.app_id != app_id:
        raise HTTPException(status_code=404, detail="Certificate monitor not found")
    assert_can_manage_app(session, actor, app_id)

    changes: list[str] = []
    if payload.days_before_expiry is not None and max(1, payload.days_before_expiry) != monitor.days_before_expiry:
        changes.append(f"threshold: {monitor.days_before_expiry}d -> {max(1, payload.days_before_expiry)}d")
        monitor.days_before_expiry = max(1, payload.days_before_expiry)
    if payload.interval_seconds is not None and max(60, payload.interval_seconds) != monitor.interval_seconds:
        changes.append(f"interval: {monitor.interval_seconds}s -> {max(60, payload.interval_seconds)}s")
        monitor.interval_seconds = max(60, payload.interval_seconds)
    if payload.enabled is not None and payload.enabled != monitor.enabled:
        changes.append(f"monitor: {'Enabled' if payload.enabled else 'Paused'}")
        monitor.enabled = payload.enabled

    session.add(monitor)
    session.commit()
    if changes:
        app = session.get(Application, app_id)
        app_label = f"{app.name} (MAP {app.map_id})" if app else f"app:{app_id}"
        record_audit(
            session,
            actor.username,
            "CERT_MONITOR_UPDATED",
            target=f"{app_label} · {monitor.url}",
            details=", ".join(changes),
        )
    return {"ok": True}


@router.post("/{app_id}/cert-monitors/{monitor_id}/check")
def check_cert_monitor_now(
    app_id: int,
    monitor_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    monitor = session.get(CertMonitor, monitor_id)
    if not monitor or monitor.app_id != app_id:
        raise HTTPException(status_code=404, detail="Certificate monitor not found")
    assert_can_manage_app(session, actor, app_id)
    return run_cert_monitor_check(session, monitor)


@router.delete("/{app_id}/cert-monitors/{monitor_id}")
def delete_cert_monitor(
    app_id: int,
    monitor_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(get_current_user),
):
    monitor = session.get(CertMonitor, monitor_id)
    if not monitor or monitor.app_id != app_id:
        raise HTTPException(status_code=404, detail="Certificate monitor not found")
    assert_can_manage_app(session, actor, app_id)
    url = monitor.url
    session.delete(monitor)
    session.commit()
    record_audit(session, actor.username, "CERT_MONITOR_DELETED", target=f"app:{app_id}:{url}")
    return {"ok": True}
