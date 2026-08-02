import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownUp,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  Mail,
  PieChart,
  Receipt,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
} from 'lucide-react';
import { APP_NAME } from '../../../config/constants';

interface PublicLandingPageProps {
  isLoading: boolean;
  error: string | null;
  onLogin: () => void;
  /** CF-056: optional contextual notice (e.g. session expired) shown above login. */
  notice?: string | null;
}

const features = [
  {
    icon: Wallet,
    title: 'Catat Transaksi',
    description: 'Pemasukan dan pengeluaran harian tersusun rapi dengan kategori dan icon yang mudah dipahami.',
    tone: 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10',
  },
  {
    icon: Mail,
    title: 'Scan Gmail',
    description: 'Baca email transaksi dari bank, e-wallet, transportasi, hotel, dan e-commerce secara otomatis.',
    tone: 'text-blue-600 dark:text-blue-300 bg-blue-500/10',
  },
  {
    icon: ClipboardCheck,
    title: 'Review AI',
    description: 'Hasil ekstraksi AI masuk pending review dulu, jadi kamu tetap punya kontrol penuh.',
    tone: 'text-violet-600 dark:text-violet-300 bg-violet-500/10',
  },
  {
    icon: Target,
    title: 'Budget Bulanan',
    description: 'Atur limit per kategori dan dapatkan peringatan saat pengeluaran mulai mendekati batas.',
    tone: 'text-amber-600 dark:text-amber-300 bg-amber-500/10',
  },
  {
    icon: BarChart3,
    title: 'Laporan',
    description: 'Lihat tren keuangan, kategori paling boros, dan ringkasan bulanan dengan tampilan clean.',
    tone: 'text-fuchsia-600 dark:text-fuchsia-300 bg-fuchsia-500/10',
  },
  {
    icon: Bell,
    title: 'Notifikasi',
    description: 'Dapatkan update penting seperti Gmail Sync selesai, budget hampir habis, atau transaksi perlu dicek.',
    tone: 'text-rose-600 dark:text-rose-300 bg-rose-500/10',
  },
] as const;

const benefits = [
  'Lebih sadar uang keluar',
  'Nggak perlu cek email satu-satu',
  'Transaksi AI masuk review dulu',
] as const;

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function LoginButton({ isLoading, onLogin, className = '' }: Pick<PublicLandingPageProps, 'isLoading' | 'onLogin'> & { className?: string }) {
  return (
    <button
      type="button"
      onClick={onLogin}
      disabled={isLoading}
      aria-label="Masuk dengan Google"
      className={[
        'inline-flex min-h-[48px] w-full items-center justify-center gap-3 rounded-2xl border px-5 py-3 text-sm font-bold',
        'border-slate-200 bg-white text-slate-950 shadow-sm shadow-slate-950/5',
        'transition duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-lg hover:shadow-slate-950/10',
        'focus:outline-none focus:ring-4 focus:ring-blue-500/25',
        'disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:shadow-sm',
        'dark:border-white/10 dark:bg-slate-900 dark:text-white dark:shadow-black/20 dark:hover:bg-slate-800',
        className,
      ].join(' ')}
    >
      {isLoading ? (
        <>
          <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-blue-500" />
          <span>Memproses...</span>
        </>
      ) : (
        <>
          <GoogleIcon />
          <span>Masuk dengan Google</span>
        </>
      )}
    </button>
  );
}

function LogoMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/90 p-2 shadow-lg shadow-emerald-900/10 dark:border-white/10 dark:bg-white/90">
        <img src="/logo/cashflow-icon.webp" alt="" aria-hidden="true" className="h-full w-full object-contain" />
      </div>
      <div>
        <p className="text-base font-extrabold text-slate-950 dark:text-white">{APP_NAME}</p>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Kelola uangmu lebih sat-set.</p>
      </div>
    </div>
  );
}

