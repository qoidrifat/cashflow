import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getCurrentUser } from '../../services/authService';
import { useAuthStore } from '../../store/useAuthStore';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const init = useAuthStore((state) => state.init);
  const [message, setMessage] = useState('Menyelesaikan login Google...');

  useEffect(() => {
    let mounted = true;
    const unsubscribe = init();

    getCurrentUser()
      .then((user) => {
        if (!mounted) return;
        if (!user) {
          setMessage('Session belum ditemukan. Mengarahkan kembali ke login...');
          navigate('/login', { replace: true });
          return;
        }

        const next = searchParams.get('next') || '/dashboard';
        navigate(next.startsWith('/') ? next : '/dashboard', { replace: true });
      })
      .catch((error) => {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : 'Login gagal diproses.');
        setTimeout(() => navigate('/login', { replace: true }), 1500);
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [init, navigate, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary-500" />
        <p className="text-sm text-app-muted">{message}</p>
      </div>
    </div>
  );
}
