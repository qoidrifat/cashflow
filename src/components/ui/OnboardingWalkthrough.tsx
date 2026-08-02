import { useEffect, useState } from 'react';
import { BarChart3, Mail, Sparkles, X } from 'lucide-react';
import Button from './Button';
import { STORAGE_KEYS } from '../../config/constants';
import { cn } from '../../lib/utils';

const steps = [
  {
    icon: Sparkles,
    title: 'Catat transaksi cepat',
    description: 'Gunakan tombol plus untuk menambahkan pemasukan atau pengeluaran harian dalam beberapa detik.',
  },
  {
    icon: Mail,
    title: 'Sinkron Gmail',
    description: 'Scan email transaksi dari bank, e-wallet, e-commerce, dan tiket lalu review sebelum disimpan.',
  },
  {
    icon: BarChart3,
    title: 'Pantau cashflow',
    description: 'Buka Laporan dan Professional Suite untuk insight AI, forecast, budget, goal, dan health score.',
  },
];

export default function OnboardingWalkthrough() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const Icon = step.icon;

  useEffect(() => {
    setOpen(localStorage.getItem(STORAGE_KEYS.ONBOARDING_DONE) !== 'true');
  }, []);

  const close = () => {
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_DONE, 'true');
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-app-overlay p-4 sm:items-center">
      <div className="w-full max-w-md rounded-3xl border border-app-border bg-app-elevated p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary-500 text-white flex items-center justify-center shadow-lg shadow-primary-500/20">
            <Icon className="h-6 w-6" />
          </div>
          <button onClick={close} className="app-icon-button p-2" aria-label="Tutup onboarding">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-500 dark:text-primary-300">
            Langkah {index + 1} dari {steps.length}
          </p>
          <h2 className="mt-2 text-xl font-black text-app-text">{step.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-app-muted">{step.description}</p>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {steps.map((item, itemIndex) => (
            <span
              key={item.title}
              className={cn(
                'h-2 rounded-full transition-all',
                itemIndex === index ? 'w-8 bg-primary-500' : 'w-2 bg-app-hover'
              )}
            />
          ))}
        </div>

        <div className="mt-6 flex gap-2">
          <Button variant="ghost" size="sm" fullWidth onClick={close}>
            Lewati
          </Button>
          <Button
            variant="primary"
            size="sm"
            fullWidth
            onClick={() => {
              if (index === steps.length - 1) close();
              else setIndex((current) => current + 1);
            }}
          >
            {index === steps.length - 1 ? 'Mulai' : 'Lanjut'}
          </Button>
        </div>
      </div>
    </div>
  );
}
