import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home } from 'lucide-react';
import Button from '../components/ui/Button';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-sm"
      >
        <div className="text-6xl font-bold text-primary-500 mb-4">404</div>
        <h1 className="text-xl font-bold text-app-text mb-2">
          Halaman Tidak Ditemukan
        </h1>
        <p className="text-sm text-app-muted mb-6">
          Halaman yang kamu cari tidak ada atau telah dipindahkan.
        </p>
        <Button
          variant="primary"
          icon={<Home className="w-4 h-4" />}
          onClick={() => navigate('/dashboard')}
        >
          Kembali ke Beranda
        </Button>
      </motion.div>
    </div>
  );
}
