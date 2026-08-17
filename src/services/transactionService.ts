import { apiDelete, apiGet, apiPost, apiPut } from '../config/api';
import { logger } from '../lib/logger';
import { onSSE } from '../lib/sse';
import type { PaymentMethod, SortOption, Transaction, TransactionFormData, TransactionSource, TransactionSummary, TransactionType } from '../types';
import { mapTransaction } from './mappers';
import { triggerTransactionReviewNotification } from './notificationTriggers';

const localKey = (userId: string) => `cashflow-local-transactions-${userId}`;

// =============================================================================
// Registry gmail_message_id per-user (cross-tab) — 2026-08-11
// -----------------------------------------------------------------------------
// Menutup race lintas-tab yang tersisa di jalur fallback localStorage (§10.9):
// dua tab yang meng-import pesan gmail SAMA secara offline bisa sama-sama lolos
// cek findDuplicateTransaction lalu sama-sama menulis baris → 2 baris lokal.
//
// Registry ini adalah daftar gmail_message_id yang pernah diimport/di-claim
// oleh browser ini (per user, disimpan di localStorage → otomatis sinkron antar
// tab via storage event). Jalur fallback mengecek registry SEBELUM menulis;
// jika pesan sudah di-claim/dikonfirmasi tab lain, ia REPLAY id existing —
// bukan menulis baris kedua.
//
// BATAS jujur: claim read-modify-write di localStorage bukan atomic lintas-tab
// (tanpa Web Locks / BroadcastChannel — keduanya butuh worker/secure context).
// Guard yang dilakukan: claim-and-verify (nonce + timestamp) — dua tab yang
// berlomba menulis claim hampir bersamaan, yang LEBIH LAMA claim-nya menang
// dan satunya replay. Ini mengurangi window race ke urutan milidetik (bukan
// menghilangkan 100%) — dokumentasi lengkap di §10.9. Server tetap sumber
// kebenaran final (unique partial index (user_id, gmail_message_id) menolak
// duplikat ENFORCED di sisi server).
//
// Struktur storage: SATU localStorage key PER KLAIM.
//   key   : `cashflow-gmail-import-registry-<userId>-<encodeURIComponent(msgId)>::<nonce>`
//   value : JSON { nonce, at, confirmedTxId? }
//
// Mengapa satu key per klaim (bukan satu key berisi map)? localStorage
// setItem bersifat per-key — dua tab yang menulis KE KEY YANG SAMA saling
// menimpa (read-modify-write non-atomic → race). Dengan key PER KLAIM, write
// tab A (key nonce A) TIDAK PERNAH menimpa write tab B (key nonce B) → kedua
// tab selalu bisa membaca SEMUA klaim untuk satu msgId → aturan at-tertua
// meng-konvergenkan keduanya pada pemenang yang SAMA secara deterministik,
// bahkan saat dua tab membaca registry kosong BERSAMAAN.
//
// - nonce: identitas tab/klaim (random) — arbitrasi lintas-tab.
// - at: timestamp claim — klaim dengan at TERTUA menang saat berlomba.
// - confirmedTxId: id transaksi (server/local) setelah import selesai —
//   tab lain yang menemukan klaim terkonfirmasi REPLAY id tsb tanpa menulis.
//
// Backward-compat: format lama satu-key (`...registry-<userId>`, isi map
// msgId → klaim) dibaca juga bila ditemukan (dibuat hari ini 2026-08-11,
// belum pernah dirilis — dibaca untuk keamanan transisi).
interface GmailRegistryClaim {
  nonce: string;
  at: number;
  confirmedTxId?: string;
}

const GMAIL_REGISTRY_MAX_ENTRIES = 5000; // bounded — klaim lama dibuang duluan
// Berapa lama tab KALAH menunggu id final dari tab pemenang (klaim tab lain
// yang belum confirm). Diexport agar test BISA memendekkan jika diperlukan;
// test wait-loop saat ini memakai window nyata 800ms dengan confirm 150ms
// (loop menunggu dengan setTimeout 25ms — fake timers akan menggantung loop).
export const GMAIL_REGISTRY_WAIT_DEADLINE_MS = 800;

const gmailRegistryPrefix = (userId: string) => `cashflow-gmail-import-registry-${userId}-`;
const gmailRegistryLegacyKey = (userId: string) => `cashflow-gmail-import-registry-${userId}`;

function gmailRegistryClaimKey(userId: string, gmailMessageId: string, nonce: string): string {
  return `${gmailRegistryPrefix(userId)}${encodeURIComponent(gmailMessageId)}::${nonce}`;
}

/** Baca SEMUA klaim untuk satu gmailMessageId (format baru per-key + legacy). */
function readGmailRegistryClaims(userId: string, gmailMessageId: string): GmailRegistryClaim[] {
  const out: GmailRegistryClaim[] = [];
  const prefix = gmailRegistryPrefix(userId);
  const encoded = encodeURIComponent(gmailMessageId);
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const sep = rest.indexOf('::');
      if (sep < 0) continue;
      if (decodeURIComponent(rest.slice(0, sep)) !== gmailMessageId) continue;
      try {
        const claim = JSON.parse(localStorage.getItem(key) || 'null') as GmailRegistryClaim | null;
        if (claim && typeof claim.nonce === 'string') out.push(claim);
      } catch {
        // key korup — abaikan (best-effort).
      }
    }
    // Legacy satu-key.
    const legacyRaw = localStorage.getItem(gmailRegistryLegacyKey(userId));
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as Record<string, GmailRegistryClaim[] | GmailRegistryClaim>;
      if (parsed && typeof parsed === 'object') {
        const entry = parsed[gmailMessageId];
        if (entry) out.push(...(Array.isArray(entry) ? entry : [entry]));
      }
    }
  } catch {
    // storage tidak tersedia — registry kosong (backstop: cek store lokal + server).
  }
  return out;
}