function DashboardPreviewCard() {
  return (
    <div className="relative mx-auto w-full max-w-[440px] rounded-[2rem] border border-white/70 bg-white/80 p-4 shadow-2xl shadow-slate-900/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/75 dark:shadow-black/30">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Dashboard</p>
          <h2 className="mt-1 text-xl font-extrabold text-slate-950 dark:text-white">Saldo Bulan Ini</h2>
        </div>
        <div className="rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          Aktif
        </div>
      </div>

      <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl shadow-slate-950/20 dark:bg-white dark:text-slate-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-white/65 dark:text-slate-500">Net cashflow</p>
            <p className="mt-1 text-3xl font-extrabold">Rp2.250.000</p>
          </div>
          <Sparkles aria-hidden="true" className="h-6 w-6 text-amber-300 dark:text-amber-500" />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/10 p-3 dark:bg-slate-950/5">
            <p className="text-xs text-white/60 dark:text-slate-500">Pemasukan</p>
            <p className="mt-1 font-bold text-emerald-300 dark:text-emerald-600">Rp3.500.000</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-3 dark:bg-slate-950/5">
            <p className="text-xs text-white/60 dark:text-slate-500">Pengeluaran</p>
            <p className="mt-1 font-bold text-rose-300 dark:text-rose-600">Rp1.250.000</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-3xl border border-amber-200/80 bg-amber-50/80 p-4 dark:border-amber-400/15 dark:bg-amber-400/10">
          <PieChart aria-hidden="true" className="mb-3 h-5 w-5 text-amber-600 dark:text-amber-300" />
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Sisa Budget</p>
          <p className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">Rp750.000</p>
        </div>
        <div className="rounded-3xl border border-blue-200/80 bg-blue-50/80 p-4 dark:border-blue-400/15 dark:bg-blue-400/10">
          <Mail aria-hidden="true" className="mb-3 h-5 w-5 text-blue-600 dark:text-blue-300" />
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Gmail Sync</p>
          <p className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">12 review</p>
        </div>
      </div>

      <div className="mt-4 rounded-3xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-extrabold text-slate-950 dark:text-white">Recent Transaction</p>
          <span className="text-xs font-bold text-blue-600 dark:text-blue-300">AI Review</span>
        </div>
        {[
          ['Gojek', 'Transportasi', '-Rp42.000', 'rose'],
          ['Salary', 'Pemasukan', '+Rp3.500.000', 'emerald'],
          ['Tokopedia', 'Belanja', '-Rp189.000', 'rose'],
        ].map(([name, label, amount, tone]) => (
          <div key={name} className="flex items-center justify-between border-t border-slate-100 py-3 first:border-t-0 first:pt-0 last:pb-0 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300'}`}>
                {tone === 'emerald' ? <ArrowDownUp aria-hidden="true" className="h-4 w-4" /> : <Receipt aria-hidden="true" className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
              </div>
            </div>
            <p className={`shrink-0 text-sm font-extrabold ${tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{amount}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureCard({ feature }: { feature: (typeof features)[number] }) {
  const Icon = feature.icon;

  return (
    <div className="group rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-slate-950/5 backdrop-blur-xl transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-950/10 dark:border-white/10 dark:bg-white/[0.055] dark:hover:bg-white/[0.075]">
      <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl ${feature.tone}`}>
        <Icon aria-hidden="true" className="h-6 w-6" />
      </div>
      <h3 className="text-base font-extrabold text-slate-950 dark:text-white">{feature.title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{feature.description}</p>
    </div>
  );
}

function LoginCard({ isLoading, error, onLogin, notice }: PublicLandingPageProps) {
  return (
    <section aria-labelledby="login-title" className="rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-xl shadow-slate-900/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/75 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-300">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 id="login-title" className="text-xl font-extrabold text-slate-950 dark:text-white">
            Mulai kelola keuanganmu
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Masuk dengan Google untuk menyinkronkan data CashFlow dan mengaktifkan Gmail Sync.
          </p>
        </div>
      </div>

      {notice && (
        <div className="mb-4 flex gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3" role="status">
          <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" />
          <p className="text-xs leading-5 text-amber-700 dark:text-amber-200">{notice}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 flex gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3" role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-rose-500 dark:text-rose-300" />
          <p className="text-xs leading-5 text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      <LoginButton isLoading={isLoading} onLogin={onLogin} />
      <p className="mt-4 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
        Dengan masuk, kamu bisa memilih izin yang diperlukan untuk fitur Gmail Sync.
      </p>
    </section>
  );
}

export default function PublicLandingPage({ isLoading, error, onLogin, notice = null }: PublicLandingPageProps) {
  const reduceMotion = useReducedMotion();

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-10rem] h-[24rem] w-[24rem] rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-400/10" />
        <div className="absolute right-[-9rem] top-8 h-[25rem] w-[25rem] rounded-full bg-blue-300/28 blur-3xl dark:bg-blue-500/10" />
        <div className="absolute bottom-24 left-1/2 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-violet-300/24 blur-3xl dark:bg-violet-500/10" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:42px_42px] opacity-35 dark:opacity-15" />
      </div>

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-14 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="flex items-center justify-between gap-4">
          <LogoMark />
          <a
            href="#features"
            className="hidden min-h-[44px] items-center rounded-2xl px-4 text-sm font-bold text-slate-600 transition hover:bg-white/70 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-blue-500/20 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white sm:inline-flex"
          >
            Lihat Fitur
          </a>
        </header>

        <section className="grid items-center gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12" aria-labelledby="hero-title">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.55, ease: 'easeOut' }}
            className="max-w-2xl"
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-3 py-2 text-xs font-extrabold text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              CashFlow
            </div>
            <h1 id="hero-title" className="text-balance text-3xl font-black leading-tight text-slate-950 dark:text-white sm:text-4xl lg:text-5xl">
              Atur Cashflow Tanpa Ribet
            </h1>
            <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-slate-700 dark:text-slate-200 sm:text-lg">
              Kelola uangmu lebih sat-set, rapi, dan pintar.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">
              Pantau pemasukan, pengeluaran, budget, laporan, dan transaksi Gmail otomatis dalam satu dashboard modern.
              Biar nggak cuma kayaknya boros, CashFlow bantu kamu lihat kondisi keuangan secara lebih jelas.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:max-w-md sm:flex-row">
              <LoginButton isLoading={isLoading} onLogin={onLogin} className="sm:flex-1" />
              <a
                href="#features"
                className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-slate-200 bg-white/60 px-5 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
              >
                Lihat Fitur
              </a>
            </div>
            <div className="mt-6 grid gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-3">
              {benefits.map((benefit) => (
                <div key={benefit} className="flex items-center gap-2">
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div {...(reduceMotion ? {} : { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, transition: { delay: 0.1, duration: 0.55, ease: 'easeOut' } })}>
            <DashboardPreviewCard />
          </motion.div>
        </section>

        <section id="features" aria-labelledby="features-title" className="scroll-mt-6">
          <div className="mb-6 max-w-2xl">
            <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-300">Fitur utama</p>
            <h2 id="features-title" className="mt-2 text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">
              Semua yang kamu butuhkan buat ngerti kondisi keuanganmu
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <FeatureCard key={feature.title} feature={feature} />
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]" aria-label="Manfaat dan privasi CashFlow">
          <div className="rounded-[2rem] border border-white/70 bg-slate-950 p-6 text-white shadow-xl shadow-slate-950/15 dark:border-white/10 dark:bg-white dark:text-slate-950">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-emerald-300 dark:bg-slate-950/5 dark:text-emerald-600">
              <Bot aria-hidden="true" className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-black">Kenapa CashFlow?</h2>
            <div className="mt-5 grid gap-3">
              {benefits.map((benefit) => (
                <div key={benefit} className="flex items-center gap-3 rounded-2xl bg-white/[0.08] p-3 dark:bg-slate-950/5">
                  <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-300 dark:text-emerald-600" />
                  <p className="font-bold">{benefit}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-sm shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.055]">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                  <ShieldCheck aria-hidden="true" className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black text-slate-950 dark:text-white">Privasi tetap jelas</h2>
              </div>
              <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
                Kamu tetap memegang kontrol. CashFlow hanya membaca email transaksi setelah kamu memberi izin, dan hasilnya bisa kamu review sebelum disimpan.
              </p>
              <div className="mt-4 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <p>Kamu bisa reset izin Gmail kapan saja.</p>
                <p>Data email penuh tidak perlu ditampilkan di halaman ini.</p>
              </div>
            </div>

            <LoginCard isLoading={isLoading} error={error} onLogin={onLogin} notice={notice} />
          </div>
        </section>
      </div>
    </main>
  );
}
