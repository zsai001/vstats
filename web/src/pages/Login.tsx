import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// GitHub Icon SVG
const GitHubIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

// Google Icon SVG
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const { login, oauthProviders, startOAuthLogin } = useAuth();
  const navigate = useNavigate();

  const hasOAuthProviders = oauthProviders.github || oauthProviders.google;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const formData = new FormData(e.target as HTMLFormElement);
    const inputPassword = (formData.get('password') as string) || password;
    
    if (!inputPassword) {
      setError('Please enter a password');
      return;
    }
    
    setLoading(true);

    const success = await login(inputPassword);
    
    if (success) {
      navigate('/settings');
    } else {
      setError('Invalid password');
    }
    
    setLoading(false);
  };

  const handleOAuthLogin = async (provider: 'github' | 'google') => {
    setError('');
    setOauthLoading(provider);
    
    try {
      await startOAuthLogin(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OAuth login failed');
      setOauthLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-cyan-500/10 via-transparent to-transparent rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 mb-4 shadow-lg shadow-emerald-500/10">
            <span className="text-4xl">⚡</span>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">vStats</h1>
          <p className="text-gray-500 text-sm mt-2">服务器监控管理面板</p>
        </div>

        {/* Login Card */}
        <div className="nezha-card p-8 backdrop-blur-xl">
          {/* OAuth Buttons */}
          {hasOAuthProviders && (
            <>
              <div className="space-y-3 mb-6">
                {oauthProviders.github && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('github')}
                    disabled={oauthLoading !== null}
                    className="group w-full py-3.5 px-4 rounded-xl bg-[#0d1117] hover:bg-[#161b22] border border-[#30363d] hover:border-[#8b949e] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-all duration-200 flex items-center justify-center gap-3 shadow-lg shadow-black/20 hover:shadow-black/40 hover:-translate-y-0.5"
                  >
                    {oauthLoading === 'github' ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        <span className="text-gray-400">正在跳转...</span>
                      </>
                    ) : (
                      <>
                        <GitHubIcon />
                        <span>使用 GitHub 登录</span>
                        <svg className="w-4 h-4 text-gray-500 group-hover:text-white group-hover:translate-x-0.5 transition-all ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>
                )}
                
                {oauthProviders.google && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('google')}
                    disabled={oauthLoading !== null}
                    className="group w-full py-3.5 px-4 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 font-medium transition-all duration-200 flex items-center justify-center gap-3 shadow-lg shadow-black/5 hover:shadow-black/10 hover:-translate-y-0.5"
                  >
                    {oauthLoading === 'google' ? (
                      <>
                        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                        <span className="text-gray-500">正在跳转...</span>
                      </>
                    ) : (
                      <>
                        <GoogleIcon />
                        <span>使用 Google 登录</span>
                        <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 group-hover:translate-x-0.5 transition-all ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Divider */}
              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="px-4 text-xs text-gray-500 bg-[#1a1a2e] uppercase tracking-wider">或使用密码</span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                管理员密码
              </label>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                placeholder="输入密码"
                autoFocus={!hasOAuthProviders}
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || oauthLoading !== null}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-medium transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:-translate-y-0.5"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  登录中...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  登录
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/5 text-center">
            <button
              onClick={() => navigate('/')}
              className="text-gray-500 hover:text-emerald-400 text-sm transition-colors inline-flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回仪表盘
            </button>
          </div>
        </div>

        {/* Help text */}
        <p className="text-center text-gray-600 text-xs mt-6">
          忘记密码？运行 <code className="text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded">./vstats-server --reset-password</code>
        </p>
      </div>
    </div>
  );
}
