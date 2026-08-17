/**
 * ReconciliationPage (P2.6) — Assisted Ledger Reconciliation · /reconciliation
 *
 * Workflow (mandate P2.6 §7): Accounts → Opening Balance → Transaction
 * Reconciliation → Transfer Reconciliation → Balance Verification → VERIFIED.
 *
 * Prinsip finansial (P2.6 §4, §60):
 *  - Frontend TIDAK menghitung financial authority — semua angka dari API
 *    canonical (GET /api/reconciliation/state), hanya merender hasil.
 *  - Tidak ada auto-assign: klasifikasi (termasuk "Terima semua HIGH")
 *    hanya diterapkan bila suggestion punya accountId nyata + user confirm.
 *  - Verifikasi saldo nyata TANPA auto-fix: mismatch ditampilkan, tidak
 *    dibuatkan adjustment.
 *  - UNKNOWN adalah hasil yang jujur — jangan pernah menampilkan Rp0 karangan.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Landmark,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Link2,
  Wallet,
  ArrowRightLeft,
  CalendarDays,
  Sparkles,
  AlertTriangle,
  Plus,
  X,
} from 'lucide-react';
import { cn, formatCurrency, formatSigned, formatDate } from '../../lib/utils';
import {
  getReconciliationState,
  classifyBySuggestion,
  classifyTransactionsBulk,
  rejectBySuggestion,
  pairTransfer,
  rejectTransferCandidate,
  verifyAccountBalance,
  reassignTransaction,
} from '../../services/reconciliationService';
import { saveWalletAccount } from '../../services/professionalSuiteService';
import { useAuthStore } from '../../store/useAuthStore';
import type {
  ReconciliationState,
  TransferPairCandidate,
  AccountSuggestionGroup,
  WalletAccountType,
} from '../../types';
import type { VerifyBalanceResult } from '../../services/reconciliationService';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';

const STATUS_META: Record<string, { label: string; badge: string; icon: 'ok' | 'warn' }> = {
  verified: { label: 'Terverifikasi', badge: 'bg-mint-50 dark:bg-mint-500/12 text-mint-700 dark:text-mint-300', icon: 'ok' },
  reconciled: { label: 'Terekonsiliasi', badge: 'bg-mint-50 dark:bg-mint-500/12 text-mint-700 dark:text-mint-300', icon: 'ok' },
  partial: { label: 'Sebagian', badge: 'bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300', icon: 'warn' },
  unknown: { label: 'Belum dimulai', badge: 'bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300', icon: 'warn' },
};

const CONFIDENCE_META: Record<string, { label: string; badge: string }> = {
  high: { label: 'Tinggi', badge: 'bg-mint-50 dark:bg-mint-500/12 text-mint-700 dark:text-mint-300' },
  medium: { label: 'Sedang', badge: 'bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  low: { label: 'Rendah', badge: 'bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300' },
};

const STEP_LABELS = [
  'Rekening',
  'Saldo awal',
  'Transaksi',
  'Transfer',
  'Verifikasi',
];

function StatBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'neutral' }) {
  return (
    <div className="rounded-2xl p-4 app-surface">
      <p className="text-xs text-app-muted">{label}</p>
      <p className={cn(
        'mt-1 text-xl sm:text-2xl font-extrabold tabular-nums',
        tone === 'ok' ? 'text-mint-600 dark:text-mint-300'
          : tone === 'warn' ? 'text-amber-700 dark:text-amber-300'
            : 'text-app-text',
      )}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-app-subtle">{sub}</p>}
    </div>
  );
}

function ProgressBar({ state }: { state: ReconciliationState }) {
  const { completedSteps, totalSteps } = state.onboardingProgress;
  const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  // P2.9 §28 — completion score deterministik dari state (bukan klik user).
  const score = state.completionScore?.score ?? 0;
  const sc = state.completionScore;
  return (
    <Card className="mb-3">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h2 className="text-sm font-bold text-app-text">Rekonsiliasi Keuangan</h2>
        <span className="text-xs font-bold text-app-text tabular-nums" aria-label={`Skor penyelesaian ${score} persen`}>
          {score}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Skor penyelesaian rekonsiliasi"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        className="h-2 rounded-full bg-app-border overflow-hidden mb-3"
      >
        <div className="h-full rounded-full bg-mint-500 dark:bg-mint-400 transition-all duration-300" style={{ width: `${score}%` }} />
      </div>
      {/* Rincian skor — jujur, angka dari DB (mandat §27/§28). */}
      {sc && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-app-muted mb-3">
          <li>
            Rekening: <strong className="text-app-text">{sc.accounts.activated}/{sc.accounts.detected}</strong> aktif
          </li>
          <li>
            Saldo terverifikasi: <strong className="text-app-text">{sc.anchors.anchored}/{sc.anchors.total}</strong> rekening
          </li>
          <li>
            Transaksi terhubung: <strong className="text-app-text">{sc.transactions.linked}/{sc.transactions.total}</strong>
          </li>
          <li>
            Transfer terselesaikan: <strong className="text-app-text">{sc.transfers.resolved}/{sc.transfers.total}</strong>
          </li>
        </ul>
      )}
      {/* P3.0 §28 — indikator langkah eksplisit "N / 5" (bukan hanya bar). */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-app-text">
          Langkah {Math.min(completedSteps + 1, totalSteps)} / {totalSteps}
        </p>
        <p className="text-xs text-app-subtle" aria-hidden="true">
          {completedSteps === totalSteps ? 'Selesai' : 'Berikutnya: ' + STEP_LABELS[Math.min(completedSteps, totalSteps - 1)]}
        </p>
      </div>
      <div className="flex gap-1.5 mb-2" role="list" aria-label={`Progres langkah ${completedSteps} dari ${totalSteps}`}>
        {STEP_LABELS.map((label, i) => {
          const done = i < completedSteps;
          return (
            <div key={label} role="listitem" className="flex-1">
              <div className={cn(
                'h-1.5 rounded-full',
                done ? 'bg-mint-500 dark:bg-mint-400' : 'bg-app-border',
              )} />
              <p className={cn('mt-1 text-[10px] leading-tight text-center', done ? 'text-app-text' : 'text-app-subtle')}>
                {label}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-app-muted">
        {state.balanceConfidence === 'verified'
          ? 'Seluruh saldo rekening terverifikasi terhadap saldo nyata.'
          : state.balanceConfidence === 'high'
            ? 'Data lengkap dan semua transaksi terhubung — verifikasi saldo nyata untuk menyelesaikan.'
            : state.balanceConfidence === 'medium'
              ? 'Beberapa transaksi/transfer masih perlu ditinjau.'
              : state.balanceConfidence === 'low'
                ? 'Saldo awal belum lengkap — isi saldo awal tiap rekening.'
                : 'Belum ada rekening — tambahkan rekening dan saldo awal untuk memulai.'}
      </p>
    </Card>
  );
}

function inferAccountType(name: string): WalletAccountType {
  const n = name.toLowerCase();
  if (n.includes('dana') || n.includes('shopeepay') || n.includes('gopay') || n.includes('ovo')) return 'e-wallet';
  if (n.includes('bank') || n.includes('line') || n.includes('krom') || n.includes('blu')) return 'bank';
  return 'other';
}

function AccountSection({ state, onMutated }: { state: ReconciliationState; onMutated: () => void }) {
  const authUser = useAuthStore((s) => s.authUser);
  const [actualInputs, setActualInputs] = useState<Record<string, string>>({});
  const [anchorDates, setAnchorDates] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  // P3.1 §19 — result menyimpan waterfall kuantitatif (breakdown) untuk panel mismatch.
  const [result, setResult] = useState<Record<string, { status: string; difference: number; breakdown?: VerifyBalanceResult['breakdown'] }>>({});
  // P2.8 §4/§9 — aktivasi akun dari kandidat terdeteksi (own_accounts).
  const [activating, setActivating] = useState<string | null>(null);
  const [activatingName, setActivatingName] = useState('');
  const [activatingType, setActivatingType] = useState<WalletAccountType>('bank');
  const [activatingError, setActivatingError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const verify = async (accountId: string) => {
    const raw = actualInputs[accountId];
    if (raw === undefined || raw === '') return;
    const actual = Number(raw);
    if (!Number.isFinite(actual)) return;
    setVerifyingId(accountId);
    try {
      // P2.8 §10: tanggal saldo aktual dipilih USER (semantik END-OF-DAY),
      // default hari ini — bukan hardcode diam-diam.
      const date = anchorDates[accountId] || new Date().toISOString().slice(0, 10);
      const res = await verifyAccountBalance(accountId, actual, date);
      setResult((prev) => ({
        ...prev,
        [accountId]: { status: res.status, difference: res.difference, breakdown: res.breakdown },
      }));
      onMutated();
    } finally {
      setVerifyingId(null);
    }
  };

  const openActivation = (candidate: string) => {
    setActivating(candidate);
    setActivatingName(candidate);
    setActivatingType(inferAccountType(candidate));
    setActivatingError(null);
  };

  const createActivatedAccount = async () => {
    const name = activatingName.trim();
    if (!name) {
      setActivatingError('Nama rekening wajib diisi.');
      return;
    }
    setCreating(true);
    setActivatingError(null);
    try {
      await saveWalletAccount(authUser?.uid ?? 'unknown', {
        name,
        type: activatingType,
        institution: '',
        balance: 0,
        color: '#8b5cf6',
        currency: 'IDR',
        // P2.9 §41: idempoten — nama sama + user sama → id existing (tanpa duplikat).
        activation: true,
      });
      setActivating(null);
      onMutated();
    } catch (err) {
      setActivatingError(err instanceof Error ? err.message : 'Gagal membuat rekening.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card className="mb-3">
      <div className="mb-3 flex items-center gap-3">
        <Landmark className="h-5 w-5 text-primary-600 dark:text-primary-300" />
        <h2 className="text-sm font-bold text-app-text">Rekening &amp; verifikasi saldo</h2>
      </div>
      {state.accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-app-border p-4">
          <p className="text-xs text-app-subtle mb-3">
            CashFlow mendeteksi akun milik Anda dari riwayat transaksi. Aktifkan hanya rekening/e-wallet
            yang benar-benar Anda gunakan — pembuatan rekening adalah keputusan eksplisit Anda.
          </p>
          {state.accountCandidates.length > 0 ? (
            <ul className="space-y-2">
              {state.accountCandidates.map((candidate) => (
                <li key={candidate} className="flex items-center justify-between gap-2 rounded-2xl bg-app-hover/50 p-2.5">
                  <span className="text-sm font-semibold text-app-text truncate">{candidate}</span>
                  <Button variant="outline" size="sm" onClick={() => openActivation(candidate)}>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Tambahkan Rekening
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-app-subtle mb-3">
              Belum ada kandidat akun terdeteksi. Tambahkan rekening dan saldo awal dari menu{' '}
              <Link to="/settings" className="font-semibold text-primary-600 dark:text-primary-300 underline">
                Pengaturan → Saldo Awal Rekening
              </Link>{' '}
              untuk memulai rekonsiliasi.
            </p>
          )}
          <Link to="/settings">
            <Button variant="primary" size="sm">Atur rekening &amp; saldo awal</Button>
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {state.accounts.map((account) => {
            const v = result[account.id];
            const statusLabel = account.verificationStatus === 'verified'
              ? 'Saldo terverifikasi'
              : account.verificationStatus === 'mismatch'
                ? 'Tidak cocok'
                : 'Belum diverifikasi';
            return (
              <li key={account.id} className="rounded-2xl bg-app-hover/50 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-app-text truncate">{account.name}</span>
                    <span className="text-xs text-app-muted">{account.currency}</span>
                  </div>
                  <span className={cn(
                    'text-xs font-semibold px-2.5 py-1 rounded-full',
                    account.verificationStatus === 'verified'
                      ? 'bg-mint-50 dark:bg-mint-500/12 text-mint-700 dark:text-mint-300'
                      : account.verificationStatus === 'mismatch'
                        ? 'bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300'
                        : 'bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300',
                  )}>
                    {statusLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm mb-3">
                  <div>
                    <p className="text-xs text-app-muted">Saldo terverifikasi (anchor)</p>
                    <p className="tabular-nums font-semibold text-app-text">
                      {account.realBalance !== null ? formatSigned(account.realBalance) : 'Belum diisi'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-app-muted">Tanggal anchor</p>
                    <p className="text-app-text">{account.realBalanceDate ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-app-muted">Saldo sistem (post-anchor)</p>
                    <p className="tabular-nums font-semibold text-app-text">
                      {account.systemBalance !== null ? formatSigned(account.systemBalance) : 'Belum dapat dihitung'}
                    </p>
                  </div>
                </div>
                {v && v.status === 'verified' && (
                  <p className="mb-2 text-xs font-semibold text-mint-600 dark:text-mint-300">
                    {v.difference === null
                      ? '✓ Saldo aktual diterima sebagai titik referensi.'
                      : '✓ Cocok dengan saldo sistem.'}
                  </p>
                )}
                {v && v.status === 'mismatch' && (
                  <div className="mb-2 rounded-2xl border border-rose-200 dark:border-rose-500/25 bg-rose-50/60 dark:bg-rose-500/8 p-3">
                    <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                      Tidak cocok — selisih {formatSigned(v.difference ?? 0)}. Tidak ada koreksi otomatis.
                    </p>
                    {/* P3.0 §18 — daftar "Kemungkinan penyebab" (bukan klaim pasti),
                        difilter oleh evidence nyata dari state rekonsiliasi. */}
                    {/* P3.1 §19 — waterfall kuantitatif (evidence nyata, non-overlapping;
                        kontribusi yang tak terukur TIDAK dibuatkan angka palsu). */}
                    {v.breakdown && (
                      <div className="mt-2 rounded-xl bg-app-surface/80 p-2.5">
                        <p className="text-xs font-bold text-app-text">Rincian selisih (waterfall)</p>
                        <ul className="mt-1 space-y-0.5 text-xs text-app-muted tabular-nums">
                          {v.breakdown.unclassifiedAmount !== 0 && (
                            <li className="flex justify-between gap-2">
                              <span>Transaksi belum tertaut (semua rekening)</span>
                              <span>{formatSigned(v.breakdown.unclassifiedAmount)}</span>
                            </li>
                          )}
                          {v.breakdown.unresolvedTransferAmount !== 0 && (
                            <li className="flex justify-between gap-2">
                              <span>Transfer belum dipasangkan (semua rekening)</span>
                              <span>{formatSigned(v.breakdown.unresolvedTransferAmount)}</span>
                            </li>
                          )}
                          {v.breakdown.postAnchorMovements && (
                            <li className="flex justify-between gap-2">
                              <span>Pergerakan setelah anchor (rekening ini)</span>
                              <span>
                                +{formatCurrency(v.breakdown.postAnchorMovements.inflow + v.breakdown.postAnchorMovements.incomingTransfer)}
                                {' '}− {formatCurrency(v.breakdown.postAnchorMovements.expense + v.breakdown.postAnchorMovements.outgoingTransfer)}
                              </span>
                            </li>
                          )}
                          {v.breakdown.unclassifiedAmount === 0 && v.breakdown.unresolvedTransferAmount === 0 && (
                            <li>Kontribusi eksternal tidak terukur dari data saat ini.</li>
                          )}
                        </ul>
                      </div>
                    )}
                    <p className="mt-2 text-xs font-bold text-app-text">Kemungkinan penyebab</p>
                    <ul className="mt-1 space-y-1 text-xs text-app-muted">
                      {state.transactions.unlinked > 0 && (
                        <li>
                          · {state.transactions.unlinked} transaksi belum terhubung ke rekening (
                          {formatCurrency(state.transactions.unlinkedAmount)}) — belum ikut dalam saldo sistem.
                        </li>
                      )}
                      {state.transfers.ungrouped > 0 && (
                        <li>
                          · {state.transfers.ungrouped} transfer belum dipasangkan — bisa mengubah saldo antar rekening.
                        </li>
                      )}
                      {state.accountCandidates.length > 0 && (
                        <li>
                          · {state.accountCandidates.length} rekening terdeteksi belum diaktifkan — transaksinya
                          belum dapat dihitung.
                        </li>
                      )}
                      <li>· Saldo aktual atau tanggal anchor yang dimasukkan mungkin belum tepat.</li>
                      <li>· Transaksi di luar rentang anchor (sebelum tanggal saldo) tidak ikut dihitung.</li>
                      <li>· Transaksi Gmail yang belum tersinkron, atau entri ganda yang belum terdeteksi.</li>
                      <li>· Transaksi tunai (cash) yang tidak tercatat di sistem.</li>
                    </ul>
                    <p className="mt-2 text-xs text-app-subtle">
                      Periksa transaksi yang hilang, klasifikasi, dan pasangan transfer — sistem tidak memilihkan
                      penyebab pasti tanpa bukti.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="min-w-0">
                    <span className="block text-xs text-app-subtle mb-1">Saldo aktual (Rp)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={actualInputs[account.id] ?? ''}
                      onChange={(e) => setActualInputs((prev) => ({ ...prev, [account.id]: e.target.value }))}
                      placeholder="Saldo menurut bank/e-wallet"
                      className="w-full rounded-2xl px-3 py-2 text-sm app-field"
                      aria-label={`Saldo aktual ${account.name}`}
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="block text-xs text-app-subtle mb-1">Saldo ini berlaku per tanggal (akhir hari)</span>
                    <input
                      type="date"
                      value={anchorDates[account.id] ?? new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setAnchorDates((prev) => ({ ...prev, [account.id]: e.target.value }))}
                      className="w-full rounded-2xl px-3 py-2 text-sm app-field"
                      aria-label={`Tanggal saldo aktual ${account.name}`}
                    />
                  </label>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={verifyingId === account.id}
                    disabled={verifyingId !== null || !(actualInputs[account.id] ?? '').trim()}
                    onClick={() => verify(account.id)}
                  >
                    Tandai terverifikasi
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* P2.8 §4/§9 — aktivasi akun kandidat (pembuatan TETAP aksi eksplisit;
          tipe default di-inferensi dari nama, user bisa ubah sebelum simpan). */}
      {activating && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="activation-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-app-elevated p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 id="activation-title" className="text-sm font-bold text-app-text">Aktifkan rekening</h3>
                <p className="text-xs text-app-muted mt-0.5">
                  Rekening dibuat dengan saldo awal kosong — masukkan saldo aktual pada langkah verifikasi.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActivating(null)}
                aria-label="Tutup dialog"
                className="rounded-lg p-1.5 text-app-muted hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <label className="block mb-3">
              <span className="block text-xs text-app-subtle mb-1">Nama rekening</span>
              <input
                type="text"
                value={activatingName}
                onChange={(e) => setActivatingName(e.target.value)}
                className="w-full rounded-2xl px-3 py-2 text-sm app-field"
                aria-label="Nama rekening"
              />
            </label>
            <label className="block mb-3">
              <span className="block text-xs text-app-subtle mb-1">Jenis rekening</span>
              <select
                value={activatingType}
                onChange={(e) => setActivatingType(e.target.value as WalletAccountType)}
                className="w-full rounded-2xl px-3 py-2 text-sm app-field"
                aria-label="Jenis rekening"
              >
                <option value="bank">Bank</option>
                <option value="e-wallet">E-wallet</option>
                <option value="cash">Tunai</option>
                <option value="credit">Kartu kredit</option>
                <option value="investment">Investasi</option>
                <option value="other">Lainnya</option>
              </select>
            </label>
            <p className="text-xs text-app-muted mb-4">
              Mata uang: <strong className="text-app-text">IDR</strong> — agregasi lintas mata uang ditolak.
            </p>
            {activatingError && <p className="mb-3 text-xs font-semibold text-rose-700 dark:text-rose-300">{activatingError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setActivating(null)} disabled={creating}>
                Batal
              </Button>
              <Button variant="primary" size="sm" loading={creating} onClick={createActivatedAccount}>
                Tambahkan Rekening
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function SuggestionSection({ state, onMutated }: { state: ReconciliationState; onMutated: () => void }) {
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<AccountSuggestionGroup | null>(null);
  // P2.8 §13 [Abaikan] — tolak saran kelompok (deterministik, mirror accept).
  const [confirmReject, setConfirmReject] = useState<AccountSuggestionGroup | null>(null);
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // P2.9 §12 — transaksi LOW tanpa sinyal akun: pilih manual (bulk), TANPA menebak.
  // P3.0 §12 — filter jenis (All/Income/Expense/Refund) agar checklist 37+ item
  // tidak menjadi dinding checkbox; transfer tidak muncul (jalurnya pairing).
  const [manualTypeFilter, setManualTypeFilter] = useState<'all' | 'income' | 'expense' | 'refund'>('all');
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set());
  const [manualAccountId, setManualAccountId] = useState('');
  const [manualApplying, setManualApplying] = useState(false);
  const [manualConfirm, setManualConfirm] = useState<{ count: number; total: number } | null>(null);

  // P3.0 §12 — daftar LOW ter-filter; `unassigned` dihitung dari state (defensif).
  const unassigned = state.unassignedTransactions ?? [];
  const filteredUnassigned = unassigned.filter((t) =>
    manualTypeFilter === 'all' || t.type === manualTypeFilter
  );
  // Saat filter berubah, pilihan yang tidak terlihat ikut dihapus — "Terapkan (N)"
  // hanya menghitung item yang benar-benar tampil, tidak ada aksi tersembunyi.
  const toggleTypeFilter = (next: 'all' | 'income' | 'expense' | 'refund') => {
    setManualTypeFilter(next);
    setManualSelected(new Set());
  };

  const toggleOne = (id: string) => {
    setManualSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setManualSelected((prev) =>
      prev.size === filteredUnassigned.length && filteredUnassigned.length > 0
        ? new Set()
        : new Set(filteredUnassigned.map((t) => t.id))
    );
  };
  const openManualConfirm = () => {
    const sel = filteredUnassigned.filter((t) => manualSelected.has(t.id));
    if (!manualAccountId || sel.length === 0) return;
    setManualConfirm({ count: sel.length, total: sel.reduce((sum, t) => sum + t.amount, 0) });
  };
  const applyManual = async () => {
    if (!manualAccountId) return;
    const sel = unassigned.filter((t) => manualSelected.has(t.id));
    setManualApplying(true);
    try {
      // Klien hanya mengirim (transactionId, accountId) — ownership & account
      // existence diverifikasi server (user-scoped); idempoten per baris.
      const res = await classifyTransactionsBulk(
        sel.map((t) => ({ transactionId: t.id, accountId: manualAccountId }))
      );
      setMessage(res.applied > 0 ? `${res.applied} transaksi dihubungkan ke rekening.` : 'Tidak ada perubahan.');
      setManualSelected(new Set());
      setManualAccountId('');
      onMutated();
    } finally {
      setManualApplying(false);
      setManualConfirm(null);
    }
  };

  const acceptAll = async (group: AccountSuggestionGroup) => {
    if (!group.accountId) return;
    // LOW selalu ber-suggestedAccountId null — grup dengan tombol pasti high/medium.
    const confidence = group.confidence === 'low' ? 'high' : group.confidence;
    setAcceptingKey(`${group.accountName}|${group.confidence}`);
    try {
      // Server-side deterministic: engine re-evaluasi setiap transaksi pending
      // dan HANYA mengklasifikasikan yang suggestion-nya cocok persis dengan
      // (accountId, confidence) — klien tidak mengirim daftar transaksi.
      const res = await classifyBySuggestion(group.accountId, confidence);
      setMessage(res.applied > 0 ? `${res.applied} transaksi diklasifikasikan.` : 'Tidak ada perubahan (sudah diklasifikasikan).');
      onMutated();
    } finally {
      setAcceptingKey(null);
      setConfirmBulk(null);
    }
  };

  const rejectAll = async (group: AccountSuggestionGroup) => {
    if (!group.accountId) return;
    const confidence = group.confidence === 'low' ? 'high' : group.confidence;
    setRejectingKey(`${group.accountName}|${group.confidence}`);
    try {
      // Saran ditandai rejected — transaksi TIDAK diubah, hanya tidak
      // disarankan ulang (suggestion ≠ truth; kejujuran §12 P2.8).
      const res = await rejectBySuggestion(group.accountId, confidence);
      setMessage(res.rejected > 0
        ? `${res.rejected} transaksi ditandai "perlu ditinjau lain waktu".`
        : 'Tidak ada perubahan (sudah ditolak/terklasifikasi).');
      onMutated();
    } finally {
      setRejectingKey(null);
      setConfirmReject(null);
    }
  };

  const needsAccountCreation = state.suggestions.some((s) => !s.accountId && s.confidence === 'high');

  return (
    <Card className="mb-3">
      <div className="mb-3 flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-primary-600 dark:text-primary-300" />
        <h2 className="text-sm font-bold text-app-text">Saran klasifikasi transaksi</h2>
      </div>
      {message && <p className="mb-3 text-xs font-semibold text-mint-600 dark:text-mint-300">{message}</p>}
      {state.transactions.rejected > 0 && (
        <p className="mb-3 text-xs text-app-subtle">
          {state.transactions.rejected} transaksi telah Anda tandai untuk ditinjau lain waktu — tidak disarankan ulang,
          tidak pernah diubah nominalnya.
        </p>
      )}
      {needsAccountCreation && (
        <div className="mb-3 rounded-2xl border border-amber-200 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-500/8 p-3">
          <p className="text-xs text-app-text">
            Beberapa merchant cocok dengan akun milik sendiri yang belum dibuat sebagai rekening.
            Buat rekeningnya dulu (Pengaturan → Saldo Awal Rekening) agar transaksi bisa dihubungkan.
          </p>
        </div>
      )}
      {state.suggestions.length === 0 ? (
        <p className="text-xs text-app-subtle">
          {state.transactions.unlinked === 0
            ? 'Semua transaksi sudah terhubung ke rekening.'
            : 'Tidak ada saran klasifikasi untuk transaksi yang tersisa.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {state.suggestions.map((group) => {
            const meta = CONFIDENCE_META[group.confidence] ?? CONFIDENCE_META.low;
            const key = `${group.accountName ?? 'none'}|${group.confidence}`;
            return (
              <li key={key} className="rounded-2xl bg-app-hover/50 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-app-text truncate">
                      {group.accountName ?? 'Belum ada saran akun'}
                    </span>
                    <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', meta.badge)}>
                      Confidence: {meta.label}
                    </span>
                  </div>
                  <span className="text-xs text-app-muted tabular-nums">
                    {group.count} transaksi · {formatCurrency(group.totalAmount)}
                  </span>
                </div>
                {group.accountId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={group.confidence === 'high' ? 'primary' : 'outline'}
                      size="sm"
                      loading={acceptingKey === key}
                      onClick={() => setConfirmBulk(group)}
                    >
                      <Link2 className="w-4 h-4" aria-hidden="true" />
                      {group.confidence === 'high' ? `Terima semua (${group.count})` : `Hubungkan (${group.count})`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={rejectingKey === key}
                      disabled={acceptingKey !== null}
                      onClick={() => setConfirmReject(group)}
                    >
                      Abaikan ({group.count})
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-app-muted">
                    Buat rekening <strong>{group.accountName}</strong> dulu untuk menghubungkan transaksi ini.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* P2.9 §12 — transaksi LOW (tanpa sinyal akun kuat): pilih manual, jangan tebak. */}
      {unassigned.length > 0 && (
        <div className="mt-4 rounded-2xl bg-app-hover/50 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-app-text">Belum dapat ditentukan</h3>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300">
                {unassigned.length} transaksi
              </span>
            </div>
            <span className="text-xs text-app-muted tabular-nums">
              {formatSigned(unassigned.reduce((s, t) => s + t.amount, 0))}
            </span>
          </div>
          <p className="text-xs text-app-muted mb-2">
            Transaksi ini tidak memiliki sinyal akun yang cukup kuat. Pilih rekening secara manual — sistem tidak
            menebak ke rekening mana transaksi ini harus masuk.
          </p>
          {state.accounts.length === 0 ? (
            <p className="text-xs text-app-subtle">
              Tambahkan rekening terlebih dahulu (Pengaturan → Saldo Awal Rekening) untuk menghubungkan transaksi ini.
            </p>
          ) : (
            <>
              {/* P3.0 §12 — filter jenis: daftar panjang tetap bisa dikerjakan
                  sebagian; transfer tidak ada di sini (alurnya pairing). */}
              <div role="group" aria-label="Filter jenis transaksi" className="flex flex-wrap items-center gap-1.5 mb-2">
                {([['all', 'Semua'], ['income', 'Pemasukan'], ['expense', 'Pengeluaran'], ['refund', 'Refund']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleTypeFilter(value)}
                    aria-pressed={manualTypeFilter === value}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      manualTypeFilter === value
                        ? 'bg-primary-600 text-white'
                        : 'bg-app-surface text-app-muted hover:bg-app-hover',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <label htmlFor="manual-account" className="text-xs font-medium text-app-text">
                  Pilih rekening:
                </label>
                <select
                  id="manual-account"
                  value={manualAccountId}
                  onChange={(e) => setManualAccountId(e.target.value)}
                  className="rounded-xl border border-app-border bg-app-surface px-2.5 py-1.5 text-xs text-app-text"
                >
                  <option value="">— Pilih rekening —</option>
                  {state.accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  loading={manualApplying}
                  disabled={!manualAccountId || manualSelected.size === 0}
                  onClick={openManualConfirm}
                >
                  Terapkan ({manualSelected.size})
                </Button>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-medium text-primary-600 dark:text-primary-300"
                >
                  {manualSelected.size === filteredUnassigned.length && filteredUnassigned.length > 0 ? 'Batalkan semua' : 'Pilih semua'}
                </button>
              </div>
              {filteredUnassigned.length === 0 ? (
                <p className="text-xs text-app-subtle">Tidak ada transaksi pada filter ini.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto rounded-xl border border-app-border divide-y divide-app-border/70">
                  {filteredUnassigned.map((tx) => (
                    <li key={tx.id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <input
                        type="checkbox"
                        checked={manualSelected.has(tx.id)}
                        onChange={() => toggleOne(tx.id)}
                        aria-label={`Pilih ${tx.merchant || 'transaksi'} ${formatCurrency(tx.amount)}`}
                        className="accent-mint-500"
                      />
                      <span className="flex-1 min-w-0 text-xs text-app-text truncate">{tx.merchant || 'Transaksi'}</span>
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-app-subtle hidden sm:inline">
                        {tx.type}
                      </span>
                      <span className="text-xs text-app-muted tabular-nums hidden sm:inline">{formatDate(tx.date)}</span>
                      <span className="text-xs font-semibold text-app-text tabular-nums">{formatCurrency(tx.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* Konfirmasi tolak saran (§13 P2.8) — saran ≠ truth; penolakan hanya
          menghentikan sugesti, TIDAK mengubah transaksi. */}
      {confirmReject && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-app-elevated p-5 shadow-xl">
            <h3 id="reject-confirm-title" className="text-sm font-bold text-app-text mb-2">
              Abaikan {confirmReject.count} saran untuk "{confirmReject.accountName}"?
            </h3>
            <p className="text-xs text-app-muted mb-4">
              Transaksi tidak akan dihubungkan dan tidak disarankan ulang ke rekening ini. Nominal, tanggal, dan
              jenis transaksi TIDAK diubah — Anda dapat menghubungkannya secara manual kapan saja.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmReject(null)}>
                Batal
              </Button>
              <Button variant="danger" size="sm" loading={rejectingKey !== null} onClick={() => rejectAll(confirmReject)}>
                Abaikan Saran
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi dampak finansial sebelum bulk (§23 P2.6) — tidak menyembunyikan impact. */}
      {confirmBulk && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-app-elevated p-5 shadow-xl">
            <h3 id="bulk-confirm-title" className="text-sm font-bold text-app-text mb-2">
              Klasifikasikan {confirmBulk.count} transaksi ke "{confirmBulk.accountName}"?
            </h3>
            <p className="text-xs text-app-muted mb-2">
              Dampak perkiraan ke rekonsiliasi: <strong className="text-app-text">{formatSigned(confirmBulk.totalAmount)}</strong>{' '}
              (jumlah nominal transaksi dalam grup). Ini mengubah bagaimana saldo saat ini disusun ulang.
            </p>
            <p className="text-xs text-app-muted mb-4">
              Hanya transaksi dengan sinyal identik ({confirmBulk.confidence === 'high' ? 'merchant cocok eksak' : 'kecocokan sedang'}) yang
              diklasifikasikan. Tidak ada transaksi yang diubah nominalnya.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmBulk(null)}>
                Batal
              </Button>
              <Button variant="primary" size="sm" loading={acceptingKey !== null} onClick={() => acceptAll(confirmBulk)}>
                Konfirmasi
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* P2.9 §12 — konfirmasi dampak finansial sebelum assign manual (tidak
          pernah blind-commit; jumlah & total tampil eksplisit). */}
      {manualConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-app-elevated p-5 shadow-xl">
            <h3 id="manual-confirm-title" className="text-sm font-bold text-app-text mb-2">
              Hubungkan {manualConfirm.count} transaksi secara manual?
            </h3>
            <p className="text-xs text-app-muted mb-2">
              Rekening: <strong className="text-app-text">{state.accounts.find((a) => a.id === manualAccountId)?.name ?? manualAccountId}</strong>
            </p>
            <p className="text-xs text-app-muted mb-4">
              Total dampak: <strong className="text-app-text">{formatSigned(manualConfirm.total)}</strong>. Transaksi historis
              tidak dihapus atau diubah nominalnya — hanya ditautkan ke rekening ini.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setManualConfirm(null)}>
                Batal
              </Button>
              <Button variant="primary" size="sm" loading={manualApplying} onClick={applyManual}>
                Konfirmasi
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function LinkedSection({ state, onMutated }: { state: ReconciliationState; onMutated: () => void }) {
  // P3.1 §21 — CORRECTION FLOW: transaksi tertaut bisa dipindah ke rekening lain
  // secara EKSPLISIT (reassign). Tidak pernah mengubah nominal/type/date/merchant;
  // audit account_reassigned menyimpan old/new account. Idempoten: akun sama → no-op.
  const linked = state.linkedTransactions ?? [];
  const [reassignTarget, setReassignTarget] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ id: string; merchant: string; amount: number; from: string; toId: string; toName: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const doReassign = async () => {
    if (!confirming) return;
    setApplying(true);
    try {
      const res = await reassignTransaction(confirming.id, confirming.toId);
      setMessage(res.applied > 0
        ? 'Penautan transaksi diperbarui (audit account_reassigned).'
        : 'Tidak ada perubahan (rekening tujuan sama / transaksi tidak ditemukan).');
      setConfirming(null);
      setReassignTarget({});
      onMutated();
    } finally {
      setApplying(false);
    }
  };

  if (linked.length === 0) return null;

  return (
    <Card className="mb-3">
      <div className="mb-3 flex items-center gap-3">
        <Link2 className="h-5 w-5 text-primary-600 dark:text-primary-300" />
        <h2 className="text-sm font-bold text-app-text">Perbaiki penautan transaksi</h2>
      </div>
      <p className="text-xs text-app-subtle mb-2">
        Transaksi yang salah tertaut bisa dipindahkan ke rekening lain secara eksplisit — nominal, tanggal, dan
        jenis transaksi tidak pernah diubah. 100 transaksi terbaru ditampilkan.
      </p>
      {message && <p className="mb-3 text-xs font-semibold text-mint-600 dark:text-mint-300">{message}</p>}
      <ul className="max-h-72 overflow-y-auto rounded-xl border border-app-border divide-y divide-app-border/70">
        {linked.map((tx) => (
          <li key={tx.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2">
            <span className="flex-1 min-w-0">
              <span className="block text-xs text-app-text truncate">{tx.merchant || 'Transaksi'}</span>
              <span className="text-[10px] text-app-muted">{formatDate(tx.date)} · {tx.type}</span>
            </span>
            <span className="text-xs font-semibold text-app-text tabular-nums">{formatCurrency(tx.amount)}</span>
            <span className="text-xs text-app-muted">→ <strong className="text-app-text">{tx.accountName || tx.accountId}</strong></span>
            <select
              value={reassignTarget[tx.id] ?? ''}
              onChange={(e) => setReassignTarget((prev) => ({ ...prev, [tx.id]: e.target.value }))}
              aria-label={`Pindahkan ${tx.merchant || 'transaksi'} ke rekening`}
              className="rounded-xl border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text"
            >
              <option value="">— Pindah ke… —</option>
              {state.accounts
                .filter((a) => a.id !== tx.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={!reassignTarget[tx.id]}
              onClick={() => {
                const targetId = reassignTarget[tx.id];
                const targetAcct = state.accounts.find((a) => a.id === targetId);
                setConfirming({
                  id: tx.id,
                  merchant: tx.merchant || 'Transaksi',
                  amount: tx.amount,
                  from: tx.accountName || tx.accountId,
                  toId: targetId,
                  toName: targetAcct?.name ?? targetId,
                });
              }}
            >
              Ubah rekening
            </Button>
          </li>
        ))}
      </ul>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reassign-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-app-elevated p-5 shadow-xl">
            <h3 id="reassign-confirm-title" className="text-sm font-bold text-app-text mb-2">
              Pindahkan "{confirming.merchant}" ({formatCurrency(confirming.amount)})?
            </h3>
            <p className="text-xs text-app-muted mb-4">
              Dari <strong className="text-app-text">{confirming.from}</strong> ke{' '}
              <strong className="text-app-text">{confirming.toName}</strong>. Nominal, tanggal, jenis transaksi, dan
              Gmail message ID tidak diubah — hanya penautan rekening (tercatat di audit).
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={applying}>
                Batal
              </Button>
              <Button variant="primary" size="sm" loading={applying} onClick={doReassign}>
                Konfirmasi
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function TransferSection({ state, onMutated }: { state: ReconciliationState; onMutated: () => void }) {
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // P2.8 §17 [Reject] — tolak kandidat tanpa auto-pair.
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<TransferPairCandidate | null>(null);

  const pair = async (candidate: TransferPairCandidate) => {
    setPairingId(`${candidate.transferId}|${candidate.incomeId}`);
    try {
      const res = await pairTransfer(candidate.transferId, candidate.incomeId);
      setMessage(res.ok
        ? 'Pasangan transfer dikonfirmasi (netral terhadap total).'
        : `Gagal: ${res.error ?? 'unknown'}`);
      onMutated();
    } finally {
      setPairingId(null);
    }
  };

  const rejectCandidate = async (candidate: TransferPairCandidate) => {
    const key = `${candidate.transferId}|${candidate.incomeId}`;
    setRejectingKey(key);
    try {
      const res = await rejectTransferCandidate(candidate.transferId);
      setMessage(res.ok
        ? 'Kandidat diabaikan — transfer tetap belum dipasangkan (tidak ada asumsi otomatis).'
        : `Gagal: ${res.error ?? 'unknown'}`);
      onMutated();
    } finally {
      setRejectingKey(null);
      setConfirmReject(null);
    }
  };

  return (
    <Card className="mb-3">
      <div className="mb-3 flex items-center gap-3">
        <ArrowRightLeft className="h-5 w-5 text-primary-600 dark:text-primary-300" />
        <h2 className="text-sm font-bold text-app-text">Transfer antar rekening</h2>
      </div>
      {message && <p className="mb-3 text-xs font-semibold text-app-text">{message}</p>}
      {state.transfers.total === 0 ? (
        <p className="text-xs text-app-subtle">Tidak ada transaksi transfer.</p>
      ) : state.transfers.ungrouped === 0 ? (
        <p className="text-xs text-app-subtle">
          Semua {state.transfers.total} transfer sudah dipasangkan ({state.transfers.grouped} resolved).
        </p>
      ) : (
        <p className="text-xs text-app-subtle mb-3">
          {state.transfers.ungrouped} transfer belum dipasangkan. Kandidat pasangan di bawah dihasilkan
          deterministik (tanggal + nominal + merchant, one-to-one) — konfirmasi manual tetap diperlukan.
        </p>
      )}
      {state.transferPairSuggestions.length > 0 && (
        <ul className="space-y-2">
          {state.transferPairSuggestions.map((candidate) => (
            <li key={`${candidate.transferId}|${candidate.incomeId}`} className="rounded-2xl bg-app-hover/50 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-app-text tabular-nums">
                    {formatCurrency(candidate.amount)}
                  </p>
                  <p className="text-xs text-app-muted truncate">
                    Transfer {candidate.transferDate} ↔ Pemasukan {candidate.incomeDate}
                    {candidate.merchant ? ` · ${candidate.merchant}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={pairingId === `${candidate.transferId}|${candidate.incomeId}`}
                    disabled={rejectingKey !== null}
                    onClick={() => pair(candidate)}
                  >
                    Pasangkan
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pairingId !== null}
                    onClick={() => setConfirmReject(candidate)}
                  >
                    Abaikan
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* P2.8 §17 — konfirmasi tolak kandidat (tanpa auto-pair). */}
      {confirmReject && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-reject-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-app-elevated p-5 shadow-xl">
            <h3 id="transfer-reject-title" className="text-sm font-bold text-app-text mb-2">
              Abaikan kandidat transfer {formatCurrency(confirmReject.amount)}?
            </h3>
            <p className="text-xs text-app-muted mb-4">
              Transfer tetap dicatat sebagai belum dipasangkan — kandidat ini tidak akan disarankan ulang.
              Anda dapat memasangkannya secara manual kapan saja.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmReject(null)}>
                Batal
              </Button>
              <Button variant="danger" size="sm" loading={rejectingKey !== null} onClick={() => rejectCandidate(confirmReject)}>
                Abaikan Kandidat
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ReconciliationPage() {
  const [state, setState] = useState<ReconciliationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getReconciliationState();
      setState(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data rekonsiliasi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const onMutated = () => setRefreshKey((k) => k + 1);

  if (loading && !state) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary-600 dark:text-primary-300" aria-hidden="true" />
        <span className="sr-only">Memuat data rekonsiliasi…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorState title="Gagal memuat rekonsiliasi" error={error} onRetry={load} />
      </div>
    );
  }

  if (!state) return null;

  const statusMeta = STATUS_META[state.balanceConfidence === 'verified' ? 'verified' : state.status] ?? STATUS_META.unknown;
  const StatusIcon = statusMeta.icon === 'ok' ? ShieldCheck : ShieldAlert;

  return (
    <div className="p-4 sm:p-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300">
            <Wallet className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-app-text">Rekonsiliasi Rekening</h1>
            <p className="text-xs text-app-muted">
              Hubungkan transaksi ke rekening dan verifikasi saldo nyata — tanpa mengubah angka transaksi.
            </p>
          </div>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full', statusMeta.badge)}>
          <StatusIcon className="w-4 h-4" aria-hidden="true" />
          {statusMeta.label}
        </span>
      </div>

      <ProgressBar state={state} />

      {/* Statistik */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
        <StatBox label="Rekening" value={String(state.accounts.length)} sub={`${state.openingBalancesConfigured}/${state.accounts.length} saldo awal`} />
        <StatBox
          label="Transaksi"
          value={String(state.transactions.total)}
          sub={`${state.transactions.linked} terhubung`}
          tone={state.transactions.unlinked > 0 ? 'warn' : 'ok'}
        />
        <StatBox
          label="Belum terhubung"
          value={String(state.transactions.unlinked)}
          sub={formatCurrency(state.transactions.unlinkedAmount)}
          tone={state.transactions.unlinked > 0 ? 'warn' : 'ok'}
        />
        <StatBox
          label="Transfer"
          value={String(state.transfers.total)}
          sub={`${state.transfers.grouped} dipasangkan`}
          tone={state.transfers.ungrouped > 0 ? 'warn' : 'ok'}
        />
        <StatBox
          label="Belum dipasangkan"
          value={String(state.transfers.ungrouped)}
          tone={state.transfers.ungrouped > 0 ? 'warn' : 'ok'}
        />
        <StatBox
          label="Cakupan data"
          value={state.dateCoverage.earliest ? state.dateCoverage.earliest.slice(0, 7) : '—'}
          sub={state.dateCoverage.latest ? `s.d. ${state.dateCoverage.latest.slice(0, 7)}` : undefined}
        />
      </div>

      <AccountSection state={state} onMutated={onMutated} />
      <SuggestionSection state={state} onMutated={onMutated} />
      {/* P3.1 §21 — correction flow: reassign eksplisit transaksi tertaut. */}
      <LinkedSection state={state} onMutated={onMutated} />
      <TransferSection state={state} onMutated={onMutated} />

      {/* Catatan kejujuran finansial */}
      <div className="rounded-2xl border border-app-border p-4 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-app-muted" aria-hidden="true" />
          <h2 className="text-xs font-bold text-app-text">Tentang saldo ini</h2>
        </div>
        <p className="text-xs text-app-muted leading-relaxed">
          Saldo Saat Ini di dashboard hanya dihitung dari rekening dengan saldo awal terisi. Transaksi yang belum
          terhubung ke rekening tidak ikut dihitung — jumlahnya ditampilkan transparan di atas. Rekonsiliasi tidak
          pernah mengubah nominal, tanggal, atau jenis transaksi; jika saldo sistem tidak cocok dengan saldo nyata,
          sistem tidak membuat penyesuaian otomatis.
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-app-muted mb-6">
        <CalendarDays className="w-4 h-4" aria-hidden="true" />
        Cakupan transaksi: {state.dateCoverage.earliest ?? '—'} → {state.dateCoverage.latest ?? '—'} · Zona waktu Asia/Jakarta
      </div>

      {state.status !== 'verified' && (
        <EmptyState
          icon={<CheckCircle2 className="w-8 h-8" />}
          title={state.status === 'unknown' ? 'Mulai rekonsiliasi dari rekening Anda' : 'Selesaikan rekonsiliasi'}
          description={
            state.status === 'unknown'
              ? 'Tambahkan rekening dan saldo awal di Pengaturan, lalu kembali ke sini untuk menghubungkan transaksi.'
              : 'Tinjau saran klasifikasi, pasangkan transfer, lalu verifikasi saldo nyata setiap rekening.'
          }
          action={
            <Link to="/settings">
              <Button variant="outline" size="sm">Buka Pengaturan</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
