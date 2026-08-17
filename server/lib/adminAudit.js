/**
 * adminAudit.js — audit trail admin (P0.3), SINGLE SOURCE OF TRUTH untuk
 * menulis entri admin_audit_log.
 *
 * LATAR BELAKANG: tabel admin_audit_log dibuat untuk endpoint suspend
 * (2026-08-09). Helper ini men-sentralkan INSERT-nya agar route lain
 * (account deletion, admin actions baru) TIDAK menyalin SQL.
 *
 * PRINSIP:
 *   - Metadata SANITIZED: object kecil, non-secret (jangan kirim token,
 *     cookie, payload finansial, isi Gmail — lihat docs/security/
 *     ADMIN_AUDIT_TRAIL.md §Metadata).
 *   - `result`: 'success' | 'failure' | 'denied' — gagal & ditolak DICATAT
 *     (nilai keamanan: percobaan privileged yang gagal).
 *   - requestId dari req.id (requestIdMiddleware) — korelasi audit ↔ log.
 *   - Pemanggil menentukan fail-open/fail-closed:
 *       * Jalur operasi (success): audit + operasi dalam SATU batch atomik
 *         (audit tidak pernah hilang; operasi tidak pernah sukses tanpa audit).
 *       * Jalur error/denied: audit ditulis BEST-EFFORT (fail-open) — kegagalan
 *         audit TIDAK boleh menimpa respons 4xx/5xx yang sudah benar.
 *     (Keputusan didokumentasikan docs/security/ADMIN_AUDIT_TRAIL.md §Fail policy.)
 *
 * Pemanggil:
 *   - server/routes/adminMetricsRoutes.js (suspend — refactor memakai helper)
 *   - server/routes/privacyRoutes.js (account deletion)
 */
import crypto from 'node:crypto';

/** INSERT audit — kolom result & request_id (migration 0002). */
export const ADMIN_AUDIT_INSERT_SQL = `
INSERT INTO admin_audit_log
  (id, action, target_user_id, target_email, actor_user_id, actor_email,
   metadata, result, request_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Bangun statement INSERT audit (PURE — tanpa eksekusi) untuk komposisi batch
 * atomik (pola suspend: [INSERT audit, DELETE sesi] dalam SATU batch).
 *
 * @param {{
 *   action: string,
 *   actorUserId: string,
 *   actorEmail?: string,
 *   targetUserId?: string,
 *   targetEmail?: string,
 *   metadata?: Record<string, unknown>,
 *   result?: 'success' | 'failure' | 'denied',
 *   requestId?: string,
 * }} entry
 * @returns {{ sql: string, args: unknown[], auditId: string }}
 */
export function buildAdminAuditStatement(entry) {
  const metadata = sanitizeMetadata(entry.metadata || {});
  const id = crypto.randomUUID();
  return {
    sql: ADMIN_AUDIT_INSERT_SQL,
    args: [
      id,
      String(entry.action || 'unknown_action'),
      entry.targetUserId || null,
      entry.targetEmail || null,
      String(entry.actorUserId || ''),
      // ?? (bukan ||) — string kosong (email REDACT untuk deletion) harus
      // dipertahankan, bukan diubah jadi null.
      entry.actorEmail ?? null,
      JSON.stringify(metadata),
      entry.result || 'success',
      entry.requestId || null,
    ],
    auditId: id,
  };
}

/**
 * Tulis satu entri audit admin (atau user-initiated privileged action).
 * Fail-open di sisi pemanggil (error audit DITERUSKAN — pemanggil memutuskan
 * apakah operasi utama tetap lanjut).
 *
 * @param {import('@libsql/client').Client} client
 * @param {Parameters<typeof buildAdminAuditStatement>[0]} entry
 * @returns {Promise<{ id: string }>}
 */
export async function recordAdminAudit(client, entry) {
  const stmt = buildAdminAuditStatement(entry);
  await client.execute({ sql: stmt.sql, args: stmt.args });
  return { id: stmt.auditId };
}

/**
 * Sanitize metadata sebelum masuk audit: hanya nilai primitif (string/number/
 * boolean/null); objek/array dipetakan jadi string ringkas; key yang mencurigakan
 * (token/secret/password/cookie/authorization) DIBUANG. PII: email/name user
 * BOLEH masuk sebagai target/actor (kolom khusus), bukan di metadata.
 */
export function sanitizeMetadata(metadata) {
  const BLOCKED_KEYS = /token|secret|password|cookie|authorization|credential|api[_-]?key/i;
  const out = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (BLOCKED_KEYS.test(key)) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = `[array:${value.length}]`;
    } else if (typeof value === 'object') {
      out[key] = '[object]';
    }
  }
  return out;
}
