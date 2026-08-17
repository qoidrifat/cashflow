/**
 * Setup project `unit-dom` (komponen React) — dijalankan OTOMATIS oleh vitest
 * sebelum setiap file test (didaftarkan via `test.setupFiles` di project
 * `unit-dom` vitest.config.ts). Pure-logic (`unit-node`) tidak memuat file ini.
 *
 * Menyediakan, SEKALI untuk seluruh project, dua hal yang dulu di-duplikasi
 * per file .tsx:
 *   1. Jest-dom matchers (toBeInTheDocument, toHaveClass, toBeDisabled, ...) —
 *      `import '@testing-library/jest-dom/vitest'` tidak perlu lagi di file test.
 *   2. afterEach(() => cleanup()) — karena vitest.config menonaktifkan globals,
 *      RTL TIDAK bisa auto-register afterEach cleanup; registrasi eksplisit di
 *      sini (unmount manual per test wajib — tanpa ini DOM menumpuk lintas
 *      test → getByText multiple elements).
 *      (Catatan: bila `globals: true` diaktifkan suatu saat nanti, RTL akan
 *      auto-register cleanup DAN registrasi di sini ikut jalan → cleanup 2×,
 *      tidak berbahaya — idempotent; baris ini tetap aman dibiarkan.)
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
