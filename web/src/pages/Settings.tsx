import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface RemoteServer {
  id: string;
  name: string;
  url: string;
  location: string;
  provider: string;
}

export default function Settings() {
  const { isAuthenticated, token, logout } = useAuth();
  const navigate = useNavigate();
  
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [loading, setLoading] = useState(true);
  
  // New server form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', url: '', location: '', provider: '' });
  const [addLoading, setAddLoading] = useState(false);
  
  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  
  // Install command
  const [showInstallCommand, setShowInstallCommand] = useState(false);
  const [installCommand, setInstallCommand] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    fetchServers();
    generateInstallCommand();
  }, [isAuthenticated, navigate]);
  
  const generateInstallCommand = async () => {
    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;
    
    const command = `curl -fsSL ${baseUrl}/agent.sh | sudo bash -s -- \\
  --server ${baseUrl} \\
  --token "${token}" \\
  --name "$(hostname)" \\
  --location "US" \\
  --provider "Unknown"`;
    
    setInstallCommand(command);
  };
  
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  const fetchServers = async () => {
    try {
      const res = await fetch('/api/servers');
      if (res.ok) {
        const data = await res.json();
        setServers(data);
      }
    } catch (e) {
      console.error('Failed to fetch servers', e);
    }
    setLoading(false);
  };

  const addServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddLoading(true);
    
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newServer)
      });
      
      if (res.ok) {
        const server = await res.json();
        setServers([...servers, server]);
        setNewServer({ name: '', url: '', location: '', provider: '' });
        setShowAddForm(false);
      }
    } catch (e) {
      console.error('Failed to add server', e);
    }
    
    setAddLoading(false);
  };

  const deleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this server?')) return;
    
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        setServers(servers.filter(s => s.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete server', e);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);
    
    if (passwords.new !== passwords.confirm) {
      setPasswordError('Passwords do not match');
      return;
    }
    
    if (passwords.new.length < 4) {
      setPasswordError('Password must be at least 4 characters');
      return;
    }
    
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          current_password: passwords.current,
          new_password: passwords.new
        })
      });
      
      if (res.ok) {
        setPasswordSuccess(true);
        setPasswords({ current: '', new: '', confirm: '' });
        setShowPasswordForm(false);
      } else {
        setPasswordError('Current password is incorrect');
      }
    } catch (e) {
      setPasswordError('Failed to change password');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-gray-500 text-sm">Manage servers and configuration</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-colors"
        >
          Logout
        </button>
      </div>

      {/* Quick Install Section */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
            Quick Install Agent
          </h2>
          <button
            onClick={() => setShowInstallCommand(!showInstallCommand)}
            className="px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {showInstallCommand ? 'Hide' : 'Show'} Install Command
          </button>
        </div>
        
        <p className="text-gray-400 text-sm mb-4">
          Run this command on any server to automatically install the monitoring agent and register it with this dashboard.
        </p>
        
        {showInstallCommand && (
          <div className="relative">
            <pre className="p-4 rounded-xl bg-black/40 border border-white/10 text-sm text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {installCommand}
            </pre>
            <button
              onClick={copyToClipboard}
              className={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                copied 
                  ? 'bg-emerald-500/20 text-emerald-400' 
                  : 'bg-white/10 hover:bg-white/20 text-gray-400 hover:text-white'
              }`}
            >
              {copied ? (
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </span>
              )}
            </button>
          </div>
        )}
        
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-amber-400 text-xs flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              <strong>Tip:</strong> Modify <code className="px-1 py-0.5 rounded bg-amber-500/20">--location</code> and <code className="px-1 py-0.5 rounded bg-amber-500/20">--provider</code> to match your server's details (e.g., --location "HK" --provider "Vultr")
            </span>
          </p>
        </div>
      </div>

      {/* Server Management Section */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Remote Servers
          </h2>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Manually
          </button>
        </div>

        {/* Add Server Form */}
        {showAddForm && (
          <form onSubmit={addServer} className="mb-6 p-4 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Server Name</label>
                <input
                  type="text"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g., US-West-1"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">WebSocket URL</label>
                <input
                  type="text"
                  value={newServer.url}
                  onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="ws://your-server:3001/ws"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Location Code</label>
                <input
                  type="text"
                  value={newServer.location}
                  onChange={(e) => setNewServer({ ...newServer, location: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g., US, HK, JP"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Provider</label>
                <input
                  type="text"
                  value={newServer.provider}
                  onChange={(e) => setNewServer({ ...newServer, provider: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g., AWS, Vultr, Aliyun"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addLoading}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {addLoading ? 'Adding...' : 'Add Server'}
              </button>
            </div>
          </form>
        )}

        {/* Server List */}
        {servers.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No remote servers configured</p>
            <p className="text-sm mt-1">Add a server to monitor it from this dashboard</p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
              <div key={server.id} className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-sm font-bold text-blue-400">
                    {server.location}
                  </div>
                  <div>
                    <div className="font-medium text-white">{server.name}</div>
                    <div className="text-xs text-gray-500 font-mono">{server.url}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {server.provider && (
                    <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 text-xs">
                      {server.provider}
                    </span>
                  )}
                  <button
                    onClick={() => deleteServer(server.id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Security Section */}
      <div className="nezha-card p-6">
        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
          Security
        </h2>

        {passwordSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            Password changed successfully!
          </div>
        )}

        {showPasswordForm ? (
          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Current Password</label>
              <input
                type="password"
                value={passwords.current}
                onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">New Password</label>
              <input
                type="password"
                value={passwords.new}
                onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={passwords.confirm}
                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
                required
              />
            </div>
            {passwordError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {passwordError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswords({ current: '', new: '', confirm: '' });
                  setPasswordError('');
                }}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium transition-colors"
              >
                Change Password
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowPasswordForm(true)}
            className="px-4 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-sm font-medium transition-colors"
          >
            Change Password
          </button>
        )}
      </div>
    </div>
  );
}

