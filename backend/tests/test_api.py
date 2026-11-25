import os
import tempfile
from unittest.mock import patch
from fastapi.testclient import TestClient

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"
os.environ["LDAP_ENABLED"] = "false"
os.environ["INITIAL_ADMINS"] = r"ad\leadadmin"

from app.main import app  # noqa: E402
from app.database import engine  # noqa: E402
from app.models import User  # noqa: E402
from app.services.twilio_sms import TwilioSendResult  # noqa: E402
from sqlmodel import Session  # noqa: E402


def test_direct_apps_alertmanager_dedupe_and_flood_protection():
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code == 200

        # Seed two users simulating prior LDAPS login with AD displayName
        with Session(engine) as s:
            u1_obj = User(username="jdoe", display_name="Jane Doe", role="user")
            u2_obj = User(username="asmith", display_name="Alex Smith", role="user")
            s.add(u1_obj)
            s.add(u2_obj)
            s.commit()
            s.refresh(u1_obj)
            s.refresh(u2_obj)
            u1 = {"id": u1_obj.id, "username": u1_obj.username}
            u2 = {"id": u2_obj.id, "username": u2_obj.username}
        assert u1["username"] == "jdoe"

        # Admin creates an App with dedupe=300s and flood limit=2/min
        created = client.post(
            "/api/apps",
            json={
                "name": "Payment Clearing",
                "map_id": 40218,
                "user_ids": [u1["id"]],
                "dedupe_window_seconds": 300,
                "max_per_minute": 2,
            },
        )
        assert created.status_code == 200
        prod = created.json()
        app_id = prod["id"]

        # Duplicate MAP ID is rejected with 409 Conflict
        assert (
            client.post(
                "/api/apps",
                json={"name": "Duplicate App", "map_id": 40218},
            ).status_code
            == 409
        )

        # Assign second user to the app
        assert client.post(f"/api/apps/{app_id}/users", json={"user_id": u2["id"]}).status_code == 200

        # Add phone number directly inside the app (and reject duplicate on same app)
        c = client.post(
            f"/api/apps/{app_id}/contacts",
            json={"name": "Jane Doe", "phone_number": "+15551234567"},
        )
        assert c.status_code == 200
        assert (
            client.post(
                f"/api/apps/{app_id}/contacts",
                json={"name": "Jane Duplicate", "phone_number": "555-123-4567"},
            ).status_code
            == 409
        )

        headers = {"Authorization": f"Bearer {prod['bearer_token']}"}

        # 1) First alert dispatches via Twilio
        with patch(
            "app.routers.webhooks.send_twilio_sms",
            return_value=TwilioSendResult(ok=True, sid="SM_001", status="queued"),
        ) as mock_sms:
            r1 = client.post(
                prod["webhook_path"],
                headers=headers,
                json={"severity": "CRITICAL", "error_code": "ERR_MQ_99", "log_string": "Queue full"},
            )
            assert r1.status_code == 200
            assert r1.json()["status"] == "Sent"
            assert mock_sms.call_count == 1

            # 2) Identical alert immediately after is DEDUPLICATED (Twilio NOT called)
            r2 = client.post(
                prod["webhook_path"],
                headers=headers,
                json={"severity": "CRITICAL", "error_code": "ERR_MQ_99", "log_string": "Queue full"},
            )
            assert r2.status_code == 200
            assert r2.json()["status"] == "Deduplicated"
            assert mock_sms.call_count == 1

            # 3) Distinct OpenShift Alertmanager alert dispatches (2nd dispatch in 60s)
            am_payload = {
                "status": "firing",
                "commonLabels": {"alertname": "KubePodCrashLooping", "severity": "critical", "namespace": "payments"},
                "commonAnnotations": {"summary": "Pod pay-api is crash looping"},
                "alerts": [{"status": "firing", "labels": {"alertname": "KubePodCrashLooping"}, "annotations": {}}],
            }
            r3 = client.post(prod["webhook_path"], headers=headers, json=am_payload)
            assert r3.status_code == 200
            assert r3.json()["status"] == "Sent"
            assert "KubePodCrashLooping" in r3.json()["rendered_sms"]
            assert mock_sms.call_count == 2

            # 4) Third distinct alert within 60s hits FLOOD PROTECTION (HTTP 429, Twilio NOT called)
            r4 = client.post(
                prod["webhook_path"],
                headers=headers,
                json={"severity": "HIGH", "error_code": "ERR_OTHER", "log_string": "Disk 95%"},
            )
            assert r4.status_code == 429
            assert r4.json()["status"] == "RateLimited"
            assert mock_sms.call_count == 2

        # ==================== URL & CERT MONITORS ====================
        # Raise flood cap so monitor alert tests dispatch cleanly
        assert client.patch(f"/api/apps/{app_id}", json={"max_per_minute": 20}).status_code == 200

        # Add a URL monitor
        um = client.post(
            f"/api/apps/{app_id}/url-monitors",
            json={
                "name": "Payments Health",
                "url": "https://payments.internal/healthz",
                "expected_status": 200,
                "expected_body": "ok",
                "interval_seconds": 60,
            },
        )
        assert um.status_code == 200
        um_id = um.json()["id"]

        # Simulate failing URL -> triggers URL_DOWN alert, then recovery -> triggers URL_RECOVERED
        class _FakeResp:
            def __init__(self, status_code, text):
                self.status_code = status_code
                self.text = text

        with (
            patch("app.services.monitors.requests.request", return_value=_FakeResp(503, "down")),
            patch(
                "app.routers.webhooks.send_twilio_sms",
                return_value=TwilioSendResult(ok=True, sid="SM_URL_DOWN", status="queued"),
            ) as mock_sms,
        ):
            chk1 = client.post(f"/api/apps/{app_id}/url-monitors/{um_id}/check").json()
            assert chk1["status"] == "failing"
            assert chk1["alert_dispatched"] is True
            assert mock_sms.call_count == 1

            # Second failing check does NOT re-alert (state-change only)
            chk2 = client.post(f"/api/apps/{app_id}/url-monitors/{um_id}/check").json()
            assert chk2["status"] == "failing"
            assert chk2["alert_dispatched"] is False
            assert mock_sms.call_count == 1

        with (
            patch("app.services.monitors.requests.request", return_value=_FakeResp(200, '{"status":"ok"}')),
            patch(
                "app.routers.webhooks.send_twilio_sms",
                return_value=TwilioSendResult(ok=True, sid="SM_URL_OK", status="queued"),
            ) as mock_sms,
        ):
            chk3 = client.post(f"/api/apps/{app_id}/url-monitors/{um_id}/check").json()
            assert chk3["status"] == "ok"
            assert chk3["alert_dispatched"] is True
            assert mock_sms.call_count == 1

        # Add a Regex URL monitor and verify regex matching
        um_rx = client.post(
            f"/api/apps/{app_id}/url-monitors",
            json={
                "name": "Regex Health",
                "url": "https://payments.internal/status",
                "expected_status": 200,
                "expected_body": r'"status"\s*:\s*"(ok|UP)"',
                "expected_body_mode": "regex",
            },
        )
        assert um_rx.status_code == 200
        rx_id = um_rx.json()["id"]
        with patch("app.services.monitors.requests.request", return_value=_FakeResp(200, '{"status": "UP"}')):
            assert client.post(f"/api/apps/{app_id}/url-monitors/{rx_id}/check").json()["status"] == "ok"

        # Batch-create 2 Certificate Expiry monitors
        cm_batch = client.post(
            f"/api/apps/{app_id}/cert-monitors",
            json={
                "urls": ["https://gw1.corp.internal", "https://gw2.corp.internal:8443"],
                "days_before_expiry": 14,
                "interval_seconds": 3600,
            },
        )
        assert cm_batch.status_code == 200
        assert cm_batch.json()["count"] == 2
        cm1_id = cm_batch.json()["created"][0]["id"]

        # Simulate cert expiring in 5 days -> alerts once, then 24h cooldown suppresses immediate re-alert
        from datetime import datetime, timedelta, timezone

        class _FakeName:
            def rfc4514_string(self):
                return "CN=gw1.corp.internal"

        class _FakeCert:
            not_valid_after_utc = datetime.now(timezone.utc) + timedelta(days=5, hours=2)
            subject = _FakeName()
            issuer = _FakeName()

        with (
            patch("app.services.monitors.fetch_peer_certificate", return_value=_FakeCert()),
            patch(
                "app.routers.webhooks.send_twilio_sms",
                return_value=TwilioSendResult(ok=True, sid="SM_CERT_1", status="queued"),
            ) as mock_sms,
        ):
            c1 = client.post(f"/api/apps/{app_id}/cert-monitors/{cm1_id}/check").json()
            assert c1["status"] == "expiring"
            assert c1["days_remaining"] == 5
            assert c1["alert_dispatched"] is True
            assert mock_sms.call_count == 1

            c2 = client.post(f"/api/apps/{app_id}/cert-monitors/{cm1_id}/check").json()
            assert c2["status"] == "expiring"
            assert c2["alert_dispatched"] is False
            assert mock_sms.call_count == 1

        # ==================== COPY TOKEN, DLP FILTER, EST SCHEDULE ====================
        # Copy token endpoint returns the decrypted bearer token
        tok_res = client.get(f"/api/apps/{app_id}/token")
        assert tok_res.status_code == 200
        assert tok_res.json()["bearer_token"] == prod["bearer_token"]

        # DLP redacts SSN, Bearer token, password=..., and emails from SMS
        from app.services.dlp import redact_sensitive_text
        redacted = redact_sensitive_text(
            "User john@bank.com SSN 123-45-6789 password=SuperSecret123 Bearer abc123xyz"
        )
        assert "123-45-6789" not in redacted
        assert "SuperSecret123" not in redacted
        assert "john@bank.com" not in redacted
        assert "abc123xyz" not in redacted

        # EST active-hours schedule helper (daytime & overnight)
        from app.routers.webhooks import is_contact_within_est_window
        from app.models import AppPhoneContact
        day_c = AppPhoneContact(app_id=app_id, name="Day", phone_number="+15551112222", active_start_est="08:00", active_end_est="18:00")
        assert is_contact_within_est_window(day_c, datetime(2026, 11, 25, 10, 0)) is True
        assert is_contact_within_est_window(day_c, datetime(2026, 11, 25, 22, 0)) is False
        night_c = AppPhoneContact(app_id=app_id, name="Night", phone_number="+15551112222", active_start_est="22:00", active_end_est="06:00")
        assert is_contact_within_est_window(night_c, datetime(2026, 11, 25, 23, 30)) is True
        assert is_contact_within_est_window(night_c, datetime(2026, 11, 25, 12, 0)) is False
