import React, { useState } from 'react';
import { Globe, ShieldCheck, Plus, Play, Trash2, X, AlertTriangle, Pencil, Clock, ListPlus, Search, ArrowUpDown } from 'lucide-react';
import { api } from '../api';

function formatLastChecked(iso) {
  if (!iso) return 'Never';
  const dt = new Date(iso);
  const diffSec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return dt.toLocaleString();
}

function ToggleSwitch({ enabled, onToggle, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      title={title || (enabled ? 'Enabled — click to pause' : 'Paused — click to enable')}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
        enabled ? 'bg-emerald-600 border-emerald-500' : 'bg-slate-800 border-slate-700'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function UrlStatusPill({ m }) {
  if (m.last_status === 'ok') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[11px]">
        OK · {m.last_http_code} ({m.last_latency_ms}ms)
      </span>
    );
  }
  if (m.last_status === 'failing') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-mono text-[11px]" title={m.last_error}>
        FAILING{m.last_http_code ? ` · ${m.last_http_code}` : ''}
      </span>
    );
  }
  return <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[11px]">PENDING</span>;
}

function CertStatusPill({ m }) {
  if (m.last_status === 'ok') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[11px]">
        OK · {m.days_remaining}d left
      </span>
    );
  }
  if (m.last_status === 'expiring') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-mono text-[11px]">
        EXPIRING · {m.days_remaining}d left
      </span>
    );
  }
  if (m.last_status === 'expired') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-mono text-[11px]">
        EXPIRED ({m.days_remaining}d)
      </span>
    );
  }
  if (m.last_status === 'error') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-mono text-[11px]" title={m.last_error}>
        ERROR
      </span>
    );
  }
  return <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[11px]">PENDING</span>;
}

const EMPTY_URL_FORM = {
  name: '',
  url: '',
  method: 'GET',
  auth_type: 'none',
  auth_username: '',
  auth_secret: '',
  headers_json: '{}',
  expected_status: 200,
  expected_body: '',
  expected_body_mode: 'contains',
  interval_seconds: 300,
  max_latency_ms: 0,
};

