import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import PublicLandingPage from './components/PublicLandingPage';

export default function LoginPage() {
  const { login, isAuthenticated, isLoading, error, clearError } = useAuthStore(
    useShallow((s) => ({ login: s.login, isAuthenticated: s.isAuthenticated, isLoading: s.isLoading, error: s.error, clearError: s.clearError })),
  );
  const setAuthReady = useAppStore((s) => s.setAuthReady);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get('reason') === 'session_expired';

  useEffect(() => {
    setAuthReady(true);
  }, [setAuthReady]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleLogin = async () => {
    clearError();
    await login();
  };

  return <PublicLandingPage isLoading={isLoading} error={error} onLogin={handleLogin} notice={sessionExpired ? 'Sesi Anda telah berakhir, silakan masuk lagi.' : null} />;
}