function writeGmailRegistryClaim(userId: string, gmailMessageId: string, claim: GmailRegistryClaim): void {
  try {
    localStorage.setItem(gmailRegistryClaimKey(userId, gmailMessageId, claim.nonce), JSON.stringify(claim));
    pruneGmailRegistry(userId);
  } catch {
    // localStorage penuh / tidak tersedia — dedupe registry best-effort;
    // jalur lain (cek store lokal + server) tetap berjalan.
    logger.warn('[transactionService] gagal menulis registry gmail (best-effort dedupe lintas-tab dilewati)');
  }
}

/** Bounded: buang klaim terlama bila total klaim user melebihi cap. */
function pruneGmailRegistry(userId: string): void {
  try {
    const prefix = gmailRegistryPrefix(userId);
    const entries: Array<{ key: string; at: number }> = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      try {
        const claim = JSON.parse(localStorage.getItem(key) || 'null') as GmailRegistryClaim | null;
        if (claim) entries.push({ key, at: claim.at ?? 0 });
      } catch {
        // key korup — hitung sebagai paling tua (kandidat buang).
        entries.push({ key, at: 0 });
      }
    }
    if (entries.length <= GMAIL_REGISTRY_MAX_ENTRIES) return;
    const overflow = entries.length - GMAIL_REGISTRY_MAX_ENTRIES;
    entries
      .sort((a, b) => a.at - b.at)
      .slice(0, overflow)
      .forEach((e) => {
        try { localStorage.removeItem(e.key); } catch { /* noop */ }
      });
  } catch {
    // best-effort — tidak menghentikan alur claim.
  }
}

let gmailRegistryNonce = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Claim-AND-VERIFY gmail_message_id di registry (2026-08-11).
 *
 * Menutup race claim read-modify-write: claim polos (read → tulis tanpa
 * verify) membuat dua tab yang membaca registry kosong BERSAMAAN sama-sama
 * menganggap menang → keduanya menulis baris lokal (bug race §10.9 yang
 * justru ingin ditutup).
 *
 * Implementasi (satu key per klaim):
 *  - Pass 1: tulis klaim tab ini ke KEY SENDIRI (nonce unik) — tidak pernah
 *    menimpa klaim tab lain, apa pun urutan write/read antar tab.
 *  - Pass 2 (verify): baca SEMUA klaim untuk msgId (termasuk klaim tab lain
 *    yang ditulis sebelum/sesudah) → pilih klaim dengan at TERTUA sebagai
 *    pemenang (tie at sama: nonce terurut — deterministik).
 *
 * Karena semua tab membaca HIMPUNAN klaim yang sama (setItem per-key tidak
 * saling menimpa), aturan at-tertua meng-konvergenkan SEMUA tab pada pemenang
 * yang sama — tanpa loop re-claim. Race read-modify-write tertutup secara
 * fundamental (batas tersisa hanya storage event yang async, bukan kebenaran
 * arbitrasi).
 *
 * Return true = PEMANGGIL yang menang; false = tab lain menang.
 */
function claimGmailMessage(userId: string, gmailMessageId: string): boolean {
  // Pass 1: tulis (atau perbarui at) klaim tab ini — key sendiri, non-destruktif.
  writeGmailRegistryClaim(userId, gmailMessageId, { nonce: gmailRegistryNonce, at: Date.now() });
  // Pass 2: baca SEMUA klaim → klaim at tertua menang (tie: nonce terkecil).
  const allClaims = readGmailRegistryClaims(userId, gmailMessageId);
  if (allClaims.length === 0) {
    // Klaim sendiri tidak terbaca (storage di-clear / penuh) — anggap menang;
    // jalur lain (cek store lokal + server) tetap berjalan sebagai backstop.
    return true;
  }
  const oldest = allClaims.reduce<GmailRegistryClaim | null>((min, c) => {
    if (!min) return c;
    const a = c.at ?? 0;
    const b = min.at ?? 0;
    if (a !== b) return a < b ? c : min;
    return c.nonce < min.nonce ? c : min; // tie-break deterministik
  }, null);
  return !!oldest && oldest.nonce === gmailRegistryNonce;
}

/**
 * Tandai pesan yang SUDAH diimport dengan id transaksi final (server/lokal).
 * Menulis ulang klaim nonce tab ini + confirmedTxId (key sendiri — aman
 * terhadap klaim tab lain).
 */
function confirmGmailImport(userId: string, gmailMessageId: string, txId: string): void {
  writeGmailRegistryClaim(userId, gmailMessageId, {
    nonce: gmailRegistryNonce,
    at: Date.now(),
    confirmedTxId: txId,
  });
}

/** Cari transaksi di store lokal dengan gmailMessageId tertentu. */
function findLocalGmailTransaction(userId: string, gmailMessageId: string): Transaction | undefined {
  return readLocalTransactions(userId).find((t) => t.gmailMessageId === gmailMessageId);
}

/**
 * SATU helper dedupe gmail lokal (2026-08-11) — menormalkan divergensi
 * semantik §10.9: `findDuplicateTransaction` (cek klien) dan cabang fallback
 * `doAddTransaction` sebelumnya menggunakan DUA logika terpisah untuk
 * pertanyaan yang sama ("apakah pesan gmail ini sudah pernah diimport
 * lokal?"), sehingga kondisi logis sama bisa menghasilkan throw-vs-replay
 * yang berbeda. Helper ini menjadi SATU-SATUNYA sumber kebenaran untuk cek
 * "sudah ada di sisi lokal":
 *
 *   1. Store transaksi lokal (`readLocalTransactions`) — pesan yang ditulis
 *      offline sebelumnya / oleh tab lain.
 *   2. Registry cross-tab (`readGmailRegistryClaims`) — klaim tab lain yang
 *      SUDAH dikonfirmasi (`confirmedTxId`), walau barisnya tidak ada di
 *      store lokal (import sukses via server tab lain).
 *
 * Return: Transaction bila pesan sudah diimport lokal (caller REPLAY id-nya);
 * null bila belum — caller boleh melanjutkan menulis.
 *
 * CATATAN scope: helper ini HANYA untuk dedupe gmail_message_id. Duplikat
 * business-key non-gmail TETAP ditangani `findDuplicateTransaction` via
 * window server 100 (isSameTransactionCandidate) — tidak berubah.
 */
