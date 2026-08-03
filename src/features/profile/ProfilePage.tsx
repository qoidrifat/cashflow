import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogOut, Settings, TrendingUp, TrendingDown,
  Receipt, Mail, Scan, ArrowRight,
  Wallet, PieChart, Flame, HelpCircle,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import SuccessFeedbackOverlay from '../../components/ui/SuccessFeedbackOverlay';
import { getTransactionsPaginated } from '../../services/transactionService';
import { cn, formatCurrency } from '../../lib/utils';

const LOGOUT_SUCCESS_FEEDBACK_DURATION_MS = 5000;

interface FinancialSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  transactionCount: number;
  topCategory: string | null;
}

export default function ProfilePage() {
  const { authUser, logout, setLogoutAnimationActive } = useAuthStore();
  const { addToast } = useAppStore();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutSuccess, setLogoutSuccess] = useState(false);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Financial summary state
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    return () => {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      setLogoutAnimationActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load financial summary for current month
  useEffect(() => {
    if (!authUser?.uid) return;
    loadFinancialSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

  const loadFinancialSummary = useCallback(async () => {
    if (!authUser?.uid) return;
    setSummaryLoading(true);
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const result = await getTransactionsPaginated({
        userId: authUser.uid,
        page: 1,
        pageSize: 100,
        dateFrom: startOfMonth.toISOString().split('T')[0],
        dateTo: now.toISOString().split('T')[0],
      });

      const transactions = result.data || [];
      let totalIncome = 0;
      let totalExpense = 0;
      const categoryCount: Record<string, number> = {};

      for (const tx of transactions) {
        if (tx.type === 'income' || tx.type === 'refund') {
          totalIncome += tx.amount || 0;
        } else {
          totalExpense += tx.amount || 0;
        }
        const cat = tx.categoryName || 'Lainnya';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
      }

      const topCategory = Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      setSummary({
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
        transactionCount: result.total || transactions.length,
        topCategory,
      });
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [authUser?.uid]);

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutSuccess(false);
    setLogoutAnimationActive(true);
    try {
      await logout();
      setLogoutSuccess(true);
      setShowLogoutConfirm(false);
      logoutTimerRef.current = setTimeout(() => {
        setLogoutSuccess(false);
        setLoggingOut(false);
        setLogoutAnimationActive(false);
        navigate('/login', { replace: true });
      }, LOGOUT_SUCCESS_FEEDBACK_DURATION_MS);
    } catch {
      setLogoutSuccess(false);
      setLoggingOut(false);
      setLogoutAnimationActive(false);
      addToast({ type: 'error', title: 'Gagal logout' });
    }
  };

  const memberSince = null; // AppUser doesn't expose creationTime

  const monthLabel = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  return (
    <div>
      <Header title="Profil" />

      <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
        {/* Profile Header */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-4">
            <img
              src={authUser?.photoURL || ''}
              alt={authUser?.displayName || 'User'}
              className="w-[72px] h-[72px] rounded-2xl object-cover ring-3 ring-primary-100 dark:ring-primary-500/20"
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-black text-app-text truncate">
                {authUser?.displayName || 'User'}
              </h2>
              <p className="text-sm text-app-muted truncate">
                {authUser?.email || ''}
              </p>
              {memberSince && (
                <p className="text-[10px] text-app-subtle mt-1">
                  Member sejak {memberSince}
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Financial Summary */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-app-subtle uppercase tracking-wider px-1">
            Ringkasan {monthLabel}
          </h3>

          {summaryLoading ? (
            <Card>
              <div className="animate-pulse space-y-3">
                <div className="h-4 w-32 bg-app-hover rounded-full" />
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-16 bg-app-hover rounded-2xl" />
                  <div className="h-16 bg-app-hover rounded-2xl" />
                  <div className="h-16 bg-app-hover rounded-2xl" />
                </div>
              </div>
            </Card>
          ) : summary ? (
            <div className="grid grid-cols-3 gap-2">
              <Card className="text-center py-4">
                <div className="w-8 h-8 rounded-xl bg-mint-50 dark:bg-mint-500/12 flex items-center justify-center mx-auto mb-2">
                  <TrendingUp className="w-4 h-4 text-mint-500" />
                </div>
                <p className="text-[10px] text-app-subtle font-medium">Pemasukan</p>
                <p className="text-sm font-bold text-mint-600 dark:text-mint-400 mt-0.5">
                  {formatCurrency(summary.totalIncome)}
                </p>
              </Card>
              <Card className="text-center py-4">
                <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-500/12 flex items-center justify-center mx-auto mb-2">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                </div>
                <p className="text-[10px] text-app-subtle font-medium">Pengeluaran</p>
                <p className="text-sm font-bold text-red-600 dark:text-red-400 mt-0.5">
                  {formatCurrency(summary.totalExpense)}
                </p>
              </Card>
              <Card className="text-center py-4">
                <div className="w-8 h-8 rounded-xl bg-primary-50 dark:bg-primary-500/12 flex items-center justify-center mx-auto mb-2">
                  <Wallet className="w-4 h-4 text-primary-500" />
                </div>
                <p className="text-[10px] text-app-subtle font-medium">Net</p>
                <p className={cn(
                  'text-sm font-bold mt-0.5',
                  summary.balance >= 0 ? 'text-mint-600 dark:text-mint-400' : 'text-red-600 dark:text-red-400'
                )}>
                  {formatCurrency(Math.abs(summary.balance))}
                </p>
              </Card>
            </div>
          ) : (
            <Card className="text-center py-6">
              <p className="text-sm text-app-muted">Belum ada transaksi bulan ini.</p>
              <Button variant="ghost" size="sm" onClick={() => navigate('/transactions')} className="mt-2">
                Tambah Transaksi
              </Button>
            </Card>
          )}
        </div>

        {/* Stats */}
        {summary && summary.transactionCount > 0 && (
          <Card>
            <div className="grid grid-cols-3 divide-x divide-app-border">
              <div className="text-center px-2 py-1">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Receipt className="w-3 h-3 text-primary-500" />
                </div>
                <p className="text-lg font-black text-app-text">{summary.transactionCount}</p>
                <p className="text-[10px] text-app-subtle">Transaksi</p>
              </div>
              <div className="text-center px-2 py-1">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <PieChart className="w-3 h-3 text-amber-500" />
                </div>
                <p className="text-sm font-bold text-app-text truncate">{summary.topCategory || '-'}</p>
                <p className="text-[10px] text-app-subtle">Top Kategori</p>
              </div>
              <div className="text-center px-2 py-1">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Flame className="w-3 h-3 text-orange-500" />
                </div>
                <p className="text-lg font-black text-app-text">{new Date().getDate()}</p>
                <p className="text-[10px] text-app-subtle">Hari bulan ini</p>
              </div>
            </div>
          </Card>
        )}

        {/* Quick Actions */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-app-subtle uppercase tracking-wider px-1">
            Akses Cepat
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <QuickActionCard
              icon={<Settings className="w-4 h-4" />}
              label="Pengaturan"
              onClick={() => navigate('/settings')}
            />
            <QuickActionCard
              icon={<Mail className="w-4 h-4" />}
              label="Gmail Sync"
              onClick={() => navigate('/gmail-sync')}
            />
            <QuickActionCard
              icon={<Scan className="w-4 h-4" />}
              label="Scan Bukti"
              onClick={() => navigate('/transactions')}
            />
            <QuickActionCard
              icon={<HelpCircle className="w-4 h-4" />}
              label="Bantuan"
              onClick={() => navigate('/privacy')}
            />
          </div>
        </div>

        {/* Logout */}
        <Button
          variant="outline"
          fullWidth
          icon={<LogOut className="w-4 h-4" />}
          onClick={() => setShowLogoutConfirm(true)}
          className="border-red-200 dark:border-red-400/25 text-red-500 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
        >
          Keluar
        </Button>

        <p className="text-[10px] text-app-subtle text-center">
          CashFlow v1.0.0
        </p>
      </div>

      {/* Logout confirm modal */}
      <Modal isOpen={showLogoutConfirm} onClose={() => setShowLogoutConfirm(false)} title="Keluar" maxWidth="sm">
        <div className="space-y-4 text-center">
          <p className="text-sm text-app-muted">Apakah kamu yakin ingin keluar?</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" fullWidth onClick={() => setShowLogoutConfirm(false)}>
              Batal
            </Button>
            <Button variant="danger" size="sm" fullWidth loading={loggingOut} onClick={handleLogout}>
              Keluar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Logout Success Overlay */}
      <Modal isOpen={logoutSuccess} onClose={() => undefined} maxWidth="sm">
        <SuccessFeedbackOverlay
          title="Logout berhasil"
          description="Sampai ketemu lagi di CashFlow."
          detail="Sesi kamu sudah ditutup dengan aman."
        >
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
              setLogoutSuccess(false);
              setLoggingOut(false);
              setLogoutAnimationActive(false);
              navigate('/login', { replace: true });
            }}
            className="mt-2"
          >
            Ke halaman login
          </Button>
        </SuccessFeedbackOverlay>
      </Modal>
    </div>
  );
}

function QuickActionCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-app-border bg-app-surface/40 hover:bg-app-hover/70 transition-all text-left group"
    >
      <div className="w-8 h-8 rounded-xl bg-app-hover/80 flex items-center justify-center text-app-muted group-hover:text-primary-500 transition-colors">
        {icon}
      </div>
      <span className="text-sm font-medium text-app-text">{label}</span>
      <ArrowRight className="w-3.5 h-3.5 text-app-subtle ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
