/**
 * AutoSyncStatus — Komponen status Sinkronisasi Otomatis
 *
 * Menampilkan:
 * - Status Auto Sync (aktif/nonaktif)
 * - Last sync / Next sync
 * - History sync progress
 * - Riwayat sinkronisasi (sync runs)
 * - Mode background sync info
 */

import { useEffect, useState } from 'react';
import {
  Shield,
  CheckCircle,
  AlertCircle,
  Loader2,
  History,
  RefreshCw,
  Calendar,
  Clock,
} from 'lucide-react';
import Card from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import {
  getGmailSyncSettings,
  toggleAutoSync,
  updateLastSyncResult,
  GmailSyncSettings,
} from '../../services/gmailSyncSettingsService';
import {
  getSyncRuns,
  GmailSyncRun,
} from '../../services/gmailSyncRunService';

interface AutoSyncStatusProps {
  userId: string;
  gmailSyncEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export default function AutoSyncStatus({
  userId,
  gmailSyncEnabled,
  onToggle,
}: AutoSyncStatusProps) {
  const [settings, setSettings] = useState<GmailSyncSettings | null>(null);
  const [syncRuns, setSyncRuns] = useState<GmailSyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!userId) return;
    loadSettings();
    loadSyncRuns();
  }, [userId]);

  const loadSettings = async () => {
    const s = await getGmailSyncSettings(userId);
    if (s) setSettings(s);
  };

  const loadSyncRuns = async () => {
    const runs = await getSyncRuns(userId, 10);
    setSyncRuns(runs);
  };

  const handleToggle = async () => {
    const newEnabled = !gmailSyncEnabled;
    setLoading(true);
    try {
      const interval = settings?.syncIntervalMinutes || 60;
      await toggleAutoSync(userId, newEnabled, interval);
      await loadSettings();
      onToggle(newEnabled);
    } catch (err) {
      console.error('[AutoSync] Toggle failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleIntervalChange = async (interval: number) => {
    if (!gmailSyncEnabled) return;
    setLoading(true);
    try {
      await toggleAutoSync(userId, true, interval);
      await loadSettings();
    } catch (err) {
      console.error('[AutoSync] Interval change failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const lastRun = syncRuns[0];
  const historyLastRun = syncRuns.find((r) => r.syncType === 'initial_history');
  const historyCompleted = settings?.historySyncCompleted;

  return (
    <Card>
      <div className="space-y-3">
        {/* Header: Toggle + Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-app-subtle" />
            <div>
              <p className="text-sm font-medium text-app-text">
                Sinkronisasi Otomatis
              </p>
              <p className="text-xs text-app-subtle">
                Scan email transaksi secara berkala saat aplikasi aktif
              </p>
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={loading}
            className={cn(
              'relative w-11 h-6 rounded-full transition-colors duration-200',
              gmailSyncEnabled ? 'bg-primary-500' : 'bg-app-hover',
              loading && 'opacity-50 cursor-not-allowed'
            )}
          >
            <div className={cn(
              'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200',
              gmailSyncEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            )} />
          </button>
        </div>

        {/* Status Info Grid */}
        {gmailSyncEnabled && (
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="p-2 rounded-lg bg-app-hover/60">
              <span className="text-app-subtle">Interval</span>
              <div className="flex items-center gap-2 mt-0.5">
                <select
                  value={settings?.syncIntervalMinutes || 60}
                  onChange={(e) => handleIntervalChange(parseInt(e.target.value, 10))}
                  className="text-[10px] font-medium text-app-text bg-transparent border border-app-hover rounded px-1 py-0.5"
                >
                  <option value={15}>15 menit</option>
                  <option value={30}>30 menit</option>
                  <option value={60}>1 jam</option>
                  <option value={360}>6 jam</option>
                  <option value={1440}>24 jam</option>
                </select>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-app-hover/60">
              <span className="text-app-subtle">Status</span>
              <p className="font-medium text-mint-500 mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 inline-block" />
                Aktif
              </p>
            </div>
            <div className="p-2 rounded-lg bg-app-hover/60">
              <span className="text-app-subtle flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Terakhir Scan
              </span>
              <p className="font-medium text-app-text mt-0.5">
                {settings?.lastSyncedAt
                  ? new Date(settings.lastSyncedAt).toLocaleString('id-ID', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })
                  : 'Belum pernah'}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-app-hover/60">
              <span className="text-app-subtle flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Scan Berikutnya
              </span>
              <p className="font-medium text-app-text mt-0.5">
                {settings?.nextSyncAt
                  ? new Date(settings.nextSyncAt).toLocaleString('id-ID', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })
                  : '-'}
              </p>
            </div>
          </div>
        )}

        {!gmailSyncEnabled && (
          <div className="p-2 rounded-lg bg-app-hover/60 text-[10px]">
            <span className="text-app-subtle">Status</span>
            <p className="font-medium text-app-muted mt-0.5">
              Nonaktif — Aktifkan untuk scan berkala saat aplikasi aktif
            </p>
          </div>
        )}

        {/* Mode Background Info */}
        <div className="p-2 rounded-lg bg-primary-50 dark:bg-primary-500/8 border border-primary-100 dark:border-primary-500/15 text-[10px]">
          <p className="text-primary-600 dark:text-primary-300 font-medium">
            {gmailSyncEnabled ? 'Auto Sync Aktif (Aplikasi Aktif)' : 'Auto Sync'}
          </p>
          <p className="text-primary-500 dark:text-primary-400 mt-0.5">
            Auto Sync saat ini berjalan saat aplikasi aktif. Scan di latar belakang
            tanpa membuka aplikasi tidak lagi didukung (fitur Edge Function dihapus).{' '}
            <a
              href="/docs/gmail-sync/GMAIL_BACKGROUND_SYNC_SETUP.md"
              className="underline hover:no-underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              (panduan setup)
            </a>.
          </p>
        </div>

        {/* History Sync Status */}
        <div className="p-2 rounded-lg bg-app-hover/60 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-app-subtle">Sinkronisasi Riwayat</span>
            {historyCompleted ? (
              <span className="flex items-center gap-1 text-mint-500 font-medium">
                <CheckCircle className="w-3 h-3" />
                Selesai
              </span>
            ) : historyLastRun?.status === 'running' ? (
              <span className="flex items-center gap-1 text-amber-500 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                Sedang Berjalan
              </span>
            ) : historyLastRun?.status === 'partial_failed' ? (
              <span className="flex items-center gap-1 text-amber-500 font-medium">
                <AlertCircle className="w-3 h-3" />
                Gagal Sebagian
              </span>
            ) : (
              <span className="text-app-muted">Belum dimulai</span>
            )}
          </div>
          {historyLastRun && (
            <p className="text-app-muted mt-0.5">
              {historyLastRun.totalProcessed} email diproses,{' '}
              {historyLastRun.pendingReviewCount} pending review,{' '}
              {historyLastRun.failedCount} gagal
              {' · '}
              {new Date(historyLastRun.startedAt).toLocaleDateString('id-ID', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
        </div>

        {/* Riwayat Sinkronisasi Toggle */}
        {syncRuns.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 text-[10px] text-app-subtle hover:text-app-text transition-colors"
            >
              <History className="w-3 h-3" />
              {showHistory ? 'Sembunyikan Riwayat' : `Riwayat Sinkronisasi (${syncRuns.length})`}
            </button>

            {showHistory && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {syncRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between p-1.5 rounded-lg bg-app-hover/40 text-[10px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        run.status === 'completed' ? 'bg-mint-500' :
                        run.status === 'running' ? 'bg-blue-500 animate-pulse' :
                        run.status === 'partial_failed' ? 'bg-amber-500' :
                        run.status === 'failed' ? 'bg-red-500' :
                        'bg-app-subtle'
                      )} />
                      <span className="font-medium text-app-text">
                        {run.syncType === 'initial_history' ? 'Riwayat Awal' :
                         run.syncType === 'auto_background' ? 'Auto Sync' :
                         run.syncType === 'manual' ? 'Manual' :
                         run.syncType === 'retry_failed' ? 'Retry Failed' :
                         run.syncType}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-app-subtle">
                      <span>{run.totalProcessed} email</span>
                      {run.pendingReviewCount > 0 && (
                        <span className="text-amber-500">{run.pendingReviewCount} pending</span>
                      )}
                      <span>
                        {new Date(run.startedAt).toLocaleDateString('id-ID', {
                          day: 'numeric', month: 'short',
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Hasil Terakhir */}
        {lastRun && (
          <div className="p-2 rounded-lg bg-app-hover/60 text-[10px]">
            <span className="text-app-subtle">Hasil Terakhir</span>
            <p className="font-medium text-app-text mt-0.5">
              {lastRun.pendingReviewCount > 0
                ? `${lastRun.pendingReviewCount} menunggu review`
                : 'Tidak ada transaksi baru'}
              {lastRun.skippedCount > 0 && ` · ${lastRun.skippedCount} dilewati`}
              {lastRun.failedCount > 0 && ` · ${lastRun.failedCount} gagal`}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
