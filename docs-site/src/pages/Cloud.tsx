import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Cloud, Shield, Zap, Globe, Server, LogOut, Plus, Trash2, Copy, Check, RefreshCw, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as api from '../api/cloud';

// GitHub Icon SVG
const GitHubIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

// Google Icon SVG
const GoogleIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

interface CloudUser {
  id: string;
  username: string;
  email?: string;
  avatar_url?: string;
  plan: string;
  serverCount: number;
  serverLimit: number;
}

export default function CloudPage() {
  const { t } = useTranslation();
  const [user, setUser] = useState<CloudUser | null>(null);
  const [servers, setServers] = useState<api.Server[]>([]);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // UI State
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [addingServer, setAddingServer] = useState(false);
  const [selectedServer, setSelectedServer] = useState<api.Server | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Load user and servers
  const loadUserData = useCallback(async () => {
    try {
      const token = api.getToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      // Verify token and get user
      const userData = await api.getCurrentUser();
      setUser({
        id: userData.user.id,
        username: userData.user.username,
        email: userData.user.email,
        avatar_url: userData.user.avatar_url,
        plan: userData.user.plan,
        serverCount: userData.server_count,
        serverLimit: userData.server_limit,
      });

      // Load servers
      const serverList = await api.listServers();
      setServers(serverList);
    } catch (err) {
      console.error('Failed to load user data:', err);
      api.setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const errorMsg = params.get('error');

    if (errorMsg) {
      setError(decodeURIComponent(errorMsg));
      window.history.replaceState({}, '', '/cloud');
      setIsLoading(false);
      return;
    }

    if (token) {
      api.setToken(token);
      window.history.replaceState({}, '', '/cloud');
    }

    loadUserData();
  }, [loadUserData]);

  // OAuth login
  const handleOAuthLogin = async (provider: 'github' | 'google') => {
    setOauthLoading(provider);
    setError(null);
    
    try {
      const { url } = await api.startOAuth(provider);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setOauthLoading(null);
    }
  };

  // Logout
  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      // Ignore logout errors
    }
    setUser(null);
    setServers([]);
  };

  // Add server
  const handleAddServer = async () => {
    if (!newServerName.trim()) return;
    
    setAddingServer(true);
    try {
      const server = await api.createServer(newServerName.trim());
      setServers([server, ...servers]);
      setNewServerName('');
      setShowAddServer(false);
      setSelectedServer(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
    } finally {
      setAddingServer(false);
    }
  };

  // Delete server
  const handleDeleteServer = async (id: string) => {
    if (!confirm(t('cloud.confirmDelete'))) return;
    
    try {
      await api.deleteServer(id);
      setServers(servers.filter(s => s.id !== id));
      if (selectedServer?.id === id) {
        setSelectedServer(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    }
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="pt-20 min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Logged in - Dashboard
  if (user) {
    return (
      <div className="pt-20 min-h-screen bg-slate-50 dark:bg-slate-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Error Alert */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex justify-between items-center"
            >
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
            </motion.div>
          )}

          {/* User Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-2xl p-6 mb-6"
          >
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-violet-500/30">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.username} className="w-full h-full rounded-xl object-cover" />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <h1 className="text-xl font-bold dark:text-white">{user.username}</h1>
                  <p className="text-sm text-slate-500">
                    {t('cloud.serversUsed', { count: user.serverCount, limit: user.serverLimit })}
                    <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                      {user.plan}
                    </span>
                  </p>
                </div>
              </div>
              <button onClick={handleLogout} className="btn btn-outline flex items-center gap-2">
                <LogOut className="w-4 h-4" />
                {t('cloud.logout')}
              </button>
            </div>
          </motion.div>

          {/* Servers Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Server List */}
            <div className="lg:col-span-1">
              <div className="glass-card rounded-2xl p-4">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-bold dark:text-white">{t('cloud.servers')}</h2>
                  <button
                    onClick={() => setShowAddServer(true)}
                    disabled={user.serverCount >= user.serverLimit}
                    className="p-2 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:bg-slate-400 text-white transition-colors"
                    title={user.serverCount >= user.serverLimit ? t('cloud.limitReached') : t('cloud.addServer')}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Add Server Form */}
                {showAddServer && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-4 p-3 rounded-lg bg-slate-100 dark:bg-slate-800"
                  >
                    <input
                      type="text"
                      value={newServerName}
                      onChange={(e) => setNewServerName(e.target.value)}
                      placeholder={t('cloud.serverName')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white mb-2"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddServer()}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddServer}
                        disabled={addingServer || !newServerName.trim()}
                        className="flex-1 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:bg-slate-400 text-white text-sm transition-colors"
                      >
                        {addingServer ? '...' : t('cloud.add')}
                      </button>
                      <button
                        onClick={() => { setShowAddServer(false); setNewServerName(''); }}
                        className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm"
                      >
                        {t('cloud.cancel')}
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Server List */}
                <div className="space-y-2">
                  {servers.length === 0 ? (
                    <p className="text-center py-8 text-slate-400">{t('cloud.noServers')}</p>
                  ) : (
                    servers.map((server) => (
                      <div
                        key={server.id}
                        onClick={() => setSelectedServer(server)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedServer?.id === server.id
                            ? 'bg-violet-100 dark:bg-violet-900/30 border border-violet-300 dark:border-violet-700'
                            : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${
                              server.status === 'online' ? 'bg-green-500' :
                              server.status === 'warning' ? 'bg-yellow-500' :
                              server.status === 'error' ? 'bg-red-500' : 'bg-slate-400'
                            }`} />
                            <div>
                              <div className="font-medium dark:text-white text-sm">{server.name}</div>
                              <div className="text-xs text-slate-500">{server.hostname || server.id.slice(0, 8)}</div>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteServer(server.id); }}
                            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Server Details */}
            <div className="lg:col-span-2">
              {selectedServer ? (
                <motion.div
                  key={selectedServer.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card rounded-2xl p-6"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-xl font-bold dark:text-white">{selectedServer.name}</h2>
                      <p className="text-sm text-slate-500">
                        {selectedServer.hostname || 'Not connected'} • {selectedServer.os_type || 'Unknown OS'}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      selectedServer.status === 'online' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      selectedServer.status === 'warning' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      selectedServer.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {selectedServer.status}
                    </span>
                  </div>

                  {/* Metrics (if online) */}
                  {selectedServer.status === 'online' && selectedServer.metrics && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                      <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800">
                        <div className="text-xs text-slate-500 mb-1">CPU</div>
                        <div className="text-lg font-bold dark:text-white">
                          {selectedServer.metrics.cpu_usage?.toFixed(1) || '0'}%
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800">
                        <div className="text-xs text-slate-500 mb-1">Memory</div>
                        <div className="text-lg font-bold dark:text-white">
                          {selectedServer.metrics.memory_total 
                            ? ((selectedServer.metrics.memory_used || 0) / selectedServer.metrics.memory_total * 100).toFixed(1)
                            : '0'}%
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800">
                        <div className="text-xs text-slate-500 mb-1">Disk</div>
                        <div className="text-lg font-bold dark:text-white">
                          {selectedServer.metrics.disk_total
                            ? ((selectedServer.metrics.disk_used || 0) / selectedServer.metrics.disk_total * 100).toFixed(1)
                            : '0'}%
                        </div>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800">
                        <div className="text-xs text-slate-500 mb-1">Network</div>
                        <div className="text-lg font-bold dark:text-white">
                          {((selectedServer.metrics.network_rx_bytes || 0) / 1024 / 1024).toFixed(1)} MB
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Install Command */}
                  <div className="p-4 rounded-xl bg-slate-900 dark:bg-slate-950">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-slate-400 text-sm">
                        <Terminal className="w-4 h-4" />
                        {t('cloud.installAgent')}
                      </div>
                      <button
                        onClick={() => copyToClipboard(
                          `curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- --cloud --key "${selectedServer.agent_key}"`,
                          'install'
                        )}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                      >
                        {copiedKey === 'install' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <code className="block text-sm text-green-400 font-mono overflow-x-auto whitespace-nowrap">
                      curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- --cloud --key "{selectedServer.agent_key}"
                    </code>
                  </div>

                  {/* Agent Key */}
                  <div className="mt-4 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">Agent Key</div>
                      <code className="text-sm font-mono dark:text-white">{selectedServer.agent_key.slice(0, 16)}...</code>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(selectedServer.agent_key, 'key')}
                        className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors"
                        title={t('cloud.copyKey')}
                      >
                        {copiedKey === 'key' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={async () => {
                          const { agent_key } = await api.regenerateAgentKey(selectedServer.id);
                          setSelectedServer({ ...selectedServer, agent_key });
                          setServers(servers.map(s => s.id === selectedServer.id ? { ...s, agent_key } : s));
                        }}
                        className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors"
                        title={t('cloud.regenerateKey')}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="glass-card rounded-2xl p-12 text-center">
                  <Server className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-500">{t('cloud.selectServer')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not logged in - Login Page
  return (
    <div className="pt-20 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 max-w-md mx-auto"
            >
              {error}
            </motion.div>
          )}
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-violet-100 dark:bg-violet-900/30 text-violet-500 mb-8"
          >
            <Cloud className="w-10 h-10" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl font-bold mb-6 dark:text-white"
          >
            {t('cloud.title')}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl text-slate-500 max-w-2xl mx-auto mb-8"
          >
            {t('cloud.subtitle')}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-8 flex flex-col gap-4 justify-center items-center"
          >
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <button
                onClick={() => handleOAuthLogin('github')}
                disabled={oauthLoading !== null}
                className="group w-full sm:w-auto py-3 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 border border-slate-800 hover:border-slate-700 disabled:border-slate-700 font-medium transition-all duration-200 flex items-center justify-center gap-3 shadow-lg shadow-slate-900/30 hover:-translate-y-0.5 disabled:cursor-not-allowed text-white"
              >
                {oauthLoading === 'github' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    <span>{t('cloud.loggingIn')}</span>
                  </>
                ) : (
                  <>
                    <GitHubIcon className="w-5 h-5" />
                    <span>{t('cloud.loginWithGitHub')}</span>
                  </>
                )}
              </button>
              <button
                onClick={() => handleOAuthLogin('google')}
                disabled={oauthLoading !== null}
                className="group w-full sm:w-auto py-3 px-6 rounded-xl bg-white hover:bg-slate-50 disabled:bg-slate-100 border border-slate-200 hover:border-slate-300 disabled:border-slate-200 text-slate-700 font-medium transition-all duration-200 flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/10 hover:-translate-y-0.5 disabled:cursor-not-allowed"
              >
                {oauthLoading === 'google' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                    <span>{t('cloud.loggingIn')}</span>
                  </>
                ) : (
                  <>
                    <GoogleIcon className="w-5 h-5" />
                    <span>{t('cloud.loginWithGoogle')}</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-20">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="space-y-8"
          >
            {[
              { icon: Shield, titleKey: 'enterpriseSecurity', descKey: 'enterpriseSecurity' },
              { icon: Globe, titleKey: 'globalEdge', descKey: 'globalEdge' },
              { icon: Zap, titleKey: 'dataRetention', descKey: 'dataRetention' },
            ].map((feature) => (
              <div key={feature.titleKey} className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-500 shrink-0">
                  <feature.icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{t(`cloud.features.${feature.titleKey}.title`)}</h3>
                  <p className="text-slate-500">{t(`cloud.features.${feature.descKey}.desc`)}</p>
                </div>
              </div>
            ))}
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
            className="glass-card p-8 rounded-2xl border-t-4 border-violet-500"
          >
            <h3 className="text-2xl font-bold mb-6 dark:text-white">{t('cloud.pricing.title')}</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div>
                  <div className="font-bold dark:text-white">{t('cloud.pricing.free.name')}</div>
                  <div className="text-sm text-slate-500">{t('cloud.pricing.free.desc')}</div>
                </div>
                <div className="font-bold text-xl dark:text-white">{t('cloud.pricing.free.price')}</div>
              </div>
              <div className="p-4 rounded-xl bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 flex justify-between items-center">
                <div>
                  <div className="font-bold text-violet-700 dark:text-violet-300">{t('cloud.pricing.pro.name')}</div>
                  <div className="text-sm text-violet-600 dark:text-violet-400">{t('cloud.pricing.pro.desc')}</div>
                </div>
                <div className="font-bold text-xl text-violet-700 dark:text-violet-300">{t('cloud.pricing.pro.price')}<span className="text-sm font-normal">{t('cloud.pricing.pro.perServer')}</span></div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
