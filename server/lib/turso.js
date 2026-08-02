/**
 * Turso Database Client
 * Singleton instance for the Turso/libSQL database connection.
 */
import { createClient } from '@libsql/client';
import { logger } from './logger.js';

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

export async function initTursoSchema(tursoClient) {
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
        await tursoClient.execute(stmt);
      } catch (err) {
        // ignore duplicate index/table errors if existing
      }
    }
    logger.info({}, 'Schema database Turso terverifikasi');
  } catch (err) {
    logger.warn({ err: err.message }, 'Warning initializing schema');
  }
}

