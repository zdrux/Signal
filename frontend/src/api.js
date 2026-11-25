async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    throw new Error(data?.detail || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  // Auth & Directory
  me: () => request('/api/auth/me'),
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  usersDirectory: () => request('/api/auth/users-directory'),

  // Apps (Admins create/delete; assigned users self-manage)
  listApps: () => request('/api/apps'),
  createApp: (body) => request('/api/apps', { method: 'POST', body: JSON.stringify(body) }),
  updateApp: (id, body) =>
    request(`/api/apps/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getAppToken: (id) => request(`/api/apps/${id}/token`),
  rotateToken: (id) => request(`/api/apps/${id}/rotate-token`, { method: 'POST' }),
  deleteApp: (id) => request(`/api/apps/${id}`, { method: 'DELETE' }),
  testTriggerApp: (id, metadata) =>
    request(`/api/apps/${id}/test-trigger`, { method: 'POST', body: JSON.stringify(metadata) }),

  // Per-App Assigned Users
  addAppUser: (appId, userId) =>
    request(`/api/apps/${appId}/users`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  removeAppUser: (appId, userId) =>
    request(`/api/apps/${appId}/users/${userId}`, { method: 'DELETE' }),

  // Per-App Phone Numbers
  addAppContact: (appId, body) =>
    request(`/api/apps/${appId}/contacts`, { method: 'POST', body: JSON.stringify(body) }),
  updateAppContact: (appId, contactId, body) =>
    request(`/api/apps/${appId}/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAppContact: (appId, contactId) =>
    request(`/api/apps/${appId}/contacts/${contactId}`, { method: 'DELETE' }),

  // Outgoing URL Monitors
  createUrlMonitor: (appId, body) =>
    request(`/api/apps/${appId}/url-monitors`, { method: 'POST', body: JSON.stringify(body) }),
  updateUrlMonitor: (appId, monitorId, body) =>
    request(`/api/apps/${appId}/url-monitors/${monitorId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  checkUrlMonitor: (appId, monitorId) =>
    request(`/api/apps/${appId}/url-monitors/${monitorId}/check`, { method: 'POST' }),
  deleteUrlMonitor: (appId, monitorId) =>
    request(`/api/apps/${appId}/url-monitors/${monitorId}`, { method: 'DELETE' }),

  // Outgoing Certificate Expiry Monitors
  createCertMonitorsBatch: (appId, body) =>
    request(`/api/apps/${appId}/cert-monitors`, { method: 'POST', body: JSON.stringify(body) }),
  updateCertMonitor: (appId, monitorId, body) =>
    request(`/api/apps/${appId}/cert-monitors/${monitorId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  checkCertMonitor: (appId, monitorId) =>
    request(`/api/apps/${appId}/cert-monitors/${monitorId}/check`, { method: 'POST' }),
  deleteCertMonitor: (appId, monitorId) =>
    request(`/api/apps/${appId}/cert-monitors/${monitorId}`, { method: 'DELETE' }),

  // Events
  listEvents: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.app_id) qs.set('app_id', params.app_id);
    if (params.severity && params.severity !== 'ALL') qs.set('severity', params.severity);
    const q = qs.toString();
    return request(q ? `/api/events?${q}` : '/api/events');
  },

  // Admin
  listUsers: () => request('/api/admin/users'),
  updateUserRole: (id, role) =>
    request(`/api/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  getSettings: () => request('/api/admin/settings'),
  saveLdapSettings: (body) =>
    request('/api/admin/settings/ldap', { method: 'PUT', body: JSON.stringify(body) }),
  saveGeneralSettings: (body) =>
    request('/api/admin/settings/general', { method: 'PUT', body: JSON.stringify(body) }),
  saveTwilioSettings: (body) =>
    request('/api/admin/settings/twilio', { method: 'PUT', body: JSON.stringify(body) }),
  getDatabaseInfo: () => request('/api/admin/database'),
  saveRetentionSettings: (body) =>
    request('/api/admin/settings/retention', { method: 'PUT', body: JSON.stringify(body) }),
  pruneDatabase: () => request('/api/admin/database/prune', { method: 'POST' }),
  listAudit: () => request('/api/admin/audit'),
  getDlpRules: () => request('/api/admin/dlp/rules'),
  testDlpText: (text) =>
    request('/api/admin/dlp/test', { method: 'POST', body: JSON.stringify({ text }) }),
};
