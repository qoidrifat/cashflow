/**
 * Conversation Aggregator (Sprint 1.5 — P8 Natural Conversation)
 *
 * Logika MURNI & DETERMINISTIK untuk endpoint POST /api/ai-product/conversation:
 *   - computeDateRange          — rentang periode & periode sebelumnya
 *   - aggregateConversationStats— agregasi transaksi (total, delta, harian,
 *                                 kategori, merchant, transaksi terbesar)
 *   - buildConversationPrompt   — prompt Gemini (output JSON terstruktur)
 *   - buildConversationFallback — narasi deterministik bila Gemini gagal
 *   - normalizeConversationNarrative — sanitasi output AI (anti prompt-injection)
 *
 * Semua fungsi pure (tanpa I/O) sehingga mudah di-unit-test dan tidak bergantung
 * pada env Vertex AI. Nominal dibulatkan ke rupiah penuh.
 */
export const DEFAULT_PERIOD_DAYS = 30;
export const PERIOD_DAYS_OPTIONS = [7, 30, 90];

/** Label periode ramah user: "7 hari terakhir", "30 hari terakhir", "3 bulan terakhir". */
export function conversationPeriodLabel(periodDays) {
  if (periodDays === 7) return '7 hari terakhir';
  if (periodDays === 90) return '3 bulan terakhir';
  return '30 hari terakhir';
}

/** Key tanggal lokal YYYY-MM-DD. */
function toDateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Hitung rentang periode (inklusi) + periode sebelumnya untuk perbandingan delta.
 * now: Date (default hari ini, waktu lokal).
 */
export function computeDateRange(periodDays, now = new Date()) {
  const days = PERIOD_DAYS_OPTIONS.includes(periodDays) ? periodDays : DEFAULT_PERIOD_DAYS;
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days);
  return {
    periodDays: days,
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    prevStartDate: toDateKey(prevStart),
    prevEndDate: toDateKey(prevEnd),
  };
}

/**
 * Sanitasi nama kategori/merchant/note sebelum masuk prompt atau respons:
 * buang control character, normalisasi spasi, cap panjang. Anti prompt-injection
 * konten user (pola yang sama dengan sanitizeMetrics di geminiRoutes).
 */
export function sanitizeConversationName(value, max = 48) {
  const raw = typeof value === 'string' ? value : '';
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return cleaned || 'Lainnya';
}

/**
 * Agregasi transaksi untuk percakapan.
 * rows: array { id, type, amount, category_name, merchant, note, date } (date YYYY-MM-DD).
 * Mengembalikan statistik siap-pakai UI + prompt (semua nominal Math.round).
 */
