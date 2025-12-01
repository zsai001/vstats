import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Get password from form input directly to handle browser automation
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mb-4">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-white">xProb Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Enter password to continue</p>
        </div>

        {/* Login Card */}
        <div className="nezha-card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Password
              </label>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-colors"
                placeholder="Enter admin password"
                autoFocus
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/5 text-center">
            <button
              onClick={() => navigate('/')}
              className="text-gray-500 hover:text-white text-sm transition-colors"
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>

        {/* Help text */}
        <p className="text-center text-gray-600 text-xs mt-6">
          Forgot password? Run <code className="text-gray-400">./xprob-server --reset-password</code>
        </p>
      </div>
    </div>
  );
}

