/**
 * Category Filter — helper murni untuk input filter kategori di AI Search.
 *
 * Mirror PERSIS aturan sanitasi server (server/routes/agentSearchRoutes.js →
 * validateSearchFilters): `value.category.trim().replace(/["\\]/g, '')` dengan
 * batas 1–80 karakter. Client men-sanitasi live agar request yang dikirim
 * selalu valid (defense-in-depth — server tetap men-strip ulang).
 */

export const CATEGORY_FILTER_MAX_LENGTH = 80;

/**
 * Normalisasi input kategori filter:
 * - trim spasi tepi
 * - buang karakter berbahaya untuk filter string Discovery Engine: `"` dan `\`
 * - potong ke 80 karakter (batas server)
 */
export function sanitizeCategoryInput(value: string): string {
  return value.trim().replace(/["\\]/g, '').slice(0, CATEGORY_FILTER_MAX_LENGTH);
}