export function aggregateConversationStats(rows, { startDate, endDate, prevStartDate, prevEndDate }) {
  const current = [];
  const previous = [];
  for (const r of rows || []) {
    const d = r && typeof r.date === 'string' ? r.date.slice(0, 10) : '';
    if (!d) continue;
    if (d >= startDate && d <= endDate) current.push(r);
    else if (d >= prevStartDate && d <= prevEndDate) previous.push(r);
  }

  const sumBy = (arr, type) =>
    arr.reduce((s, r) => (r && r.type === type ? s + (Number(r.amount) || 0) : s), 0);

  const income = sumBy(current, 'income');
  const expense = sumBy(current, 'expense');
  const prevIncome = sumBy(previous, 'income');
  const prevExpense = sumBy(previous, 'expense');

  /** Delta % (1 desimal), null bila periode sebelumnya 0 (tidak ada basis). */
  const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

  // ── Seri harian lengkap (0 untuk hari tanpa transaksi) — untuk chart ──
  const dailyMap = new Map();
  const cursor = new Date(`${startDate}T00:00:00`);
  const endDt = new Date(`${endDate}T00:00:00`);
  while (cursor <= endDt) {
    const key = toDateKey(cursor);
    dailyMap.set(key, { date: key, income: 0, expense: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const r of current) {
    const key = r.date.slice(0, 10);
    const entry = dailyMap.get(key);
    if (!entry) continue;
    const amt = Number(r.amount) || 0;
    if (r.type === 'income') entry.income += amt;
    else if (r.type === 'expense') entry.expense += amt;
  }
  const daily = [...dailyMap.values()];

  // ── Kategori pengeluaran ──
  const catMap = new Map();
  for (const r of current) {
    if (r.type !== 'expense') continue;
    const name = sanitizeConversationName(r.category_name, 48);
    const cur = catMap.get(name) || { name, amount: 0, count: 0 };
    cur.amount += Number(r.amount) || 0;
    cur.count += 1;
    catMap.set(name, cur);
  }
  const categories = [...catMap.values()]
    .map((c) => ({
      name: c.name,
      amount: Math.round(c.amount),
      count: c.count,
      pct: expense > 0 ? Math.round((c.amount / expense) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  // ── Merchant pengeluaran teratas ──
  const merchMap = new Map();
  for (const r of current) {
    if (r.type !== 'expense') continue;
    const m = sanitizeConversationName(r.merchant, 48);
    if (!m || m === 'Lainnya') continue;
    const cur = merchMap.get(m) || { merchant: m, amount: 0, count: 0 };
    cur.amount += Number(r.amount) || 0;
    cur.count += 1;
    merchMap.set(m, cur);
  }
  const topMerchants = [...merchMap.values()]
    .map((m) => ({ merchant: m.merchant, amount: Math.round(m.amount), count: m.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // ── Transaksi pengeluaran terbesar ──
  const topTransactions = current
    .filter((r) => r.type === 'expense')
    .map((r) => ({
      id: String(r.id || ''),
      merchant: sanitizeConversationName(r.merchant, 48),
      note: sanitizeConversationName(r.note, 80),
      categoryName: sanitizeConversationName(r.category_name, 48),
      amount: Math.round(Number(r.amount) || 0),
      date: r.date.slice(0, 10),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const expenseCount = current.filter((r) => r.type === 'expense').length;
  const incomeCount = current.filter((r) => r.type === 'income').length;

  return {
    income: Math.round(income),
    expense: Math.round(expense),
    net: Math.round(income - expense),
    prevIncome: Math.round(prevIncome),
    prevExpense: Math.round(prevExpense),
    prevNet: Math.round(prevIncome - prevExpense),
    expenseDeltaPct: pct(expense, prevExpense),
    incomeDeltaPct: pct(income, prevIncome),
    transactionCount: current.length,
    expenseCount,
    incomeCount,
    daily,
    categories,
    topMerchants,
    topTransactions,
    hasData: expenseCount + incomeCount > 0,
  };
}

/** Subset statistik untuk prompt AI (angka + nama tersanitasi, cap panjang). */
function statsForPrompt(stats) {
  return {
    periodLabel: null, // diisi pemanggil
    income: stats.income,
    expense: stats.expense,
    net: stats.net,
    prevIncome: stats.prevIncome,
    prevExpense: stats.prevExpense,
    prevNet: stats.prevNet,
    expenseDeltaPct: stats.expenseDeltaPct,
    incomeDeltaPct: stats.incomeDeltaPct,
    expenseCount: stats.expenseCount,
    incomeCount: stats.incomeCount,
    topCategories: stats.categories.slice(0, 5).map((c) => ({ name: c.name, amount: c.amount, pct: c.pct })),
    topMerchants: stats.topMerchants.slice(0, 3).map((m) => ({ merchant: m.merchant, amount: m.amount })),
    topExpenses: stats.topTransactions.slice(0, 3).map((t) => ({
      merchant: t.merchant,
      categoryName: t.categoryName,
      amount: t.amount,
      date: t.date,
    })),
  };
}

/**
 * Prompt Gemini untuk percakapan finansial — gaya buildAdvisorPrompt
 * (Bahasa Indonesia, output SATU JSON, aturan ketat, anti-halusinasi).
 */
export function buildConversationPrompt({ query, periodDays, stats, periodLabel }) {
  const data = statsForPrompt(stats);
  data.periodLabel = periodLabel;
  const q = sanitizeConversationName(query, 200);
  return `Kamu adalah AI asisten keuangan personal CashFlow Indonesia yang menjawab pertanyaan pengguna berdasarkan DATA TRANSAKSI NYATA pengguna itu sendiri.

Pertanyaan pengguna: "${q}"

Tugas: Jawab pertanyaan secara langsung, jujur, dan praktis. Bila data tidak mendukung klaim, katakan demikian. JANGAN menyebut akses rekening bank — analisis hanya dari data aplikasi. Gunakan bahasa Indonesia natural dan singkat.

Keluarkan SATU JSON OBJECT VALID SAJA. Tidak ada markdown, tidak ada code block, tidak ada teks lain.

OUTPUT SCHEMA (semua key wajib ada):
{
  "summary": "string, maksimal 3 kalimat, langsung menjawab pertanyaan",
  "insights": [
    { "title": "string pendek", "detail": "string 1-2 kalimat", "severity": "high | medium | low" }
  ],
  "recommendations": [
    { "title": "string pendek", "action": "string langkah konkret", "href": "salah satu dari /transactions | /budgets | /advisor | /ai | /reports", "impact": "string estimasi dampak singkat" }
  ]
}

ATURAN:
1. summary: maksimal 3 kalimat, menjawab pertanyaan user, sebut angka kunci (IDR).
2. insights: maksimal 3 item — pola penting (kategori boros, kenaikan pengeluaran, transaksi aneh).
3. recommendations: maksimal 3 item — action executable; href WAJIB dari daftar yang diberikan.
4. severity hanya "high" | "medium" | "low".
5. Jangan gunakan trailing comma, undefined, NaN, atau null.
6. Gunakan angka bulat untuk nominal (IDR).
7. Jangan mengarang angka di luar data yang diberikan.

Data ringkasan pengguna (JSON):
${JSON.stringify(data).substring(0, 9000)}`;
}

/**
 * Narasi DETERMINISTIK bila Gemini tidak tersedia/gagal — tidak pernah
 * menampilkan raw error ke user (trust.source = 'rule-based').
 */
export function buildConversationFallback({ query, periodDays, stats }) {
  const label = conversationPeriodLabel(periodDays);
  const parts = [];

  if (!stats.hasData) {
    return {
      summary: `Belum ada transaksi tercatat pada ${label}. Catat pemasukan dan pengeluaranmu lebih dulu agar AI bisa menjelaskan pola keuangannya.`,
      insights: [],
      recommendations: [
        {
          title: 'Catat transaksi',
          action: 'Tambahkan transaksi pemasukan dan pengeluaran secara rutin.',
          href: '/transactions',
          impact: 'AI bisa mulai menganalisis pola keuanganmu.',
        },
      ],
    };
  }

  const fmt = (n) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
  const deltaTxt =
    stats.expenseDeltaPct === null
      ? 'belum bisa dibandingkan dengan periode sebelumnya (tidak ada data dasar)'
      : stats.expenseDeltaPct > 0
        ? `naik ${stats.expenseDeltaPct}% dibanding periode sebelumnya`
        : stats.expenseDeltaPct < 0
          ? `turun ${Math.abs(stats.expenseDeltaPct)}% dibanding periode sebelumnya`
          : 'stabil dibanding periode sebelumnya';
  const topCat = stats.categories[0];

  parts.push(
    `Pada ${label}, total pengeluaran ${fmt(stats.expense)} dan pemasukan ${fmt(stats.income)} (selisih ${fmt(stats.net)}). ` +
    `Pengeluaran ${deltaTxt}.`,
  );
  if (topCat) {
    parts.push(`Kategori pengeluaran terbesar adalah ${topCat.name} sebesar ${fmt(topCat.amount)} (${topCat.pct}% dari total pengeluaran).`);
  }

  const insights = [];
  if (topCat && topCat.pct >= 30) {
    insights.push({
      title: `${topCat.name} mendominasi`,
      detail: `${topCat.name} mengambil ${topCat.pct}% dari total pengeluaran ${label}.`,
      severity: topCat.pct >= 50 ? 'high' : 'medium',
    });
  }
  if (stats.expenseDeltaPct !== null && stats.expenseDeltaPct > 20) {
    insights.push({
      title: 'Pengeluaran naik signifikan',
      detail: `Pengeluaran naik ${stats.expenseDeltaPct}% dibanding periode sebelumnya.`,
      severity: 'high',
    });
  }
  if (stats.topTransactions[0]) {
    insights.push({
      title: 'Transaksi terbesar',
      detail: `Transaksi terbesar: ${stats.topTransactions[0].merchant || 'Tanpa merchant'} sebesar ${fmt(stats.topTransactions[0].amount)}.`,
      severity: 'medium',
    });
  }

  const recommendations = [];
  if (topCat) {
    recommendations.push({
      title: 'Tinjau pengeluaran ' + topCat.name,
      action: `Cek daftar transaksi ${topCat.name} pada ${label} dan tandai mana yang bisa dikurangi.`,
      href: '/transactions',
      impact: `Potensi hemat hingga ${fmt(Math.round(topCat.amount * 0.2))} (20% dari ${topCat.name}).`,
    });
  }
  if (stats.topMerchants[0]) {
    recommendations.push({
      title: 'Pantau merchant ' + stats.topMerchants[0].merchant,
      action: `Total pengeluaran di ${stats.topMerchants[0].merchant} mencapai ${fmt(stats.topMerchants[0].amount)} (${stats.topMerchants[0].count} transaksi).`,
      href: '/transactions',
      impact: 'Mengurangi frekuensi bisa menurunkan pengeluaran bulanan.',
    });
  }
  recommendations.push({
    title: 'Susun budget kategori',
    action: 'Buat batas budget per kategori agar pengeluaran terkendali.',
    href: '/budgets',
    impact: 'Pengingat otomatis saat budget mendekati batas.',
  });

  return {
    summary: parts.join(' '),
    insights: insights.slice(0, 3),
    recommendations: recommendations.slice(0, 3),
  };
}

/** Severity output AI dibatasi enum; default 'low'. */
function normalizeSeverity(v) {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}

/** Whitelist href rekomendasi — mencegah link arbitrer dari output AI. */
const ALLOWED_HREFS = ['/transactions', '/budgets', '/advisor', '/ai', '/reports'];

/**
 * Sanitasi output AI (narrative) sebelum dikirim ke user:
 * string di-cap, array di-cap, enum divalidasi, href di-whitelist.
 */
export function normalizeConversationNarrative(data) {
  const src = data && typeof data === 'object' ? data : {};
  const str = (v, max, fallback) => {
    const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
    return (s ? s.slice(0, max) : fallback);
  };
  const insights = Array.isArray(src.insights)
    ? src.insights.slice(0, 3).map((i) => ({
        title: str(i?.title, 120, 'Insight'),
        detail: str(i?.detail, 400, ''),
        severity: normalizeSeverity(i?.severity),
      }))
    : [];
  const recommendations = Array.isArray(src.recommendations)
    ? src.recommendations.slice(0, 3).map((r) => ({
        title: str(r?.title, 120, 'Rekomendasi'),
        action: str(r?.action, 400, ''),
        href: ALLOWED_HREFS.includes(r?.href) ? r.href : '/advisor',
        impact: str(r?.impact, 200, ''),
      }))
    : [];
  return {
    summary: str(src.summary, 700, 'Analisis selesai — lihat rincian di bawah.'),
    insights,
    recommendations,
  };
}
