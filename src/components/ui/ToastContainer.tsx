import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: 'bg-mint-500',
  error: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-primary-500',
};

export default function ToastContainer() {
  const { toasts, removeToast } = useAppStore();

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 space-y-2 pointer-events-none sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:max-w-sm sm:w-full">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = iconMap[toast.type];
          
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className={cn(
                'pointer-events-auto',
                'app-elevated rounded-2xl p-4',
                'flex items-start gap-3'
              )}
            >
              <div className={cn(
                'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
                colorMap[toast.type],
                'bg-opacity-20'
              )}>
                <Icon className={cn('w-4 h-4', colorMap[toast.type].replace('bg-', 'text-'))} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-app-text">
                  {toast.title}
                </p>
                {toast.message && (
                  <p className="text-xs text-app-muted mt-0.5">
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="p-1 app-icon-button"
                aria-label="Tutup notifikasi"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
