import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, Download, Moon, Sun, Monitor, RefreshCw,
  ShieldCheck, WalletCards, Trash2, Shield, Landmark,
} from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import SuccessFeedbackOverlay from '../../components/ui/SuccessFeedbackOverlay';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import { downloadTransactionsCSV, getAllTransactions } from '../../services/transactionService';
import { resetUserData } from '../../services/resetService';
import { getFinancialSettings, updateFinancialSettings } from '../../services/financialSettingsService';
import { getWalletAccounts, updateWalletAccount } from '../../services/professionalSuiteService';
import { cn } from '../../lib/utils';
import type { ThemeMode, WalletAccount } from '../../types';

export default function SettingsPage() {
  const authUser = useAuthStore((s) => s.authUser);
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
  } = useAppStore(
    useShallow((s) => ({
      theme: s.theme,
      setTheme: s.setTheme,
      gmailSyncEnabled: s.gmailSyncEnabled,
      setGmailSyncEnabled: s.setGmailSyncEnabled,
      gmailAutoConfirm: s.gmailAutoConfirm,
      setGmailAutoConfirm: s.setGmailAutoConfirm,
      defaultCurrency: s.defaultCurrency,
      setDefaultCurrency: s.setDefaultCurrency,
      addToast: s.addToast,
    })),
  );
  const [exporting, setExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  // Akun milik sendiri (transfer internal netral, §10.13)
  const [ownAccounts, setOwnAccounts] = useState<string[]>([]);
  const [ownAccountDraft, setOwnAccountDraft] = useState('');
  const [ownAccountsLoaded, setOwnAccountsLoaded] = useState(false);
  const [savingOwnAccounts, setSavingOwnAccounts] = useState(false);
  // P2.5 account-based ledger: saldo awal per rekening.
  const [walletAccounts, setWalletAccounts] = useState<WalletAccount[]>([]);
  const [walletsLoaded, setWalletsLoaded] = useState(false);
  const [savingWalletId, setSavingWalletId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  // Load rekening wallet untuk pengaturan saldo awal (P2.5, satu kali).
  useEffect(() => {
    if (!authUser || walletsLoaded) return;
    let cancelled = false;
    getWalletAccounts(authUser.uid)
      .then((rows) => {
        if (cancelled) return;
        setWalletAccounts(rows);
        setWalletsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setWalletsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser, walletsLoaded]);

  // Simpan saldo awal satu rekening (PUT /api/wallets/:id, partial update).
  const saveOpeningBalance = async (account: WalletAccount) => {
    if (!authUser) return;
    setSavingWalletId(account.id);
    try {
      await updateWalletAccount(authUser.uid, account.id, {
        openingBalance: account.openingBalance,
        openingBalanceDate: account.openingBalanceDate || null,
        currency: account.currency || 'IDR',
      });
      addToast({ type: 'success', title: 'Saldo awal disimpan', message: `${account.name} akan dipakai untuk menghitung Saldo Saat Ini.` });
    } catch {
      addToast({ type: 'error', title: 'Gagal menyimpan', message: 'Coba lagi sebentar.' });
    } finally {
      setSavingWalletId(null);
    }
  };

  // Load daftar akun milik sendiri (satu kali, setelah auth tersedia).
  useEffect(() => {
    if (!authUser || ownAccountsLoaded) return;
    let cancelled = false;
    getFinancialSettings()
      .then((settings) => {
        if (cancelled) return;
        setOwnAccounts(settings.ownAccounts);
      })
      .catch(() => {
        if (!cancelled) setOwnAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setOwnAccountsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser, ownAccountsLoaded]);

  const addOwnAccount = () => {
    const name = ownAccountDraft.trim();
    if (!name) return;
    if (ownAccounts.some((a) => a.toLowerCase() === name.toLowerCase())) {
      setOwnAccountDraft('');
      return; // duplikat (case-insensitive) — abaikan
    }
    setOwnAccounts((prev) => [...prev, name]);
    setOwnAccountDraft('');
  };

  const removeOwnAccount = (name: string) => {
    setOwnAccounts((prev) => prev.filter((a) => a !== name));
  };

  const saveOwnAccounts = async () => {
    if (!authUser) return;
    setSavingOwnAccounts(true);
    try {
      const saved = await updateFinancialSettings(ownAccounts);
      setOwnAccounts(saved.ownAccounts);
      addToast({
        type: 'success',
        title: 'Akun tersimpan',
        message: 'Transfer ke akun ini netral, dan pemasukan pasangannya tidak lagi menambah Total Saldo.',
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Gagal menyimpan akun',
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingOwnAccounts(false);
    }
  };

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

        {/* Akun Milik Sendiri — transfer internal netral */}
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <WalletCards className="h-5 w-5 text-violet-500" />
            <h3 className="text-sm font-bold text-app-text">Akun Milik Sendiri</h3>
          </div>
          <p className="text-xs text-app-subtle mb-3">
            Transfer antar-akun milik sendiri (mis. blu → LINE Bank) dihitung
            netral — tidak mengurangi Total Saldo. Pemasukan dari perpindahan
            dana antar-akun sendiri (hari & nominal sama) juga dinetralkan agar
            tidak menggandakan pendapatan. Daftarkan nama akun kamu di sini agar
            saldo mencerminkan kekayaan bersih.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {ownAccounts.length === 0 ? (
              <p className="text-xs text-app-subtle">
                Belum ada akun terdaftar — semua transfer dihitung sebagai pengeluaran.
              </p>
            ) : (
              ownAccounts.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-app-hover px-3 py-1.5 text-xs font-semibold text-app-text"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeOwnAccount(name)}
                    aria-label={`Hapus akun ${name}`}
                    className="text-app-muted hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={ownAccountDraft}
              onChange={(event) => setOwnAccountDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addOwnAccount();
                }
              }}
              placeholder="Nama akun (mis. LINE Bank)"
              className="min-w-0 flex-1 rounded-2xl px-4 py-2.5 text-sm app-field"
              aria-label="Nama akun milik sendiri"
            />
            <Button variant="outline" size="sm" onClick={addOwnAccount}>
              Tambah
            </Button>
            <Button variant="primary" size="sm" loading={savingOwnAccounts} onClick={saveOwnAccounts}>
              Simpan
            </Button>
          </div>
        </Card>

        {/* Saldo Awal Rekening — P2.5 account-based ledger */}
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Landmark className="h-5 w-5 text-primary-600 dark:text-primary-300" />
              <h3 className="text-sm font-bold text-app-text">Saldo Awal Rekening</h3>
            </div>
            {/* P2.6: CTA ke halaman rekonsiliasi (assisted classification +
                transfer pairing + verifikasi saldo nyata). */}
            <Link
              to="/reconciliation"
              className="inline-flex items-center gap-1.5 rounded-xl border-2 border-app-border px-3 py-1.5 text-xs font-semibold text-app-text hover:border-primary-500 hover:text-primary-600 dark:hover:border-primary-400 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg focus-visible:ring-primary-600"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Rekonsiliasi otomatis
            </Link>
          </div>
          <p className="text-xs text-app-subtle mb-3">
            Saldo Saat Ini di dashboard dihitung dari <strong>saldo awal</strong> tiap
            rekening ditambah seluruh pergerakan transaksi yang terhubung ke
            rekening itu. Selama saldo awal belum diisi, sistem menampilkan
            "Belum dapat dihitung" — bukan menebak Rp0. Saldo awal = saldo pada
            awal hari tanggal yang kamu pilih; transaksi di tanggal yang sama
            ikut dihitung.
          </p>
          {!walletsLoaded ? (
            <p className="text-xs text-app-subtle">Memuat rekening…</p>
          ) : walletAccounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-app-border p-4">
              <p className="text-xs text-app-subtle mb-2">
                Belum ada rekening. Tambahkan rekening dari menu Profesional
                (Wealth) atau hubungkan transaksi ke rekening untuk saldo yang
                lengkap.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {walletAccounts.map((account) => (
                <li key={account.id} className="rounded-2xl bg-app-hover/50 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-semibold text-app-text">{account.name}</span>
                    <span className="text-xs text-app-muted">{account.currency}</span>
                  </div>
                  {/* P2.8 §29 — Saldo Aktual (verified balance anchor) per rekening:
                      status ringkas + CTA ke halaman rekonsiliasi. */}
                  <div className="mb-2 flex items-center justify-between gap-2 flex-wrap rounded-xl bg-app-surface/60 px-2.5 py-1.5 text-xs">
                    <span className="text-app-muted">
                      Saldo aktual:{' '}
                      {account.realBalance !== null && account.realBalance !== undefined
                        ? <strong className="tabular-nums text-app-text">{account.realBalance.toLocaleString('id-ID')}</strong>
                        : 'belum diisi'}
                      {account.realBalanceDate ? ` · per ${account.realBalanceDate}` : ''}
                    </span>
                    <Link
                      to="/reconciliation"
                      className="font-semibold text-primary-600 dark:text-primary-300 underline underline-offset-2 hover:text-primary-700"
                    >
                      {account.balanceAnchorStatus === 'verified'
                        ? '✓ Saldo terverifikasi — perbarui'
                        : account.balanceAnchorStatus === 'mismatch'
                          ? '⚠ Tidak cocok — periksa'
                          : 'Masukkan saldo aktual'}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="block text-xs text-app-subtle mb-1">Saldo awal (Rp)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={account.openingBalance === null ? '' : String(account.openingBalance)}
                        onChange={(event) => {
                          const v = event.target.value;
                          setWalletAccounts((prev) => prev.map((a) =>
                            a.id === account.id ? { ...a, openingBalance: v === '' ? null : Number(v) } : a,
                          ));
                        }}
                        placeholder="Kosong = belum diisi"
                        className="w-full rounded-2xl px-3 py-2 text-sm app-field"
                        aria-label={`Saldo awal ${account.name}`}
                      />
                    </label>
                    <label className="min-w-0 flex-1">
                      <span className="block text-xs text-app-subtle mb-1">Tanggal saldo awal</span>
                      <input
                        type="date"
                        value={account.openingBalanceDate || ''}
                        onChange={(event) => {
                          setWalletAccounts((prev) => prev.map((a) =>
                            a.id === account.id ? { ...a, openingBalanceDate: event.target.value || null } : a,
                          ));
                        }}
                        className="w-full rounded-2xl px-3 py-2 text-sm app-field"
                        aria-label={`Tanggal saldo awal ${account.name}`}
                      />
                    </label>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={savingWalletId === account.id}
                      disabled={savingWalletId !== null && savingWalletId !== account.id}
                      onClick={() => saveOpeningBalance(account)}
                    >
                      Simpan
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
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
