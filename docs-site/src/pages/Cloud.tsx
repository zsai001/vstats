import { useState } from 'react';
import { motion } from 'framer-motion';
import { Cloud, Shield, Zap, Globe, LogOut, Rocket, Server, BarChart3, Bell, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';

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

export default function CloudPage() {
  const { t } = useTranslation();
  const { user, logout, isLoading } = useAuth();
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // OAuth login
  const handleOAuthLogin = async (provider: 'github' | 'google') => {
    setOauthLoading(provider);
    setError(null);
    
    try {
      const { startOAuth } = await import('../api/cloud');
      const { url } = await startOAuth(provider);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setOauthLoading(null);
    }
  };

  // Logout
  const handleLogout = () => {
    logout();
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="pt-20 min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-slate-50 to-purple-50 dark:from-slate-900 dark:via-slate-900 dark:to-violet-950">
        <div className="w-10 h-10 border-3 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Logged in - Beautiful Dashboard
  if (user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-slate-50 to-purple-50 dark:from-slate-900 dark:via-slate-900 dark:to-violet-950">
        {/* Decorative background elements */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-violet-400/20 dark:bg-violet-500/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 -left-40 w-80 h-80 bg-purple-400/20 dark:bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 right-1/3 w-80 h-80 bg-pink-400/20 dark:bg-pink-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative pt-24 pb-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            {/* User Profile Card */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative mb-8"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-purple-600 rounded-3xl blur-xl opacity-20" />
              <div className="relative bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl border border-white/50 dark:border-slate-700/50 p-8 shadow-2xl shadow-violet-500/10">
                <div className="flex flex-col md:flex-row items-center gap-6">
                  {/* Avatar */}
                  <div className="relative">
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-pink-500 p-1 shadow-lg shadow-violet-500/30">
                      <div className="w-full h-full rounded-xl bg-white dark:bg-slate-800 flex items-center justify-center text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-violet-500 to-purple-500">
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  </div>

                  {/* User Info */}
                  <div className="flex-1 text-center md:text-left">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                      {user.username}
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 flex items-center justify-center md:justify-start gap-2">
                      <span className="capitalize px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded-md text-sm">
                        {user.provider}
                      </span>
                      {user.email && <span className="text-sm">{user.email}</span>}
                    </p>
                  </div>

                  {/* Logout Button */}
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="font-medium">{t('common.logout', 'Logout')}</span>
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Coming Soon Hero */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="relative mb-8"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-purple-600 rounded-3xl" />
              <div className="relative bg-gradient-to-r from-violet-600/90 to-purple-600/90 rounded-3xl p-8 md:p-12 text-white overflow-hidden">
                {/* Background pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-0 left-0 w-40 h-40 border border-white/20 rounded-full -translate-x-1/2 -translate-y-1/2" />
                  <div className="absolute top-1/2 right-0 w-60 h-60 border border-white/20 rounded-full translate-x-1/2" />
                  <div className="absolute bottom-0 left-1/3 w-32 h-32 border border-white/20 rounded-full translate-y-1/2" />
                </div>
                
                <div className="relative flex flex-col md:flex-row items-center gap-8">
                  <div className="flex-1">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur rounded-full text-sm font-medium mb-4">
                      <Rocket className="w-4 h-4" />
                      {t('cloud.comingSoon', 'Coming Soon')}
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold mb-4">
                      {t('userCenter.comingSoonTitle', 'vStats Cloud is Coming Soon')}
                    </h2>
                    <p className="text-white/80 text-lg max-w-xl">
                      {t('userCenter.comingSoonDesc', 'We are working hard to bring you amazing features!')}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <div className="w-32 h-32 md:w-40 md:h-40 bg-white/10 backdrop-blur rounded-3xl flex items-center justify-center">
                      <Clock className="w-16 h-16 md:w-20 md:h-20 text-white/80" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Feature Cards */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
            >
              {[
                { icon: Server, title: t('userCenter.feature1Title', 'Multi-Server Management'), desc: t('userCenter.feature1Desc', 'Manage all your servers in one place'), color: 'from-blue-500 to-cyan-500' },
                { icon: BarChart3, title: t('userCenter.feature2Title', 'Real-time Analytics'), desc: t('userCenter.feature2Desc', 'Monitor performance with live dashboards'), color: 'from-violet-500 to-purple-500' },
                { icon: Bell, title: t('userCenter.feature3Title', 'Smart Alerts'), desc: t('userCenter.feature3Desc', 'Get notified when something goes wrong'), color: 'from-orange-500 to-pink-500' },
              ].map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="group relative"
                >
                  <div className={`absolute inset-0 bg-gradient-to-r ${feature.color} rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-300`} />
                  <div className="relative h-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-2xl border border-white/50 dark:border-slate-700/50 p-6 hover:shadow-xl transition-all duration-300">
                    <div className={`w-14 h-14 rounded-xl bg-gradient-to-r ${feature.color} flex items-center justify-center mb-4 shadow-lg`}>
                      <feature.icon className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{feature.title}</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">{feature.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
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