function isAlreadyImportedLocal(userId: string, gmailMessageId: string): Transaction | null {
  if (!gmailMessageId) return null;
  const local = findLocalGmailTransaction(userId, gmailMessageId);
  if (local) return local;
  const confirmed = readGmailRegistryClaims(userId, gmailMessageId).find((c) => c.confirmedTxId);
  if (confirmed?.confirmedTxId) {
    // Id dari registry (server/local tab lain) — bungkus sebagai Transaction
    // minimal agar caller bisa REPLAY id tanpa menulis baris baru.
    return {
      id: confirmed.confirmedTxId,
      userId,
      type: 'expense',
      amount: 0,
      categoryId: '',
      categoryName: '',
      merchant: '',
      paymentMethod: 'cash',
      note: '',
      date: '',
      source: 'gmail',
      gmailMessageId,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as Transaction;
  }
  return null;
}

export class DuplicateTransactionError extends Error {
  duplicate: Transaction;

  constructor(duplicate: Transaction) {
    // Kandidat duplikat bisa berupa Transaction minimal dari registry
    // (isAlreadyImportedLocal — hanya membawa id, tanpa kategori/tanggal):
    // jangan render label kosong saat field tidak tersedia.
    const label = `${duplicate.categoryName || ''} ${duplicate.date || ''}`.trim();
    super(`Transaksi serupa sudah ada${label ? `: ${label}` : ''}`);
    this.name = 'DuplicateTransactionError';
    this.duplicate = duplicate;
  }
}

function readLocalTransactions(userId: string): Transaction[] {
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return [];
    return (JSON.parse(raw) as Transaction[]).map((transaction) => ({
      ...transaction,
      createdAt: new Date(transaction.createdAt),
      updatedAt: new Date(transaction.updatedAt),
    }));
  } catch {
    return [];
  }
}

function writeLocalTransactions(userId: string, transactions: Transaction[]) {
  localStorage.setItem(localKey(userId), JSON.stringify(transactions));
}

