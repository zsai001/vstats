import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  token: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('xprob_token'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Verify token on mount
    const verifyToken = async () => {
      if (token) {
        try {
          const res = await fetch('/api/auth/verify', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!res.ok) {
            setToken(null);
            localStorage.removeItem('xprob_token');
          }
        } catch {
          // Keep token if server is unreachable
        }
      }
      setIsLoading(false);
    };
    verifyToken();
  }, [token]);

  const login = async (password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        localStorage.setItem('xprob_token', data.token);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('xprob_token');
  };

  return (
    <AuthContext.Provider value={{ 
      isAuthenticated: !!token, 
      token, 
      login, 
      logout,
      isLoading 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

