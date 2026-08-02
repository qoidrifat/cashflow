import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Shield, Zap, BarChart3, Smartphone } from 'lucide-react';
import Button from '../../components/ui/Button';
import { APP_NAME } from '../../config/constants';

export default function LandingPage() {
  const navigate = useNavigate();

  const features = [
    {
      icon: <Zap className="w-6 h-6" />,
      title: 'Catat Cepat',
      description: 'Input transaksi dalam hitungan detik',
    },
    {
      icon: <BarChart3 className="w-6 h-6" />,
      title: 'Analisis Pintar',
      description: 'Grafik dan insight otomatis',
    },
    {
      icon: <Smartphone className="w-6 h-6" />,
      title: 'Mobile Friendly',
      description: 'Akses kapan saja, di mana saja',
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: 'Aman & Privasi',
      description: 'Data kamu aman dengan autentikasi session dan akses data per-user di server.',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-900 via-navy-950 to-navy-900">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-soft-purple/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 py-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-2xl mx-auto"
          >
            <motion.img
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              src="/logo/cashflow-logo.webp"
              alt={APP_NAME}
              className="mx-auto mb-6 h-20 w-auto max-w-[240px] object-contain"
            />

            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
              Kelola Keuangan
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-soft-purple">
                dengan Gaya GenZ
              </span>
            </h1>

            <p className="text-gray-400 text-lg mb-8 max-w-lg mx-auto">
              Catat pemasukan, pantau pengeluaran, dan dapatkan insight keuangan otomatis dari email Gmail kamu.
            </p>

            <div className="flex items-center justify-center gap-3">
              <Button
                variant="primary"
                size="lg"
                icon={<ArrowRight className="w-5 h-5" />}
                onClick={() => navigate('/login')}
              >
                Mulai Sekarang
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate('/login')}
                className="border-white/10 text-white hover:bg-white/5"
              >
                Masuk
              </Button>
            </div>
          </motion.div>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20"
          >
            {features.map((feature, i) => (
              <div
                key={feature.title}
                className="bg-white/5 backdrop-blur-xl rounded-2xl p-5 border border-white/10 text-center"
              >
                <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center mx-auto mb-3 text-primary-400">
                  {feature.icon}
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">{feature.title}</h3>
                <p className="text-xs text-gray-400">{feature.description}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
