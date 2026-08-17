/**
 * Helpers E2E untuk autentikasi via cookie.
 *
 * Better Auth menyimpan sesi di tabel `session` (Turso) dan cookie-nya berbentuk
 * `${token}.${base64(HMAC-SHA256(secret, token))}`. Helper ini menulis satu baris
 * sesi valid ke Turso (userAgent 'e2e-test') dan mengembalikan nilai cookie yang
 * bisa di-inject ke browser — sehingga test bisa login tanpa Google OAuth manual.
 *
 * Referensi skema signature: server/lib/auth.js (betterAuth secret fallback).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

/**
 * P1.7 — client Turso E2E bersama (dipakai SEMUA helper di file ini).
 *
 * Untuk DB LOKAL (file:) set `PRAGMA busy_timeout` per-koneksi: WAL (di-set
 * scripts/prepare-e2e-local-db.mjs) sudah mengizinkan reader saat writer aktif,
 * tapi writer-vs-writer masih bisa kena SQLITE_BUSY instan (default timeout 0)
 * saat server API menulis bersamaan — busy_timeout membuat client test MENUNGGU
 * alih-alih langsung gagal. URL remote (CI/dev) tidak terpengaruh.
 */
/**
 * Factory client Turso E2E bersama — WAJIB dipakai SEMUA spec/helper yang
 * menyentuh DB langsung (P1.7): selain URL+token dari env, untuk DB lokal
 * (file:) set `PRAGMA busy_timeout` per-koneksi. Tanpa ini writer-vs-writer
 * (server API + helper test = dua proses pada file DB yang sama) kena
 * SQLITE_BUSY instan (default timeout 0) → flake tak menentu antar run
 * (pola terbukti: spec AI/gmail/fraud gagal bergiliran).
 */
export async function createE2eTursoClient(): Promise<ReturnType<typeof createClient>> {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL || '',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  if ((process.env.TURSO_DATABASE_URL || '').startsWith('file:')) {
    try {
      await turso.execute({ sql: 'PRAGMA busy_timeout = 10000', args: [] });
    } catch {
      /* non-blocking — pragma lokal saja */
    }
  }
  return turso;
}

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
}

export interface MintedSession {
  cookie: string;
  userId: string;
}

/**
 * P1.7 — E2E DB SAFETY GUARD (fail-fast).
 *
 * E2E TIDAK PERNAH boleh menulis ke database production. Guard memeriksa
 * `E2E_DB_DENY_URLS` (comma-separated substring; opsional — operator menyetel
 * marker DB production, mis. nama db Turso produksi) dan menggagalkan run
 * bila URL DB cocok. Bila guard TIDAK di-set, aman karena: run lokal
 * terisolasi memakai `file:` URL (playwright.e2e-local.config.mjs) dan CI
 * memakai DB CI seed terisolasi (kebijakan project yang sudah terdokumentasi).
 */
