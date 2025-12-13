import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { setToken, exchangeForToken } from '../api/cloud';

export default function AuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { login } = useAuth();
    const { t } = useTranslation();

    useEffect(() => {
        const handleAuth = async () => {
            const user = searchParams.get('user');
            const email = searchParams.get('email');
            const provider = searchParams.get('provider');
            const error = searchParams.get('error');
            const from = searchParams.get('from');
            const token = searchParams.get('token');

            if (error) {
                console.error('Auth error:', error);
                navigate(from === 'cloud' ? '/cloud' : '/');
                return;
            }

            if (user && provider) {
                // For Google provider, user is the email
                // For GitHub provider, user is the username
                const userEmail = provider === 'google' ? user : email;
                const username = provider === 'google' ? user.split('@')[0] : user;

                // Save JWT token if provided (from backend OAuth)
                if (token) {
                    setToken(token);
                } else {
                    // Exchange OAuth info for JWT token from backend
                    try {
                        const result = await exchangeForToken(provider, username, userEmail || undefined);
                        setToken(result.token);
                    } catch (err) {
                        console.error('Token exchange failed:', err);
                        // Continue without token - user can still see public pages
                    }
                }
                
                login({ 
                    username, 
                    email: userEmail,
                    provider 
                });
                
                // Always redirect to Cloud dashboard after login
                navigate('/cloud');
            } else {
                navigate('/cloud');
            }
        };

        handleAuth();
    }, [searchParams, login, navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
            <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-slate-600 dark:text-slate-400">{t('common.authenticating', 'Authenticating...')}</p>
            </div>
        </div>
    );
}
