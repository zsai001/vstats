import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, Users, Activity, Settings, Shield, Send, 
  ChevronDown, ChevronUp, ChevronLeft, MapPin, TrendingUp, 
  BarChart3, RefreshCw, Globe, Calendar, ArrowUpRight, Sparkles,
  Search, UserCog, Trash2, Crown, X, Server, UserCheck, UserX, ArrowLeft
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import * as api from '../api/cloud';
import type { AuthOverallStats, AuthDailyStats, AuthSiteStats, AuthReport, AdminUser, UserStats } from '../api/cloud';

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

type AdminTab = 'dashboard' | 'users' | 'auth-stats' | 'broadcast' | 'settings';

export default function AdminPage() {
  useTranslation();
  const navigate = useNavigate();
  const { user, isUserAdmin, isLoading: authLoading } = useAuth();
  
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Dashboard stats
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [authStats, setAuthStats] = useState<AuthOverallStats | null>(null);
  const [dailyStats, setDailyStats] = useState<AuthDailyStats[]>([]);
  const [siteStats, setSiteStats] = useState<AuthSiteStats[]>([]);
  
  // Auth stats detail view
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [siteReports, setSiteReports] = useState<AuthReport[]>([]);
  const [showDailyDetails, setShowDailyDetails] = useState(true);
  const [showSiteDetails, setShowSiteDetails] = useState(true);
  
  // Broadcast email
  const [emailSubject, setEmailSubject] = useState('');
  const [emailContent, setEmailContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);

  // User management
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<AdminUser | null>(null);

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && (!user || !isUserAdmin)) {
      navigate('/cloud');
    }
  }, [user, isUserAdmin, authLoading, navigate]);

  // Fetch dashboard data
  useEffect(() => {
    if (user && isUserAdmin && activeTab === 'dashboard') {
      fetchDashboardData();
    }
  }, [user, isUserAdmin, activeTab]);

  // Fetch auth stats
  useEffect(() => {
    if (user && isUserAdmin && activeTab === 'auth-stats') {
      fetchAuthStats();
    }
  }, [user, isUserAdmin, activeTab]);

  // Fetch users
  useEffect(() => {
    if (user && isUserAdmin && activeTab === 'users') {
      fetchUsers();
      fetchUserStats();
    }
  }, [user, isUserAdmin, activeTab, userPage]);

  // Debounced search for users
  useEffect(() => {
    if (activeTab === 'users') {
      const timer = setTimeout(() => {
        setUserPage(1);
        fetchUsers();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [userSearch]);

  const fetchDashboardData = async () => {
    setDashboardLoading(true);
    try {
      const [overall, daily, sites] = await Promise.all([
        api.getAuthOverallStats(),
        api.getAuthDailyStats(7),
        api.getAuthSiteStats(10),
      ]);
      setAuthStats(overall);
      setDailyStats(daily.stats || []);
      setSiteStats(sites.sites || []);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setDashboardLoading(false);
    }
  };

  const fetchAuthStats = async () => {
    setDashboardLoading(true);
    try {
      const [overall, daily, sites] = await Promise.all([
        api.getAuthOverallStats(),
        api.getAuthDailyStats(30),
        api.getAuthSiteStats(100),
      ]);
      setAuthStats(overall);
      setDailyStats(daily.stats || []);
      setSiteStats(sites.sites || []);
    } catch (err) {
      console.error('Failed to fetch auth stats:', err);
    } finally {
      setDashboardLoading(false);
    }
  };

  const fetchSiteReports = async (siteHost: string) => {
    try {
      const { reports } = await api.getAuthUsersBySite(siteHost, 50);
      setSiteReports(reports || []);
    } catch (err) {
      console.error('Failed to fetch site reports:', err);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const response = await api.listUsers(userPage, 20, userSearch);
      setUsers(response.users || []);
      setUserTotal(response.total);
      setUserTotalPages(response.total_pages);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchUserStats = async () => {
    try {
      const stats = await api.getUserStats();
      setUserStats(stats);
    } catch (err) {
      console.error('Failed to fetch user stats:', err);
    }
  };

  const handleUpdateUser = async (userId: string, data: { plan?: string; status?: string }) => {
    try {
      await api.updateUser(userId, data);
      fetchUsers();
      fetchUserStats();
      setEditingUser(null);
    } catch (err) {
      console.error('Failed to update user:', err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await api.deleteUser(userId);
      fetchUsers();
      fetchUserStats();
      setDeleteConfirmUser(null);
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailSubject.trim() || !emailContent.trim()) return;

    setIsSending(true);
    setSendResult(null);

    try {
      const response = await fetch('/api/admin/broadcast-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: emailSubject,
          content: emailContent,
          senderEmail: user?.email,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSendResult({ success: true, message: `Email sent to ${data.count} users` });
        setEmailSubject('');
        setEmailContent('');
      } else {
        const errorData = await response.json();
        setSendResult({ success: false, message: errorData.message || 'Failed to send email' });
      }
    } catch {
      setSendResult({ success: false, message: 'Failed to send email' });
    } finally {
      setIsSending(false);
    }
  };

  // Sidebar menu items
  const menuItems = [
    { id: 'dashboard' as AdminTab, icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'auth-stats' as AdminTab, icon: Activity, label: 'OAuth Stats' },
    { id: 'users' as AdminTab, icon: Users, label: 'Users' },
    { id: 'broadcast' as AdminTab, icon: Send, label: 'Broadcast' },
    { id: 'settings' as AdminTab, icon: Settings, label: 'Settings' },
  ];

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="w-10 h-10 border-3 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || !isUserAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <div className="flex">
        {/* Sidebar */}
        <aside className={`fixed left-0 top-0 h-screen bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 transition-all duration-300 z-40 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
          <div className="flex flex-col h-full">
            {/* Sidebar Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                {!sidebarCollapsed && (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">Admin</span>
                  </div>
                )}
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors"
                >
                  <ChevronLeft className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* Back Button */}
            <div className="p-2">
              <button
                onClick={() => navigate('/')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors`}
              >
                <ArrowLeft className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span className="font-medium">返回首页</span>}
              </button>
            </div>

            {/* Menu */}
            <nav className="flex-1 p-2 space-y-1">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                    activeTab === item.id
                      ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {!sidebarCollapsed && <span className="font-medium">{item.label}</span>}
                </button>
              ))}
            </nav>

            {/* User Info */}
            {!sidebarCollapsed && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-medium">
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{user.username}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      Administrator
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
          <div className="p-6">
            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
                    <p className="text-slate-500 dark:text-slate-400">Overview of your vStats Cloud platform</p>
                  </div>
                  <button
                    onClick={fetchDashboardData}
                    disabled={dashboardLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${dashboardLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Stats Cards */}
                {authStats && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                          <MapPin className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full font-medium">
                          +{authStats.today_sites} today
                        </span>
                      </div>
                      <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{authStats.total_sites}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">Total Sites</div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                          <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full font-medium">
                          +{authStats.today_users} today
                        </span>
                      </div>
                      <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{authStats.total_users}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">Total Users</div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                          <TrendingUp className="w-6 h-6 text-violet-600 dark:text-violet-400" />
                        </div>
                        <span className="text-xs px-2 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded-full font-medium">
                          +{authStats.today_auths} today
                        </span>
                      </div>
                      <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{authStats.total_auths}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">Total Authentications</div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                          <Shield className="w-6 h-6 text-slate-600 dark:text-slate-400" />
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <GitHubIcon className="w-5 h-5" />
                          <span className="text-xl font-bold text-slate-900 dark:text-white">{authStats.github_users}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <GoogleIcon className="w-5 h-5" />
                          <span className="text-xl font-bold text-slate-900 dark:text-white">{authStats.google_users}</span>
                        </div>
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400 mt-2">OAuth Providers</div>
                    </div>
                  </div>
                )}

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Recent Activity */}
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                      <h3 className="font-semibold text-slate-900 dark:text-white">Recent Daily Stats</h3>
                    </div>
                    <div className="p-4">
                      {dailyStats.slice(0, 7).map((day, idx) => (
                        <div key={day.date} className={`flex items-center justify-between py-3 ${idx !== 0 ? 'border-t border-slate-100 dark:border-slate-700/50' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                              <Calendar className="w-4 h-4 text-slate-500" />
                            </div>
                            <span className="font-medium text-slate-700 dark:text-slate-300">{day.date}</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-emerald-600 dark:text-emerald-400">{day.unique_sites} sites</span>
                            <span className="text-blue-600 dark:text-blue-400">{day.unique_users} users</span>
                            <span className="text-violet-600 dark:text-violet-400">{day.total_auths} auths</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top Sites */}
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                      <h3 className="font-semibold text-slate-900 dark:text-white">Top Sites</h3>
                    </div>
                    <div className="p-4">
                      {siteStats.slice(0, 7).map((site, idx) => (
                        <div key={site.site_host} className={`flex items-center justify-between py-3 ${idx !== 0 ? 'border-t border-slate-100 dark:border-slate-700/50' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30 flex items-center justify-center">
                              <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <a
                              href={site.site_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-slate-700 dark:text-slate-300 hover:text-violet-600 dark:hover:text-violet-400 transition-colors flex items-center gap-1"
                            >
                              {site.site_host}
                              <ArrowUpRight className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-blue-600 dark:text-blue-400">{site.unique_users} users</span>
                            <span className="text-slate-500">{site.active_days}d active</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Auth Stats Tab */}
            {activeTab === 'auth-stats' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">OAuth Statistics</h1>
                    <p className="text-slate-500 dark:text-slate-400">Detailed analytics of OAuth authorizations</p>
                  </div>
                  <button
                    onClick={fetchAuthStats}
                    disabled={dashboardLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${dashboardLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Stats Overview */}
                {authStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 text-white shadow-lg shadow-emerald-500/20">
                      <div className="flex items-center gap-2 mb-2 opacity-80">
                        <MapPin className="w-4 h-4" />
                        <span className="text-sm font-medium">Total Sites</span>
                      </div>
                      <div className="text-4xl font-bold">{authStats.total_sites}</div>
                      <div className="text-sm opacity-70 mt-1">+{authStats.today_sites} today</div>
                    </div>
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-5 text-white shadow-lg shadow-blue-500/20">
                      <div className="flex items-center gap-2 mb-2 opacity-80">
                        <Users className="w-4 h-4" />
                        <span className="text-sm font-medium">Total Users</span>
                      </div>
                      <div className="text-4xl font-bold">{authStats.total_users}</div>
                      <div className="text-sm opacity-70 mt-1">+{authStats.today_users} today</div>
                    </div>
                    <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg shadow-violet-500/20">
                      <div className="flex items-center gap-2 mb-2 opacity-80">
                        <TrendingUp className="w-4 h-4" />
                        <span className="text-sm font-medium">Total Auths</span>
                      </div>
                      <div className="text-4xl font-bold">{authStats.total_auths}</div>
                      <div className="text-sm opacity-70 mt-1">+{authStats.today_auths} today</div>
                    </div>
                    <div className="bg-gradient-to-br from-slate-600 to-slate-700 rounded-2xl p-5 text-white shadow-lg shadow-slate-500/20">
                      <div className="flex items-center gap-2 mb-2 opacity-80">
                        <Shield className="w-4 h-4" />
                        <span className="text-sm font-medium">Providers</span>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5">
                          <GitHubIcon className="w-5 h-5" />
                          <span className="text-2xl font-bold">{authStats.github_users}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <GoogleIcon className="w-5 h-5" />
                          <span className="text-2xl font-bold">{authStats.google_users}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Daily Stats Table */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                  <button
                    onClick={() => setShowDailyDetails(!showDailyDetails)}
                    className="w-full flex items-center justify-between p-5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <BarChart3 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                      <span className="font-semibold text-slate-900 dark:text-white">Daily Statistics</span>
                      <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-full">
                        {dailyStats.length} days
                      </span>
                    </div>
                    {showDailyDetails ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                  </button>
                  
                  <AnimatePresence>
                    {showDailyDetails && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-slate-200 dark:border-slate-700 overflow-hidden"
                      >
                        <div className="max-h-96 overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                              <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                <th className="px-5 py-3">Date</th>
                                <th className="px-5 py-3 text-center">Sites</th>
                                <th className="px-5 py-3 text-center">Users</th>
                                <th className="px-5 py-3 text-center">Auths</th>
                                <th className="px-5 py-3 text-center">GitHub</th>
                                <th className="px-5 py-3 text-center">Google</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                              {dailyStats.map((day) => (
                                <tr key={day.date} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                  <td className="px-5 py-4 font-medium text-slate-900 dark:text-white">{day.date}</td>
                                  <td className="px-5 py-4 text-center">
                                    <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg text-sm font-medium">
                                      {day.unique_sites}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-center">
                                    <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium">
                                      {day.unique_users}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-center">
                                    <span className="px-2 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 rounded-lg text-sm font-medium">
                                      {day.total_auths}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-center text-slate-600 dark:text-slate-400">{day.github_users}</td>
                                  <td className="px-5 py-4 text-center text-slate-600 dark:text-slate-400">{day.google_users}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Site Stats Table */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                  <button
                    onClick={() => setShowSiteDetails(!showSiteDetails)}
                    className="w-full flex items-center justify-between p-5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-slate-900 dark:text-white">Site Statistics</span>
                      <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-full">
                        {siteStats.length} sites
                      </span>
                    </div>
                    {showSiteDetails ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                  </button>
                  
                  <AnimatePresence>
                    {showSiteDetails && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-slate-200 dark:border-slate-700 overflow-hidden"
                      >
                        <div className="max-h-96 overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                              <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                <th className="px-5 py-3">Site</th>
                                <th className="px-5 py-3 text-center">Users</th>
                                <th className="px-5 py-3 text-center">Auths</th>
                                <th className="px-5 py-3 text-center">Active Days</th>
                                <th className="px-5 py-3">First Seen</th>
                                <th className="px-5 py-3">Last Seen</th>
                                <th className="px-5 py-3 text-center">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                              {siteStats.map((site) => (
                                <tr key={site.site_host} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                  <td className="px-5 py-4">
                                    <a
                                      href={site.site_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-slate-900 dark:text-white hover:text-violet-600 dark:hover:text-violet-400 transition-colors flex items-center gap-1"
                                    >
                                      {site.site_host}
                                      <ArrowUpRight className="w-3 h-3" />
                                    </a>
                                  </td>
                                  <td className="px-5 py-4 text-center">
                                    <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium">
                                      {site.unique_users}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-center">
                                    <span className="px-2 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 rounded-lg text-sm font-medium">
                                      {site.total_auths}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-center text-slate-600 dark:text-slate-400">{site.active_days}</td>
                                  <td className="px-5 py-4 text-xs text-slate-500">{new Date(site.first_seen).toLocaleDateString()}</td>
                                  <td className="px-5 py-4 text-xs text-slate-500">{new Date(site.last_seen).toLocaleString()}</td>
                                  <td className="px-5 py-4 text-center">
                                    <button
                                      onClick={() => {
                                        setSelectedSite(site.site_host);
                                        fetchSiteReports(site.site_host);
                                      }}
                                      className="text-xs px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
                                    >
                                      View Users
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Site Users Modal */}
                <AnimatePresence>
                  {selectedSite && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                      onClick={() => setSelectedSite(null)}
                    >
                      <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">Users for {selectedSite}</h3>
                            <p className="text-sm text-slate-500">{siteReports.length} recent authorizations</p>
                          </div>
                          <button
                            onClick={() => setSelectedSite(null)}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <ChevronDown className="w-5 h-5 text-slate-400" />
                          </button>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                              <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                <th className="px-5 py-3">Username</th>
                                <th className="px-5 py-3">Provider</th>
                                <th className="px-5 py-3">Time</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                              {siteReports.map((report) => (
                                <tr key={report.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{report.username}</td>
                                  <td className="px-5 py-3">
                                    <div className="flex items-center gap-2">
                                      {report.provider === 'github' ? <GitHubIcon className="w-4 h-4" /> : <GoogleIcon className="w-4 h-4" />}
                                      <span className="text-slate-600 dark:text-slate-400 capitalize">{report.provider}</span>
                                    </div>
                                  </td>
                                  <td className="px-5 py-3 text-sm text-slate-500">{new Date(report.reported_at).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h1>
                    <p className="text-slate-500 dark:text-slate-400">Manage platform users and permissions</p>
                  </div>
                  <button
                    onClick={() => { fetchUsers(); fetchUserStats(); }}
                    disabled={usersLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${usersLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* User Stats Cards */}
                {userStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-4 h-4 text-blue-500" />
                        <span className="text-xs text-slate-500">Total Users</span>
                      </div>
                      <div className="text-2xl font-bold text-slate-900 dark:text-white">{userStats.total_users}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <UserCheck className="w-4 h-4 text-emerald-500" />
                        <span className="text-xs text-slate-500">Active</span>
                      </div>
                      <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{userStats.active_users}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <UserX className="w-4 h-4 text-red-500" />
                        <span className="text-xs text-slate-500">Suspended</span>
                      </div>
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">{userStats.suspended_users}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <Crown className="w-4 h-4 text-violet-500" />
                        <span className="text-xs text-slate-500">Pro Users</span>
                      </div>
                      <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">{userStats.pro_users}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <Server className="w-4 h-4 text-slate-500" />
                        <span className="text-xs text-slate-500">Servers</span>
                      </div>
                      <div className="text-2xl font-bold text-slate-900 dark:text-white">{userStats.total_servers}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        <span className="text-xs text-slate-500">New Today</span>
                      </div>
                      <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{userStats.new_today}</div>
                    </div>
                  </div>
                )}

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search users by username or email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all text-slate-900 dark:text-white"
                  />
                </div>

                {/* Users Table */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 dark:bg-slate-900/50">
                        <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                          <th className="px-5 py-3">User</th>
                          <th className="px-5 py-3">Provider</th>
                          <th className="px-5 py-3 text-center">Plan</th>
                          <th className="px-5 py-3 text-center">Servers</th>
                          <th className="px-5 py-3 text-center">Status</th>
                          <th className="px-5 py-3">Last Login</th>
                          <th className="px-5 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                        {usersLoading ? (
                          <tr>
                            <td colSpan={7} className="px-5 py-12 text-center">
                              <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
                            </td>
                          </tr>
                        ) : users.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-5 py-12 text-center text-slate-500">
                              No users found
                            </td>
                          </tr>
                        ) : (
                          users.map((u) => (
                            <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm">
                                    {u.avatar_url ? (
                                      <img src={u.avatar_url} alt={u.username} className="w-10 h-10 rounded-full" />
                                    ) : (
                                      u.username.charAt(0).toUpperCase()
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-medium text-slate-900 dark:text-white">{u.username}</div>
                                    <div className="text-xs text-slate-500">{u.email || 'No email'}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-2">
                                  {u.oauth_provider === 'github' ? (
                                    <GitHubIcon className="w-4 h-4" />
                                  ) : u.oauth_provider === 'google' ? (
                                    <GoogleIcon className="w-4 h-4" />
                                  ) : null}
                                  <span className="text-sm text-slate-600 dark:text-slate-400 capitalize">{u.oauth_provider || '-'}</span>
                                </div>
                              </td>
                              <td className="px-5 py-4 text-center">
                                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                                  u.plan === 'enterprise' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                                  u.plan === 'pro' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400' :
                                  'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                                }`}>
                                  {u.plan}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-center">
                                <span className="text-slate-600 dark:text-slate-400">{u.server_count}/{u.server_limit}</span>
                              </td>
                              <td className="px-5 py-4 text-center">
                                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                                  u.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                                  u.status === 'suspended' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                                  'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                                }`}>
                                  {u.status}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-500">
                                {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => setEditingUser(u)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-500 hover:text-violet-600"
                                    title="Edit user"
                                  >
                                    <UserCog className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmUser(u)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-500 hover:text-red-600"
                                    title="Delete user"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {userTotalPages > 1 && (
                    <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                      <div className="text-sm text-slate-500">
                        Showing {((userPage - 1) * 20) + 1} to {Math.min(userPage * 20, userTotal)} of {userTotal} users
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setUserPage(p => Math.max(1, p - 1))}
                          disabled={userPage === 1}
                          className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                        >
                          Previous
                        </button>
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          Page {userPage} of {userTotalPages}
                        </span>
                        <button
                          onClick={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                          disabled={userPage === userTotalPages}
                          className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Edit User Modal */}
                <AnimatePresence>
                  {editingUser && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                      onClick={() => setEditingUser(null)}
                    >
                      <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                          <h3 className="font-semibold text-slate-900 dark:text-white">Edit User</h3>
                          <button
                            onClick={() => setEditingUser(null)}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <X className="w-5 h-5 text-slate-400" />
                          </button>
                        </div>
                        <div className="p-6 space-y-4">
                          <div className="flex items-center gap-4 mb-6">
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xl font-medium">
                              {editingUser.avatar_url ? (
                                <img src={editingUser.avatar_url} alt={editingUser.username} className="w-16 h-16 rounded-full" />
                              ) : (
                                editingUser.username.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div>
                              <div className="text-lg font-semibold text-slate-900 dark:text-white">{editingUser.username}</div>
                              <div className="text-sm text-slate-500">{editingUser.email || 'No email'}</div>
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Plan</label>
                            <select
                              defaultValue={editingUser.plan}
                              onChange={(e) => handleUpdateUser(editingUser.id, { plan: e.target.value })}
                              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all text-slate-900 dark:text-white"
                            >
                              <option value="free">Free (5 servers)</option>
                              <option value="pro">Pro (50 servers)</option>
                              <option value="enterprise">Enterprise (500 servers)</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Status</label>
                            <select
                              defaultValue={editingUser.status}
                              onChange={(e) => handleUpdateUser(editingUser.id, { status: e.target.value })}
                              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all text-slate-900 dark:text-white"
                            >
                              <option value="active">Active</option>
                              <option value="suspended">Suspended</option>
                            </select>
                          </div>

                          <div className="pt-4">
                            <button
                              onClick={() => setEditingUser(null)}
                              className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Delete Confirmation Modal */}
                <AnimatePresence>
                  {deleteConfirmUser && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                      onClick={() => setDeleteConfirmUser(null)}
                    >
                      <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="p-6 text-center">
                          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Trash2 className="w-8 h-8 text-red-600 dark:text-red-400" />
                          </div>
                          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Delete User</h3>
                          <p className="text-slate-500 dark:text-slate-400 mb-6">
                            Are you sure you want to delete <span className="font-medium text-slate-900 dark:text-white">{deleteConfirmUser.username}</span>? This action cannot be undone.
                          </p>
                          <div className="flex gap-3">
                            <button
                              onClick={() => setDeleteConfirmUser(null)}
                              className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDeleteUser(deleteConfirmUser.id)}
                              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Broadcast Tab */}
            {activeTab === 'broadcast' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Broadcast Email</h1>
                  <p className="text-slate-500 dark:text-slate-400">Send announcements to all registered users</p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
                  <form onSubmit={handleSendEmail} className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        placeholder="Enter email subject..."
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Content
                      </label>
                      <textarea
                        value={emailContent}
                        onChange={(e) => setEmailContent(e.target.value)}
                        placeholder="Enter email content..."
                        rows={8}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all resize-none"
                        required
                      />
                    </div>

                    {sendResult && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`p-4 rounded-xl ${sendResult.success ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}
                      >
                        {sendResult.message}
                      </motion.div>
                    )}

                    <button
                      type="submit"
                      disabled={isSending || !emailSubject.trim() || !emailContent.trim()}
                      className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-xl hover:from-violet-600 hover:to-purple-700 focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-500/30"
                    >
                      {isSending ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-5 h-5" />
                          Send Broadcast Email
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
                  <p className="text-slate-500 dark:text-slate-400">Configure platform settings</p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-8 text-center">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Settings className="w-8 h-8 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Coming Soon</h3>
                  <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    Platform settings and configuration options are under development.
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

