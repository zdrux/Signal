import React, { useState } from 'react';
import { Radio, Lock, AlertCircle } from 'lucide-react';
import { api } from '../api';

export default function LoginView({ ldapDomain, onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(username, password);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Signal</h1>
            <p className="text-xs text-slate-400">Corporate SMS Notification Gateway</p>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-5">
          Sign in with your Active Directory username and password.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/60 border border-red-800/70 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">AD Username</label>
            <div className="flex items-stretch rounded-lg border border-slate-800 bg-slate-950 focus-within:border-indigo-500 overflow-hidden">
              {ldapDomain && (
                <span className="px-3 py-2 bg-slate-900 border-r border-slate-800 text-sm font-mono text-slate-400 select-none flex items-center">
                  {ldapDomain}\
                </span>
              )}
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="jdoe"
                className="flex-1 bg-transparent px-3 py-2 text-sm text-white focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition"
          >
            <Lock className="w-4 h-4" />
            {loading ? 'Authenticating via LDAPS...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
