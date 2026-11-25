import React, { useEffect, useState } from 'react';
import { Shield, Server, MessageSquare, FileText, Search, CheckCircle2, Database, Trash2, Link2, EyeOff, FlaskConical, Sparkles, X } from 'lucide-react';
import { api } from '../api';

const DLP_SAMPLE_TEXT =
  'Alert on server=prod-db-01.corp.internal (10.24.8.15) host prd-app02: ' +
  'User jane.doe@bank.com phone +1-416-555-0199 SSN 123-45-6789 SIN 123-456-789 ' +
  'card 4532-0151-1283-0366 failed auth with password=SuperSecret123 ' +
  'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.signature123 ' +
  'at https://console.apps.ocp4.cibc.com/login (postgres://admin:pass@db01.internal:5432/prod)';

function renderHighlightedRedacted(text) {
  if (!text) return null;
  const parts = text.split(/(\[REDACTED(?:_[A-Z_]+)?\])/g);
  return parts.map((part, idx) =>
    /^\[REDACTED(?:_[A-Z_]+)?\]$/.test(part) ? (
      <span
        key={idx}
        className="inline-block px-1 py-0.5 mx-0.5 rounded bg-amber-500/20 border border-amber-500/35 text-amber-300 font-mono text-[11px]"
      >
        {part}
      </span>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AdminSettingsView({ onToast, onSettingsChanged }) {
  const [subTab, setSubTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [audit, setAudit] = useState([]);
  const [settings, setSettings] = useState(null);
  const [dbInfo, setDbInfo] = useState(null);
  const [retention, setRetention] = useState({ EVENT_RETENTION_DAYS: 90, AUDIT_RETENTION_DAYS: 365 });
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [pruning, setPruning] = useState(false);

  // DLP rules & live tester state
  const [dlpRules, setDlpRules] = useState([]);
  const [dlpCategory, setDlpCategory] = useState('All');
  const [dlpSearch, setDlpSearch] = useState('');
  const [dlpInput, setDlpInput] = useState('');
  const [dlpResult, setDlpResult] = useState(null);
  const [dlpTesting, setDlpTesting] = useState(false);

  const [ldap, setLdap] = useState({
    LDAP_ENABLED: false,
    LDAP_HOST: '',
    LDAP_PORT: 636,
    LDAP_USE_SSL: true,
    LDAP_USER_DOMAIN: 'ad',
    LDAP_AUTH_TYPE: 'SIMPLE',
  });

  const [twilio, setTwilio] = useState({
    TWILIO_ACCOUNT_SID: '',
    TWILIO_API_KEY_SID: '',
    TWILIO_API_KEY_SECRET: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_MESSAGING_SERVICE_SID: '',
    TWILIO_FROM_NUMBER: '',
  });

  async function loadAll() {
    try {
      const [u, s, a, db, dlp] = await Promise.all([
        api.listUsers(),
        api.getSettings(),
        api.listAudit(),
        api.getDatabaseInfo(),
        api.getDlpRules(),
      ]);
      setUsers(u);
      setSettings(s);
      setAudit(a);
      setDbInfo(db);
      setDlpRules(dlp.rules || []);
      setRetention({
        EVENT_RETENTION_DAYS: db.event_retention_days,
        AUDIT_RETENTION_DAYS: db.audit_retention_days,
      });
      setPublicBaseUrl(s.public_base_url || '');
      setLdap(s.ldap);
      setTwilio((prev) => ({
        ...prev,
        TWILIO_ACCOUNT_SID: s.twilio.TWILIO_ACCOUNT_SID || '',
        TWILIO_API_KEY_SID: s.twilio.TWILIO_API_KEY_SID || '',
        TWILIO_MESSAGING_SERVICE_SID: s.twilio.TWILIO_MESSAGING_SERVICE_SID || '',
        TWILIO_FROM_NUMBER: s.twilio.TWILIO_FROM_NUMBER || '',
      }));
    } catch (err) {
      onToast(err.message, true);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleRoleChange(userId, role) {
    try {
      await api.updateUserRole(userId, role);
      onToast(`Role updated to ${role}`);
      loadAll();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handleSaveLdap(e) {
    e.preventDefault();
    try {
      await api.saveLdapSettings({ ...ldap, LDAP_PORT: Number(ldap.LDAP_PORT) || 636 });
      onToast('LDAPS settings saved');
      loadAll();
      onSettingsChanged?.();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handleSaveTwilio(e) {
    e.preventDefault();
    try {
      await api.saveTwilioSettings(twilio);
      setTwilio((prev) => ({ ...prev, TWILIO_API_KEY_SECRET: '', TWILIO_AUTH_TOKEN: '' }));
      onToast('Twilio SMS configuration saved');
      loadAll();
      onSettingsChanged?.();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handleSaveBaseUrl(e) {
    e.preventDefault();
    try {
      await api.saveGeneralSettings({ PUBLIC_BASE_URL: publicBaseUrl });
      onToast('Public Base URL saved');
      loadAll();
      onSettingsChanged?.();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handleSaveRetention(e) {
    e.preventDefault();
    try {
      await api.saveRetentionSettings({
        EVENT_RETENTION_DAYS: Number(retention.EVENT_RETENTION_DAYS) || 0,
        AUDIT_RETENTION_DAYS: Number(retention.AUDIT_RETENTION_DAYS) || 0,
      });
      onToast('Retention policy saved');
      loadAll();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handlePruneNow() {
    setPruning(true);
    try {
      const res = await api.pruneDatabase();
      onToast(
        `Pruned ${res.deleted_events} events, ${res.deleted_deliveries} deliveries, ${res.deleted_audit_logs} audit logs (DB now ${formatBytes(res.db_size_bytes)})`
      );
      loadAll();
    } catch (err) {
      onToast(err.message, true);
    } finally {
      setPruning(false);
    }
  }

  async function handleRunDlpTest(textOverride) {
    const sample = textOverride !== undefined ? textOverride : dlpInput;
    if (!sample.trim()) {
      setDlpResult(null);
      return;
    }
    setDlpTesting(true);
    try {
      const res = await api.testDlpText(sample);
      setDlpResult(res);
    } catch (err) {
      onToast(err.message, true);
    } finally {
      setDlpTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {[
          { id: 'users', label: 'Users & Admins', icon: Shield },
          { id: 'general', label: 'Base URL', icon: Link2 },
          { id: 'twilio', label: 'Twilio SMS', icon: MessageSquare },
          { id: 'ldap', label: 'LDAPS Auth', icon: Server },
          { id: 'dlp', label: 'DLP & Redaction', icon: EyeOff },
          { id: 'database', label: 'Database & Retention', icon: Database },
          { id: 'audit', label: 'Audit Log', icon: FileText },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                subTab === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* USERS & ADMINS */}
      {subTab === 'users' && (() => {
        const q = userSearch.trim().toLowerCase();
        const filteredUsers = q
          ? users.filter(
              (u) =>
                u.username.toLowerCase().includes(q) ||
                (u.display_name || '').toLowerCase().includes(q) ||
                u.role.toLowerCase().includes(q)
            )
          : users;
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                Users appear automatically after signing in via LDAPS (full name synced from AD).
                {settings?.initial_admins?.length > 0 && (
                  <> ConfigMap admins: <span className="font-mono text-slate-200">{settings.initial_admins.join(', ')}</span>.</>
                )}
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filter by name, username, or role..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Full Name</th>
                    <th className="py-2.5 px-4">Username</th>
                    <th className="py-2.5 px-4">Source</th>
                    <th className="py-2.5 px-4">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-medium text-slate-200">{u.display_name}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">{u.username}</td>
                      <td className="py-3 px-4">
                        {u.from_configmap ? (
                          <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-mono">
                            ConfigMap Admin
                          </span>
                        ) : (
                          <span className="text-slate-500">LDAPS</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <select
                          disabled={u.from_configmap}
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          className="bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1 text-xs text-white disabled:opacity-50"
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500">
                        No users match "{userSearch}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* GENERAL / PUBLIC BASE URL */}
      {subTab === 'general' && (
        <form onSubmit={handleSaveBaseUrl} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 max-w-2xl text-xs">
          <div>
            <h3 className="text-sm font-semibold text-white">Public Base URL (OpenShift Route)</h3>
            <p className="text-slate-400 mt-0.5">
              Used to build all displayed Webhook Endpoint URLs, cURL examples, and Alertmanager YAML snippets. Leave blank to fall back to the browser's current origin.
            </p>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Base URL</label>
            <input
              value={publicBaseUrl}
              onChange={(e) => setPublicBaseUrl(e.target.value)}
              placeholder="https://signal.apps.ocp.bank.internal"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
              Save Base URL
            </button>
            {publicBaseUrl && (
              <button
                type="button"
                onClick={async () => {
                  setPublicBaseUrl('');
                  await api.saveGeneralSettings({ PUBLIC_BASE_URL: '' });
                  onToast('Base URL cleared (using browser origin)');
                  loadAll();
                  onSettingsChanged?.();
                }}
                className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Reset to Browser Origin
              </button>
            )}
          </div>
        </form>
      )}

      {/* TWILIO SETTINGS */}
      {subTab === 'twilio' && (
        <form onSubmit={handleSaveTwilio} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 max-w-2xl text-xs">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Twilio SMS Provider</h3>
              <p className="text-slate-400 mt-0.5">
                Configure via <code className="text-indigo-300">.env</code> / OpenShift Secret or override here. Supports API Key (SK...) or Auth Token.
              </p>
            </div>
            {settings?.twilio?.configured ? (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Configured
              </span>
            ) : (
              <span className="text-amber-400 font-medium">Not Configured</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Account SID (AC...)</label>
              <input
                value={twilio.TWILIO_ACCOUNT_SID}
                onChange={(e) => setTwilio({ ...twilio, TWILIO_ACCOUNT_SID: e.target.value })}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">API Key SID (SK...)</label>
              <input
                value={twilio.TWILIO_API_KEY_SID}
                onChange={(e) => setTwilio({ ...twilio, TWILIO_API_KEY_SID: e.target.value })}
                placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">
                API Key Secret {settings?.twilio?.has_api_key_secret && <span className="text-emerald-400">(saved)</span>}
              </label>
              <input
                type="password"
                value={twilio.TWILIO_API_KEY_SECRET}
                onChange={(e) => setTwilio({ ...twilio, TWILIO_API_KEY_SECRET: e.target.value })}
                placeholder={settings?.twilio?.has_api_key_secret ? 'Leave blank to keep existing' : 'Enter API Key Secret'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">
                Auth Token (alt to API Key) {settings?.twilio?.has_auth_token && <span className="text-emerald-400">(saved)</span>}
              </label>
              <input
                type="password"
                value={twilio.TWILIO_AUTH_TOKEN}
                onChange={(e) => setTwilio({ ...twilio, TWILIO_AUTH_TOKEN: e.target.value })}
                placeholder={settings?.twilio?.has_auth_token ? 'Leave blank to keep existing' : 'Optional if using API Key'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Messaging Service SID (MG...)</label>
              <input
                value={twilio.TWILIO_MESSAGING_SERVICE_SID}
                onChange={(e) => setTwilio({ ...twilio, TWILIO_MESSAGING_SERVICE_SID: e.target.value })}
                placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">OR From Phone Number (E.164)</label>
              <input
                value={twilio.TWILIO_FROM_NUMBER}
                onChange={(e) => setTwilio({ ...twilio, TWILIO_FROM_NUMBER: e.target.value })}
                placeholder="+15551234567"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
          </div>

          <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
            Save Twilio Configuration
          </button>
        </form>
      )}

      {/* LDAPS SETTINGS */}
      {subTab === 'ldap' && (
        <form onSubmit={handleSaveLdap} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 max-w-2xl text-xs">
          <div>
            <h3 className="text-sm font-semibold text-white">LDAPS Pass-Through Bind</h3>
            <p className="text-slate-400 mt-0.5">
              Direct user bind (no dedicated bind ID needed). While disabled, Signal runs in open Local Admin mode.
            </p>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={ldap.LDAP_ENABLED}
              onChange={(e) => setLdap({ ...ldap, LDAP_ENABLED: e.target.checked })}
              className="accent-indigo-500 w-4 h-4"
            />
            <span className="text-slate-200 font-medium">Enable LDAPS Authentication</span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">LDAP Host</label>
              <input
                value={ldap.LDAP_HOST}
                onChange={(e) => setLdap({ ...ldap, LDAP_HOST: e.target.value })}
                placeholder="ldaps.corp.bank.internal"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Port</label>
              <input
                type="number"
                value={ldap.LDAP_PORT}
                onChange={(e) => setLdap({ ...ldap, LDAP_PORT: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">AD Domain Prefix</label>
              <input
                value={ldap.LDAP_USER_DOMAIN}
                onChange={(e) => setLdap({ ...ldap, LDAP_USER_DOMAIN: e.target.value })}
                placeholder="ad"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Auth Type</label>
              <select
                value={ldap.LDAP_AUTH_TYPE}
                onChange={(e) => setLdap({ ...ldap, LDAP_AUTH_TYPE: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
              >
                <option value="SIMPLE">SIMPLE</option>
                <option value="NTLM">NTLM</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={ldap.LDAP_USE_SSL}
              onChange={(e) => setLdap({ ...ldap, LDAP_USE_SSL: e.target.checked })}
              className="accent-indigo-500 w-4 h-4"
            />
            <span className="text-slate-300">Use SSL/TLS (LDAPS)</span>
          </label>

          <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
            Save LDAPS Settings
          </button>
        </form>
      )}

      {/* DLP & REDACTION */}
      {subTab === 'dlp' && (() => {
        const categories = ['All', 'Secrets & Tokens', 'PII & Financial', 'Servers & Network'];
        const countsByCat = {
          All: dlpRules.length,
          'Secrets & Tokens': dlpRules.filter((r) => r.category === 'Secrets & Tokens').length,
          'PII & Financial': dlpRules.filter((r) => r.category === 'PII & Financial').length,
          'Servers & Network': dlpRules.filter((r) => r.category === 'Servers & Network').length,
        };
        const q = dlpSearch.trim().toLowerCase();
        const filteredRules = dlpRules.filter((r) => {
          if (dlpCategory !== 'All' && r.category !== dlpCategory) return false;
          if (!q) return true;
          return (
            r.name.toLowerCase().includes(q) ||
            r.category.toLowerCase().includes(q) ||
            r.replacement.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.example.toLowerCase().includes(q)
          );
        });

        const catBadge = (cat) => {
          if (cat === 'Secrets & Tokens') return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
          if (cat === 'PII & Financial') return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
          return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
        };

        return (
          <div className="space-y-5 text-xs">
            {/* Live DLP Redaction Tester */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-indigo-400" />
                    Live SMS Redaction Tester
                  </h3>
                  <p className="text-slate-400 mt-0.5">
                    Every outgoing SMS (webhooks, Alertmanager, URL &amp; cert monitors, and test alerts) is scrubbed through these rules before reaching Twilio.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDlpInput(DLP_SAMPLE_TEXT);
                      handleRunDlpTest(DLP_SAMPLE_TEXT);
                    }}
                    className="h-7 px-2.5 rounded-[5px] bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1.5 text-xs font-medium"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Load Sample
                  </button>
                  {dlpInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setDlpInput('');
                        setDlpResult(null);
                      }}
                      className="h-7 px-2.5 rounded-[5px] border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                <div className="space-y-2">
                  <label className="block text-[11px] font-medium text-slate-400">
                    Test Input String
                  </label>
                  <textarea
                    rows={5}
                    value={dlpInput}
                    onChange={(e) => setDlpInput(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleRunDlpTest();
                      }
                    }}
                    placeholder="Paste any alert message, log line, or payload to test redaction (Ctrl+Enter to run)..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-slate-500">
                      Runs the exact backend <code className="text-slate-300">dlp.py</code> scrubber — nothing is logged or sent.
                    </span>
                    <button
                      type="button"
                      disabled={dlpTesting || !dlpInput.trim()}
                      onClick={() => handleRunDlpTest()}
                      className="h-7 px-3 rounded-[5px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium text-xs whitespace-nowrap shrink-0 transition-colors"
                    >
                      {dlpTesting ? 'Testing...' : 'Test Redaction'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-medium text-slate-400">
                      Redacted SMS Output
                    </label>
                    {dlpResult && (
                      dlpResult.total_redactions > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-medium tabular-nums">
                          {dlpResult.total_redactions} redaction{dlpResult.total_redactions === 1 ? '' : 's'} across {dlpResult.matched_rules.length} rule{dlpResult.matched_rules.length === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-medium">
                          Clean — no sensitive data matched
                        </span>
                      )
                    )}
                  </div>
                  <div className="min-h-[118px] bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                    {dlpResult ? (
                      renderHighlightedRedacted(dlpResult.redacted)
                    ) : (
                      <span className="text-slate-600">
                        Redacted preview will appear here after running a test...
                      </span>
                    )}
                  </div>
                  {dlpResult?.matched_rules?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {dlpResult.matched_rules.map((mr) => (
                        <span
                          key={mr.id}
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] ${catBadge(mr.category)}`}
                        >
                          <span>{mr.name}</span>
                          <span className="font-mono font-semibold opacity-80">×{mr.matches}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Active Scrubbing Rules Table */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="DLP rule category filter"
                  className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-slate-800 bg-slate-900"
                >
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={dlpCategory === cat}
                      onClick={() => setDlpCategory(cat)}
                      className={`h-[26px] px-2.5 rounded-[4px] inline-flex items-center gap-1.5 text-[11.5px] transition-colors ${
                        dlpCategory === cat
                          ? 'bg-slate-800 text-slate-100 font-semibold'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-medium'
                      }`}
                    >
                      <span>{cat === 'All' ? 'All Rules' : cat}</span>
                      <span className="text-[10px] font-semibold tabular-nums text-slate-400">
                        {countsByCat[cat]}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={dlpSearch}
                    onChange={(e) => setDlpSearch(e.target.value)}
                    placeholder="Filter rules, tags, or examples..."
                    className="w-full h-7 bg-slate-900 border border-slate-800 rounded-[5px] pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {dlpSearch && (
                    <button
                      type="button"
                      onClick={() => setDlpSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg bg-slate-900 overflow-x-auto">
                <table className="w-full table-fixed min-w-[780px] text-left border-collapse">
                  <colgroup>
                    <col className="w-[22%]" />
                    <col className="w-[15%]" />
                    <col className="w-[18%]" />
                    <col className="w-[27%]" />
                    <col className="w-[18%]" />
                  </colgroup>
                  <thead className="bg-slate-950/55 text-[11.5px] text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3 font-normal whitespace-nowrap">Rule</th>
                      <th className="py-2 px-3 font-normal whitespace-nowrap">Category</th>
                      <th className="py-2 px-3 font-normal whitespace-nowrap">Replacement</th>
                      <th className="py-2 px-3 font-normal">What It Catches</th>
                      <th className="py-2 px-3 font-normal whitespace-nowrap">Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {filteredRules.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-800/35 transition-colors">
                        <td className="py-2.5 px-3 font-medium text-slate-100 truncate" title={r.name}>
                          {r.name}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-[5px] border text-[11px] font-medium ${catBadge(r.category)}`}>
                            {r.category}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <code className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-[11px]">
                            {r.replacement}
                          </code>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {r.description}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 truncate" title={r.example}>
                          {r.example}
                        </td>
                      </tr>
                    ))}
                    {filteredRules.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No scrubbing rules match "{dlpSearch}".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* DATABASE & RETENTION */}
      {subTab === 'database' && dbInfo && (
        <div className="space-y-4 max-w-3xl text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-400">Current SQLite Size</div>
              <div className="text-2xl font-bold font-mono text-white mt-1">{formatBytes(dbInfo.db_size_bytes)}</div>
              <div className="text-[11px] text-slate-500 font-mono truncate mt-1" title={dbInfo.db_path}>
                {dbInfo.db_path}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-400">Stored Alerts / Deliveries</div>
              <div className="text-2xl font-bold font-mono text-indigo-300 mt-1">
                {dbInfo.counts.webhook_events} / {dbInfo.counts.sms_deliveries}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">{dbInfo.counts.audit_logs} audit log entries</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-400">Last Pruned</div>
              <div className="text-sm font-mono text-slate-200 mt-2">
                {dbInfo.last_pruned_at ? new Date(dbInfo.last_pruned_at).toLocaleString() : 'Never'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Auto-prunes daily in background</div>
            </div>
          </div>

          <form onSubmit={handleSaveRetention} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Data Retention Policy</h3>
              <p className="text-slate-400 mt-0.5">
                Limit how long historical alerts and audit entries are kept on the SQLite PVC. Set to <code className="text-slate-200">0</code> to keep forever.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 mb-1">Alert &amp; Delivery Log Retention (days)</label>
                <input
                  type="number"
                  min="0"
                  value={retention.EVENT_RETENTION_DAYS}
                  onChange={(e) => setRetention({ ...retention, EVENT_RETENTION_DAYS: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Audit Log Retention (days)</label>
                <input
                  type="number"
                  min="0"
                  value={retention.AUDIT_RETENTION_DAYS}
                  onChange={(e) => setRetention({ ...retention, AUDIT_RETENTION_DAYS: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
                Save Retention Policy
              </button>
              <button
                type="button"
                disabled={pruning}
                onClick={handlePruneNow}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-300 font-medium flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {pruning ? 'Pruning & Vacuuming...' : 'Prune Expired & Reclaim Space Now'}
              </button>
            </div>
          </form>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="text-xs font-semibold text-slate-300 mb-3">Table Row Counts</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
              {Object.entries(dbInfo.counts).map(([k, v]) => (
                <div key={k} className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex justify-between">
                  <span className="text-slate-400">{k}</span>
                  <span className="text-slate-100 font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AUDIT LOG */}
      {subTab === 'audit' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Time (UTC)</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Target</th>
                <th className="py-2.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {audit.map((a) => (
                <tr key={a.id} className="hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-200">{a.actor}</td>
                  <td className="py-2.5 px-4 font-mono text-indigo-300">{a.action}</td>
                  <td className="py-2.5 px-4 text-slate-200">{a.target}</td>
                  <td className="py-2.5 px-4 text-slate-400">{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
