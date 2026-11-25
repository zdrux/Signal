import React, { useMemo, useState } from 'react';
import { Globe, ShieldCheck, Plus, Play, Trash2, X, AlertTriangle, Pencil, ListPlus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api';

function formatLastChecked(iso) {
  if (!iso) return 'Never';
  const dt = new Date(iso);
  const diffSec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return dt.toLocaleDateString();
}

function formatInterval(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

function SortHeader({ colKey, label, sort, onSort, align = 'left' }) {
  const active = sort.key === colKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th
      aria-sort={ariaSort}
      className={`monitor-sort-th py-0 px-2.5 h-9 font-normal whitespace-nowrap select-none ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(colKey)}
        data-active={active || undefined}
        className={`monitor-sort-btn ${align === 'right' ? 'ml-auto' : ''}`}
      >
        <span>{label}</span>
        <span className="sort-glyph" aria-hidden="true">
          {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

function MethodBadge({ method }) {
  const styles = {
    GET: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    POST: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    HEAD: 'bg-slate-800 text-slate-300 border-slate-700',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border shrink-0 ${
        styles[method] || styles.HEAD
      }`}
    >
      {method || 'GET'}
    </span>
  );
}

function ToggleSwitch({ enabled, onToggle, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      title={title || (enabled ? 'Enabled — click to pause' : 'Paused — click to enable')}
      className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
        enabled ? 'bg-emerald-600 border-emerald-500' : 'bg-slate-800 border-slate-700'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function UrlStatusPill({ m }) {
  if (!m.enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-slate-700/80 bg-slate-800/70 text-slate-400 font-medium text-[11px] whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        Paused
      </span>
    );
  }
  if (m.last_status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-emerald-500/30 bg-emerald-500/12 text-emerald-400 font-medium text-[11px] whitespace-nowrap tabular-nums">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        OK · {m.last_http_code || 200}
      </span>
    );
  }
  if (m.last_status === 'failing') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-red-500/35 bg-red-500/12 text-red-400 font-medium text-[11px] whitespace-nowrap tabular-nums"
        title={m.last_error}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Failing{m.last_http_code ? ` · ${m.last_http_code}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-slate-700/80 bg-slate-800/70 text-slate-400 font-medium text-[11px] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Pending
    </span>
  );
}

function CertStatusPill({ m }) {
  if (!m.enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-slate-700/80 bg-slate-800/70 text-slate-400 font-medium text-[11px] whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        Paused
      </span>
    );
  }
  if (m.last_status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-emerald-500/30 bg-emerald-500/12 text-emerald-400 font-medium text-[11px] whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Healthy
      </span>
    );
  }
  if (m.last_status === 'expiring') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-amber-500/35 bg-amber-500/12 text-amber-400 font-medium text-[11px] whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Expiring
      </span>
    );
  }
  if (m.last_status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-red-500/35 bg-red-500/12 text-red-400 font-medium text-[11px] whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Expired
      </span>
    );
  }
  if (m.last_status === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-red-500/35 bg-red-500/12 text-red-400 font-medium text-[11px] whitespace-nowrap"
        title={m.last_error}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] border border-slate-700/80 bg-slate-800/70 text-slate-400 font-medium text-[11px] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Pending
    </span>
  );
}

function TablePagination({ page, totalPages, start, end, total, onPageChange }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between text-[11.5px] text-slate-400 pt-1">
      <span className="tabular-nums">
        {start}–{end} of {total}
      </span>
      {totalPages > 1 && (
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="h-7 px-2 rounded-[5px] border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-default inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <span className="px-2 tabular-nums text-slate-300">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="h-7 px-2 rounded-[5px] border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-default inline-flex items-center gap-1"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
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

  const [urlStage, setUrlStage] = useState('all'); // all | ok | failing | pending | paused
  const [urlFilter, setUrlFilter] = useState('');
  const [urlMethodFilter, setUrlMethodFilter] = useState('ALL');
  const [urlSort, setUrlSort] = useState({ key: 'last_checked_at', dir: 'desc' });
  const [urlPage, setUrlPage] = useState(1);
  const [urlPageSize, setUrlPageSize] = useState(10);

  const [showCertModal, setShowCertModal] = useState(false);
  const [editingCert, setEditingCert] = useState(null);
  const [certStage, setCertStage] = useState('all'); // all | ok | expiring | critical | paused
  const [certFilter, setCertFilter] = useState('');
  const [certSort, setCertSort] = useState({ key: 'days_remaining', dir: 'asc' });
  const [certPage, setCertPage] = useState(1);
  const [certPageSize, setCertPageSize] = useState(10);

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
      <div className={mode === 'all' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-slate-800 text-xs' : 'space-y-3 text-xs'}>
        {/* URL MONITORS — SLEEK POSTSCORE-STYLE TABLE */}
        {showUrl && (() => {
          const toggleUrlSort = (key) => {
            setUrlSort((prev) =>
              prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
            );
            setUrlPage(1);
          };

          const urlCounts = {
            all: urlMonitors.length,
            ok: urlMonitors.filter((m) => m.enabled && m.last_status === 'ok').length,
            failing: urlMonitors.filter((m) => m.enabled && m.last_status === 'failing').length,
            pending: urlMonitors.filter((m) => m.enabled && (!m.last_status || m.last_status === 'unknown')).length,
            paused: urlMonitors.filter((m) => !m.enabled).length,
          };

          const q = urlFilter.trim().toLowerCase();
          const filteredUrls = urlMonitors.filter((m) => {
            if (urlStage === 'ok' && !(m.enabled && m.last_status === 'ok')) return false;
            if (urlStage === 'failing' && !(m.enabled && m.last_status === 'failing')) return false;
            if (urlStage === 'pending' && !(m.enabled && (!m.last_status || m.last_status === 'unknown'))) return false;
            if (urlStage === 'paused' && m.enabled) return false;
            if (urlMethodFilter !== 'ALL' && (m.method || 'GET') !== urlMethodFilter) return false;
            if (!q) return true;
            return (
              (m.url || '').toLowerCase().includes(q) ||
              (m.name || '').toLowerCase().includes(q) ||
              (m.method || '').toLowerCase().includes(q) ||
              (m.last_status || '').toLowerCase().includes(q) ||
              (m.last_error || '').toLowerCase().includes(q) ||
              String(m.last_http_code || '').includes(q)
            );
          });

          const statusRank = (m) => {
            if (!m.enabled) return 3;
            if (m.last_status === 'failing') return 0;
            if (m.last_status === 'unknown' || !m.last_status) return 1;
            return 2;
          };

          const sortedUrls = [...filteredUrls].sort((a, b) => {
            const dir = urlSort.dir === 'asc' ? 1 : -1;
            const k = urlSort.key;
            if (k === 'endpoint') {
              return String(a.name || a.url || '').localeCompare(String(b.name || b.url || '')) * dir;
            }
            if (k === 'last_status') {
              const r = statusRank(a) - statusRank(b);
              if (r !== 0) return r * dir;
              return ((a.last_http_code || 0) - (b.last_http_code || 0)) * dir;
            }
            if (k === 'last_latency_ms' || k === 'interval_seconds' || k === 'expected_status') {
              const an = a[k] === null || a[k] === undefined ? Number.POSITIVE_INFINITY : Number(a[k]);
              const bn = b[k] === null || b[k] === undefined ? Number.POSITIVE_INFINITY : Number(b[k]);
              return (an - bn) * dir;
            }
            if (k === 'last_checked_at') {
              const at = a.last_checked_at ? new Date(a.last_checked_at).getTime() : 0;
              const bt = b.last_checked_at ? new Date(b.last_checked_at).getTime() : 0;
              return (at - bt) * dir;
            }
            if (k === 'enabled') {
              return (Number(b.enabled) - Number(a.enabled)) * dir;
            }
            return String(a[k] || '').localeCompare(String(b[k] || '')) * dir;
          });

          const totalPages = Math.max(1, Math.ceil(sortedUrls.length / urlPageSize));
          const safePage = Math.min(urlPage, totalPages);
          const startIdx = (safePage - 1) * urlPageSize;
          const pagedUrls = sortedUrls.slice(startIdx, startIdx + urlPageSize);

          return (
            <div className="space-y-2.5">
              {/* Stage Filter Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="URL monitor status filter"
                  className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-slate-800 bg-slate-900"
                >
                  {[
                    ['all', 'All Monitors'],
                    ['ok', 'Healthy'],
                    ['failing', 'Failing'],
                    ['pending', 'Pending'],
                    ['paused', 'Paused'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={urlStage === key}
                      onClick={() => { setUrlStage(key); setUrlPage(1); }}
                      className={`h-[26px] px-2.5 rounded-[4px] inline-flex items-center gap-1.5 text-[11.5px] transition-colors ${
                        urlStage === key
                          ? 'bg-slate-800 text-slate-100 font-semibold'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-medium'
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`text-[10px] font-semibold tabular-nums ${
                          key === 'failing' && urlCounts.failing > 0
                            ? 'text-red-400'
                            : urlStage === key
                            ? 'text-slate-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {urlCounts[key]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sleek Single-Line Toolbar */}
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-[7px] border border-slate-800 bg-slate-900">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={urlFilter}
                    onChange={(e) => { setUrlFilter(e.target.value); setUrlPage(1); }}
                    placeholder="Search URL, label, status, or error..."
                    className="w-full h-7 bg-slate-950 border border-slate-800 rounded-[5px] pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {urlFilter && (
                    <button
                      type="button"
                      onClick={() => { setUrlFilter(''); setUrlPage(1); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
                      title="Clear search"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <select
                  aria-label="Filter by HTTP method"
                  value={urlMethodFilter}
                  onChange={(e) => { setUrlMethodFilter(e.target.value); setUrlPage(1); }}
                  className="h-7 px-2 rounded-[5px] bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All methods</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="HEAD">HEAD</option>
                </select>

                <select
                  aria-label="Rows per page"
                  value={urlPageSize}
                  onChange={(e) => { setUrlPageSize(Number(e.target.value)); setUrlPage(1); }}
                  className="h-7 px-2 rounded-[5px] bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 ml-auto"
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                </select>

                <button
                  type="button"
                  onClick={openAddUrlModal}
                  className="h-7 px-2.5 rounded-[5px] bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-1 text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add URL Monitor
                </button>
              </div>

              {/* High-Density Sleek Table */}
              <div className="border border-slate-800 rounded-lg bg-slate-900 overflow-x-auto">
                <table className="w-full table-fixed min-w-[780px] text-left border-collapse">
                  <colgroup>
                    <col />
                    <col className="w-[106px]" />
                    <col className="w-[68px]" />
                    <col className="w-[64px]" />
                    <col className="w-[144px]" />
                    <col className="w-[84px]" />
                    <col className="w-[58px]" />
                    <col className="w-[88px]" />
                  </colgroup>
                  <thead className="bg-slate-950/55 text-[11.5px] text-slate-400 border-b border-slate-800">
                    <tr>
                      <SortHeader colKey="endpoint" label="Endpoint" sort={urlSort} onSort={toggleUrlSort} />
                      <SortHeader colKey="last_status" label="Result" sort={urlSort} onSort={toggleUrlSort} />
                      <SortHeader colKey="last_latency_ms" label="Latency" sort={urlSort} onSort={toggleUrlSort} />
                      <SortHeader colKey="interval_seconds" label="Interval" sort={urlSort} onSort={toggleUrlSort} />
                      <SortHeader colKey="expected_status" label="Expectation" sort={urlSort} onSort={toggleUrlSort} />
                      <SortHeader colKey="last_checked_at" label="Checked" sort={urlSort} onSort={toggleUrlSort} />
                      <SortHeader colKey="enabled" label="Active" sort={urlSort} onSort={toggleUrlSort} />
                      <th className="py-0 px-2.5 h-9 font-normal text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {pagedUrls.map((m) => {
                      const slowLatency =
                        m.max_latency_ms > 0 &&
                        m.last_latency_ms !== null &&
                        m.last_latency_ms !== undefined &&
                        m.last_latency_ms > m.max_latency_ms;
                      const latencyColor =
                        m.last_latency_ms === null || m.last_latency_ms === undefined
                          ? 'text-slate-500'
                          : slowLatency
                          ? 'text-red-400 font-semibold'
                          : m.last_latency_ms >= 500
                          ? 'text-amber-400'
                          : 'text-slate-200';
                      const bodyChip = m.expected_body
                        ? m.expected_body_mode === 'regex'
                          ? `/${m.expected_body}/`
                          : m.expected_body
                        : '';

                      return (
                        <tr
                          key={m.id}
                          className={`hover:bg-slate-800/35 transition-colors ${!m.enabled ? 'opacity-60 hover:opacity-100' : ''}`}
                        >
                          <td className="py-2.5 px-2.5 max-w-[260px] xl:max-w-[360px]">
                            <div className="flex items-center gap-2 min-w-0">
                              <MethodBadge method={m.method} />
                              <div className="min-w-0">
                                <div
                                  className="text-[12.5px] font-medium text-slate-100 truncate"
                                  title={m.name || m.url}
                                >
                                  {m.name || m.url}
                                </div>
                                {m.name && (
                                  <div className="font-mono text-[11px] text-slate-500 truncate mt-0.5" title={m.url}>
                                    {m.url}
                                  </div>
                                )}
                                {m.last_error && (
                                  <div className="text-[11px] text-red-400 truncate mt-0.5" title={m.last_error}>
                                    {m.last_error}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <UrlStatusPill m={m} />
                          </td>
                          <td className={`py-2.5 px-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap ${latencyColor}`}>
                            {m.last_latency_ms !== null && m.last_latency_ms !== undefined ? `${m.last_latency_ms}ms` : '—'}
                          </td>
                          <td
                            className="py-2.5 px-2.5 font-mono text-[12px] text-slate-300 tabular-nums whitespace-nowrap"
                            title={`Checks every ${m.interval_seconds} seconds`}
                          >
                            {formatInterval(m.interval_seconds)}
                          </td>
                          <td className="py-2.5 px-2.5 max-w-[180px]">
                            <div className="flex items-center gap-1 flex-wrap font-mono text-[11px] text-slate-400">
                              <span className="text-slate-300 whitespace-nowrap">HTTP {m.expected_status || '2xx'}</span>
                              {m.max_latency_ms > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 text-[10px] whitespace-nowrap">
                                  ≤{m.max_latency_ms}ms
                                </span>
                              )}
                              {m.auth_type && m.auth_type !== 'none' && (
                                <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] whitespace-nowrap">
                                  {m.auth_type}
                                </span>
                              )}
                              {bodyChip && (
                                <span
                                  className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 text-[10px] max-w-[130px] truncate"
                                  title={m.expected_body_mode === 'regex' ? `Regex: /${m.expected_body}/` : `Contains: ${m.expected_body}`}
                                >
                                  {bodyChip}
                                </span>
                              )}
                            </div>
                          </td>
                          <td
                            className="py-2.5 px-2.5 text-[11.5px] text-slate-400 tabular-nums whitespace-nowrap"
                            title={m.last_checked_at ? new Date(m.last_checked_at).toLocaleString() : 'Never checked'}
                          >
                            {formatLastChecked(m.last_checked_at)}
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <ToggleSwitch
                              enabled={m.enabled}
                              onToggle={async () => {
                                await api.updateUrlMonitor(app.id, m.id, { enabled: !m.enabled });
                                onRefresh();
                              }}
                            />
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                disabled={checkingKey === `url-${m.id}`}
                                onClick={() => handleCheckUrl(m)}
                                title="Check now"
                                className="w-7 h-7 rounded-[5px] inline-flex items-center justify-center text-sky-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditUrlModal(m)}
                                title="Edit monitor"
                                className="w-7 h-7 rounded-[5px] inline-flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
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
                                className="w-7 h-7 rounded-[5px] inline-flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {pagedUrls.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-slate-500">
                          {urlMonitors.length === 0
                            ? 'No outgoing URL monitors configured.'
                            : 'No URL monitors match your current filter.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <TablePagination
                page={safePage}
                totalPages={totalPages}
                start={sortedUrls.length ? startIdx + 1 : 0}
                end={Math.min(startIdx + urlPageSize, sortedUrls.length)}
                total={sortedUrls.length}
                onPageChange={setUrlPage}
              />
            </div>
          );
        })()}

        {/* CERTIFICATE EXPIRY MONITORS — SLEEK POSTSCORE-STYLE TABLE */}
        {showCert && (() => {
          const toggleCertSort = (key) => {
            setCertSort((prev) =>
              prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
            );
            setCertPage(1);
          };

          const certCounts = {
            all: certMonitors.length,
            ok: certMonitors.filter((m) => m.enabled && m.last_status === 'ok').length,
            expiring: certMonitors.filter((m) => m.enabled && m.last_status === 'expiring').length,
            critical: certMonitors.filter((m) => m.enabled && (m.last_status === 'expired' || m.last_status === 'error')).length,
            paused: certMonitors.filter((m) => !m.enabled).length,
          };

          const q = certFilter.trim().toLowerCase();
          const filteredCerts = certMonitors.filter((m) => {
            if (certStage === 'ok' && !(m.enabled && m.last_status === 'ok')) return false;
            if (certStage === 'expiring' && !(m.enabled && m.last_status === 'expiring')) return false;
            if (certStage === 'critical' && !(m.enabled && (m.last_status === 'expired' || m.last_status === 'error'))) return false;
            if (certStage === 'paused' && m.enabled) return false;
            if (!q) return true;
            return (
              (m.url || '').toLowerCase().includes(q) ||
              (m.last_status || '').toLowerCase().includes(q) ||
              (m.last_error || '').toLowerCase().includes(q) ||
              (m.cert_expires_at || '').toLowerCase().includes(q) ||
              (m.cert_issuer || '').toLowerCase().includes(q) ||
              (m.cert_subject || '').toLowerCase().includes(q)
            );
          });

          const certStatusRank = (m) => {
            if (!m.enabled) return 4;
            if (m.last_status === 'expired' || m.last_status === 'error') return 0;
            if (m.last_status === 'expiring') return 1;
            if (m.last_status === 'unknown' || !m.last_status) return 2;
            return 3;
          };

          const sortedCerts = [...filteredCerts].sort((a, b) => {
            const dir = certSort.dir === 'asc' ? 1 : -1;
            const k = certSort.key;
            if (k === 'last_status') {
              return (certStatusRank(a) - certStatusRank(b)) * dir;
            }
            if (k === 'days_remaining' || k === 'days_before_expiry' || k === 'interval_seconds') {
              const an = a[k] === null || a[k] === undefined ? Number.POSITIVE_INFINITY : Number(a[k]);
              const bn = b[k] === null || b[k] === undefined ? Number.POSITIVE_INFINITY : Number(b[k]);
              return (an - bn) * dir;
            }
            if (k === 'cert_expires_at' || k === 'last_checked_at') {
              const at = a[k] ? new Date(a[k]).getTime() : Number.POSITIVE_INFINITY;
              const bt = b[k] ? new Date(b[k]).getTime() : Number.POSITIVE_INFINITY;
              return (at - bt) * dir;
            }
            if (k === 'enabled') {
              return (Number(b.enabled) - Number(a.enabled)) * dir;
            }
            return String(a[k] || '').localeCompare(String(b[k] || '')) * dir;
          });

          const totalPages = Math.max(1, Math.ceil(sortedCerts.length / certPageSize));
          const safePage = Math.min(certPage, totalPages);
          const startIdx = (safePage - 1) * certPageSize;
          const pagedCerts = sortedCerts.slice(startIdx, startIdx + certPageSize);

          return (
            <div className="space-y-2.5">
              {/* Stage Filter Pills */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="Certificate monitor status filter"
                  className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-slate-800 bg-slate-900"
                >
                  {[
                    ['all', 'All Certificates'],
                    ['ok', 'Healthy'],
                    ['expiring', 'Expiring'],
                    ['critical', 'Expired / Error'],
                    ['paused', 'Paused'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={certStage === key}
                      onClick={() => { setCertStage(key); setCertPage(1); }}
                      className={`h-[26px] px-2.5 rounded-[4px] inline-flex items-center gap-1.5 text-[11.5px] transition-colors ${
                        certStage === key
                          ? 'bg-slate-800 text-slate-100 font-semibold'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-medium'
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`text-[10px] font-semibold tabular-nums ${
                          key === 'critical' && certCounts.critical > 0
                            ? 'text-red-400'
                            : key === 'expiring' && certCounts.expiring > 0
                            ? 'text-amber-400'
                            : certStage === key
                            ? 'text-slate-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {certCounts[key]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sleek Single-Line Toolbar */}
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-[7px] border border-slate-800 bg-slate-900">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={certFilter}
                    onChange={(e) => { setCertFilter(e.target.value); setCertPage(1); }}
                    placeholder="Search endpoint, issuer, status, or expiry..."
                    className="w-full h-7 bg-slate-950 border border-slate-800 rounded-[5px] pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {certFilter && (
                    <button
                      type="button"
                      onClick={() => { setCertFilter(''); setCertPage(1); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
                      title="Clear search"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <select
                  aria-label="Rows per page"
                  value={certPageSize}
                  onChange={(e) => { setCertPageSize(Number(e.target.value)); setCertPage(1); }}
                  className="h-7 px-2 rounded-[5px] bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 ml-auto"
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                </select>

                <button
                  type="button"
                  onClick={() => setShowCertModal(true)}
                  className="h-7 px-2.5 rounded-[5px] bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-1 text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Cert(s)
                </button>
              </div>

              {/* High-Density Sleek Table */}
              <div className="border border-slate-800 rounded-lg bg-slate-900 overflow-x-auto">
                <table className="w-full table-fixed min-w-[780px] text-left border-collapse">
                  <colgroup>
                    <col />
                    <col className="w-[92px]" />
                    <col className="w-[64px]" />
                    <col className="w-[90px]" />
                    <col className="w-[74px]" />
                    <col className="w-[62px]" />
                    <col className="w-[80px]" />
                    <col className="w-[56px]" />
                    <col className="w-[88px]" />
                  </colgroup>
                  <thead className="bg-slate-950/55 text-[11.5px] text-slate-400 border-b border-slate-800">
                    <tr>
                      <SortHeader colKey="url" label="Endpoint" sort={certSort} onSort={toggleCertSort} />
                      <SortHeader colKey="last_status" label="Status" sort={certSort} onSort={toggleCertSort} />
                      <SortHeader colKey="days_remaining" label="Days" sort={certSort} onSort={toggleCertSort} />
                      <SortHeader colKey="cert_expires_at" label="Expires" sort={certSort} onSort={toggleCertSort} />
                      <SortHeader colKey="days_before_expiry" label="Alert" sort={certSort} onSort={toggleCertSort} />
                      <SortHeader colKey="interval_seconds" label="Interval" sort={certSort} onSort={toggleCertSort} />
                      <SortHeader colKey="last_checked_at" label="Checked" sort={certSort} onSort={toggleCertSort} />
                      <SortHeader colKey="enabled" label="Active" sort={certSort} onSort={toggleCertSort} />
                      <th className="py-0 px-2.5 h-9 font-normal text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {pagedCerts.map((m) => {
                      const daysColor =
                        m.days_remaining === null || m.days_remaining === undefined
                          ? 'text-slate-500'
                          : m.days_remaining <= 0
                          ? 'text-red-400 font-semibold'
                          : m.days_remaining <= m.days_before_expiry
                          ? 'text-amber-400 font-semibold'
                          : 'text-emerald-400 font-medium';
                      return (
                        <tr
                          key={m.id}
                          className={`hover:bg-slate-800/35 transition-colors ${!m.enabled ? 'opacity-60 hover:opacity-100' : ''}`}
                        >
                          <td className="py-2.5 px-2.5 max-w-[230px] xl:max-w-[340px]">
                            <div className="font-mono text-[12px] font-medium text-slate-100 truncate" title={m.url}>
                              {m.url}
                            </div>
                            {m.cert_issuer && !m.last_error && (
                              <div className="text-[11px] text-slate-500 truncate mt-0.5" title={m.cert_issuer}>
                                {m.cert_issuer}
                              </div>
                            )}
                            {m.last_error && (
                              <div className="text-[11px] text-amber-400 truncate mt-0.5" title={m.last_error}>
                                {m.last_error}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <CertStatusPill m={m} />
                          </td>
                          <td className={`py-2.5 px-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap ${daysColor}`}>
                            {m.days_remaining !== null && m.days_remaining !== undefined ? `${m.days_remaining}d` : '—'}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-[12px] text-slate-300 tabular-nums whitespace-nowrap">
                            {m.cert_expires_at ? m.cert_expires_at.slice(0, 10) : '—'}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-[12px] text-slate-300 tabular-nums whitespace-nowrap">
                            ≤ {m.days_before_expiry}d
                          </td>
                          <td
                            className="py-2.5 px-2.5 font-mono text-[12px] text-slate-400 tabular-nums whitespace-nowrap"
                            title={`Checks every ${m.interval_seconds} seconds`}
                          >
                            {formatInterval(m.interval_seconds)}
                          </td>
                          <td
                            className="py-2.5 px-2.5 text-[11.5px] text-slate-400 tabular-nums whitespace-nowrap"
                            title={m.last_checked_at ? new Date(m.last_checked_at).toLocaleString() : 'Never checked'}
                          >
                            {formatLastChecked(m.last_checked_at)}
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <ToggleSwitch
                              enabled={m.enabled}
                              onToggle={async () => {
                                await api.updateCertMonitor(app.id, m.id, { enabled: !m.enabled });
                                onRefresh();
                              }}
                            />
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                disabled={checkingKey === `cert-${m.id}`}
                                onClick={() => handleCheckCert(m)}
                                title="Check certificate now"
                                className="w-7 h-7 rounded-[5px] inline-flex items-center justify-center text-sky-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCert({ ...m })}
                                title="Edit threshold / interval"
                                className="w-7 h-7 rounded-[5px] inline-flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
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
                                className="w-7 h-7 rounded-[5px] inline-flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {pagedCerts.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-slate-500">
                          {certMonitors.length === 0
                            ? 'No certificate expiry monitors configured.'
                            : 'No certificate monitors match your current filter.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <TablePagination
                page={safePage}
                totalPages={totalPages}
                start={sortedCerts.length ? startIdx + 1 : 0}
                end={Math.min(startIdx + certPageSize, sortedCerts.length)}
                total={sortedCerts.length}
                onPageChange={setCertPage}
              />
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
