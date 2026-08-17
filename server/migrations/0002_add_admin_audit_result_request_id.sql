-- =============================================
-- CashFlow Database Migration — 0002
-- admin_audit_log: result + request_id (P0.3 Admin Audit Trail)
-- =============================================
-- Kontrak docs/security/ADMIN_AUDIT_TRAIL.md: audit harus mencatat hasil
-- (SUCCESS / FAILURE / DENIED) dan requestId agar setiap entri bisa
-- dikorelasikan dengan log/metrics (pola requestIdMiddleware di index.js).
--
-- Backward-compatible:
--   * result TEXT NOT NULL DEFAULT 'success' — baris lama (mis. dari endpoint
--     suspend sebelum migration ini) otomatis ber-status 'success'.
--   * request_id TEXT nullable — opsional, baris lama NULL.
--   * INSERT existing yang tidak menyebut kedua kolom tetap valid (default).
--
-- Aman di DB fresh (kolom belum ada) maupun existing (kolom belum ada).
ALTER TABLE admin_audit_log ADD COLUMN result TEXT NOT NULL DEFAULT 'success';
ALTER TABLE admin_audit_log ADD COLUMN request_id TEXT;
