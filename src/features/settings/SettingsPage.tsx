import { useState, useRef, useEffect } from 'react';
import {
  Bell, Download, Moon, Sun, Monitor, RefreshCw,
  ShieldCheck, WalletCards, Trash2, Shield,
} from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import SuccessFeedbackOverlay from '../../components/ui/SuccessFeedbackOverlay';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { downloadTransactionsCSV, getAllTransactions } from '../../services/transactionService';
import { resetUserData } from '../../services/resetService';
import { cn } from '../../lib/utils';
import type { ThemeMode } from '../../types';

export default function SettingsPage() {
  const { authUser } = useAuthStore();
  const {
    theme,
    setTheme,
    gmailSyncEnabled,
    setGmailSyncEnabled,
    gmailAutoConfirm,
    setGmailAutoConfirm,
    defaultCurrency,
    setDefaultCurrency,
    addToast,
  } = useAppStore();
  const [exporting, setExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: React.ReactNode }> = [
    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
  ];

  const handleExport = async () => {
    if (!authUser) return;
    setExporting(true);
    try {
      const transactions = await getAllTransactions(authUser.uid);
      downloadTransactionsCSV(transactions);
      addToast({ type: 'success', title: 'CSV berhasil dibuat', message: `${transactions.length} transaksi diexport.` });
    } catch (error) {
      addToast({ type: 'error', title: 'Export gagal', message: error instanceof Error ? error.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  const requestNotification = async () => {
    if (!('Notification' in window)) {
      addToast({ type: 'warning', title: 'Browser belum mendukung notifikasi' });
      return;
    }
    const permission = await Notification.requestPermission();
    addToast({
      type: permission === 'granted' ? 'success' : 'warning',
      title: permission === 'granted' ? 'Notifikasi aktif' : 'Notifikasi belum diizinkan',
    });
  };

  const handleDeleteAllData = async () => {
    if (!authUser) return;
    setDeletingData(true);
    setDeleteSuccess(false);
    try {
      await resetUserData(authUser.uid);
      setDeleteSuccess(true);
      deleteTimerRef.current = setTimeout(() => {
        setShowDeleteConfirm(false);
        setDeleteSuccess(false);
        window.location.reload();
      }, 2000);
    } catch (error) {
      setDeleteSuccess(false);
      addToast({
        type: 'error',
        title: 'Gagal menghapus data',
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeletingData(false);
    }
  };

  return (
    <div>
      <Header title="Pengaturan" />

      <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
        {/* Header */}
        <Card className="fintech-surface">
          <h2 className="font-display text-2xl font-bold text-app-text">Pengaturan</h2>
          <p className="mt-1 text-sm text-app-muted">
            Atur tampilan, sinkronisasi, data, dan preferensi aplikasi dari satu tempat.
          </p>
        </Card>

        {/* Tampilan & Mata Uang */}
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <WalletCards className="h-5 w-5 text-primary-500" />
            <h3 className="text-sm font-bold text-app-text">Tampilan & Mata Uang</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition',
                  theme === option.value
                    ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-400/30 dark:bg-primary-500/12 dark:text-primary-300'
                    : 'border-app-border bg-app-surface/40 text-app-muted hover:border-app-subtle hover:text-app-text'
                )}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <label className="text-xs font-semibold text-app-muted">Mata uang default</label>
            <select
              value={defaultCurrency}
              onChange={(event) => setDefaultCurrency(event.target.value)}
              className="mt-1 w-full rounded-2xl px-4 py-3 text-sm app-field sm:w-56"
            >
              {['IDR', 'USD', 'SGD', 'MYR'].map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>
        </Card>

        {/* Gmail Automation */}
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-mint-500" />
            <h3 className="text-sm font-bold text-app-text">Gmail Automation</h3>
          </div>
          <ToggleRow title="Sinkronisasi Gmail" description="Aktifkan scan email transaksi relevan." enabled={gmailSyncEnabled} onToggle={() => setGmailSyncEnabled(!gmailSyncEnabled)} />
          <ToggleRow title="Auto-save confidence tinggi" description="Transaksi dengan confidence di atas 0.90 bisa otomatis disimpan." enabled={gmailAutoConfirm} onToggle={() => setGmailAutoConfirm(!gmailAutoConfirm)} />
        </Card>

        {/* Notifikasi */}
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <Bell className="h-5 w-5 text-amber-500" />
            <h3 className="text-sm font-bold text-app-text">Notifikasi</h3>
          </div>
          <p className="text-xs text-app-subtle mb-3">Aktifkan notifikasi browser untuk alert budget dan transaksi.</p>
          <Button variant="outline" size="sm" icon={<Bell className="h-4 w-4" />} onClick={requestNotification}>
            Aktifkan Notifikasi Browser
          </Button>
        </Card>

        {/* Data & Privasi */}
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <Shield className="h-5 w-5 text-blue-500" />
            <h3 className="text-sm font-bold text-app-text">Data & Privasi</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="text-sm font-medium text-app-text">Export Data</p>
                <p className="text-xs text-app-subtle">Download semua transaksi dalam format CSV</p>
              </div>
              <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={handleExport}>
                Export
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 py-2 border-t border-app-border">
              <div>
                <p className="text-sm font-medium text-app-text">Privasi & Izin</p>
                <p className="text-xs text-app-subtle">Data yang dibaca dan disimpan CashFlow</p>
              </div>
              <Button variant="outline" size="sm" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => window.location.assign('/privacy')}>
                Lihat
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 py-2 border-t border-app-border">
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Hapus Semua Data</p>
                <p className="text-xs text-app-subtle">Reset data transaksi, budget, dan kategori</p>
              </div>
              <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setShowDeleteConfirm(true)}>
                Hapus
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Delete data confirm modal */}
      <Modal isOpen={showDeleteConfirm} onClose={() => { if (!deleteSuccess && !deletingData) setShowDeleteConfirm(false); }} title={deleteSuccess ? undefined : "Hapus Semua Data"} maxWidth="sm">
        {deleteSuccess ? (
          <SuccessFeedbackOverlay
            title="Data berhasil dihapus"
            description="CashFlow kamu sudah kembali bersih."
            detail="Kamu bisa mulai mencatat transaksi baru kapan saja."
          >
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteSuccess(false);
                window.location.reload();
              }}
              className="mt-2"
            >
              Kembali ke Beranda
            </Button>
          </SuccessFeedbackOverlay>
        ) : (
          <div className="space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            <p className="text-sm text-app-muted">
              Semua data transaksi, budget, dan kategori akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" fullWidth onClick={() => setShowDeleteConfirm(false)}>
                Batal
              </Button>
              <Button variant="danger" size="sm" fullWidth loading={deletingData} onClick={handleDeleteAllData}>
                Hapus Semua
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-app-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-bold text-app-text">{title}</p>
        <p className="text-xs text-app-subtle">{description}</p>
      </div>
      <button
        onClick={onToggle}
        className={cn('relative h-7 w-12 rounded-full transition', enabled ? 'bg-primary-500' : 'bg-app-hover')}
      >
        <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition', enabled ? 'left-6' : 'left-1')} />
      </button>
    </div>
  );
}
