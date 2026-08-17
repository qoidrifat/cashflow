import { useState } from 'react';
import { AlertTriangle, Database, Download, KeyRound, MailCheck, Shield, Trash2 } from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import SuccessFeedbackOverlay from '../../components/ui/SuccessFeedbackOverlay';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { signOutUser } from '../../services/authService';
import { resetUserData } from '../../services/resetService';
import { exportUserData, deleteAccount } from '../../services/privacyService';

const DELETE_CONFIRMATION_PHRASE = 'DELETE';

/** Ambil pesan ramah dari error API (body JSON { message }) — fallback raw. */
function extractErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string };
    return parsed.message || parsed.error || raw;
  } catch {
    return raw;
  }
}

const sections = [
  {
    icon: MailCheck,
    title: 'Data Gmail yang Dibaca',
    body: 'Aplikasi hanya mencari email yang berpotensi berisi transaksi seperti bank, e-wallet, marketplace, QRIS, payment gateway, tagihan, cashback, refund, dan subscription.',
  },
  {
    icon: Database,
    title: 'Data yang Disimpan',
    body: 'CashFlow hanya menyimpan hasil ekstraksi transaksi: nominal, tanggal, merchant, kategori, metode pembayaran, sumber Gmail, messageId, dan confidence score. Isi email lengkap tidak disimpan.',
  },
  {
    icon: KeyRound,
    title: 'API Key & Token',
    body: 'Gemini API untuk production dipanggil lewat server proxy. API key sensitif tidak boleh di-hardcode di frontend production.',
  },
  {
    icon: Shield,
    title: 'Scope Minimum',
    body: 'OAuth Gmail wajib memakai scope seminimal mungkin dan user harus bisa memutus sinkronisasi Gmail kapan pun dari pengaturan.',
  },
  {
    icon: Trash2,
    title: 'Kontrol User',
    body: 'User memiliki opsi export data, hapus akun, reset data, disconnect Gmail, dan logout. Akses data dibatasi oleh autentikasi session berbasis user di server.',
  },
];

export default function PrivacyPage() {
  const addToast = useAppStore((s) => s.addToast);
  const authUser = useAuthStore((s) => s.authUser);
  const [exporting, setExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportUserData();
      addToast({
        type: 'success',
        title: 'Export selesai',
        message: `Salinan JSON data kamu siap (${(data.transactions || []).length} transaksi).`,
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Export gagal', message: extractErrorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmation !== DELETE_CONFIRMATION_PHRASE) return;
    setDeleting(true);
    try {
      await deleteAccount(confirmation);
      setDeleteSuccess(true);
      // Akun + sesi sudah dihapus di server. Bersihkan state lokal & redirect.
      try {
        await signOutUser();
      } catch {
        // cookie sesi sudah invalid (sesi dihapus server) — sign-out boleh gagal.
      }
      try {
        // Bersihkan cache lokal (localStorage) milik user — data server sudah
        // dihapus; tanpa ini salinan data user tertinggal di browser.
        if (authUser?.uid) resetUserData(authUser.uid);
      } catch {
        // noop
      }
      window.setTimeout(() => {
        window.location.assign('/');
      }, 900);
    } catch (error) {
      setDeleting(false);
      addToast({
        type: 'error',
        title: 'Gagal menghapus akun',
        message: extractErrorMessage(error),
      });
    }
  };

  const closeModal = () => {
    if (!deleting && !deleteSuccess) {
      setShowDeleteConfirm(false);
      setConfirmation('');
    }
  };

  return (
    <div>
      <Header title="Privasi & Izin" />

      <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
        <Card className="fintech-surface">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary-600 dark:text-primary-300">
              Permission brief
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold text-app-text">
              Gmail dibaca seperlunya, transaksi disimpan secukupnya.
            </h2>
            <p className="mt-3 text-sm leading-6 text-app-muted">
              Halaman ini menjelaskan batas data yang diproses agar integrasi Gmail dan Gemini tetap transparan, aman, dan sesuai kebutuhan aplikasi.
            </p>
          </div>
        </Card>

        {/* ===== Export My Data (P0.2) ===== */}
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-app-text">Export Data Saya</h3>
              <p className="mt-1 text-sm leading-6 text-app-muted">
                Download salinan JSON dari seluruh data pribadi kamu — transaksi, budget, AI memory, timeline, feedback, dan lainnya.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="h-4 w-4" />}
              loading={exporting}
              onClick={handleExport}
              className="shrink-0"
            >
              Export My Data
            </Button>
          </div>
        </Card>

        {/* ===== Delete My Account (P0.3) ===== */}
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-red-600 dark:text-red-400">Hapus Akun CashFlow</h3>
              <p className="mt-1 text-sm leading-6 text-app-muted">
                Ini menghapus akun kamu beserta seluruh data pribadi — transaksi, budget, AI memory, timeline, feedback, dan sesi — secara permanen.
                {' '}<span className="font-semibold text-app-text">Tindakan ini tidak dapat dibatalkan.</span>
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => setShowDeleteConfirm(true)}
              className="shrink-0"
            >
              Delete Account
            </Button>
          </div>
        </Card>

        <div className="grid gap-3">
          {sections.map((section) => (
            <Card key={section.title}>
              <div className="flex gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-900/25 dark:text-primary-300">
                  <section.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-app-text">{section.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-app-muted">{section.body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Delete account confirmation modal — dua langkah, non-destructive default */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={closeModal}
        title={deleteSuccess ? undefined : 'Hapus Akun CashFlow'}
        maxWidth="sm"
      >
        {deleteSuccess ? (
          <SuccessFeedbackOverlay
            title="Akun berhasil dihapus"
            description="Seluruh data kamu telah dihapus secara permanen."
            detail="Kamu akan dialihkan ke beranda."
          />
        ) : (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <p className="text-sm text-app-muted text-center">
              Ini menghapus akun dan semua data terkait secara permanen: transaksi, budget, AI memory, timeline, feedback, dan sesi login.
              {' '}<span className="font-bold text-red-600 dark:text-red-400">Tindakan ini tidak dapat dibatalkan.</span>
            </p>
            <div>
              <label className="text-xs font-semibold text-app-muted" htmlFor="delete-confirm-input">
                Ketik <span className="font-mono font-bold text-app-text">{DELETE_CONFIRMATION_PHRASE}</span> untuk konfirmasi
              </label>
              <input
                id="delete-confirm-input"
                type="text"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={DELETE_CONFIRMATION_PHRASE}
                autoComplete="off"
                className="mt-1 w-full rounded-2xl px-4 py-3 text-sm app-field"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" fullWidth onClick={closeModal}>
                Batal
              </Button>
              <Button
                variant="danger"
                size="sm"
                fullWidth
                loading={deleting}
                disabled={confirmation !== DELETE_CONFIRMATION_PHRASE}
                onClick={handleDeleteAccount}
              >
                Delete Account
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