function normalizeText(value?: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function isSameTransactionCandidate(
  transaction: Transaction,
  data: TransactionFormData,
  source: TransactionSource,
  gmailMessageId?: string
): boolean {
  if (source === 'gmail' && gmailMessageId && transaction.gmailMessageId === gmailMessageId) return true;
  if (transaction.date !== data.date) return false;
  if (transaction.type !== data.type) return false;
  if (Number(transaction.amount) !== Number(data.amount)) return false;

  const existingMerchant = normalizeText(transaction.merchant);
  const incomingMerchant = normalizeText(data.merchant);
  if (existingMerchant && incomingMerchant) return existingMerchant === incomingMerchant;

  return transaction.categoryId === data.categoryId || transaction.categoryName === data.categoryName;
}

export interface PaginatedTransactionsResult {
  data: Transaction[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface GetTransactionsPaginatedOptions {
  userId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  type?: TransactionType | 'all';
  categoryId?: string;
  paymentMethod?: PaymentMethod | 'all';
  source?: TransactionSource | 'all';
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  sortBy?: SortOption;
  /**
   * Sprint 1.5: false → error API dibiarkan menyebar (tidak fallback ke
   * localStorage) agar UI bisa menampilkan ErrorState yang jujur.
   * Default true = perilaku lama (offline-first: tampilkan cache lokal).
   */
  fallbackToLocal?: boolean;
}

export function listenToTransactions(
  userId: string,
  callback: (transactions: Transaction[]) => void,
  errorCallback?: (error: Error) => void
): () => void {
  const fetchRecent = () => {
    getRecentTransactions(userId, 50).then(callback).catch(errorCallback);
  };

  fetchRecent();

  const unsub1 = onSSE('transaction:created', fetchRecent);
  const unsub2 = onSSE('transaction:updated', fetchRecent);
  const unsub3 = onSSE('transaction:deleted', fetchRecent);

  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

/**
 * Ambil ringkasan keuangan WINDOWLESS dari server (GET /api/transactions/summary).
 *
 * Sumber kebenaran tunggal untuk Total Saldo / Pemasukan Bulan Ini /
 * Pengeluaran Bulan Ini — agregasi SQL atas SELURUH transaksi user, bukan
 * window 50 baris terbaru (root cause insiden 2026-08-08).
 */
export async function getTransactionSummary(
  _userId: string,
  month: number,
  year: number,
): Promise<TransactionSummary> {
  return apiGet<TransactionSummary>(`/api/transactions/summary?month=${month}&year=${year}`);
}

/**
 * Subscribe ringkasan keuangan + refetch otomatis saat transaksi berubah
 * (pola listenToTransactions). Error API dibiarkan menyebar (jangan menelan
 * error jadi angka 0 yang menyesatkan).
 */
export function listenToTransactionSummary(
  userId: string,
  month: number,
  year: number,
  callback: (summary: TransactionSummary) => void,
  errorCallback?: (error: Error) => void,
): () => void {
  const fetchSummary = () => {
    getTransactionSummary(userId, month, year).then(callback).catch(errorCallback);
  };

  fetchSummary();

  const unsub1 = onSSE('transaction:created', fetchSummary);
  const unsub2 = onSSE('transaction:updated', fetchSummary);
  const unsub3 = onSSE('transaction:deleted', fetchSummary);

  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

export function listenToTransactionChanges(
  _userId: string,
  callback: () => void,
): () => void {
  const unsub1 = onSSE('transaction:created', callback);
  const unsub2 = onSSE('transaction:updated', callback);
  const unsub3 = onSSE('transaction:deleted', callback);

  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

async function getRecentTransactions(userId: string, maxResults = 50): Promise<Transaction[]> {
  try {
    const rows = await apiGet<any[]>(`/api/transactions?limit=${maxResults}`);
    return (rows || []).map(mapTransaction);
  } catch {
    return readLocalTransactions(userId);
  }
}

export async function getTransactionsPaginated(
  options: GetTransactionsPaginatedOptions,
): Promise<PaginatedTransactionsResult> {
  const query = new URLSearchParams();
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('pageSize', String(options.pageSize));
  if (options.search) query.set('search', options.search);
  if (options.type) query.set('type', options.type);
  if (options.categoryId) query.set('categoryId', options.categoryId);
  if (options.paymentMethod) query.set('paymentMethod', options.paymentMethod);
  if (options.source) query.set('source', options.source);
  if (options.dateFrom) query.set('dateFrom', options.dateFrom);
  if (options.dateTo) query.set('dateTo', options.dateTo);
  if (typeof options.minAmount === 'number') query.set('minAmount', String(options.minAmount));
  if (typeof options.maxAmount === 'number') query.set('maxAmount', String(options.maxAmount));
  if (options.sortBy) query.set('sortBy', options.sortBy);

  try {
    const res = await apiGet<any>(`/api/transactions/paginated?${query.toString()}`);
    return {
      ...res,
      data: (res.data || []).map(mapTransaction),
    };
  } catch (err) {
    // Sprint 1.5: panggil dengan fallbackToLocal:false bila error harus
    // sampai ke UI (mis. ringkasan profil) — jangan menelan error jadi
    // "Belum ada transaksi" yang menyesatkan saat backend down.
    if (options.fallbackToLocal === false) throw err;
    const rows = readLocalTransactions(options.userId);
    return {
      data: rows,
      page: 1,
      pageSize: 50,
      total: rows.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    };
  }
}

export async function findDuplicateTransaction(
  userId: string,
  data: TransactionFormData,
  source: TransactionSource = 'manual',
  gmailMessageId?: string
): Promise<Transaction | null> {
  // Normalisasi semantik (2026-08-11): cek duplikat gmail LOKAL memakai SATU
  // helper yang sama dengan cabang fallback (isAlreadyImportedLocal) — pesan
  // yang sudah diimport lokal (store lokal / registry tab lain) ditemukan di
  // sini, bukan hanya di cabang fallback. Sebelumnya cek klien hanya melihat
  // window server 100 (getRecentTransactions) → pesan lama di luar window
  // LOLOS → akar masalah §10.2. Duplikat yang ditemukan di sini → caller
  // melempar DuplicateTransactionError (bukan replay) — perilaku cek klien
  // tetap konsisten untuk semua source.
  if (source === 'gmail' && gmailMessageId) {
    const localDuplicate = isAlreadyImportedLocal(userId, gmailMessageId);
    if (localDuplicate) return localDuplicate;
  }
  const recent = await getRecentTransactions(userId, 100);
  return recent.find((t) => isSameTransactionCandidate(t, data, source, gmailMessageId)) || null;
}

/**
 * Idempotensi create client-side (2026-08-09) — cegah double-insert saat klik
 * ganda / retry serentak di SEMUA caller (form, QuickAddSheet, Gmail approve,
 * recurring, receipt scan).
 *
 * Cek duplikat klien (findDuplicateTransaction) punya celah TOCTOU: dua create
 * identik yang berjalan bersamaan sama-sama lolos cek sebelum INSERT pertama
 * commit → 2 baris (server juga tanpa idempotency key/unique constraint).
 * Guard ini membuat create identik yang masih in-flight BERBAGI SATU POST
 * (create-once). Entry dibersihkan setelah settle → retry sah setelah
 * kegagalan tetap bisa dieksekusi (dan retry setelah sukses akan kena
 * DuplicateTransactionError dari cek duplikat, perilaku existing).
 */
/**
 * Track promise in-flight per key: caller kedua BERBAGI promise yang sama;
 * entry dibersihkan setelah settle (sukses MAUPUN gagal) — hanya bila masih
 * promise yang sama (create baru dengan key sama menunggu giliran).
 * Dipakai oleh pendingCreates (create) & pendingMutations (update/delete).
 */
function trackInFlight<T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>): Promise<T> {
  map.set(key, promise);
  void promise.then(
    () => { if (map.get(key) === promise) map.delete(key); },
    () => { if (map.get(key) === promise) map.delete(key); },
  );
  return promise;
}

const pendingCreates = new Map<string, Promise<string>>();

/** Fingerprint identitas create — konsisten dengan isSameTransactionCandidate:
 *  gmailMessageId dominan; selain itu date+type+amount+merchant|kategori
 *  (merchant ternormalisasi; kategori saat merchant kosong). userId disertakan
 *  agar map shared antar-user tidak saling menelan create.
 *  CATATAN: ini identitas PRAGMATIS untuk merge in-flight, bukan relasi
 *  ekivalensi ketat — dua create identik yang satu ber-merchant dan lainnya
 *  kosong akan beda fingerprint (lolos merge), sejalan dengan batas cek
 *  duplikat klien (isSameTransactionCandidate juga memakai merchant-ketika-
 *  keduanya-hadir). Kasus ini praktis tidak terjadi (form state sama; gmail
 *  selalu punya merchant). */
function createFingerprint(userId: string, data: TransactionFormData, gmailMessageId?: string): string {
  if (gmailMessageId) return `gmail::${userId}::${gmailMessageId}`;
  const merchant = normalizeText(data.merchant);
  const identity = merchant || `${data.categoryId}|${data.categoryName}`;
  return [userId, data.date, data.type, Number(data.amount), identity].join('::');
}

export async function addTransaction(
  userId: string,
  data: TransactionFormData,
  source: TransactionSource = 'manual',
  gmailMessageId?: string,
  confidenceScore?: number,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const fingerprint = createFingerprint(userId, data, gmailMessageId);
  const inFlight = pendingCreates.get(fingerprint);
  if (inFlight) return inFlight;

  // Claim registry gmail SEBELUM POST (2026-08-11, cross-tab): dua tab yang
  // meng-import pesan gmail SAMA — yang claim-nya lebih dulu menang, yang lain
  // replay (lihat cabang fallback). Claim dilakukan SINCHRONOUS sebelum request
  // apa pun agar window race lintas-tab (read→write localStorage) seminimal
  // mungkin: dua tab yang masuk bersamaan sama-sama menulis klaim, lalu klaim
  // yang LEBIH LAMA (timestamp) menang saat verifikasi di cabang fallback.
  // Server tetap sumber kebenaran final (unique index gmail menolak duplikat
  // ENFORCED) — registry hanya mencegah duplikat di jalur fallback lokal.
  const registryWinner = source === 'gmail' && gmailMessageId ? claimGmailMessage(userId, gmailMessageId) : true;

  const create = doAddTransaction(userId, data, source, gmailMessageId, confidenceScore, metadata, registryWinner);
  return trackInFlight(pendingCreates, fingerprint, create);
}

async function doAddTransaction(
  userId: string,
  data: TransactionFormData,
  source: TransactionSource = 'manual',
  gmailMessageId?: string,
  confidenceScore?: number,
  metadata?: Record<string, unknown>,
  registryWinner = true,
): Promise<string> {
  const duplicate = await findDuplicateTransaction(userId, data, source, gmailMessageId);
  if (duplicate) throw new DuplicateTransactionError(duplicate);

  // Idempotency-Key server (2026-08-09): fingerprint SAMA dengan map
  // in-flight client (createFingerprint) → retry dari klien mana pun
  // (tab lain, request langsung, server restart) dengan payload identik
  // memakai key yang sama → server menjamin create-once via unique
  // partial index (user_id, idempotency_key). Tanpa key → perilaku lama.
  const idempotencyKey = createFingerprint(userId, data, gmailMessageId);
  try {
    const res = await apiPost<{ id: string }>(
      '/api/transactions',
      {
        ...data,
        source,
        gmailMessageId,
        confidenceScore,
        metadata: metadata || data.metadata || {},
      },
      { 'Idempotency-Key': idempotencyKey },
    );

    if (source === 'gmail' && confidenceScore !== undefined && confidenceScore < 0.7) {
      void triggerTransactionReviewNotification(userId, {
        id: res.id,
        userId,
        ...data,
        merchant: data.merchant || '',
        paymentMethod: data.paymentMethod || 'cash',
        note: data.note || '',
        source,
        gmailMessageId,
        confidenceScore,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Cache getAllTransactions: mutasi sukses → data berubah → bersihkan
    // (SSE invalidator juga akan menyapu, tapi jalur ini sinkron & mencakup
    // juga kasus server down di bawah).
    invalidateAllTransactionsCache(userId);
    // Cross-tab (2026-08-11): import gmail SUKSES via server TIDAK menulis
    // localStorage — tab lain yang POST-nya gagal (offline) untuk pesan sama
    // tidak akan menemukan baris lokal. Catat di registry agar tab itu REPLAY
    // id server ini, bukan menulis duplikat lokal. Registry = sinkronisasi
    // lintas-tab (storage event); server tetap sumber kebenaran final.
    if (source === 'gmail' && gmailMessageId) {
      confirmGmailImport(userId, gmailMessageId, res.id);
    }
    return res.id;
  } catch {
    const transactions = readLocalTransactions(userId);
    if (source === 'gmail' && gmailMessageId) {
      // Dedupe gmail OFFLINE (2026-08-11) — menutup batasan §10.8 + §10.9:
      // jalur fallback localStorage TIDAK boleh menulis duplikat
      // gmail_message_id. Normalisasi semantik: helper isAlreadyImportedLocal
      // (SATU sumber kebenaran untuk "sudah diimport lokal?") dipakai DI SINI
      // dan di findDuplicateTransaction — tidak ada lagi dua logika terpisah
      // yang bisa menghasilkan throw-vs-replay berbeda untuk kondisi sama.
      const importedLocal = isAlreadyImportedLocal(userId, gmailMessageId);
      if (importedLocal) {
        logger.warn(
          '[transactionService] fallback lokal: pesan gmail sudah diimpor (store lokal / registry) — replay id existing (tanpa duplikat lokal)',
          { userId, gmailMessageId, txId: importedLocal.id },
        );
        // Tidak ada mutasi → cache getAllTransactions TIDAK perlu di-invalidate.
        return importedLocal.id;
      }
      if (!registryWinner) {
        // Tab ini KALAH claim (klaim tab lain lebih tua) tapi belum ada id
        // terkonfirmasi — tab pemenang sedang meng-import. Tunda sebentar
        // (GMAIL_REGISTRY_WAIT_DEADLINE_MS) agar id final sempat tercatat,
        // lalu replay. Bila klaim orphan (tab ditutup saat POST), tab ini
        // yang menulis (baris tunggal) — pengecekan terakhir setelah wait.
        const deadline = Date.now() + GMAIL_REGISTRY_WAIT_DEADLINE_MS;
        while (Date.now() < deadline) {
          const tx = findLocalGmailTransaction(userId, gmailMessageId);
          if (tx) return tx.id;
          const confirmed = readGmailRegistryClaims(userId, gmailMessageId).find((c) => c.confirmedTxId)?.confirmedTxId;
          if (confirmed) return confirmed;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const lastConfirmed = readGmailRegistryClaims(userId, gmailMessageId).find((c) => c.confirmedTxId)?.confirmedTxId;
        if (lastConfirmed) {
          logger.warn(
            '[transactionService] fallback lokal: pesan gmail dikonfirmasi tab lain — replay id',
            { userId, gmailMessageId, txId: lastConfirmed },
          );
          return lastConfirmed;
        }
        // Klaim tab lain orphan (tab ditutup saat POST) → tab ini menulis
        // (baris tunggal; klaim di-overwrite di bawah via confirmGmailImport).
        logger.warn(
          '[transactionService] fallback lokal: klaim tab lain orphan — tab ini yang menulis',
          { userId, gmailMessageId },
        );
      }
    }
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();
    const transaction: Transaction = {
      id,
      userId,
      ...data,
      merchant: data.merchant || '',
      paymentMethod: data.paymentMethod || 'cash',
      note: data.note || '',
      source,
      gmailMessageId,
      confidenceScore,
      metadata: metadata || data.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    writeLocalTransactions(userId, [transaction, ...transactions]);
    // Fallback localStorage juga mutasi data → cache HARUS dibersihkan
    // (jalur ini TIDAK memicu SSE server; tanap ini getAllTransactions
    // berikutnya menyajikan data basi dari cache).
    invalidateAllTransactionsCache(userId);
    // Tandai import lokal di registry — tab lain yang fallback untuk pesan
    // yang sama akan REPLAY id ini, bukan menulis baris kedua (dedupe
    // lintas-tab). Nonce di-overwrite: klaim terbukti sukses menulis.
    if (source === 'gmail' && gmailMessageId) {
      confirmGmailImport(userId, gmailMessageId, id);
    }
    return id;
  }
}

/**
 * Guard in-flight untuk MUTASI resource transaksi (update/delete) — 2026-08-09.
 *
 * Pola sama dengan pendingCreates (create): dua panggilan untuk resource yang
 * sama yang berjalan bersamaan BERBAGI SATU request — klik ganda Edit-Save /
 * Delete → satu PUT/DELETE, satu SSE, satu toast (sebelumnya double-fire).
 * Entry dibersihkan setelah settle (sukses MAUPUN gagal) → retry sah setelah
 * kegagalan tetap bisa dieksekusi.
 *
 * KEPUTUSAN: busy per transactionId, BUKAN content fingerprint. Alasan:
 *  - Identity resource SUDAH transactionId (beda dengan create yang belum punya
 *    id sebelum POST) — fingerprint konten di sini malah BERBAHAYA: dua edit
 *    BEDA data pada tx yang sama akan lolos dedupe → race last-write-wins yang
 *    justru ingin dicegah.
 *  - Caller kedua (data sama ATAU beda) di-merge ke op pertama — window
 *    in-flight hanya milidetik dan form tertutup saat submit, jadi tidak
 *    reachable via UI untuk data beda.
 *  - Update dan delete berbagi map tapi dengan prefix kind → dua op BERBEDA
 *    pada tx sama (mis. Save lalu Delete cepat) TIDAK saling menelan.
 */
const pendingMutations = new Map<string, Promise<void>>();
const mutationKey = (kind: 'update' | 'delete', userId: string, transactionId: string) =>
  `${kind}::${userId}::${transactionId}`;

function guardMutation(
  kind: 'update' | 'delete',
  userId: string,
  transactionId: string,
  op: () => Promise<void>,
): Promise<void> {
  const key = mutationKey(kind, userId, transactionId);
  const inFlight = pendingMutations.get(key);
  if (inFlight) return inFlight;
  return trackInFlight(pendingMutations, key, op());
}

export async function updateTransaction(
  userId: string,
  transactionId: string,
  data: Partial<TransactionFormData>
): Promise<void> {
  return guardMutation('update', userId, transactionId, async () => {
    try {
      await apiPut(`/api/transactions/${transactionId}`, data);
    } catch {
      writeLocalTransactions(
        userId,
        readLocalTransactions(userId).map((t) => (t.id === transactionId ? { ...t, ...data, updatedAt: new Date() } : t))
      );
    }
    // Mutasi (sukses ATAU fallback lokal) → cache getAllTransactions basi.
    invalidateAllTransactionsCache(userId);
  });
}

export async function deleteTransaction(userId: string, transactionId: string): Promise<void> {
  return guardMutation('delete', userId, transactionId, async () => {
    try {
      await apiDelete(`/api/transactions/${transactionId}`);
    } catch {
      writeLocalTransactions(
        userId,
        readLocalTransactions(userId).filter((t) => t.id !== transactionId)
      );
    }
    // Mutasi (sukses ATAU fallback lokal) → cache getAllTransactions basi.
    invalidateAllTransactionsCache(userId);
  });
}

/**
 * Lookup point transaksi — migrasi windowless (2026-08-09).
 *
 * Sebelumnya: getRecentTransactions(500) lalu cari id di memori → transaksi
 * lebih tua dari 500 baris terbaru kembali `null` (bug laten roadmap
 * FINANCIAL_CALCULATION_INTEGRITY §9). Kini: query LANGSUNG server
 * `GET /api/transactions?limit=1&id=<id>` (user-scoped) — `[]` = tidak ada
 * (bukan null-ambigu), baris = transaksi. API gagal → fallback localStorage
 * (kontrak offline-first lama dipertahankan).
 */
export async function getTransaction(userId: string, transactionId: string): Promise<Transaction | null> {
  try {
    const rows = await apiGet<any[]>(`/api/transactions?limit=1&id=${encodeURIComponent(transactionId)}`);
    const row = rows && rows[0];
    return row ? mapTransaction(row) : null;
  } catch {
    return readLocalTransactions(userId).find((t) => t.id === transactionId) || null;
  }
}

/**
 * Paginasi penuh windowless — loop GET /api/transactions/paginated sampai
 * hasNextPage=false (pageSize 100). Guard defensif: hasNextPage must converge
 * (server totalPages stabil) → > 1000 halaman dianggap tidak konvergen.
 *
 * Kontrak error: kegagalan SATU halaman mana pun → throw (caller memutuskan
 * fallback; fallbackToLocal:false dipakai di sini agar error API tidak
 * disamarkan jadi data lokal yang menyesatkan).
 *
 * Satu-satunya sumber kebenaran untuk agregasi lengkap (migrasi 2026-08-09) —
 * dipakai getAllTransactions & getTransactionsByDateRange (sebelumnya dua
 * salinan loop identik + guard yang sama, berisiko drift).
 */
async function fetchAllPaginated(userId: string, extra: Pick<GetTransactionsPaginatedOptions, 'dateFrom' | 'dateTo'> = {}): Promise<Transaction[]> {
  const all: Transaction[] = [];
  let page = 1;
  let result = await getTransactionsPaginated({ userId, page, pageSize: 100, fallbackToLocal: false, ...extra });
  all.push(...result.data);
  while (result.hasNextPage) {
    if (page > 1000) throw new Error('Paginasi transaksi tidak konvergen');
    page += 1;
    result = await getTransactionsPaginated({ userId, page, pageSize: 100, fallbackToLocal: false, ...extra });
    all.push(...result.data);
  }
  return all;
}

/**
 * Transaksi dalam rentang tanggal — migrasi windowless (2026-08-09).
 *
 * Sebelumnya: getRecentTransactions(1000) lalu filter di memori → rentang
 * dengan data lebih tua dari 1000 baris terpotong. Kini: filter SERVER
 * dateFrom/dateTo via GET /api/transactions/paginated (loop sampai
 * hasNextPage=false, helper fetchAllPaginated). API gagal → fallback
 * localStorage (kontrak lama).
 *
 * CATATAN (cache 2026-08-09): sengaja TIDAK ikut cache getAllTransactions —
 * rentang tanggal adalah query spesifik (server-side filter) yang jarang
 * diulang; cache per-rentang akan meledak tanpa benefit. Bila nanti dipakai
 * berulang (mis. ekspor rentang berurutan), cache dengan key date-range.
 */
export async function getTransactionsByDateRange(userId: string, startDate: string, endDate: string): Promise<Transaction[]> {
  try {
    return await fetchAllPaginated(userId, { dateFrom: startDate, dateTo: endDate });
  } catch {
    return readLocalTransactions(userId).filter((t) => t.date >= startDate && t.date <= endDate);
  }
}

/**
 * Cache in-memory untuk getAllTransactions (2026-08-09).
 *
 * Motivasi: user >2000 transaksi → getAllTransactions = 20+ request berurutan
 * (pageSize 100). Nav antar halaman yang memakai dataset penuh (Reports ↔
 * Advisor ↔ Settings CSV ↔ AI Hub ↔ Budgets/ProfessionalSuite) sebelumnya
 * men-trigger loop penuh SETIAP mount — sia-sia karena data jarang berubah
 * antar halaman.
 *
 * Desain:
 *  - Key = userId (dataset user-scoped; logout/login user lain tidak saling
 *    menelan — Map per user).
 *  - Nilai = { data, at } dengan TTL 60s (in-memory, tidak persisten).
 *  - Invalidasi SSE: transaction:created/updated/deleted → cache DIBERSIHKAN
 *    (mutasi server dari tab/mana pun langsung memicu refetch berikutnya).
 *  - Invalidasi eksplisit di addTransaction/updateTransaction/deleteTransaction
 *    (jalur localStorage-fallback TIDAK memicu SSE — cache harus tetap
 *    konsisten dengan data lokal).
 *  - In-flight dedup: dua caller yang memanggil bersamaan (StrictMode
 *    double-mount, dua halaman mount cepat) berbagi SATU loop paginasi.
 *  - TTL 60s = batas atas staleness bila SSE gagal/terputus (fail-safe);
 *    cache TIDAK pernah lebih basi dari 1 menit.
 *  - Data disalin (slice) saat disajikan — caller tidak bisa mengubah cache
 *    lewat mutasi array hasil.
 */
const ALL_TX_CACHE_TTL_MS = 60_000;
const allTxCache = new Map<string, { data: Transaction[]; at: number }>();
const allTxInFlight = new Map<string, Promise<Transaction[]>>();

/**
 * Bersihkan cache getAllTransactions — userId kosong = semua user.
 *
 * In-flight ikut dibersihkan: fetch yang sedang berjalan TIDAK boleh
 * menulis ulang cache setelah invalidasi (lihat guard identity di
 * getAllTransactions) — kalau tidak, mutasi yang terjadi saat fetch panjang
 * masih berjalan akan tertimpa data pre-mutasi yang basi.
 */
export function invalidateAllTransactionsCache(userId?: string): void {
  if (userId) {
    allTxCache.delete(userId);
    allTxInFlight.delete(userId);
  } else {
    allTxCache.clear();
    allTxInFlight.clear();
  }
}

let sseInvalidatorsRegistered = false;
let storageInvalidatorsRegistered = false;

function registerAllTxSseInvalidators(): void {
  if (sseInvalidatorsRegistered) return;
  sseInvalidatorsRegistered = true;
  for (const evt of ['transaction:created', 'transaction:updated', 'transaction:deleted']) {
    onSSE(evt, () => invalidateAllTransactionsCache());
  }

  // Cross-tab (2026-08-11): tab LAIN menulis transaksi/registry lokal via
  // localStorage (fallback offline / import gmail) → storage event → cache
  // getAllTransactions user tsb dibersihkan agar tab ini tidak menyajikan
  // data basi. Key lokal & registry per-user → invalidate spesifik user.
  // (Guard terdaftar sekali; storage event dari tab sendiri tidak memicu.)
  if (!storageInvalidatorsRegistered) {
    storageInvalidatorsRegistered = true;
    // Node/SSR (test, build tooling) tidak punya window — storage event hanya
    // tersedia di browser; typeof guard menghindari ReferenceError.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event: StorageEvent) => {
        if (!event.key) return;
        if (event.key.startsWith('cashflow-local-transactions-')) {
          const userId = event.key.slice('cashflow-local-transactions-'.length);
          invalidateAllTransactionsCache(userId);
        } else if (event.key.startsWith('cashflow-gmail-import-registry-')) {
          const userId = event.key.slice('cashflow-gmail-import-registry-'.length);
          invalidateAllTransactionsCache(userId);
        }
      });
    }
  }
}

/**
 * Ambil SELURUH transaksi user — WINDOWLESS-COMPLETE (migrasi 2026-08-09) +
 * cache in-memory + invalidasi SSE (optimasi 2026-08-09).
 *
 * Sebelumnya: GET /api/transactions?limit=2000 → window diam-diam memotong
 * data user >2000 baris, sehingga agregasi (ReportsPage, AdvisorPage,
 * SettingsPage CSV, ProfessionalSuitePage) salah — kelas bug insiden
 * 2026-08-08 (agregasi dari fetch terbatas).
 *
 * Setelah migrasi windowless: paginasi penuh (pageSize 100, halaman berurutan
 * sampai hasNextPage=false) — agregasi selalu atas dataset LENGKAP.
 *
 * Optimasi cache: halaman pertama memanggil loop penuh, halaman berikutnya
 * (dalam TTL 60s) disajikan dari memori tanpa request. Kontrak error
 * dipertahankan: kegagalan API → fallback localStorage (pola lama); kegagalan
 * TIDAK di-cache (refetch berikutnya mencoba lagi).
 */
export async function getAllTransactions(userId: string): Promise<Transaction[]> {
  registerAllTxSseInvalidators();

  const cached = allTxCache.get(userId);
  if (cached && Date.now() - cached.at < ALL_TX_CACHE_TTL_MS) {
    return cached.data.slice();
  }

  const inFlight = allTxInFlight.get(userId);
  if (inFlight) return inFlight;

  // Definite-assignment (!): closure self-reference `fetch` di dalam body
  // async yang mengeksekusi setelah `fetch` diisi — TS tidak bisa membuktikan
  // ini sendiri, jadi assertion eksplisit (pola umum promise in-flight).
  let fetch!: Promise<Transaction[]>;
  const run = (async (): Promise<Transaction[]> => {
    try {
      const data = await fetchAllPaginated(userId);
      // Guard identity: kalau invalidasi terjadi saat fetch masih berjalan
      // (mutasi → allTxInFlight dihapus), jangan tulis ulang cache dengan
      // data pre-mutasi — race repopulation (review 2026-08-09).
      if (allTxInFlight.get(userId) === fetch) {
        allTxCache.set(userId, { data, at: Date.now() });
      }
      return data.slice();
    } catch {
      // Kegagalan TIDAK di-cache — refetch berikutnya mencoba API lagi.
      return readLocalTransactions(userId);
    } finally {
      // Identity-checked delete: hanya bersihkan kalau masih fetch ini
      // (bukan fetch baru yang menunggu giliran).
      if (allTxInFlight.get(userId) === fetch) {
        allTxInFlight.delete(userId);
      }
    }
  })();
  fetch = run;
  allTxInFlight.set(userId, fetch);
  return fetch;
}

export function downloadTransactionsCSV(transactions: Transaction[]): void {
  const headers = ['id', 'date', 'type', 'amount', 'category', 'merchant', 'paymentMethod', 'source', 'confidenceScore', 'note'];
  const rows = transactions.map((transaction) => [
    transaction.id,
    transaction.date,
    transaction.type,
    transaction.amount,
    transaction.categoryName,
    transaction.merchant,
    transaction.paymentMethod,
    transaction.source,
    transaction.confidenceScore ?? '',
    transaction.note,
  ]);
  const escapeCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cashflow-transactions-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Deteksi id income pasangan transfer internal (paritas client Skr B §10.13).
 *
 * Rule SAMA PERSIS dengan server (financialSummary.js findInternalIncomePairIds):
 * income (`type='income'`) dinetralkan bila ada transfer ke akun milik sendiri
 * dengan merchant SAMA + transaction_date SAMA + amount SAMA; pairing 1:1
 * min-pair per grup (date, amount, merchant), tie-break id ASC (deterministik).
 * ownAccounts kosong → tanpa pairing (legacy).
 */
function findInternalIncomePairIds(transactions: Transaction[], ownSet: Set<string>): Set<string> {
  if (ownSet.size === 0) return new Set();
  const groupKey = (t: Transaction) => `${t.date}|${Number(t.amount)}|${t.merchant}`;
  const incomesByKey = new Map<string, Transaction[]>();
  const transfersByKey = new Map<string, Transaction[]>();
  const push = (map: Map<string, Transaction[]>, k: string, t: Transaction) => {
    const arr = map.get(k);
    if (arr) arr.push(t);
    else map.set(k, [t]);
  };
  for (const t of transactions) {
    if (t.type === 'income' && ownSet.has(t.merchant)) push(incomesByKey, groupKey(t), t);
    else if (t.type === 'transfer' && ownSet.has(t.merchant)) push(transfersByKey, groupKey(t), t);
  }
  const paired = new Set<string>();
  for (const [k, incs] of incomesByKey) {
    const trs = transfersByKey.get(k);
    if (!trs) continue;
    // min-pair + tie-break id ASC — identik dengan ROW_NUMBER server.
    const n = Math.min(incs.length, trs.length);
    const sorted = [...incs].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let i = 0; i < n; i++) paired.add(sorted[i].id);
  }
  return paired;
}

export function calculateBalance(
  transactions: Transaction[],
  ownAccounts: string[] = [],
): {
  totalIncome: number;
  totalExpense: number;
  balance: number;
} {
  // Paritas semantik server §10.13 (Skr B): income pasangan transfer internal
  // (same-day same-amount same-merchant) TIDAK dihitung sebagai income.
  const ownSet = new Set(ownAccounts);
  const pairedIncomeIds = findInternalIncomePairIds(transactions, ownSet);
  const totalIncome = transactions
    .filter((t) =>
      (t.type === 'income' || t.type === 'refund') && !pairedIncomeIds.has(t.id)
    )
    .reduce((sum, t) => sum + t.amount, 0);
  // Paritas semantik server §10.13 (Skr A): transfer ke akun milik sendiri
  // TIDAK dihitung sebagai expense (kekayaan bersih tidak berubah). ownAccounts
  // kosong (default) → perilaku legacy (semua transfer = expense).
  const totalExpense = transactions
    .filter((t) =>
      t.type === 'expense' || (t.type === 'transfer' && !ownSet.has(t.merchant))
    )
    .reduce((sum, t) => sum + t.amount, 0);
  return { totalIncome, totalExpense, balance: totalIncome - totalExpense };
}
