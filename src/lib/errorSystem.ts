/**
 * Error System (Sprint 1 — Core Product).
 *
 * Standardisasi error frontend:
 *   - pesan ramah Bahasa Indonesia (tidak pernah menampilkan error mentah backend)
 *   - ekstraksi requestId + errorCode dari respons server (observability)
 *   - penanda retryable (untuk aksi "Coba Lagi")
 *
 * Dipakai oleh ErrorState (shared UI) dan halaman yang menampilkan error.
 */

export interface AppErrorInfo {
  message: string;
  code?: string;
  requestId?: string;
  retryable: boolean;
}

/** Pola pesan mentah → pesan ramah. Diuji berurutan; pola pertama yang cocok menang. */
const FRIENDLY_PATTERNS: Array<{ test: RegExp; message: string; retryable?: boolean }> = [
  {
    test: /schema cache|could not find the table/i,
    message: 'Database belum siap. Pastikan server API aktif dan data sudah dimigrasi.',
  },
  {
    test: /permission denied|row-level security/i,
    message: 'Data tidak bisa dibaca karena policy akses belum mengizinkan akun kamu.',
  },
  {
    test: /failed to fetch|network error|econnreset|econnrefused|network request failed/i,
    message: 'Tidak bisa terhubung ke server. Periksa koneksi internet dan coba lagi.',
    retryable: true,
  },
  {
    test: /timeout|timed out|deadline exceeded/i,
    message: 'Server membutuhkan waktu terlalu lama. Coba lagi sebentar lagi.',
    retryable: true,
  },
  {
    test: /quota|rate limit|too many requests/i,
    message: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
    retryable: true,
  },
  {
    test: /unauthorized|401|sesi.*berakhir/i,
    message: 'Sesi kamu berakhir. Silakan masuk kembali.',
  },
  {
    test: /forbidden|403|akses ditolak/i,
    message: 'Akses ditolak. Kamu tidak memiliki izin untuk aksi ini.',
  },
  {
    test: /validation|tidak valid|harus berupa|maksimal/i,
    message: 'Ada data yang belum valid. Periksa kembali isian kamu.',
  },
];

/** Ambil field terstandardisasi dari error server (errorCode / requestId / retryable). */
function extractFields(error: unknown): { code?: string; requestId?: string; retryable?: boolean } {
  if (!error || typeof error !== 'object') return {};
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.errorCode === 'string' ? e.errorCode
      : typeof e.code === 'string' ? e.code
        : undefined,
    requestId: typeof e.requestId === 'string' ? e.requestId : undefined,
    retryable: typeof e.retryable === 'boolean' ? e.retryable : undefined,
  };
}

/**
 * Ubah error mentah menjadi info ramah untuk UI.
 * Tidak pernah throw — selalu mengembalikan AppErrorInfo.
 */
export function friendlyErrorMessage(error: unknown): AppErrorInfo {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const rawMessage = raw.trim() || 'Terjadi kesalahan tak terduga.';
  const { code, requestId, retryable } = extractFields(error);

  for (const pattern of FRIENDLY_PATTERNS) {
    if (pattern.test.test(rawMessage)) {
      return {
        message: pattern.message,
        code,
        requestId,
        retryable: pattern.retryable ?? retryable ?? false,
      };
    }
  }
  return { message: rawMessage, code, requestId, retryable: retryable ?? false };
}


