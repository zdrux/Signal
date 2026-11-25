import React, { useEffect, useState } from 'react';
import {
  Radio, LayoutDashboard, Layers, FileText, Settings,
  Plus, Copy, RefreshCw, Zap, Trash2, LogOut, Check, AlertTriangle, X, Code2,
  ShieldAlert, Phone, Users, Search, ChevronDown, ChevronRight, Globe, ShieldCheck, Webhook
} from 'lucide-react';
import { api } from './api';
import LoginView from './components/LoginView';
import AdminSettingsView from './components/AdminSettingsView';
import AppMonitorsSection from './components/AppMonitorsSection';

const EST_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
}).concat(['23:59']);

function SeverityBadge({ sev }) {
  const styles = {
    CRITICAL: 'bg-red-500/15 text-red-400 border-red-500/30',
    HIGH: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    WARN: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    RESOLVED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    INFO: 'bg-slate-800 text-slate-300 border-slate-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-mono font-semibold ${styles[sev] || styles.INFO}`}>
      {sev}
    </span>
  );
}

function StatusBadge({ status }) {
  if (status === 'Sent' || status === 'sent' || status === 'queued' || status === 'delivered') {
    return <span className="text-emerald-400 font-medium">● {status}</span>;
  }
  if (status === 'Deduplicated' || status === 'RateLimited') {
    return <span className="text-sky-400 font-medium">● {status}</span>;
  }
  if (status === 'Partial' || status === 'Skipped') {
    return <span className="text-amber-400 font-medium">● {status}</span>;
  }
  return <span className="text-red-400 font-medium">● {status}</span>;
}

