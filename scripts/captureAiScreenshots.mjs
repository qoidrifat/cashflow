/**
 * captureAiScreenshots.mjs — regenerasi screenshot halaman AI dalam SATU script:
 *   · AI Hub     (/ai)         — hero insight, health score, simulasi, timeline, memory
 *   · AI Timeline (/ai/timeline) — daftar event + detail view (event insight demo-tl-0)
 *   · AI Chat    (/ai/chat)    — hero + suggested queries + komposer (opsional: jawaban)
 *
 * Memakai engine bersama scripts/captureEngine.mjs — script ini hanya
 * MENDEFINISIKAN konfigurasi:
 *   · PAGES (path, waitText hero, shots dengan base nama + klik detail)
 *   · --chat-answer: shot tambahan `ai-chat-answer` dengan hook prepare yang
 *     mengirim query deterministik dan menunggu jawaban rich (polling toleran).
 *
 * Menjalankan:
 *   npm run capture:ai                                  # semua halaman, desktop 1280×900
 *   npm run capture:ai -- --viewport 375x812            # mobile 375×812
 *   node scripts/captureAiScreenshots.mjs --theme dark          # hanya dark
 *   node scripts/captureAiScreenshots.mjs --pages hub,chat      # subset halaman
 *   node scripts/captureAiScreenshots.mjs --chat-answer         # chat dengan jawaban (submit query)
 *   node scripts/captureAiScreenshots.mjs --out /tmp/shots
 *   node scripts/captureAiScreenshots.mjs --keep-data           # sesi dibiarkan
 *   node scripts/captureAiScreenshots.mjs --ci                  # CI: output ke folder
 *     temporer + summary.json + exit 0/1 (job GH Actions)
 *
 * Prasyarat: server dev berjalan (Vite 5180 + API 5181, `npm run dev:all`) +
 * browser Playwright terpasang (`npx playwright install chromium`).
 *
 * Output (docs/assets/screenshots/, nama stabil untuk in-place regeneration):
 *   Desktop (>480):  ai-hub-light(-dark).png · ai-timeline(-detail)-light(-dark).png · ai-chat-light(-dark).png
 *   Mobile  (≤480):  ai-hub-mobile(-dark).png · ai-timeline(-detail)-mobile(-dark).png · ai-chat-mobile(-dark).png
 *   --chat-answer:   ai-chat-answer(-mobile)(-dark).png
 */
import { loadEnv, parseArgs, THEMES, runCapture, exitForCapture } from './captureEngine.mjs';

/** User demo yang memiliki data lengkap (transaksi + timeline demo-tl-*). */
const DEMO_EMAIL = 'demo@cashflow.test';
/** Event detail yang dibuka di /ai/timeline: insight demo-tl-0 (evidence payload). */
const DETAIL_EVENT_TITLE = 'Pengeluaran makanan naik 27%';
/** Query yang dikirim saat --chat-answer (suggested query deterministik). */
const CHAT_QUERY = 'Kategori apa paling boros bulan ini?';

/**
 * Definisi halaman + shot. `waitText` = penanda halaman termuat (hero heading);
 * shot dengan `clickLabel` membuka detail dulu sebelum screenshot.
 */
const PAGES = [
  {
    id: 'hub',
    path: '/ai',
    waitText: 'Dashboard keuangan cerdas kamu',
    shots: [{ base: 'ai-hub' }],
  },
  {
    id: 'timeline',
    path: '/ai/timeline',
    waitText: 'Perjalanan finansialmu bersama AI',
    shots: [
      { base: 'ai-timeline' },
      {
        base: 'ai-timeline-detail',
        clickLabel: `Lihat detail ${DETAIL_EVENT_TITLE}`,
        waitText: 'Mengapa AI mengatakan ini',
      },
    ],
  },
  {
    id: 'chat',
    path: '/ai/chat',
    waitText: 'Tanya keuanganmu dengan bahasa sehari-hari',
    shots: [{ base: 'ai-chat' }],
  },
];

/** Halaman terpilih: 'all' → semua; selain itu daftar id dipisah koma. */
function selectedPages(pagesArg) {
  if (pagesArg === 'all') return PAGES;
  const ids = new Set(pagesArg.split(',').map((s) => s.trim().toLowerCase()));
  return PAGES.filter((p) => ids.has(p.id));
}

/**
 * Hook prepare untuk shot ai-chat-answer: kirim query deterministik → tunggu
 * jawaban rich (kartu Ringkasan). Polling toleran: jawaban pertama bisa lambat
 * (Gemini/fallback); state error (bubble + "Coba lagi") menghentikan polling
 * agar tidak hang 60s per tema — screenshot tetap diambil apa adanya.
 */
async function prepareChatAnswer(page) {
  await page.getByRole('button', { name: CHAT_QUERY }).first().click().catch(() => {});
  const deadline = Date.now() + 60000;
  let answered = false;
  while (Date.now() < deadline) {
    const has = await page
      .getByText('Ringkasan', { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (has) { answered = true; break; }
    // Gagal cepat (401/500/rate-limit): bubble error + tombol "Coba lagi".
    const failed = await page
      .getByText('Coba lagi', { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (failed) { break; }
    await page.waitForTimeout(1000);
  }
  console.log(`[capture] chat-answer ${answered ? 'TERJAWAB' : 'TIMEOUT/ERROR'} (tunggu hingga 60s)`);
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2), {
    defaults: { pages: 'all', chatAnswer: false },
    booleans: ['--chat-answer'],
    values: ['--pages'],
  });
  const themes = THEMES(args.theme);
  const mobile = args.width <= 480;
  let pages = selectedPages(args.pages);
  console.log(
    `[capture] AI pages: ${pages.map((p) => p.id).join(',')} · user: ${args.email || DEMO_EMAIL} · theme: ${themes.join('+')} · viewport: ${args.width}x${args.height}${mobile ? ' (mobile)' : ''} · out: ${args.out}`,
  );

  if (pages.length === 0) {
    console.error('[capture] --pages tidak cocok. Opsi: hub, timeline, chat (atau all).');
    process.exit(1);
  }

  // --chat-answer: tambahkan shot ai-chat-answer (prepare = submit + polling).
  // Spread PAGES (bukan mutasi array module-level) — aman walau runCapture
  // dipanggil ulang dalam satu proses.
  if (args.chatAnswer) {
    pages = pages.map((p) =>
      p.id === 'chat'
        ? { ...p, shots: [...p.shots, { base: 'ai-chat-answer', prepare: prepareChatAnswer }] }
        : p,
    );
  }

  const result = await runCapture({
    email: args.email || DEMO_EMAIL,
    width: args.width,
    height: args.height,
    themes,
    out: args.out,
    keepData: args.keepData,
    ci: args.ci,
    pages,
  });
  // CI: exit 1 bila ada kegagalan (shot/setup/waitText/cleanup) — job gagal.
  exitForCapture(result, args.ci);
}

main().catch((err) => {
  console.error('[capture] GAGAL:', err.message);
  process.exit(1);
});
