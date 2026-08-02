/**
 * Turso Database Client
 * Singleton instance for the Turso/libSQL database connection.
 */
import { createClient } from '@libsql/client';

let client = null;

import fs from 'node:fs';
import path from 'node:path';

export function getTurso() {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.warn('[Turso] TURSO_DATABASE_URL belum diisi.');
    return null;
  }

  client = createClient({
    url,
    authToken: authToken || undefined,
  });

  console.log(`[Turso] Database client siap (${url}).`);
  initTursoSchema(client).catch((err) => console.error('[Turso] Error initializing schema:', err));
  return client;
}

export function isTursoReady() {
  return !!client || !!process.env.TURSO_DATABASE_URL;
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
    console.log('[Turso] Schema database berhasil diverifikasi.');
  } catch (err) {
    console.warn('[Turso] Warning initializing schema:', err.message);
  }
}

