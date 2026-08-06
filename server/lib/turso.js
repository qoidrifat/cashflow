/**
 * Turso Database Client
 * Singleton instance for the Turso/libSQL database connection.
 */
import { createClient } from '@libsql/client';
import { logger } from './logger.js';
import { withRetry, TRANSIENT_RE, isConstraintError } from './retry.js';

let client = null;

import fs from 'node:fs';
import path from 'node:path';

export function getTurso() {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    logger.warn({}, 'TURSO_DATABASE_URL belum diisi');
    return null;
  }

  client = createClient({
    url,
    authToken: authToken || undefined,
  });

  logger.info({ url }, 'Database client Turso siap');
  initTursoSchema(client).catch((err) => logger.error({ err: err.message }, 'Error initializing schema'));
  return client;
}

export function isTursoReady() {
  return !!client || !!process.env.TURSO_DATABASE_URL;
}

/**
 * Tutup koneksi Turso (graceful shutdown). Reset singleton agar bisa
 * direinitialisasi (mis. setelah reconnect/test).
 */
export function closeTurso() {
  if (client) {
    try {
      client.close();
    } catch (err) {
      logger.warn({ err: err.message }, 'close error');
    }
    client = null;
  }
}

/**
 * Apply turso-schema.sql (IDEMPOTEN) terhadap client.
 *
 * @param {import('@libsql/client').Client} tursoClient
 * @param {{ retry?: boolean }} [options]
 *   retry: false (default, perilaku lama) — error statement di-ignore seperti
 *   sebelumnya (schema idempoten). retry: true — setiap statement dijalankan
 *   via withRetry (transient → exponential backoff); error transient yang
 *   persist setelah attempts habis di-RE-THROW (tidak lagi disembunyikan)
 *   supaya caller tahu apply schema gagal, bukan diam-diam "sukses" dengan
 *   schema tidak lengkap. Error constraint tetap di-ignore (idempoten).
 */
export async function initTursoSchema(tursoClient, { retry = false } = {}) {
  try {
    const schemaPath = path.resolve(process.cwd(), '..', 'turso-schema.sql');
    const altSchemaPath = path.resolve(process.cwd(), 'turso-schema.sql');
    const targetPath = fs.existsSync(schemaPath) ? schemaPath : (fs.existsSync(altSchemaPath) ? altSchemaPath : null);

    if (!targetPath) return;

    const sqlContent = fs.readFileSync(targetPath, 'utf8').replace(/--.*$/gm, '');
    const statements = sqlContent
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        if (retry) {
          await withRetry(() => tursoClient.execute(stmt), { label: 'schema stmt', logPrefix: '[schema]' });
        } else {
          await tursoClient.execute(stmt);
        }
      } catch (err) {
        // ignore duplicate index/table errors if existing (schema idempoten).
        // Bila retry aktif: RE-THROW HANYA error transient yang sudah habis
        // di-retry (TRANSIENT_RE match) — jadi apply gagal terang-terangan,
        // bukan "sukses" dengan schema tidak lengkap. Error non-transient /
        // constraint tetap di-ignore (perilaku lama dipertahankan — statement
        // schema yang error tanpa dampak tidak memecah CI).
        const msg = String(err?.message || err);
        if (retry && TRANSIENT_RE.test(msg) && !isConstraintError(msg)) {
          throw err;
        }
      }
    }
    logger.info({}, 'Schema database Turso terverifikasi');
  } catch (err) {
    logger.warn({ err: err.message }, 'Warning initializing schema');
    // retry mode: transient persisten harus sampai ke caller (apply schema
    // perlu exit non-zero) — default (retry:false) tetap menelan seperti dulu.
    if (retry) throw err;
  }
}