export default function App() {
  const [auth, setAuth] = useState(null);
  // Top-level views: 'overview' | 'apps' | 'app-detail' | 'logs' | 'admin'
  const [tab, setTab] = useState('overview');
  const [appsFolderOpen, setAppsFolderOpen] = useState(true);
  const [expandedApps, setExpandedApps] = useState({});
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [appSubTab, setAppSubTab] = useState('webhook'); // 'webhook' | 'url' | 'cert'

  const [apps, setApps] = useState([]);
  const [events, setEvents] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [toast, setToast] = useState(null);

  // Modals
  const [showCreateApp, setShowCreateApp] = useState(false);
  const [tokenModal, setTokenModal] = useState(null);
  const [testModalApp, setTestModalApp] = useState(null);
  const [testResultModal, setTestResultModal] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [docsModalApp, setDocsModalApp] = useState(null);
  const [guardModalApp, setGuardModalApp] = useState(null);
  const [inspectEvent, setInspectEvent] = useState(null);

  // Forms
  const [appForm, setAppForm] = useState({
    name: '',
    map_id: '',
    description: '',
    user_ids: [],
    dedupe_window_seconds: 300,
    max_per_minute: 5,
  });
  const [newContactByApp, setNewContactByApp] = useState({});
  const [userSearchByApp, setUserSearchByApp] = useState({});
  const [createAppUserSearch, setCreateAppUserSearch] = useState('');
  const [testForm, setTestForm] = useState({
    severity: 'CRITICAL',
    error_code: 'ERR_TEST_ALERT',
    log_string: 'Manual test trigger from Signal dashboard',
  });

  function showToast(message, isError = false) {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3200);
  }

  function copy(text, label) {
    navigator.clipboard?.writeText(text);
    showToast(`${label} copied to clipboard`);
  }

  function openAppSection(appId, section = 'webhook') {
    setAppsFolderOpen(true);
    setExpandedApps((prev) => ({ ...prev, [appId]: true }));
    setSelectedAppId(appId);
    setAppSubTab(section);
    setTab('app-detail');
  }

  async function loadAuth() {
    try {
      const me = await api.me();
      setAuth(me);
      if (me.authenticated) {
        await loadData();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function loadData() {
    try {
      const [a, e, dir] = await Promise.all([
        api.listApps(),
        api.listEvents(),
        api.usersDirectory(),
      ]);
      setApps(a);
      setEvents(e);
      setDirectory(dir);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  useEffect(() => {
    loadAuth();
  }, []);

  if (!auth) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">Loading Signal...</div>;
  }

  if (!auth.authenticated) {
    return <LoginView ldapDomain={auth.ldap_domain} onSuccess={loadAuth} />;
  }

  const user = auth.user;
  const origin = (auth.public_base_url || window.location.origin).replace(/\/+$/, '');
  const totalContacts = apps.reduce((sum, a) => sum + a.contacts.length, 0);
  const sentCount = events.reduce((sum, e) => sum + (e.delivered_count || 0), 0);
  const suppressedCount = events.filter((e) => e.status === 'Deduplicated' || e.status === 'RateLimited').length;
  const selectedApp = apps.find((a) => a.id === selectedAppId) || null;

  async function handleCreateApp(e) {
    e.preventDefault();
    try {
      const created = await api.createApp({
        ...appForm,
        map_id: Number(appForm.map_id),
        dedupe_window_seconds: Number(appForm.dedupe_window_seconds) || 0,
        max_per_minute: Number(appForm.max_per_minute) || 0,
      });
      setShowCreateApp(false);
      setAppForm({
        name: '',
        map_id: '',
        description: '',
        user_ids: [],
        dedupe_window_seconds: 300,
        max_per_minute: 5,
      });
      setCreateAppUserSearch('');
      setTokenModal({
        appName: `${created.name} (MAP ${created.map_id})`,
        webhookUrl: `${origin}${created.webhook_path}`,
        token: created.bearer_token,
      });
      await loadData();
      openAppSection(created.id, 'webhook');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleCopyToken(app) {
    try {
      const res = await api.getAppToken(app.id);
      copy(res.bearer_token, 'Bearer token');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleRotateToken(app) {
    try {
      const res = await api.rotateToken(app.id);
      setTokenModal({
        appName: `${app.name} (MAP ${app.map_id})`,
        webhookUrl: `${origin}${app.webhook_path}`,
        token: res.bearer_token,
      });
      loadData();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleAddAppUser(appId, userId) {
    if (!userId) return;
    try {
      await api.addAppUser(appId, userId);
      setUserSearchByApp({ ...userSearchByApp, [appId]: '' });
      showToast('User assigned to application');
      loadData();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleAddAppContact(e, appId) {
    e.preventDefault();
    const draft = newContactByApp[appId] || { name: '', phone_number: '' };
    if (!draft.name?.trim() || !draft.phone_number?.trim()) return;
    try {
      await api.addAppContact(appId, draft);
      setNewContactByApp({ ...newContactByApp, [appId]: { name: '', phone_number: '' } });
      showToast('Phone number added to app');
      loadData();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleSaveGuards(e) {
    e.preventDefault();
    try {
      await api.updateApp(guardModalApp.id, {
        dedupe_window_seconds: Number(guardModalApp.dedupe_window_seconds) || 0,
        max_per_minute: Number(guardModalApp.max_per_minute) || 0,
      });
      setGuardModalApp(null);
      showToast('Dedupe & flood protection updated');
      loadData();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function handleFireTest(e) {
    e.preventDefault();
    try {
      const targetApp = testModalApp;
      const res = await api.testTriggerApp(targetApp.id, {
        mapid: targetApp.map_id,
        ...testForm,
      });
      setTestModalApp(null);
      loadData();
      if (res.failed > 0 || res.status === 'Failed' || res.status === 'Partial' || res.status === 'Skipped') {
        setTestResultModal({ appName: `${targetApp.name} (MAP ${targetApp.map_id})`, result: res });
      } else {
        showToast(`Test SMS sent to ${res.delivered || 0} recipient(s)`);
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  const pageTitle =
    tab === 'app-detail' && selectedApp
      ? `${selectedApp.name} · MAP ${selectedApp.map_id}`
      : tab === 'admin'
      ? 'Admin & Settings'
      : tab === 'apps'
      ? 'Apps & Webhooks'
      : tab === 'logs'
      ? 'Delivery Logs'
      : 'Overview';

  const pageSubtitle =
    tab === 'app-detail' && selectedApp
      ? appSubTab === 'url'
        ? 'Outgoing HTTP/HTTPS health & response monitors'
        : appSubTab === 'cert'
        ? 'Outgoing TLS certificate expiry monitors'
        : 'Webhook endpoint, bearer token, assigned users & SMS phone numbers'
      : 'Signal webhook-to-SMS gateway · Direct App-to-User access · Dedupe & Flood Protection';

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col justify-between">
        <div className="overflow-y-auto flex-1">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-sm text-white leading-tight">Signal</div>
              <div className="text-xs text-slate-400">Enterprise SMS Gateway</div>
            </div>
          </div>

          <nav className="p-3 space-y-1 text-sm">
            {/* Overview */}
            <button
              onClick={() => setTab('overview')}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition text-xs font-medium ${
                tab === 'overview' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <LayoutDashboard className="w-4 h-4" />
                Overview
              </span>
            </button>

            {/* Apps & Webhooks Parent Folder */}
            <div>
              <div
                className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between transition text-xs font-medium ${
                  tab === 'apps' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <button
                  onClick={() => setAppsFolderOpen((o) => !o)}
                  className="p-0.5 text-slate-400 hover:text-white"
                  title={appsFolderOpen ? 'Collapse apps' : 'Expand apps'}
                >
                  {appsFolderOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => { setTab('apps'); setAppsFolderOpen(true); }}
                  className="flex-1 text-left flex items-center gap-2 py-0.5 pl-1"
                >
                  <Layers className="w-4 h-4" />
                  <span>Apps &amp; Webhooks</span>
                </button>
                <span className="px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 font-mono text-[11px]">
                  {apps.length}
                </span>
              </div>

              {/* Child Apps Tree */}
              {appsFolderOpen && (
                <div className="mt-1 ml-3 pl-2.5 border-l border-slate-800 space-y-1">
                  {apps.map((a) => {
                    const isOpen = !!expandedApps[a.id];
                    const isSelected = tab === 'app-detail' && selectedAppId === a.id;
                    return (
                      <div key={a.id}>
                        <div
                          className={`px-2 py-1.5 rounded-md flex items-center justify-between text-xs transition ${
                            isSelected ? 'bg-slate-800 text-white font-medium' : 'text-slate-300 hover:bg-slate-800/60'
                          }`}
                        >
                          <button
                            onClick={() => setExpandedApps((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                            className="p-0.5 text-slate-500 hover:text-slate-200"
                          >
                            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => openAppSection(a.id, 'webhook')}
                            className="flex-1 text-left truncate pl-1"
                            title={`${a.name} (MAP ${a.map_id})`}
                          >
                            {a.name}
                          </button>
                          <span className="font-mono text-[10px] text-slate-500 ml-1">{a.map_id}</span>
                        </div>

                        {isOpen && (
                          <div className="mt-0.5 ml-4 pl-2 border-l border-slate-800/80 space-y-0.5">
                            <button
                              onClick={() => openAppSection(a.id, 'webhook')}
                              className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between transition ${
                                isSelected && appSubTab === 'webhook'
                                  ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                <Webhook className="w-3 h-3" /> Webhook &amp; Access
                              </span>
                            </button>
                            <button
                              onClick={() => openAppSection(a.id, 'url')}
                              className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between transition ${
                                isSelected && appSubTab === 'url'
                                  ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                <Globe className="w-3 h-3 text-sky-400" /> URL Monitors
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">{(a.url_monitors || []).length}</span>
                            </button>
                            <button
                              onClick={() => openAppSection(a.id, 'cert')}
                              className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between transition ${
                                isSelected && appSubTab === 'cert'
                                  ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                <ShieldCheck className="w-3 h-3 text-amber-400" /> Cert Monitors
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">{(a.cert_monitors || []).length}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {apps.length === 0 && (
                    <div className="px-2 py-1 text-[11px] text-slate-500 italic">No apps yet</div>
                  )}
                </div>
              )}
            </div>

            {/* Delivery Logs */}
            <button
              onClick={() => setTab('logs')}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition text-xs font-medium ${
                tab === 'logs' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <FileText className="w-4 h-4" />
                Delivery Logs
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 font-mono text-[11px]">
                {events.length}
              </span>
            </button>

            {/* Admin & Settings */}
            {user.is_admin && (
              <button
                onClick={() => setTab('admin')}
                className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition text-xs font-medium ${
                  tab === 'admin' ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Settings className="w-4 h-4" />
                  Admin &amp; Settings
                </span>
              </button>
            )}
          </nav>
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-800 space-y-2.5">
          {!auth.ldap_enabled && (
            <div className="px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
              Local Admin Mode (LDAP off)
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs font-medium text-white truncate">{user.display_name}</div>
              <div className="text-[11px] text-slate-400 font-mono truncate">
                {user.username} · <span className="text-indigo-300">{user.role}</span>
              </div>
            </div>
            {auth.ldap_enabled && (
              <button
                onClick={async () => { await api.logout(); loadAuth(); }}
                title="Sign out"
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="px-6 py-4 bg-slate-900/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-white">{pageTitle}</h1>
            <p className="text-xs text-slate-400">{pageSubtitle}</p>
          </div>
          {user.is_admin && (
            <button
              onClick={() => setShowCreateApp(true)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Register App
            </button>
          )}
        </header>

        <div className="p-6 flex-1 space-y-6">
          {/* ==================== OVERVIEW ==================== */}
          {tab === 'overview' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-400">Accessible Apps</div>
                  <div className="text-2xl font-bold font-mono text-white mt-1">{apps.length}</div>
                  <div className="text-xs text-slate-500 mt-1">Unique MAP IDs</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-400">Configured Phone Numbers</div>
                  <div className="text-2xl font-bold font-mono text-white mt-1">{totalContacts}</div>
                  <div className="text-xs text-slate-500 mt-1">Residing directly in apps</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-400">SMS Dispatched (Twilio)</div>
                  <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{sentCount}</div>
                  <div className="text-xs text-slate-500 mt-1">{events.length} total triggers</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-400">Suppressed (Dedupe / Flood)</div>
                  <div className="text-2xl font-bold font-mono text-sky-400 mt-1">{suppressedCount}</div>
                  <div className="text-xs text-slate-500 mt-1">Blocked before Twilio spend</div>
                </div>
              </div>

              {apps.length === 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-2">
                  <p className="text-sm font-medium text-white">No Applications Assigned Yet</p>
                  <p className="text-xs text-slate-400">
                    {user.is_admin
                      ? 'Click "+ Register App" to create your first application with a unique MAP ID.'
                      : 'Ask an Admin (or a colleague already assigned to an app) to assign your username to an application.'}
                  </p>
                </div>
              )}

              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Recent Alert Triggers</h2>
                  <button onClick={() => setTab('logs')} className="text-xs text-indigo-400 hover:underline">View all →</button>
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4">Time</th>
                      <th className="py-2.5 px-4">App / MAP ID</th>
                      <th className="py-2.5 px-4">Severity</th>
                      <th className="py-2.5 px-4">Metadata</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {events.slice(0, 8).map((ev) => (
                      <tr key={ev.id} onClick={() => setInspectEvent(ev)} className="hover:bg-slate-800/40 cursor-pointer">
                        <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">{new Date(ev.created_at).toLocaleTimeString()}</td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-200">{ev.app_name}</div>
                          <div className="font-mono text-slate-400">MAP {ev.map_id}</div>
                        </td>
                        <td className="py-3 px-4"><SeverityBadge sev={ev.severity} /></td>
                        <td className="py-3 px-4 text-slate-300 max-w-md truncate">
                          <span className="font-mono text-indigo-300">{ev.error_code}</span> {ev.log_string}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap"><StatusBadge status={ev.status} /></td>
                      </tr>
                    ))}
                    {events.length === 0 && (
                      <tr><td colSpan={5} className="py-8 text-center text-slate-500">No events recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ==================== APPS DIRECTORY (PARENT FOLDER VIEW) ==================== */}
          {tab === 'apps' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {apps.map((app) => (
                <div key={app.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">{app.name}</h3>
                      <span className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800/60 text-indigo-300 font-mono text-xs shrink-0">
                        MAP {app.map_id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{app.description || 'No description'}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono text-slate-400">
                      <span className={app.enabled ? 'text-emerald-400' : 'text-slate-500'}>
                        ● {app.enabled ? 'Enabled' : 'Paused'}
                      </span>
                      <span>· {app.contacts.length} phones</span>
                      <span>· {(app.url_monitors || []).length} URL</span>
                      <span>· {(app.cert_monitors || []).length} cert</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800 text-[11px]">
                    <button
                      onClick={() => openAppSection(app.id, 'webhook')}
                      className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
                    >
                      Webhook
                    </button>
                    <button
                      onClick={() => openAppSection(app.id, 'url')}
                      className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 font-medium"
                    >
                      URL ({(app.url_monitors || []).length})
                    </button>
                    <button
                      onClick={() => openAppSection(app.id, 'cert')}
                      className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-medium"
                    >
                      Certs ({(app.cert_monitors || []).length})
                    </button>
                  </div>
                </div>
              ))}
              {apps.length === 0 && (
                <div className="col-span-full bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-xs text-slate-400">
                  No applications available.
                </div>
              )}
            </div>
          )}

          {/* ==================== FOCUSED APP DETAIL VIEW ==================== */}
          {tab === 'app-detail' && selectedApp && (() => {
            const app = selectedApp;
            const fullUrl = `${origin}${app.webhook_path}`;
            const assignedIds = new Set(app.users.map((u) => u.id));
            const unassignedUsers = directory.filter((u) => !assignedIds.has(u.id));
            const contactDraft = newContactByApp[app.id] || { name: '', phone_number: '' };

            return (
              <div className="space-y-5">
                {/* Sub-tab bar + quick actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { id: 'webhook', label: 'Webhook & Access', icon: Webhook },
                      { id: 'url', label: `URL Monitors (${(app.url_monitors || []).length})`, icon: Globe },
                      { id: 'cert', label: `Cert Monitors (${(app.cert_monitors || []).length})`, icon: ShieldCheck },
                    ].map((st) => {
                      const Icon = st.icon;
                      return (
                        <button
                          key={st.id}
                          onClick={() => setAppSubTab(st.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                            appSubTab === st.id
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {st.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-1 rounded-md border text-xs font-medium ${
                      app.enabled
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    }`}>
                      ● {app.enabled ? 'App Enabled' : 'App Paused'}
                    </span>
                    <button
                      onClick={() => setDocsModalApp(app)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1"
                    >
                      <Code2 className="w-3.5 h-3.5" /> API / Usage
                    </button>
                    <button
                      onClick={() => setGuardModalApp({ ...app })}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs flex items-center gap-1"
                      title="Configure deduplication & flood protection"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" /> {app.dedupe_window_seconds}s / {app.max_per_minute}/m
                    </button>
                    <button
                      onClick={() => setTestModalApp(app)}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs flex items-center gap-1"
                    >
                      <Zap className="w-3.5 h-3.5" /> Test SMS
                    </button>
                    <button
                      onClick={async () => {
                        await api.updateApp(app.id, { enabled: !app.enabled });
                        showToast(app.enabled ? `${app.name} webhook paused` : `${app.name} webhook resumed`);
                        loadData();
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs"
                    >
                      {app.enabled ? 'Pause App' : 'Resume App'}
                    </button>
                    {user.is_admin && (
                      <button
                        onClick={() =>
                          setConfirmAction({
                            title: `Delete ${app.name}?`,
                            message: `This will permanently delete "${app.name}" (MAP ${app.map_id}), its webhook token, phone numbers, and all monitors.`,
                            confirmLabel: 'Delete App',
                            danger: true,
                            onConfirm: async () => {
                              await api.deleteApp(app.id);
                              setSelectedAppId(null);
                              setTab('apps');
                              showToast(`Deleted ${app.name}`);
                              loadData();
                            },
                          })
                        }
                        className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-900"
                        title="Delete app (Admin only)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* CHILD TAB 1: WEBHOOK & ACCESS (VERTICAL STACKED LAYOUT) */}
                {appSubTab === 'webhook' && (
                  <div className="space-y-4 text-xs">
                    {/* 1. Webhook Endpoint & Bearer Token */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                      <div className="text-sm font-semibold text-white">Webhook Endpoint &amp; Authentication</div>
                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <div className="flex items-center justify-between text-slate-400 mb-1">
                          <span>Webhook Endpoint (POST)</span>
                          <button onClick={() => copy(fullUrl, 'Webhook URL')} className="text-indigo-400 hover:underline flex items-center gap-1">
                            <Copy className="w-3 h-3" /> Copy
                          </button>
                        </div>
                        <div className="font-mono text-slate-200 break-all">{fullUrl}</div>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <div className="flex items-center justify-between text-slate-400 mb-1">
                          <span>Bearer Token</span>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleCopyToken(app)}
                              className="text-indigo-400 hover:underline flex items-center gap-1"
                              title="Retrieve and copy webhook bearer token"
                            >
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                            <button
                              onClick={() =>
                                setConfirmAction({
                                  title: 'Rotate Bearer Token?',
                                  message: `Rotating the token for "${app.name}" will immediately invalidate the current token. Any workloads or Alertmanager configs using the old token will receive HTTP 401 until updated.`,
                                  confirmLabel: 'Rotate Token',
                                  danger: false,
                                  onConfirm: () => handleRotateToken(app),
                                })
                              }
                              className="text-amber-400 hover:underline flex items-center gap-1"
                            >
                              <RefreshCw className="w-3 h-3" /> Rotate Token
                            </button>
                          </div>
                        </div>
                        <div className="font-mono text-slate-300">{app.token_prefix}</div>
                      </div>
                    </div>

                    {/* 2. Assigned App Users */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-400" />
                        Assigned App Users ({app.users.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {app.users.map((u) => (
                          <span key={u.id} className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 flex items-center gap-1.5">
                            <span className="text-slate-200">{u.display_name}</span>
                            <span className="font-mono text-slate-500">({u.username})</span>
                            <button
                              onClick={() =>
                                setConfirmAction({
                                  title: 'Remove User Access?',
                                  message: `Remove "${u.display_name}" (${u.username}) from ${app.name}? They will no longer be able to manage this app.`,
                                  confirmLabel: 'Remove User',
                                  danger: true,
                                  onConfirm: async () => {
                                    try {
                                      await api.removeAppUser(app.id, u.id);
                                      showToast(`Removed ${u.username}`);
                                      loadData();
                                    } catch (err) {
                                      showToast(err.message, true);
                                    }
                                  },
                                })
                              }
                              className="text-slate-500 hover:text-red-400"
                              title="Remove user from app"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        {app.users.length === 0 && (
                          <span className="text-slate-500">No users assigned yet (Admins still have access).</span>
                        )}
                      </div>
                      <div className="relative max-w-md">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          value={userSearchByApp[app.id] || ''}
                          onChange={(e) => setUserSearchByApp({ ...userSearchByApp, [app.id]: e.target.value })}
                          placeholder={unassignedUsers.length ? 'Search logged-in user by name or username to assign...' : 'All registered users assigned'}
                          disabled={unassignedUsers.length === 0}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                        />
                        {(userSearchByApp[app.id] || '').trim() && (() => {
                          const q = (userSearchByApp[app.id] || '').trim().toLowerCase();
                          const matches = unassignedUsers
                            .filter((u) => u.username.toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q))
                            .slice(0, 6);
                          return (
                            <div className="mt-1 bg-slate-950 border border-slate-700 rounded-lg divide-y divide-slate-800 overflow-hidden shadow-lg">
                              {matches.map((u) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => handleAddAppUser(app.id, u.id)}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center justify-between gap-2"
                                >
                                  <span className="text-slate-200 font-medium">{u.display_name}</span>
                                  <span className="font-mono text-slate-400">{u.username}</span>
                                </button>
                              ))}
                              {matches.length === 0 && (
                                <div className="px-3 py-2 text-slate-500">No matching users found</div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* 3. SMS Phone Numbers */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        <Phone className="w-4 h-4 text-emerald-400" />
                        SMS Phone Numbers ({app.contacts.length})
                      </div>
                      <div className="space-y-2">
                        {app.contacts.map((c) => {
                          const lastFailed = c.last_delivery_status === 'failed';
                          return (
                            <div
                              key={c.id}
                              className={`bg-slate-950 border rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 ${
                                lastFailed ? 'border-red-500/50' : 'border-slate-800'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-slate-200 font-medium">{c.name}</span>
                                  <span className="font-mono text-slate-400">{c.phone_number}</span>
                                  {lastFailed && (
                                    <span
                                      className="px-2 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-400 text-[11px] font-medium flex items-center gap-1"
                                      title={c.last_delivery_error}
                                    >
                                      <AlertTriangle className="w-3 h-3" /> Last SMS failed
                                    </span>
                                  )}
                                </div>
                                {lastFailed && c.last_delivery_error && (
                                  <div className="text-[11px] text-red-400 mt-1">{c.last_delivery_error}</div>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-3 shrink-0">
                                {/* Active Between (EST) — 24h dropdowns (no browser AM/PM quirks) */}
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-900 border border-slate-800 rounded-md px-2 py-1">
                                  <span className="text-slate-500">Active (EST):</span>
                                  <select
                                    value={c.active_start_est || ''}
                                    onChange={async (e) => {
                                      try {
                                        await api.updateAppContact(app.id, c.id, { active_start_est: e.target.value });
                                        loadData();
                                      } catch (err) {
                                        showToast(err.message, true);
                                      }
                                    }}
                                    className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 font-mono text-slate-200 text-[11px]"
                                    title="Start time (EST 24h)"
                                  >
                                    <option value="">--:--</option>
                                    {EST_TIME_OPTIONS.map((t) => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                  <span>–</span>
                                  <select
                                    value={c.active_end_est || ''}
                                    onChange={async (e) => {
                                      try {
                                        await api.updateAppContact(app.id, c.id, { active_end_est: e.target.value });
                                        loadData();
                                      } catch (err) {
                                        showToast(err.message, true);
                                      }
                                    }}
                                    className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 font-mono text-slate-200 text-[11px]"
                                    title="End time (EST 24h)"
                                  >
                                    <option value="">--:--</option>
                                    {EST_TIME_OPTIONS.map((t) => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                  {(c.active_start_est || c.active_end_est) ? (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        await api.updateAppContact(app.id, c.id, { active_start_est: '', active_end_est: '' });
                                        loadData();
                                      }}
                                      className="text-slate-500 hover:text-slate-200 ml-0.5"
                                      title="Clear schedule (24/7)"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  ) : (
                                    <span className="text-slate-500 ml-0.5">24/7</span>
                                  )}
                                </div>
                                <button
                                  onClick={async () => { await api.updateAppContact(app.id, c.id, { active: !c.active }); loadData(); }}
                                  className={`px-2 py-0.5 rounded border text-[11px] font-medium ${
                                    c.active
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                      : 'bg-slate-900 border-slate-700 text-slate-400'
                                  }`}
                                  title="Click to mute or unmute this individual phone number"
                                >
                                  ● {c.active ? 'Receiving SMS' : 'Muted'}
                                </button>
                                <button
                                  onClick={() =>
                                    setConfirmAction({
                                      title: 'Remove Phone Number?',
                                      message: `Remove ${c.name} (${c.phone_number}) from ${app.name}?`,
                                      confirmLabel: 'Remove Phone',
                                      danger: true,
                                      onConfirm: async () => {
                                        await api.deleteAppContact(app.id, c.id);
                                        showToast(`Removed ${c.name}`);
                                        loadData();
                                      },
                                    })
                                  }
                                  className="text-slate-500 hover:text-red-400"
                                  title="Delete phone number"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {app.contacts.length === 0 && (
                          <div className="text-amber-400">No phone numbers added yet.</div>
                        )}
                      </div>
                      <form onSubmit={(e) => handleAddAppContact(e, app.id)} className="flex flex-wrap gap-2 max-w-xl pt-1">
                        <input
                          required
                          value={contactDraft.name}
                          onChange={(e) =>
                            setNewContactByApp({ ...newContactByApp, [app.id]: { ...contactDraft, name: e.target.value } })
                          }
                          placeholder="Contact Name"
                          className="w-44 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                        <input
                          required
                          value={contactDraft.phone_number}
                          onChange={(e) =>
                            setNewContactByApp({ ...newContactByApp, [app.id]: { ...contactDraft, phone_number: e.target.value } })
                          }
                          placeholder="+15551234567"
                          className="flex-1 min-w-40 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                        />
                        <button type="submit" className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
                          + Add Phone
                        </button>
                      </form>
                    </div>
                  </div>
                )}

                {/* CHILD TAB 2: URL MONITORS */}
                {appSubTab === 'url' && (
                  <AppMonitorsSection app={app} mode="url" onRefresh={loadData} onToast={showToast} />
                )}

                {/* CHILD TAB 3: CERT MONITORS */}
                {appSubTab === 'cert' && (
                  <AppMonitorsSection app={app} mode="cert" onRefresh={loadData} onToast={showToast} />
                )}
              </div>
            );
          })()}

          {/* ==================== DELIVERY LOGS ==================== */}
          {tab === 'logs' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">MAP ID / App</th>
                    <th className="py-2.5 px-4">Severity</th>
                    <th className="py-2.5 px-4">Rendered SMS</th>
                    <th className="py-2.5 px-4">Sent / Failed</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {events.map((ev) => (
                    <tr key={ev.id} onClick={() => setInspectEvent(ev)} className="hover:bg-slate-800/40 cursor-pointer">
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">{new Date(ev.created_at).toLocaleString()}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono text-indigo-300">MAP {ev.map_id}</span> · {ev.app_name}
                      </td>
                      <td className="py-3 px-4"><SeverityBadge sev={ev.severity} /></td>
                      <td className="py-3 px-4 font-mono text-slate-300 max-w-md truncate">{ev.rendered_sms}</td>
                      <td className="py-3 px-4 font-mono">{ev.delivered_count} / {ev.failed_count}</td>
                      <td className="py-3 px-4 whitespace-nowrap"><StatusBadge status={ev.status} /></td>
                    </tr>
                  ))}
                  {events.length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-slate-500">No delivery logs yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ==================== ADMIN & SETTINGS ==================== */}
          {tab === 'admin' && user.is_admin && (
            <AdminSettingsView onToast={showToast} onSettingsChanged={loadAuth} />
          )}
        </div>
      </main>

      {/* ==================== MODALS ==================== */}

      {/* Create App Modal (Admin Only — Unique MAP ID, No Environment) */}
      {showCreateApp && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleCreateApp} className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-3.5 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">Register Application &amp; Webhook</h3>
              <button type="button" onClick={() => setShowCreateApp(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-slate-400 mb-1">Application Name</label>
                <input required value={appForm.name} onChange={(e) => setAppForm({ ...appForm, name: e.target.value })} placeholder="Payment Clearing Engine" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">MAP ID (Unique)</label>
                <input required type="number" min="1" value={appForm.map_id} onChange={(e) => setAppForm({ ...appForm, map_id: e.target.value })} placeholder="40218" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
              </div>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Description (optional)</label>
              <input value={appForm.description} onChange={(e) => setAppForm({ ...appForm, description: e.target.value })} placeholder="Optional workload details" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Dedupe Window (seconds)</label>
                <input type="number" min="0" value={appForm.dedupe_window_seconds} onChange={(e) => setAppForm({ ...appForm, dedupe_window_seconds: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Flood Limit (max alerts / min)</label>
                <input type="number" min="0" value={appForm.max_per_minute} onChange={(e) => setAppForm({ ...appForm, max_per_minute: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-slate-400">Assign Initial Users (must have logged in prior)</label>
                <span className="text-[11px] text-slate-500">{appForm.user_ids.length} selected</span>
              </div>
              {appForm.user_ids.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {appForm.user_ids.map((uid) => {
                    const u = directory.find((d) => d.id === uid);
                    if (!u) return null;
                    return (
                      <span key={uid} className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800/60 text-indigo-200 flex items-center gap-1.5">
                        <span>{u.display_name}</span>
                        <span className="font-mono text-indigo-400">({u.username})</span>
                        <button
                          type="button"
                          onClick={() => setAppForm({ ...appForm, user_ids: appForm.user_ids.filter((id) => id !== uid) })}
                          className="text-indigo-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={createAppUserSearch}
                  onChange={(e) => setCreateAppUserSearch(e.target.value)}
                  placeholder="Search by full name or username..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              {(() => {
                const q = createAppUserSearch.trim().toLowerCase();
                const filtered = q
                  ? directory.filter(
                      (u) => u.username.toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q)
                    )
                  : directory;
                const visible = filtered.slice(0, 8);
                return (
                  <div className="max-h-36 overflow-y-auto bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-1">
                    {visible.map((u) => (
                      <label key={u.id} className="flex items-center justify-between cursor-pointer px-1.5 py-1 rounded hover:bg-slate-900">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={appForm.user_ids.includes(u.id)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...appForm.user_ids, u.id]
                                : appForm.user_ids.filter((id) => id !== u.id);
                              setAppForm({ ...appForm, user_ids: next });
                            }}
                            className="accent-indigo-500"
                          />
                          <span className="text-slate-200">{u.display_name}</span>
                        </span>
                        <span className="font-mono text-slate-400">{u.username}</span>
                      </label>
                    ))}
                    {filtered.length === 0 && (
                      <div className="text-slate-500 text-center py-2">No users match "{createAppUserSearch}".</div>
                    )}
                    {filtered.length > visible.length && (
                      <div className="text-[11px] text-slate-500 text-center pt-1 border-t border-slate-800">
                        Showing {visible.length} of {filtered.length} users — type to narrow results
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreateApp(false)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button>
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">Create &amp; Generate Token</button>
            </div>
          </form>
        </div>
      )}

      {/* Dedupe & Flood Protection Modal */}
      {guardModalApp && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleSaveGuards} className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">Dedupe &amp; Flood Protection</h3>
              <button type="button" onClick={() => setGuardModalApp(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-slate-400">
              Protect responders and Twilio spend for <strong>{guardModalApp.name}</strong>. Set either field to <code className="text-slate-200">0</code> to disable.
            </p>
            <div>
              <label className="block text-slate-400 mb-1">Deduplication Window (seconds)</label>
              <input
                type="number"
                min="0"
                value={guardModalApp.dedupe_window_seconds}
                onChange={(e) => setGuardModalApp({ ...guardModalApp, dedupe_window_seconds: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Max Dispatches per Minute (Flood Cap)</label>
              <input
                type="number"
                min="0"
                value={guardModalApp.max_per_minute}
                onChange={(e) => setGuardModalApp({ ...guardModalApp, max_per_minute: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setGuardModalApp(null)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button>
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">Save Protection Rules</button>
            </div>
          </form>
        </div>
      )}

      {/* One-time Bearer Token Modal */}
      {tokenModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-xl max-w-lg w-full p-6 space-y-4 text-xs">
            <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4" />
              Save Your Bearer Token Now
            </div>
            <p className="text-slate-300">
              For security, Signal only stores a SHA-256 hash of this token for <strong>{tokenModal.appName}</strong>. You will not be able to view it again (you can rotate it anytime).
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-slate-400">
                <span>Bearer Token</span>
                <button onClick={() => copy(tokenModal.token, 'Bearer token')} className="text-indigo-400 hover:underline">Copy</button>
              </div>
              <div className="font-mono text-emerald-300 break-all">{tokenModal.token}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
              <div className="text-slate-400">Example cURL</div>
              <pre className="font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-all">{`curl -X POST ${tokenModal.webhookUrl} \\\n  -H "Authorization: Bearer ${tokenModal.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"severity":"CRITICAL","error_code":"ERR_001","log_string":"Queue depth high"}'`}</pre>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setTokenModal(null)} className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium">I've Saved the Token</button>
            </div>
          </div>
        </div>
      )}

      {/* Test Trigger Modal */}
      {testModalApp && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleFireTest} className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-3.5 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">Test SMS Trigger · {testModalApp.name}</h3>
              <button type="button" onClick={() => setTestModalApp(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-slate-400">
              Fires the real Twilio SMS flow to all {testModalApp.contacts.filter((c) => c.active).length} active phone number(s) on this app (bypasses dedupe/flood limits for testing).
            </p>
            <div>
              <label className="block text-slate-400 mb-1">Severity</label>
              <select value={testForm.severity} onChange={(e) => setTestForm({ ...testForm, severity: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white">
                <option value="CRITICAL">CRITICAL</option>
                <option value="HIGH">HIGH</option>
                <option value="WARN">WARN</option>
                <option value="INFO">INFO</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Error Code</label>
              <input value={testForm.error_code} onChange={(e) => setTestForm({ ...testForm, error_code: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Log String</label>
              <input value={testForm.log_string} onChange={(e) => setTestForm({ ...testForm, log_string: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setTestModalApp(null)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button>
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">Send Real SMS</button>
            </div>
          </form>
        </div>
      )}

      {/* API Usage / Integration Guide Modal */}
      {docsModalApp && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 space-y-4 text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  How to Trigger · {docsModalApp.name} (MAP {docsModalApp.map_id})
                </h3>
                <p className="text-slate-400 mt-0.5">Send an authenticated HTTP POST with optional JSON metadata or OpenShift Alertmanager payload.</p>
              </div>
              <button type="button" onClick={() => setDocsModalApp(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span className="font-medium text-slate-300">1. Custom Workload / cURL (Ad-hoc JSON)</span>
                <button
                  onClick={() => copy(`curl -X POST ${origin}${docsModalApp.webhook_path} \\\n  -H "Authorization: Bearer <YOUR_BEARER_TOKEN>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"severity":"CRITICAL","error_code":"ERR_TIMEOUT","log_string":"Payment queue exceeded threshold"}'`, 'cURL snippet')}
                  className="text-indigo-400 hover:underline"
                >
                  Copy
                </button>
              </div>
              <pre className="font-mono text-[11px] text-emerald-300 whitespace-pre-wrap break-all">{`curl -X POST ${origin}${docsModalApp.webhook_path} \\
  -H "Authorization: Bearer <YOUR_BEARER_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "severity": "CRITICAL",
    "error_code": "ERR_TIMEOUT",
    "log_string": "Payment queue exceeded threshold"
  }'`}</pre>
              <div className="text-slate-400 pt-1">
                All JSON fields are optional. Recognized fields: <code className="text-slate-200">severity</code> (CRITICAL/HIGH/WARN/INFO), <code className="text-slate-200">error_code</code>, and <code className="text-slate-200">log_string</code> (or <code className="text-slate-200">message</code>). Extra fields are stored in Delivery Logs.
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span className="font-medium text-slate-300">2. OpenShift / Prometheus Alertmanager Receiver</span>
                <button
                  onClick={() => copy(`receivers:\n  - name: signal-${docsModalApp.map_id}\n    webhook_configs:\n      - url: "${origin}${docsModalApp.webhook_path}"\n        send_resolved: true\n        http_config:\n          authorization:\n            type: Bearer\n            credentials: "<YOUR_BEARER_TOKEN>"`, 'Alertmanager YAML')}
                  className="text-indigo-400 hover:underline"
                >
                  Copy
                </button>
              </div>
              <pre className="font-mono text-[11px] text-indigo-300 whitespace-pre-wrap break-all">{`receivers:
  - name: signal-${docsModalApp.map_id}
    webhook_configs:
      - url: "${origin}${docsModalApp.webhook_path}"
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials: "<YOUR_BEARER_TOKEN>"`}</pre>
              <div className="text-slate-400 pt-1">
                Signal automatically detects Alertmanager payloads and extracts <code className="text-slate-200">alertname</code>, <code className="text-slate-200">severity</code>, <code className="text-slate-200">namespace</code>, <code className="text-slate-200">summary</code>, and <code className="text-slate-200">status</code> (firing/resolved).
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={() => setDocsModalApp(null)} className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Event Inspector Modal */}
      {inspectEvent && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-5 space-y-4 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">
                {inspectEvent.app_name} (MAP {inspectEvent.map_id})
              </h3>
              <button onClick={() => setInspectEvent(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {inspectEvent.suppressed_reason && (
              <div className="p-3 rounded-lg bg-sky-950/60 border border-sky-800/70 text-sky-200">
                <strong>{inspectEvent.status}:</strong> {inspectEvent.suppressed_reason}
              </div>
            )}
            <div>
              <div className="text-slate-400 mb-1">Rendered SMS</div>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-slate-200">{inspectEvent.rendered_sms}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-1">Incoming Payload</div>
              <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-indigo-300 overflow-x-auto">
                {JSON.stringify(inspectEvent.payload, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-slate-400 mb-1">Twilio Deliveries ({inspectEvent.deliveries.length})</div>
              <div className="space-y-1.5">
                {inspectEvent.deliveries.map((d) => (
                  <div key={d.id} className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-slate-200 font-medium">{d.contact_name}</span>{' '}
                      <span className="font-mono text-slate-400">{d.phone_number}</span>
                      {d.twilio_sid && <div className="font-mono text-[11px] text-slate-500">SID: {d.twilio_sid}</div>}
                      {d.error_message && <div className="text-red-400 mt-0.5">{d.error_message}</div>}
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                ))}
                {inspectEvent.deliveries.length === 0 && (
                  <div className="text-slate-500">No SMS dispatched for this event.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test SMS Failure / Delivery Result Modal */}
      {testResultModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-800/60 rounded-xl max-w-lg w-full p-5 space-y-4 text-xs">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4" />
                Test SMS Result · {testResultModal.appName}
              </div>
              <button type="button" onClick={() => setTestResultModal(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {testResultModal.result.reason && (
              <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-800/70 text-amber-200">
                {testResultModal.result.reason}
              </div>
            )}
            <div className="space-y-2">
              {(testResultModal.result.deliveries || []).map((d, idx) => {
                const failed = d.status === 'failed';
                return (
                  <div
                    key={idx}
                    className={`bg-slate-950 border rounded-lg p-3 flex items-start justify-between gap-3 ${
                      failed ? 'border-red-500/50' : 'border-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {failed ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" /> : <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        <span className="font-medium text-slate-200">{d.contact_name}</span>
                        <span className="font-mono text-slate-400">{d.phone_number}</span>
                      </div>
                      {d.error_message && <div className="text-red-400 mt-1">{d.error_message}</div>}
                      {d.twilio_sid && <div className="font-mono text-[11px] text-slate-500 mt-0.5">SID: {d.twilio_sid}</div>}
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setTestResultModal(null)} className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className={`bg-slate-900 border rounded-xl max-w-md w-full p-5 space-y-4 text-xs ${
            confirmAction.danger ? 'border-red-800/60' : 'border-amber-600/50'
          }`}>
            <div className={`flex items-center gap-2 font-semibold text-sm ${
              confirmAction.danger ? 'text-red-400' : 'text-amber-300'
            }`}>
              <AlertTriangle className="w-4 h-4" />
              {confirmAction.title}
            </div>
            <p className="text-slate-300 leading-relaxed">{confirmAction.message}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmAction(null)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fn = confirmAction.onConfirm;
                  setConfirmAction(null);
                  await fn();
                }}
                className={`px-4 py-1.5 rounded-lg text-white font-medium ${
                  confirmAction.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {confirmAction.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg border shadow-xl text-xs font-medium flex items-center gap-2 ${
          toast.isError ? 'bg-red-950 border-red-800 text-red-200' : 'bg-slate-900 border-slate-700 text-emerald-300'
        }`}>
          {toast.isError ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