function assertE2eDbSafe(url: string): void {
  if (!url) {
    throw new Error('E2E DB SAFETY: TURSO_DATABASE_URL kosong — minting sesi tidak bisa diarahkan ke DB yang jelas.');
  }
  const deny = (process.env.E2E_DB_DENY_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hit = deny.find((marker) => url.includes(marker));
  if (hit) {
    throw new Error(
      `E2E DB SAFETY: URL DB mengandung marker production '${hit}' — ` +
      'E2E dibatalkan (jangan pernah menulis sesi test ke DB production). ' +
      'Gunakan DB E2E terisolasi (file: URL lokal atau DB CI seed).',
    );
  }
}

/**
 * Email user seed E2E — resolusi HARUS identik dengan scripts/seedE2eDataset.mjs
 * (ADMIN_EMAILS[0] atau default 'e2e-seed-admin@cashflow.test'). Mint sesi &
 * cleanup memakai email yang sama persis dengan seed agar target user
 * deterministik di lingkungan mana pun (CI: e2e-seed-admin@…; lokal: admin dev).
 *
 * ⚠️ DIVERGENSI TAHU-BETUL (reviewer): seed script menghitung ADMIN_EMAIL saat
 * module-load — SEBELUM loadEnv() — sehingga ia TIDAK pernah membaca server/.env
 * (hanya env var proses nyata). Helper ini dipanggil SETELAH loadEnv() → di
 * skenario lokal tanpa env ter-export, seed menarget e2e-seed-admin@… sedangkan
 * mintSession menarget ADMIN_EMAILS dari server/.env. CI TIDAK terpengaruh
 * (workflow selalu men-set ADMIN_EMAILS sebagai env var nyata). Untuk konsistensi
 * penuh saat run lokal: export ADMIN_EMAILS secara eksplisit (pola verifikasi
 * temp-DB: seed & spec memakai env yang sama).
 */
function resolveSeedAdminEmail(): string {
  return (
    (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim().toLowerCase() ||
    'e2e-seed-admin@cashflow.test'
  );
}

/** Buat sesi Better Auth untuk userId tertentu (shared — dipakai admin & non-admin). */
async function insertSession(turso: ReturnType<typeof createClient>, userId: string): Promise<MintedSession> {
  const token = crypto.randomBytes(24).toString('base64url').slice(0, 32);
  const secret =
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    'cashflow-dev-secret-change-in-production';
  const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
  const now = new Date();

  await turso.execute({
    sql: `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
          VALUES (?, ?, ?, ?, ?, '', 'e2e-test', ?)`,
    args: [
      token,
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      token,
      now.toISOString(),
      now.toISOString(),
      userId,
    ],
  });

  return { cookie: `${token}.${sig}`, userId };
}

/**
 * Mint sesi Better Auth yang valid dan kembalikan cookie + userId.
 * Sesi ditandai userAgent='e2e-test' agar mudah dibersihkan.
 *
 * Target user = USER SEED (email ADMIN_EMAILS[0] atau default
 * e2e-seed-admin@cashflow.test) — SAMA dengan scripts/seedE2eDataset.mjs.
 * Resolusi by email (BUKAN `LIMIT 1`) agar deterministik walau tabel `user`
 * berisi banyak user (mis. leftover dari spec non-admin) atau urutan row
 * berubah — penyebab kegagalan CI #4 (mint sesi untuk user yang salah).
 */
export async function mintSessionCookie(): Promise<MintedSession> {
  loadEnv();
  assertE2eDbSafe(process.env.TURSO_DATABASE_URL as string);

  const turso = await createE2eTursoClient();

  try {
    const email = resolveSeedAdminEmail();
    const users = await turso.execute({
      sql: 'SELECT id FROM user WHERE email = ?',
      args: [email],
    });
    let userId = users.rows[0]?.id as string | undefined;
    if (!userId) {
      // User seed belum ada (DB fresh tanpa seed) — buat seperti seed, termasuk
      // sinkronisasi ke `users` (plural) yang dipakai FK tabel bisnis.
      userId = crypto.randomBytes(16).toString('hex');
      await turso.execute({
        sql: `INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)`,
        args: [userId, 'E2E Seed Admin', email],
      });
      await turso.execute({
        sql: `INSERT INTO users (id, email, name, display_name) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        args: [userId, email, 'E2E Seed Admin', 'E2E Seed Admin'],
      });
    }

    return await insertSession(turso, userId);
  } finally {
    turso.close();
  }
}

/**
 * Mint sesi untuk user dengan email tertentu — membuat user sementara bila belum ada.
 * Dipakai untuk menguji gate admin 403 (email TIDAK di ADMIN_EMAILS).
 * User test ditandai email berawalan 'e2e-' agar aman dibersihkan di cleanup.
 */
export async function mintSessionCookieForEmail(email: string): Promise<MintedSession> {
  loadEnv();
  assertE2eDbSafe(process.env.TURSO_DATABASE_URL as string);

  const turso = await createE2eTursoClient();

  try {
    const existing = await turso.execute({
      sql: 'SELECT id FROM user WHERE email = ?',
      args: [email],
    });
    let userId = existing.rows[0]?.id as string | undefined;
    if (!userId) {
      userId = crypto.randomBytes(16).toString('hex');
      await turso.execute({
        sql: `INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)`,
        args: [userId, 'E2E Non-Admin', email],
      });
    }

    return await insertSession(turso, userId);
  } finally {
    turso.close();
  }
}

/**
 * Hapus data test approve Gmail review (transaksi + log + notifikasi) dari Turso.
 * Dipakai spec e2e/gmail-review-approve.spec.ts — data test ditandai messageId
 * unik (prefiks 'e2e-review-') agar tidak mengganggu dataset asli user.
 */
export async function cleanupGmailReviewTestData(testMessageId: string): Promise<void> {
  if (!testMessageId) return;
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    // Transaksi yang dibuat oleh alur approve (gmail_message_id = testMessageId)
    await turso.execute({
      sql: `DELETE FROM transactions WHERE gmail_message_id = ?`,
      args: [testMessageId],
    });
    // Log Gmail Sync test
    await turso.execute({
      sql: `DELETE FROM gmail_sync_logs WHERE message_id = ?`,
      args: [testMessageId],
    });
    // Notifikasi hasil review (dedupeKey gmail-review-<messageId>)
    await turso.execute({
      sql: `DELETE FROM notifications WHERE dedupe_key = ?`,
      args: [`gmail-review-${testMessageId}`],
    });
  } finally {
    turso.close();
  }
}

/**
 * Hapus data test kategori (nama prefiks 'e2e-cat-') dari Turso.
 * Dipakai spec e2e/categories.spec.ts — data test ditandai prefiks unik agar
 * tidak mengganggu dataset asli user (kategori default is_default=1 tidak
 * mungkin memiliki nama prefiks 'e2e-cat-', jadi aman).
 */
export async function cleanupTestCategories(): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({
      sql: `DELETE FROM categories WHERE name LIKE 'e2e-cat-%'`,
      args: [],
    });
  } finally {
    turso.close();
  }
}

/**
 * Seed fixture DETERMINISTIK ai_usage_metrics (hari ini, 3 fitur) agar chart
 * multi-seri Tren Biaya di /admin/monitoring PASTI punya >1 garis di CI.
 * Tanpa ini ai_usage_metrics bisa kosong (seedE2eDataset tidak mengisinya) →
 * chart menampilkan EmptyMini dan asersi line-count tidak bermakna.
 * Baris ditandai id prefiks 'e2e-usage-' agar aman dibersihkan.
 */
export async function seedAICostTrendFixtures(userId: string): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    // Satu INSERT multi-VALUES → ATOMIK (reviewer): kegagalan tidak bisa
    // menyisakan baris parsial yang membuat chart tidak konsisten.
    await turso.execute({
      sql: `INSERT INTO ai_usage_metrics
            (id, user_id, feature, provider, model, prompt_tokens, completion_tokens,
             estimated_cost_usd, estimated_cost_idr, execution_time_ms, status, error_message, metadata)
            VALUES
              ('e2e-usage-gmail', ?, 'gmail_sync', 'gemini_flash', 'e2e-fixture', 2000, 0, 0, 150, 120, 'success', NULL, '{}'),
              ('e2e-usage-ocr', ?, 'ocr_receipt', 'gemini_flash', 'e2e-fixture', 800, 0, 0, 50, 120, 'success', NULL, '{}'),
              ('e2e-usage-insight', ?, 'insight_generator', 'gemini_flash', 'e2e-fixture', 1200, 0, 0, 100, 120, 'success', NULL, '{}')`,
      args: [userId, userId, userId],
    });
  } finally {
    turso.close();
  }
}

/** Hapus fixture ai_usage_metrics (id prefiks 'e2e-usage-') dari Turso. */
export async function cleanupAICostTrendFixtures(): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({
      sql: `DELETE FROM ai_usage_metrics WHERE id LIKE 'e2e-usage-%'`,
      args: [],
    });
  } finally {
    turso.close();
  }
}

/**
 * Seed fixture DETERMINISTIK system_metrics untuk panel "Rekomendasi AI"
 * (P10.2): 8 baris recommendation_shown/_opened dengan metadata feature +
 * eventType. Dipakai e2e/admin-monitoring-recommendation.spec.ts agar panel
 * PASTI punya data (byDay ≥ 2 hari, byFeature advisor+insight, CTR 2/6=0.333).
 * Baris ditandai id prefiks 'e2e-reco-' agar aman dibersihkan.
 * created_at space-format UTC (pola datetime('now') DB) — RELATIF ke now
 * (1-5 jam & 26-28 jam lalu) sehingga selalu dalam window panel 7 hari dan
 * tidak pernah future-dated (jam tetap bisa > now saat suite jalan sebelum
 * 09:00 UTC → baris terbuang dari window).
 */
export async function seedRecommendationFixtures(userId: string): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    // created_at RELATIF ke now (bukan jam tetap): baris "kemarin" = 26-28 jam
    // lalu, "hari ini" = 1-5 jam lalu → SELALU di dalam window panel (7 hari)
    // dan TIDAK PERNAH future-dated relatif `to = now` (jam tetap 09:00 UTC
    // bisa jadi > now saat suite jalan sebelum 09:00 UTC → baris terbuang).
    const ts = (hoursAgo: number) => {
      const d = new Date(Date.now() - hoursAgo * 3_600_000);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    };
    const meta = (feature: string, itemId: string, eventType: string) =>
      JSON.stringify({ feature, itemId, eventType });

    // Satu INSERT multi-VALUES → ATOMIK: 6 shown (advisor 4 + insight 2) &
    // 2 opened (semua advisor) → CTR total 2/6 = 0.333; byDay ≥ 2 hari;
    // byFeature = advisor (4+2=6) + insight (2); byEventType = recommendation.
    await turso.execute({
      sql: `INSERT INTO system_metrics
            (id, metric_name, metric_value, feature, user_id, metadata, created_at)
            VALUES
              ('e2e-reco-a1', 'recommendation_shown', 1, 'ai_product', ?, ?, ?),
              ('e2e-reco-a2', 'recommendation_shown', 1, 'ai_product', ?, ?, ?),
              ('e2e-reco-a3', 'recommendation_shown', 1, 'ai_product', ?, ?, ?),
              ('e2e-reco-a4', 'recommendation_shown', 1, 'ai_product', ?, ?, ?),
              ('e2e-reco-i1', 'recommendation_shown', 1, 'ai_product', ?, ?, ?),
              ('e2e-reco-i2', 'recommendation_shown', 1, 'ai_product', ?, ?, ?),
              ('e2e-reco-o1', 'recommendation_opened', 1, 'ai_product', ?, ?, ?),
              ('e2e-reco-o2', 'recommendation_opened', 1, 'ai_product', ?, ?, ?)`,
      args: [
        userId, meta('advisor', 'e2e-reco-a1', 'recommendation'), ts(2),
        userId, meta('advisor', 'e2e-reco-a2', 'recommendation'), ts(3),
        userId, meta('advisor', 'e2e-reco-a3', 'recommendation'), ts(26),
        userId, meta('advisor', 'e2e-reco-a4', 'recommendation'), ts(27),
        userId, meta('insight', 'e2e-reco-i1', 'recommendation'), ts(4),
        userId, meta('insight', 'e2e-reco-i2', 'recommendation'), ts(28),
        userId, meta('advisor', 'e2e-reco-o1', 'recommendation'), ts(1),
        userId, meta('advisor', 'e2e-reco-o2', 'recommendation'), ts(5),
      ],
    });
  } finally {
    turso.close();
  }
}

/** Hapus fixture rekomendasi (id prefiks 'e2e-reco-') dari Turso. */
export async function cleanupRecommendationFixtures(): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({
      sql: `DELETE FROM system_metrics WHERE id LIKE 'e2e-reco-%'`,
      args: [],
    });
  } finally {
    turso.close();
  }
}

/**
 * Seed fixture DETERMINISTIK untuk panel "Feedback Rate" (P10.2i):
 *   - ai_feedback (numerator): 4 baris feature 'e2e-fr-a' + 2 baris 'e2e-fr-b'
 *   - system_metrics ai_result_shown (denominator): 10 views 'e2e-fr-a' +
 *     5 views 'e2e-fr-b' (metadata.feature) → per-feature rate DETERMINISTIK:
 *     e2e-fr-a = 4/10 = 0.4 · e2e-fr-b = 2/5 = 0.4
 * Feature unik (tidak dipakai spec lain) → angka per-feature pasti tepat,
 * sedangkan TOTAL feedback/views/rate tetap dibiarkan non-deterministik
 * (spec lain dalam suite bisa menambah ai_result_shown / ai_feedback).
 * created_at space-format UTC relatif now (1-5 & 26-28 jam lalu) → selalu
 * dalam window panel 7 hari & tidak pernah future-dated (pola reco fixture).
 * Baris ditandai id prefiks 'e2e-fr-' agar aman dibersihkan.
 */
export async function seedFeedbackRateFixtures(userId: string): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    const ts = (hoursAgo: number) => {
      const d = new Date(Date.now() - hoursAgo * 3_600_000);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    };
    const meta = (feature: string) => JSON.stringify({ feature });
    const FEEDBACK_RATINGS = ['helpful', 'not_helpful', 'mismatched', 'irrelevant', 'already_done', 'skip'];

    // Numerator: 4× e2e-fr-a + 2× e2e-fr-b (rating enum valid) — Satu INSERT ATOMIK.
    await turso.execute({
      sql: `INSERT INTO ai_feedback (id, user_id, feature, item_id, rating, reason, created_at)
            VALUES
              ('e2e-fr-fb-a1', ?, 'e2e-fr-a', '', ?, 'e2e-fixture', ?),
              ('e2e-fr-fb-a2', ?, 'e2e-fr-a', '', ?, 'e2e-fixture', ?),
              ('e2e-fr-fb-a3', ?, 'e2e-fr-a', '', ?, 'e2e-fixture', ?),
              ('e2e-fr-fb-a4', ?, 'e2e-fr-a', '', ?, 'e2e-fixture', ?),
              ('e2e-fr-fb-b1', ?, 'e2e-fr-b', '', ?, 'e2e-fixture', ?),
              ('e2e-fr-fb-b2', ?, 'e2e-fr-b', '', ?, 'e2e-fixture', ?)`,
      args: [
        userId, FEEDBACK_RATINGS[0], ts(1),
        userId, FEEDBACK_RATINGS[1], ts(2),
        userId, FEEDBACK_RATINGS[2], ts(26),
        userId, FEEDBACK_RATINGS[3], ts(27),
        userId, FEEDBACK_RATINGS[4], ts(3),
        userId, FEEDBACK_RATINGS[5], ts(28),
      ],
    });

    // Denominator: 10× ai_result_shown e2e-fr-a + 5× e2e-fr-b (metadata.feature).
    const viewRows = [
      ...Array.from({ length: 10 }, (_, i) => `('e2e-fr-v-a${i}', 'ai_result_shown', 1, 'ai_product', ?, ?, ?)`),
      ...Array.from({ length: 5 }, (_, i) => `('e2e-fr-v-b${i}', 'ai_result_shown', 1, 'ai_product', ?, ?, ?)`),
    ].join(',\n');
    const viewArgs: Array<string | number> = [];
    for (let i = 0; i < 10; i++) viewArgs.push(userId, meta('e2e-fr-a'), ts(i % 5 + 1));
    for (let i = 0; i < 5; i++) viewArgs.push(userId, meta('e2e-fr-b'), ts(i % 4 + 1));
    await turso.execute({
      sql: `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at)
            VALUES\n${viewRows}`,
      args: viewArgs,
    });
  } finally {
    turso.close();
  }
}

/** Hapus fixture feedback-rate (ai_feedback + system_metrics prefiks 'e2e-fr-') dari Turso. */
export async function cleanupFeedbackRateFixtures(): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({ sql: `DELETE FROM ai_feedback WHERE id LIKE 'e2e-fr-%'`, args: [] });
    await turso.execute({ sql: `DELETE FROM system_metrics WHERE id LIKE 'e2e-fr-%'`, args: [] });
  } finally {
    turso.close();
  }
}

/**
 * Hapus data test contract ai-product (marker 'e2e-ai-contract-') dari Turso.
 * Dipakai e2e/contract/ai-product.spec.ts — SELURUH side-effect spec ditandai
 * marker unik: ai_timeline (title/body), ai_feedback (item_id/reason),
 * ai_memory (key/value), system_metrics (metadata JSON). Idempoten — aman
 * dipanggil berulang (beforeAll delete-first + afterAll).
 */
export async function cleanupAiProductFixtures(): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({
      sql: `DELETE FROM ai_timeline WHERE title LIKE '%e2e-ai-contract%' OR body LIKE '%e2e-ai-contract%'`,
      args: [],
    });
    await turso.execute({
      sql: `DELETE FROM ai_feedback WHERE item_id LIKE '%e2e-ai-contract%' OR reason LIKE '%e2e-ai-contract%'`,
      args: [],
    });
    await turso.execute({
      sql: `DELETE FROM ai_memory WHERE key LIKE '%e2e-ai-contract%' OR value LIKE '%e2e-ai-contract%'`,
      args: [],
    });
    await turso.execute({
      sql: `DELETE FROM system_metrics WHERE metadata LIKE '%e2e-ai-contract%'`,
      args: [],
    });
  } finally {
    turso.close();
  }
}

/** Hapus sesi E2E (userAgent='e2e-test') + user test (email 'e2e-*') dari Turso. */
export async function cleanupTestSessions(): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({
      sql: `DELETE FROM session WHERE userAgent = 'e2e-test'`,
      args: [],
    });
    // User test non-admin (dibuat mintSessionCookieForEmail) — email prefiks 'e2e-'.
    // ⚠️ JANGAN hapus USER SEED: di CI user seed = e2e-seed-admin@cashflow.test
    // yang juga cocok `LIKE 'e2e-%'` — menghapusnya memutus sesi & data bisnis
    // untuk spec berikutnya (akar kegagalan CI #4: 3× E2E gagal beruntun palsu).
    const seedEmail = resolveSeedAdminEmail();
    await turso.execute({
      sql: `DELETE FROM user WHERE email LIKE 'e2e-%' AND email != ?`,
      args: [seedEmail],
    });
  } finally {
    turso.close();
  }
}

/**
 * Hapus user test rate-limit (email persis) + sesi Better Auth-nya dari Turso.
 * Dipakai e2e/rate-limit-ai-general.spec.ts — email user UNIK per run
 * (timestamp) sehingga budget limiter per-user selalu bersih; cleanup di
 * afterAll menghapus user+sesi persis run ini (bukan semua user e2e-*).
 * Idempoten — aman dipanggil berulang (user sudah terhapus → 0 row).
 */
export async function cleanupRateLimitUsers(emails: string[]): Promise<void> {
  if (!emails || emails.length === 0) return;
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    // Sesi dulu (FK user) lalu user — multi-placeholder @libsql didukung.
    await turso.execute({
      sql: `DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email IN (${emails.map(() => '?').join(',')}))`,
      args: [...emails],
    });
    await turso.execute({
      sql: `DELETE FROM user WHERE email IN (${emails.map(() => '?').join(',')})`,
      args: [...emails],
    });
  } finally {
    turso.close();
  }
}

/** "2026-08-07" + n hari (UTC) → "YYYY-MM-DD". */
function addDaysUtc(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Seed fixture DETERMINISTIK untuk panel "Retensi Pengguna" (P10.2b/P10.2k):
 * satu cohort 10 user (createdAt = hari UTC − 40 hari) + 22 baris user_active:
 *   - D+1: 10/10 aktif  → d1 = 1.0   (100%)
 *   - D+7: 6/10 aktif   → d7 = 0.6   ( 60%)
 *   - D+14: 4/10 aktif  → d14 = 0.4  ( 40%)
 *   - D+28: 2/10 aktif  → d28 = 0.2  ( 20%)
 * Angka EKSAK & deterministik: user id prefiks 'e2e-ret-u*' unik → spec lain
 * tidak mungkin menulis user_active untuk user ini (user_id asing tak cocok
 * cohort lain). Cohort 40 hari lalu → seluruh jendela D1/D7/D14/D28 tercapai
 * DAN masuk window panel 90 hari (panel default 7 hari TIDAK cukup — spec
 * mengklik toggle "90 Hari").
 *
 * createdAt ditulis sebagai TEXT ISO ("YYYY-MM-DDTHH:MM:SS.sssZ") — persis
 * bentuk yang ditulis adapter Better Auth untuk user riil — sehingga E2E
 * meng-guard jalur produksi (query cohort harus menormalkan tipe via CASE
 * typeof; bug tipe ditemukan & diperbaiki P10.2k).
 *
 * Idempoten: delete-first prefiks 'e2e-ret-%' sebelum INSERT (PK user.id unik
 * — leftover run gagal tidak bisa menggandakan cohort).
 * @returns day keys cohort yang dipakai spec untuk assertion.
 */
export async function seedRetentionFixtures(): Promise<{ cohortDay: string; d1: string; d7: string; d14: string; d28: string }> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    const cohortDay = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const d1 = addDaysUtc(cohortDay, 1);
    const d7 = addDaysUtc(cohortDay, 7);
    const d14 = addDaysUtc(cohortDay, 14);
    const d28 = addDaysUtc(cohortDay, 28);

    // Delete-first (idempoten): baris user_active dulu (bisa nunjuk FK), lalu user.
    await turso.execute({ sql: `DELETE FROM system_metrics WHERE id LIKE 'e2e-ret-%'`, args: [] });
    await turso.execute({ sql: `DELETE FROM user WHERE id LIKE 'e2e-ret-%'`, args: [] });

    // 10 user cohort — Satu INSERT multi-VALUES → ATOMIK. createdAt = TEXT ISO
    // (bentuk Better Auth riil) agar query cohort yang di-test adalah jalur
    // produksi (CASE typeof normalization di metricsService).
    const cohortIso = new Date(`${cohortDay}T00:00:00Z`).toISOString();
    const userVals = Array.from(
      { length: 10 },
      (_, i) => `('e2e-ret-u${i}', 'E2E Retention', 'e2e-ret-u${i}@cashflow.test', 1, ?)`,
    ).join(',\n');
    await turso.execute({
      sql: `INSERT INTO user (id, name, email, emailVerified, createdAt) VALUES\n${userVals}`,
      args: Array(10).fill(cohortIso),
    });

    // 22 baris user_active — Satu INSERT multi-VALUES → ATOMIK.
    const uids = Array.from({ length: 10 }, (_, i) => `e2e-ret-u${i}`);
    const mkRows = (offset: number, count: number, day: string) =>
      Array.from(
        { length: count },
        (_, i) =>
          `('e2e-ret-a-${offset}-${i}', 'user_active', 1, 'http', ?, '{"day":"${day}"}', '${day} 12:00:00')`,
      );
    const rows = [
      ...mkRows(1, 10, d1),
      ...mkRows(7, 6, d7),
      ...mkRows(14, 4, d14),
      ...mkRows(28, 2, d28),
    ];
    const args = [
      ...uids, // D+1: 10 user
      ...uids.slice(0, 6), // D+7: 6 user
      ...uids.slice(0, 4), // D+14: 4 user
      ...uids.slice(0, 2), // D+28: 2 user
    ];
    await turso.execute({
      sql: `INSERT INTO system_metrics (id, metric_name, metric_value, feature, user_id, metadata, created_at)
            VALUES\n${rows.join(',\n')}`,
      args,
    });

    return { cohortDay, d1, d7, d14, d28 };
  } finally {
    turso.close();
  }
}

/** Hapus fixture retention (user + user_active prefiks 'e2e-ret-') dari Turso. */
export async function cleanupRetentionFixtures(): Promise<void> {
  loadEnv();
  const turso = await createE2eTursoClient();
  try {
    await turso.execute({ sql: `DELETE FROM system_metrics WHERE id LIKE 'e2e-ret-%'`, args: [] });
    await turso.execute({ sql: `DELETE FROM user WHERE id LIKE 'e2e-ret-%'`, args: [] });
  } finally {
    turso.close();
  }
}
