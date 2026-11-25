# Signal — Corporate SMS Notification Gateway

In-house webhook-to-SMS notification and active monitoring platform built with **FastAPI + SQLite (WAL) + React** for deployment on **OpenShift**.

## Key Features
- **LDAPS Pass-Through Bind** (no dedicated bind ID needed, mirrors `ocp-inventory`). Syncs full name (`displayName`) from AD on login. Runs in **Local Admin Mode** until LDAP is enabled.
- **Direct App-to-User Access**: Admins create/delete Apps (unique `MAP ID`) and assign initial logged-in users; assigned users self-manage their Apps (add/remove colleagues, phone numbers, rotate/copy tokens, and manage monitors).
- **Real Twilio SMS + DLP Filter**: Scrubs PII, SSNs, PANs, JWTs, Bearer tokens, and labeled secrets before dispatch. Supports per-phone **Active (EST)** schedules, deduplication, and flood caps.
- **Outgoing Monitors**: HTTP/HTTPS **URL Monitors** (optional auth, Key/Value or JSON headers, Substring/Regex body match, max latency ms) and batch **Certificate Expiry Monitors**.
- **OpenShift Alertmanager Compatible**: Auto-detects Alertmanager webhook payloads.
- **SQLite Retention & Maintenance**: Live DB size + configurable retention days + on-demand `VACUUM` under **Admin & Settings → Database & Retention**.

## Local Development

1. Copy `.env.example` to `.env` and add your Twilio credentials (or configure them in **Admin & Settings → Twilio SMS**).
2. Start Backend (Terminal 1):
   ```powershell
   $env:PYTHONPATH = "backend"
   .\backend\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000
   ```
3. Start Frontend (Terminal 2):
   ```powershell
   cd frontend
   npm run dev
   ```
   Open **http://localhost:5173**.

## Simple OpenShift Deployment (Plain `oc` — No Kustomize or Helm)

1. **Configure internal package repos** (if needed):
   - Edit `pip.config` for your internal PyPI / Artifactory index & auth (automatically removed during image build).
   - Edit `frontend/.npmrc` if you also use an internal npm registry (also removed during image build).

2. **Create project, ImageStream, and binary Docker Build**:
   ```bash
   oc new-project signal
   oc new-build --name signal --binary --strategy docker
   oc start-build signal --from-dir=. --follow
   ```

3. **Edit & apply the plain manifests** in `openshift/` (fill in `openshift/secret.yaml` and `openshift/configmap.yaml` first):
   ```bash
   oc apply -f openshift/pvc.yaml
   oc apply -f openshift/configmap.yaml
   oc apply -f openshift/secret.yaml
   oc apply -f openshift/deployment.yaml
   oc apply -f openshift/service-route.yaml
   ```

4. **Update later** after code changes:
   ```bash
   oc start-build signal --from-dir=. --follow
   oc rollout restart deployment/signal
   ```