export default function AppMonitorsSection({ app, mode = 'all', onRefresh, onToast }) {
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [editingUrlId, setEditingUrlId] = useState(null);
  const [editingUrlHasSecret, setEditingUrlHasSecret] = useState(false);
  const [showBatchUrlModal, setShowBatchUrlModal] = useState(false);
  const [batchUrlText, setBatchUrlText] = useState('');
  const [batchUrls, setBatchUrls] = useState([]);

  const [showCertModal, setShowCertModal] = useState(false);
  const [editingCert, setEditingCert] = useState(null);
  const [certFilter, setCertFilter] = useState('');
  const [certSort, setCertSort] = useState({ key: 'days_remaining', dir: 'asc' });

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [checkingKey, setCheckingKey] = useState(null);

  const [urlForm, setUrlForm] = useState(EMPTY_URL_FORM);
  const [headerMode, setHeaderMode] = useState('kv');
  const [headerRows, setHeaderRows] = useState([{ key: '', value: '' }]);

  const [certForm, setCertForm] = useState({
    urlsText: '',
    days_before_expiry: 14,
    interval_seconds: 3600,
  });

  function rowsToJson(rows) {
    const obj = {};
    for (const r of rows) {
      const k = (r.key || '').trim();
      if (k) obj[k] = r.value ?? '';
    }
    return JSON.stringify(obj, null, 2);
  }

  function jsonToRows(raw) {
    try {
      const parsed = JSON.parse((raw || '').trim() || '{}');
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed).map(([key, value]) => ({ key, value: String(value) }));
        return entries.length ? entries : [{ key: '', value: '' }];
      }
    } catch {
      // fall through
    }
    return [{ key: '', value: '' }];
  }

  function openAddUrlModal() {
    setEditingUrlId(null);
    setEditingUrlHasSecret(false);
    setUrlForm(EMPTY_URL_FORM);
    setBatchUrls([]);
    setBatchUrlText('');
    setHeaderRows([{ key: '', value: '' }]);
    setHeaderMode('kv');
    setShowUrlModal(true);
  }

  function openEditUrlModal(m) {
    setEditingUrlId(m.id);
    setEditingUrlHasSecret(!!m.has_auth_secret);
    setBatchUrls([]);
    setBatchUrlText('');
    setUrlForm({
      name: m.name || '',
      url: m.url || '',
      method: m.method || 'GET',
      auth_type: m.auth_type || 'none',
      auth_username: m.auth_username || '',
      auth_secret: '',
      headers_json: m.headers_json || '{}',
      expected_status: m.expected_status ?? 200,
      expected_body: m.expected_body || '',
      expected_body_mode: m.expected_body_mode || 'contains',
      interval_seconds: m.interval_seconds || 300,
      max_latency_ms: m.max_latency_ms || 0,
    });
    setHeaderRows(jsonToRows(m.headers_json));
    setHeaderMode('kv');
    setShowUrlModal(true);
  }

  function switchHeaderMode(nextMode) {
    if (nextMode === headerMode) return;
    if (nextMode === 'json') {
      setUrlForm((f) => ({ ...f, headers_json: rowsToJson(headerRows) }));
      setHeaderMode('json');
    } else {
      try {
        const parsed = JSON.parse((urlForm.headers_json || '').trim() || '{}');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Headers JSON must be an object');
        }
        const entries = Object.entries(parsed).map(([key, value]) => ({ key, value: String(value) }));
        setHeaderRows(entries.length ? entries : [{ key: '', value: '' }]);
        setHeaderMode('kv');
      } catch (err) {
        onToast(`Fix JSON before switching to Key/Value: ${err.message}`, true);
      }
    }
  }

  async function handleSaveUrl(e) {
    e.preventDefault();
    try {
      const headersJson = headerMode === 'kv' ? rowsToJson(headerRows) : urlForm.headers_json;
      const body = {
        ...urlForm,
        headers_json: headersJson,
        expected_status: Number(urlForm.expected_status) || 0,
        interval_seconds: Number(urlForm.interval_seconds) || 300,
        max_latency_ms: Number(urlForm.max_latency_ms) || 0,
      };
      if (editingUrlId) {
        await api.updateUrlMonitor(app.id, editingUrlId, body);
        onToast('URL monitor updated');
      } else {
        const res = await api.createUrlMonitor(app.id, {
          ...body,
          urls: batchUrls.length ? batchUrls : undefined,
        });
        onToast(res.count > 1 ? `Added ${res.count} URL monitors` : 'URL monitor added');
      }
      setShowUrlModal(false);
      setEditingUrlId(null);
      setBatchUrls([]);
      setBatchUrlText('');
      onRefresh();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handleCreateCerts(e) {
    e.preventDefault();
    const urls = certForm.urlsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!urls.length) {
      onToast('Paste at least one URL or hostname', true);
      return;
    }
    try {
      const res = await api.createCertMonitorsBatch(app.id, {
        urls,
        days_before_expiry: Number(certForm.days_before_expiry) || 14,
        interval_seconds: Number(certForm.interval_seconds) || 3600,
      });
      setShowCertModal(false);
      setCertForm({ urlsText: '', days_before_expiry: 14, interval_seconds: 3600 });
      onToast(`Added ${res.count} certificate monitor(s)`);
      onRefresh();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handleSaveEditCert(e) {
    e.preventDefault();
    try {
      await api.updateCertMonitor(app.id, editingCert.id, {
        days_before_expiry: Number(editingCert.days_before_expiry) || 14,
        interval_seconds: Number(editingCert.interval_seconds) || 3600,
      });
      setEditingCert(null);
      onToast('Certificate monitor updated');
      onRefresh();
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function handleCheckUrl(m) {
    setCheckingKey(`url-${m.id}`);
    try {
      const res = await api.checkUrlMonitor(app.id, m.id);
      onToast(
        res.status === 'ok'
          ? `URL OK (HTTP ${res.http_code}, ${res.latency_ms}ms)`
          : `URL Failing: ${res.error}`,
        res.status !== 'ok'
      );
      onRefresh();
    } catch (err) {
      onToast(err.message, true);
    } finally {
      setCheckingKey(null);
    }
  }

  async function handleCheckCert(m) {
    setCheckingKey(`cert-${m.id}`);
    try {
      const res = await api.checkCertMonitor(app.id, m.id);
      onToast(
        res.status === 'ok'
          ? `Cert OK (${res.days_remaining} days remaining)`
          : `Cert ${res.status.toUpperCase()}: ${res.error}`,
        res.status !== 'ok'
      );
      onRefresh();
    } catch (err) {
      onToast(err.message, true);
    } finally {
      setCheckingKey(null);
    }
  }

  const urlMonitors = app.url_monitors || [];
  const certMonitors = app.cert_monitors || [];
  const showUrl = mode === 'all' || mode === 'url';
  const showCert = mode === 'all' || mode === 'cert';

  return (
    <>
      <div className={mode === 'all' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-slate-800 text-xs' : 'space-y-4 text-xs'}>
        {/* URL MONITORS */}
        {showUrl && (
          <div className={mode === 'all' ? 'space-y-2.5' : 'bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3.5'}>
            <div className="flex items-center justify-between">
              <div className="text-slate-200 font-semibold flex items-center gap-1.5 text-sm">
                <Globe className="w-4 h-4 text-sky-400" />
                URL Monitors ({urlMonitors.length})
              </div>
              <button
                onClick={openAddUrlModal}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add URL Monitor
              </button>
            </div>

            <div className="space-y-2">
              {urlMonitors.map((m) => (
                <div key={m.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[11px] text-indigo-300">{m.method}</span>
                        <span className="text-slate-200 font-medium truncate">{m.name || m.url}</span>
                        <UrlStatusPill m={m} />
                      </div>
                      {m.name && <div className="font-mono text-[11px] text-slate-500 truncate">{m.url}</div>}
                      {m.last_error && <div className="text-[11px] text-red-400 truncate mt-0.5">{m.last_error}</div>}
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        disabled={checkingKey === `url-${m.id}`}
                        onClick={() => handleCheckUrl(m)}
                        title="Check now"
                        className="p-1 rounded hover:bg-slate-800 text-sky-400 hover:text-sky-300 disabled:opacity-40"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openEditUrlModal(m)}
                        title="Edit monitor"
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <ToggleSwitch
                        enabled={m.enabled}
                        onToggle={async () => { await api.updateUrlMonitor(app.id, m.id, { enabled: !m.enabled }); onRefresh(); }}
                      />
                      <button
                        onClick={() =>
                          setConfirmDelete({
                            title: 'Delete URL Monitor',
                            message: `Are you sure you want to delete the URL monitor for "${m.name || m.url}"?`,
                            onConfirm: async () => {
                              await api.deleteUrlMonitor(app.id, m.id);
                              onToast('URL monitor deleted');
                              onRefresh();
                            },
                          })
                        }
                        title="Delete monitor"
                        className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
                    <div>
                      every {m.interval_seconds}s · expect {m.expected_status || '2xx'}
                      {m.max_latency_ms > 0 ? ` · ≤ ${m.max_latency_ms}ms` : ''}
                      {m.expected_body ? (m.expected_body_mode === 'regex' ? ` · regex /${m.expected_body}/` : ` · contains "${m.expected_body}"`) : ''}
                      {m.auth_type !== 'none' ? ` · auth:${m.auth_type}` : ''}
                    </div>
                    <div className="flex items-center gap-1 text-slate-400" title={m.last_checked_at ? new Date(m.last_checked_at).toLocaleString() : 'Never checked'}>
                      <Clock className="w-3 h-3" /> Last checked: {formatLastChecked(m.last_checked_at)}
                    </div>
                  </div>
                </div>
              ))}
              {urlMonitors.length === 0 && (
                <div className="text-slate-500 py-4 text-center">No outgoing URL monitors configured.</div>
              )}
            </div>
          </div>
        )}

        {/* CERTIFICATE EXPIRY MONITORS (SORTABLE, FILTERABLE TABLE) */}
        {showCert && (() => {
          const toggleSort = (key) => {
            setCertSort((prev) =>
              prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
            );
          };

          const q = certFilter.trim().toLowerCase();
          const filteredCerts = q
            ? certMonitors.filter(
                (m) =>
                  (m.url || '').toLowerCase().includes(q) ||
                  (m.last_status || '').toLowerCase().includes(q) ||
                  (m.last_error || '').toLowerCase().includes(q) ||
                  (m.cert_expires_at || '').toLowerCase().includes(q)
              )
            : certMonitors;

          const sortedCerts = [...filteredCerts].sort((a, b) => {
            const dir = certSort.dir === 'asc' ? 1 : -1;
            const k = certSort.key;
            let av = a[k];
            let bv = b[k];
            if (k === 'days_remaining' || k === 'days_before_expiry') {
              const an = av === null || av === undefined ? Number.POSITIVE_INFINITY : Number(av);
              const bn = bv === null || bv === undefined ? Number.POSITIVE_INFINITY : Number(bv);
              return (an - bn) * dir;
            }
            if (k === 'cert_expires_at' || k === 'last_checked_at') {
              const at = av ? new Date(av).getTime() : Number.POSITIVE_INFINITY;
              const bt = bv ? new Date(bv).getTime() : Number.POSITIVE_INFINITY;
              return (at - bt) * dir;
            }
            return String(av || '').localeCompare(String(bv || '')) * dir;
          });

          const SortHeader = ({ colKey, label }) => (
            <th
              onClick={() => toggleSort(colKey)}
              className="py-2.5 px-3 font-medium cursor-pointer select-none hover:text-slate-200 whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-1">
                {label}
                <ArrowUpDown className={`w-3 h-3 ${certSort.key === colKey ? 'text-indigo-400' : 'text-slate-600'}`} />
                {certSort.key === colKey && (
                  <span className="text-[10px] text-indigo-400">{certSort.dir === 'asc' ? '▲' : '▼'}</span>
                )}
              </span>
            </th>
          );

          return (
            <div className={mode === 'all' ? 'space-y-2.5' : 'bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4'}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-slate-200 font-semibold flex items-center gap-1.5 text-sm">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  Certificate Expiry Monitors ({certMonitors.length})
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative w-64">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      value={certFilter}
                      onChange={(e) => setCertFilter(e.target.value)}
                      placeholder="Filter URL, status, or expiry..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <button
                    onClick={() => setShowCertModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 text-xs font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Cert(s)
                  </button>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/70 text-slate-400 border-b border-slate-800">
                    <tr>
                      <SortHeader colKey="url" label="Endpoint URL" />
                      <SortHeader colKey="last_status" label="Status" />
                      <SortHeader colKey="days_remaining" label="Remaining Days" />
                      <SortHeader colKey="cert_expires_at" label="Expires On" />
                      <SortHeader colKey="days_before_expiry" label="Threshold" />
                      <SortHeader colKey="last_checked_at" label="Last Checked" />
                      <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {sortedCerts.map((m) => {
                      const daysColor =
                        m.days_remaining === null || m.days_remaining === undefined
                          ? 'text-slate-500'
                          : m.days_remaining <= 0
                          ? 'text-red-400 font-semibold'
                          : m.days_remaining <= m.days_before_expiry
                          ? 'text-amber-400 font-semibold'
                          : 'text-emerald-400 font-medium';
                      return (
                        <tr key={m.id} className="hover:bg-slate-900/50">
                          <td className="py-2.5 px-3 max-w-xs">
                            <div className="font-mono text-slate-200 truncate" title={m.url}>{m.url}</div>
                            {m.last_error && (
                              <div className="text-[11px] text-amber-400 truncate mt-0.5" title={m.last_error}>{m.last_error}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <CertStatusPill m={m} />
                          </td>
                          <td className={`py-2.5 px-3 font-mono whitespace-nowrap ${daysColor}`}>
                            {m.days_remaining !== null && m.days_remaining !== undefined ? `${m.days_remaining}d` : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300 whitespace-nowrap">
                            {m.cert_expires_at ? m.cert_expires_at.slice(0, 10) : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap">
                            &le; {m.days_before_expiry}d · {Math.round(m.interval_seconds / 60)}m
                          </td>
                          <td
                            className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap"
                            title={m.last_checked_at ? new Date(m.last_checked_at).toLocaleString() : 'Never checked'}
                          >
                            {formatLastChecked(m.last_checked_at)}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                disabled={checkingKey === `cert-${m.id}`}
                                onClick={() => handleCheckCert(m)}
                                title="Check certificate now"
                                className="p-1 rounded hover:bg-slate-800 text-sky-400 hover:text-sky-300 disabled:opacity-40"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingCert({ ...m })}
                                title="Edit threshold / interval"
                                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <ToggleSwitch
                                enabled={m.enabled}
                                onToggle={async () => { await api.updateCertMonitor(app.id, m.id, { enabled: !m.enabled }); onRefresh(); }}
                              />
                              <button
                                onClick={() =>
                                  setConfirmDelete({
                                    title: 'Delete Certificate Monitor',
                                    message: `Are you sure you want to delete the certificate expiry monitor for "${m.url}"?`,
                                    onConfirm: async () => {
                                      await api.deleteCertMonitor(app.id, m.id);
                                      onToast('Certificate monitor deleted');
                                      onRefresh();
                                    },
                                  })
                                }
                                title="Delete monitor"
                                className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {sortedCerts.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          {certMonitors.length === 0
                            ? 'No certificate expiry monitors configured.'
                            : `No certificate monitors match "${certFilter}".`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ADD / EDIT URL MONITOR MODAL */}
      {showUrlModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleSaveUrl} className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-3.5 text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">
                {editingUrlId ? 'Edit URL Monitor' : 'Add URL Monitor'} · {app.name}
              </h3>
              <button type="button" onClick={() => setShowUrlModal(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-slate-400">TLS certificate verification is skipped automatically for internal endpoints. Alerts on failure &amp; recovery.</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Method</label>
                <select value={urlForm.method} onChange={(e) => setUrlForm({ ...urlForm, method: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-slate-400 mb-1">Label (optional)</label>
                <input value={urlForm.name} onChange={(e) => setUrlForm({ ...urlForm, name: e.target.value })} placeholder="Health Check Endpoint" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-400">Target URL</label>
                {!editingUrlId && (
                  <button
                    type="button"
                    onClick={() => {
                      setBatchUrlText(batchUrls.join('\n'));
                      setShowBatchUrlModal(true);
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    <ListPlus className="w-3.5 h-3.5" />
                    {batchUrls.length ? `Edit Batch (${batchUrls.length} URLs)` : 'Paste Batch URLs'}
                  </button>
                )}
              </div>
              {batchUrls.length > 0 && !editingUrlId ? (
                <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-indigo-200 font-medium">
                      {batchUrls.length} URLs queued — all settings below will apply to each entry
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 truncate mt-0.5">
                      {batchUrls.slice(0, 3).join(', ')}{batchUrls.length > 3 ? ` +${batchUrls.length - 3} more` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setBatchUrls([]); setBatchUrlText(''); }}
                    className="text-slate-400 hover:text-red-400 shrink-0"
                    title="Clear batch list"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <input required value={urlForm.url} onChange={(e) => setUrlForm({ ...urlForm, url: e.target.value })} placeholder="https://payments.corp.internal/healthz" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Auth</label>
                <select value={urlForm.auth_type} onChange={(e) => setUrlForm({ ...urlForm, auth_type: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white">
                  <option value="none">None</option>
                  <option value="bearer">Bearer</option>
                  <option value="basic">Basic</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Expected HTTP</label>
                <input type="number" min="0" value={urlForm.expected_status} onChange={(e) => setUrlForm({ ...urlForm, expected_status: e.target.value })} placeholder="200" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-white" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Interval (sec)</label>
                <input type="number" min="30" value={urlForm.interval_seconds} onChange={(e) => setUrlForm({ ...urlForm, interval_seconds: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-white" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Must reply (ms)</label>
                <input type="number" min="0" value={urlForm.max_latency_ms} onChange={(e) => setUrlForm({ ...urlForm, max_latency_ms: e.target.value })} placeholder="0 = off" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-white" />
              </div>
            </div>
            {urlForm.auth_type === 'bearer' && (
              <div>
                <label className="block text-slate-400 mb-1">
                  Bearer Token {editingUrlHasSecret && <span className="text-emerald-400">(saved)</span>}
                </label>
                <input type="password" value={urlForm.auth_secret} onChange={(e) => setUrlForm({ ...urlForm, auth_secret: e.target.value })} placeholder={editingUrlHasSecret ? 'Leave blank to keep existing' : 'Token value'} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
              </div>
            )}
            {urlForm.auth_type === 'basic' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Basic Username</label>
                  <input value={urlForm.auth_username} onChange={(e) => setUrlForm({ ...urlForm, auth_username: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Basic Password {editingUrlHasSecret && <span className="text-emerald-400">(saved)</span>}
                  </label>
                  <input type="password" value={urlForm.auth_secret} onChange={(e) => setUrlForm({ ...urlForm, auth_secret: e.target.value })} placeholder={editingUrlHasSecret ? 'Leave blank to keep existing' : 'Password'} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white" />
                </div>
              </div>
            )}

            {/* Custom Headers (Key/Value or JSON) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-slate-400">Custom Headers (optional)</label>
                <div className="inline-flex rounded-md bg-slate-950 border border-slate-800 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => switchHeaderMode('kv')}
                    className={`px-2 py-0.5 rounded ${headerMode === 'kv' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Key / Value
                  </button>
                  <button
                    type="button"
                    onClick={() => switchHeaderMode('json')}
                    className={`px-2 py-0.5 rounded ${headerMode === 'json' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    JSON
                  </button>
                </div>
              </div>

              {headerMode === 'kv' ? (
                <div className="space-y-1.5">
                  {headerRows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={row.key}
                        onChange={(e) => {
                          const next = [...headerRows];
                          next[idx] = { ...next[idx], key: e.target.value };
                          setHeaderRows(next);
                        }}
                        placeholder="Header-Name"
                        className="w-2/5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-white"
                      />
                      <input
                        value={row.value}
                        onChange={(e) => {
                          const next = [...headerRows];
                          next[idx] = { ...next[idx], value: e.target.value };
                          setHeaderRows(next);
                        }}
                        placeholder="Value"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-white"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = headerRows.filter((_, i) => i !== idx);
                          setHeaderRows(next.length ? next : [{ key: '', value: '' }]);
                        }}
                        className="p-1.5 text-slate-500 hover:text-red-400"
                        title="Remove header"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setHeaderRows([...headerRows, { key: '', value: '' }])}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 pt-0.5"
                  >
                    <Plus className="w-3 h-3" /> Add Header Row
                  </button>
                </div>
              ) : (
                <textarea
                  rows={3}
                  value={urlForm.headers_json}
                  onChange={(e) => setUrlForm({ ...urlForm, headers_json: e.target.value })}
                  placeholder='{"X-Api-Key": "..."}'
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              )}
            </div>

            {/* Expected Response (Substring / Regex) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-slate-400">Expected Response Match (optional)</label>
                <div className="inline-flex rounded-md bg-slate-950 border border-slate-800 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setUrlForm({ ...urlForm, expected_body_mode: 'contains' })}
                    className={`px-2 py-0.5 rounded ${urlForm.expected_body_mode === 'contains' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Substring (contains)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrlForm({ ...urlForm, expected_body_mode: 'regex' })}
                    className={`px-2 py-0.5 rounded ${urlForm.expected_body_mode === 'regex' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Regex
                  </button>
                </div>
              </div>
              <input
                value={urlForm.expected_body}
                onChange={(e) => setUrlForm({ ...urlForm, expected_body: e.target.value })}
                placeholder={urlForm.expected_body_mode === 'regex' ? 'e.g. "status"\\s*:\\s*"(ok|UP)"' : 'e.g. "status":"ok"'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowUrlModal(false)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button>
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">
                {editingUrlId ? 'Save Changes' : batchUrls.length > 1 ? `Add ${batchUrls.length} URL Monitors` : 'Add URL Monitor'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* BATCH URL PASTE POPUP MODAL */}
      {showBatchUrlModal && (
        <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-indigo-500/40 rounded-xl max-w-lg w-full p-5 space-y-3.5 text-xs shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <ListPlus className="w-4 h-4 text-indigo-400" />
                Paste Batch URLs
              </h3>
              <button type="button" onClick={() => setShowBatchUrlModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-slate-400">
              Paste one URL per line (must start with <code className="text-slate-200">http://</code> or <code className="text-slate-200">https://</code>). Individual monitor entries will be created using the settings in the URL Monitor form.
            </p>
            <textarea
              rows={6}
              autoFocus
              value={batchUrlText}
              onChange={(e) => setBatchUrlText(e.target.value)}
              placeholder={"https://service-a.corp.internal/healthz\nhttps://service-b.corp.internal/healthz\nhttps://service-c.corp.internal/healthz"}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-400 font-mono">
                {batchUrlText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length} URL(s) detected
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowBatchUrlModal(false)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const parsed = batchUrlText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
                    setBatchUrls(parsed);
                    setShowBatchUrlModal(false);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                >
                  Apply URLs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD CERT MONITORS (BATCH) MODAL */}
      {showCertModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleCreateCerts} className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-3.5 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">Add Certificate Expiry Monitor(s) · {app.name}</h3>
              <button type="button" onClick={() => setShowCertModal(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-slate-400">
              Paste one or multiple URLs (one per line). Signal creates an individual monitor for each endpoint and alerts at most once every 24h when within threshold.
            </p>
            <div>
              <label className="block text-slate-400 mb-1">URLs / Hostnames (one per line)</label>
              <textarea
                required
                rows={4}
                value={certForm.urlsText}
                onChange={(e) => setCertForm({ ...certForm, urlsText: e.target.value })}
                placeholder={"https://payments.corp.internal\nhttps://swift-gw.corp.internal:8443\nfx-api.corp.internal"}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Alert Days Before Expiry</label>
                <input
                  type="number"
                  min="1"
                  value={certForm.days_before_expiry}
                  onChange={(e) => setCertForm({ ...certForm, days_before_expiry: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Check Interval (seconds)</label>
                <input
                  type="number"
                  min="60"
                  value={certForm.interval_seconds}
                  onChange={(e) => setCertForm({ ...certForm, interval_seconds: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCertModal(false)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button>
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">Create Monitor(s)</button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT CERT MONITOR MODAL */}
      {editingCert && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleSaveEditCert} className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-3.5 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-white">Edit Certificate Monitor</h3>
              <button type="button" onClick={() => setEditingCert(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 truncate">
              {editingCert.url}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Alert Days Before Expiry</label>
                <input
                  type="number"
                  min="1"
                  value={editingCert.days_before_expiry}
                  onChange={(e) => setEditingCert({ ...editingCert, days_before_expiry: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Check Interval (seconds)</label>
                <input
                  type="number"
                  min="60"
                  value={editingCert.interval_seconds}
                  onChange={(e) => setEditingCert({ ...editingCert, interval_seconds: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingCert(null)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button>
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-800/60 rounded-xl max-w-md w-full p-5 space-y-4 text-xs">
            <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4" />
              {confirmDelete.title}
            </div>
            <p className="text-slate-300">{confirmDelete.message}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fn = confirmDelete.onConfirm;
                  setConfirmDelete(null);
                  await fn();
                }}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
