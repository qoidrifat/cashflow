/**
 * Shared Validation Foundation (P1-2 — Validation Layer).
 *
 * Perpustakaan validator TERBAGI untuk semua route group. Empat route group
 * (transactions, notifications, gmail, admin) memakai fungsi-fungsi ini agar
 * perilaku validasi konsisten dan tidak lagi ditulis ulang per-route.
 *
 * Kontrak hasil (mengikuti pola server/lib/notificationGuard.js):
 *
 *   { ok: true, value: <cleaned> } | { ok: false, error: <string manusia> }
 *
 * Prinsip:
 *  - MURNI: tanpa DB, jaringan, logging, atau side effect. Logging kegagalan
 *    validasi adalah tanggung jawab pemanggil (server/lib/logger.js).
 *  - FAIL-CLOSED: input tidak bisa diparse → error. TIDAK ADA default permisif
 *    diam-diam. Pengecualian satu-satunya: field opsional yang absen
 *    (undefined/null) → ok dengan value undefined.
 *  - `error` SELALU string human-readable (frontend menampilkan body error
 *    CRUD sebagai teks mentah). Validasi gagal → route merespons 400,
 *    JANGAN PERNAH 401 (401 khusus autentikasi).
 *  - Koersi konsisten dengan pola existing: numeric string diterima untuk
 *    int/amount (Number()), query param selalu tiba sebagai string.
 *
 * CATATAN MODUL: repo ini `"type": "module"` (package.json) dan seluruh
 * server memakai ESM (lihat notificationGuard.js) — maka file ini ESM dengan
 * JSDoc typing, bukan CommonJS, agar bisa di-import route tanpa shim.
 */

/** @typedef {{ ok: true, value?: any } | { ok: false, error: string }} ValidationResult */

/** Batas panjang aman untuk id string (konsisten guard emailId di gmailRoutes). */
const ID_MAX_LENGTH = 191;

/** Batas panjang default string (anti payload raksasa). */
const DEFAULT_STRING_MAX = 1000;

/**
 * @param {*} value
 * @returns {ValidationResult}
 */
function okResult(value) {
  return { ok: true, value };
}

/**
 * @param {string} message
 * @returns {ValidationResult}
 */
function failResult(message) {
  return { ok: false, error: message };
}

/** Apakah nilai dianggap "absen" (undefined/null)? */
function isAbsent(value) {
  return value === undefined || value === null;
}

/**
 * Wajib diisi: string bukan-kosong, di-trim, panjang dalam [min, max].
 *
 * @param {*} value
 * @param {{ field: string, min?: number, max?: number }} opts
 * @returns {ValidationResult} value = string hasil trim.
 */
export function validateRequiredString(value, opts) {
  const { field, min = 1, max = DEFAULT_STRING_MAX } = opts || {};
  if (typeof value !== 'string') {
    return failResult(`${field} wajib diisi.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return failResult(`${field} wajib diisi.`);
  }
  if (trimmed.length < min) {
    return failResult(`${field} minimal ${min} karakter.`);
  }
  if (trimmed.length > max) {
    return failResult(`${field} maksimal ${max} karakter.`);
  }
  return okResult(trimmed);
}

/**
 * Opsional: absen (undefined/null) → ok dengan value undefined.
 *
 * Keputusan terdokumentasi: string kosong / hanya-whitespace DINORMALISASI
 * menjadi undefined (dianggap absen), BUKAN error — cocok untuk query param
 * seperti `?search=`. String non-kosong tetap di-trim dan dibatasi `max`.
 *
 * @param {*} value
 * @param {{ field: string, max?: number }} opts
 * @returns {ValidationResult} value = string trim atau undefined.
 */
export function validateOptionalString(value, opts) {
  const { field, max = DEFAULT_STRING_MAX } = opts || {};
  if (isAbsent(value)) return okResult(undefined);
  if (typeof value !== 'string') {
    return failResult(`${field} harus berupa teks.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return okResult(undefined);
  if (trimmed.length > max) {
    return failResult(`${field} maksimal ${max} karakter.`);
  }
  return okResult(trimmed);
}

/**
 * Whitelist enum. `values` boleh array ATAU Set.
 *
 * @param {*} value
 * @param {{ field: string, values: ReadonlyArray<*> | Set<*>, required?: boolean }} opts
 * @returns {ValidationResult} value = anggota whitelist persis seperti input.
 */
export function validateEnum(value, opts) {
  const { field, values, required = false } = opts || {};
  if (isAbsent(value) || value === '') {
    if (required) return failResult(`${field} wajib diisi.`);
    return okResult(undefined);
  }
  const allowed = values instanceof Set ? values : new Set(values);
  if (allowed.has(value)) return okResult(value);
  const list = Array.from(allowed).join(', ');
  return failResult(`${field} harus salah satu dari: ${list}.`);
}

/**
 * Bilangan bulat. Menerima number bulat ATAU numeric string via Number().
 *
 * Mode di luar rentang:
 *  - opts.clamp = true  → nilai dipotong ke [min, max] (pola GET
 *    notifications: limit/offset di-clamp, bukan ditolak).
 *  - opts.clamp falsy   → di luar rentang = ERROR (fail-closed).
 *
 * @param {*} value
 * @param {{ field: string, min?: number, max?: number, required?: boolean, clamp?: boolean }} opts
 * @returns {ValidationResult} value = number bulat (atau undefined bila opsional absen).
 */
export function validateInt(value, opts) {
  const { field, min, max, required = false, clamp = false } = opts || {};
  if (isAbsent(value)) {
    if (required) return failResult(`${field} wajib diisi.`);
    return okResult(undefined);
  }
  let num;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    if (value.trim() === '') {
      if (required) return failResult(`${field} wajib diisi.`);
      return okResult(undefined);
    }
    num = Number(value);
  } else {
    return failResult(`${field} harus berupa bilangan bulat.`);
  }
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return failResult(`${field} harus berupa bilangan bulat.`);
  }
  if (clamp) {
    if (min !== undefined && num < min) num = min;
    if (max !== undefined && num > max) num = max;
  } else {
    if (min !== undefined && num < min) {
      return failResult(`${field} minimal ${min}.`);
    }
    if (max !== undefined && num > max) {
      return failResult(`${field} maksimal ${max}.`);
    }
  }
  return okResult(num);
}

/**
 * Nilai moneter: number finite ATAU numeric string. NaN/Infinity ditolak.
 * Negatif ditolak KECUALI opts.allowNegative = true (mis. penyesuaian/koreksi).
 *
 * @param {*} value
 * @param {{ field: string, required?: boolean, max?: number, allowNegative?: boolean }} opts
 * @returns {ValidationResult} value = number finite.
 */
export function validateAmount(value, opts) {
  const { field, required = false, max, allowNegative = false } = opts || {};
  if (isAbsent(value)) {
    if (required) return failResult(`${field} wajib diisi.`);
    return okResult(undefined);
  }
  let num;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    if (value.trim() === '') {
      if (required) return failResult(`${field} wajib diisi.`);
      return okResult(undefined);
    }
    num = Number(value);
  } else {
    return failResult(`${field} harus berupa angka.`);
  }
  if (!Number.isFinite(num)) {
    return failResult(`${field} harus berupa angka.`);
  }
  if (!allowNegative && num < 0) {
    return failResult(`${field} tidak boleh negatif.`);
  }
  if (max !== undefined && num > max) {
    return failResult(`${field} maksimal ${max}.`);
  }
  return okResult(num);
}

/**
 * Tanggal ISO-8601, FAIL-CLOSED via Date.parse (pola parseDateRange di
 * adminMetricsRoutes). Menerima string ISO atau epoch ms (number).
 *
 * @param {*} value
 * @param {{ field: string, required?: boolean }} opts
 * @returns {ValidationResult} value = string ISO ternormalisasi (toISOString).
 */
export function validateIsoDate(value, opts) {
  const { field, required = false } = opts || {};
  if (isAbsent(value)) {
    if (required) return failResult(`${field} wajib diisi.`);
    return okResult(undefined);
  }
  let date;
  if (typeof value === 'number') {
    date = Number.isFinite(value) ? new Date(value) : null;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      if (required) return failResult(`${field} wajib diisi.`);
      return okResult(undefined);
    }
    date = new Date(trimmed);
  } else {
    return failResult(`${field} harus berupa tanggal ISO valid.`);
  }
  if (!date || Number.isNaN(date.getTime())) {
    return failResult(`${field} harus berupa tanggal ISO valid.`);
  }
  return okResult(date.toISOString());
}

/** Bentuk boolean yang diterima (string case-insensitive, di-trim). */
const BOOLEAN_STRINGS = new Map([
  ['true', true],
  ['false', false],
  ['1', true],
  ['0', false],
]);

/**
 * Boolean: menerima true/false dan 'true'/'false'/'1'/'0'
 * (case-insensitive, trim) — query param tiba sebagai string.
 *
 * @param {*} value
 * @param {{ field: string, required?: boolean }} opts
 * @returns {ValidationResult} value = boolean asli (true/false).
 */
export function validateBoolean(value, opts) {
  const { field, required = false } = opts || {};
  if (isAbsent(value)) {
    if (required) return failResult(`${field} wajib diisi.`);
    return okResult(undefined);
  }
  if (typeof value === 'boolean') return okResult(value);
  if (typeof value === 'string') {
    const mapped = BOOLEAN_STRINGS.get(value.trim().toLowerCase());
    if (mapped !== undefined) return okResult(mapped);
  }
  return failResult(`${field} harus berupa boolean (true/false).`);
}

/**
 * Identifier baris: string non-kosong ATAU integer positif.
 * Normalisasi: string digit murni ('123') → number 123; string lain
 * dikembalikan apa adanya setelah trim (maks ID_MAX_LENGTH karakter).
 *
 * @param {*} value
 * @param {{ field: string }} opts
 * @returns {ValidationResult} value = number | string ternormalisasi.
 */
export function validateId(value, opts) {
  const { field } = opts || {};
  if (isAbsent(value)) {
    return failResult(`${field} wajib diisi.`);
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0) return okResult(value);
    return failResult(`${field} tidak valid.`);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.length > ID_MAX_LENGTH) {
      return failResult(`${field} tidak valid.`);
    }
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isSafeInteger(num) && num > 0) return okResult(num);
      return failResult(`${field} tidak valid.`);
    }
    return okResult(trimmed);
  }
  return failResult(`${field} tidak valid.`);
}

/**
 * @typedef {object} ValidatorDescriptor
 * @property {(value: any, opts?: any) => ValidationResult} validate
 *   Fungsi validator (salah satu primitive di atas, atau fungsi lain yang
 *   berkontrak sama).
 * @property {object} [options]
 *   Opts untuk validator. `field` otomatis diisi dengan nama key schema bila
 *   tidak diberikan eksplisit.
 */

/**
 * Validasi komposisi untuk req.body / req.query.
 *
 * Perilaku terdokumentasi:
 *  - TIDAK fail-fast: SEMUA error dikumpulkan di `errors`.
 *  - `error` = semua pesan digabung '; ' (siap dipakai sebagai body 400).
 *  - Objek hasil (`value`) HANYA berisi field yang ada di schema — field
 *    tak dikenal DIBUANG (anti field-mass-assignment). Field opsional yang
 *    absen tidak muncul di objek hasil.
 *  - `reqBody` bukan objek (atau null/array) → satu error, fail-closed.
 *  - Validator yang melempar dianggap kegagalan validasi (fail-closed).
 *
 * Skema: map `field -> ValidatorDescriptor`, atau fungsi validator langsung
 * (dipanggil dengan `(value, { field })`).
 *
 * @param {*} reqBody
 * @param {Record<string, ValidatorDescriptor | ((value: any, opts?: any) => ValidationResult)>} schema
 * @returns {{ ok: true, value: Record<string, any>, error: null, errors: [] }
 *  | { ok: false, value: Record<string, any>, error: string, errors: string[] }}
 */
export function validateBody(reqBody, schema) {
  const cleaned = {};
  const errors = [];

  if (reqBody === null || typeof reqBody !== 'object' || Array.isArray(reqBody)) {
    errors.push('Body request harus berupa objek JSON.');
    return { ok: false, value: cleaned, error: errors.join('; '), errors };
  }

  for (const [key, descriptor] of Object.entries(schema || {})) {
    const validate = typeof descriptor === 'function' ? descriptor : descriptor?.validate;
    if (typeof validate !== 'function') {
      // Kesalahan programmer (skema rusak), bukan input user — tetap fail-closed.
      errors.push(`Validator untuk field "${key}" tidak valid.`);
      continue;
    }
    const options = typeof descriptor === 'function'
      ? { field: key }
      : { field: key, ...(descriptor.options || {}) };
    let result;
    try {
      result = validate(reqBody[key], options);
    } catch {
      result = failResult(`${key} tidak valid.`);
    }
    if (!result || result.ok !== true) {
      errors.push(result?.error || `${key} tidak valid.`);
      continue;
    }
    if (result.value !== undefined) cleaned[key] = result.value;
  }

  if (errors.length > 0) {
    return { ok: false, value: cleaned, error: errors.join('; '), errors };
  }
  return { ok: true, value: cleaned, error: null, errors: [] };
}

/**
 * Alias semantik validateBody untuk req.query (nilai query tiba sebagai
 * string; validator primitive sudah melakukan koersi). Dipisah agar intent
 * pemanggil jelas dan perilaku query bisa berevolusi tanpa memecah body.
 *
 * @param {*} reqQuery
 * @param {Record<string, ValidatorDescriptor | ((value: any, opts?: any) => ValidationResult)>} schema
 * @returns {ReturnType<typeof validateBody>}
 */
export function validateQuery(reqQuery, schema) {
  return validateBody(reqQuery, schema);
}

/**
 * Kirim respons 400 standar untuk kegagalan validasi.
 *
 * Bentuk body: { error: string, errorCode: 'VALIDATION_ERROR', details: string[] }
 *  - `error` selalu string human-readable (kontrak frontend CRUD).
 *  - JANGAN pakai helper ini untuk 401; validasi selalu 400.
 *
 * Menerima hasil validateBody/validateQuery ATAU hasil satu validator
 * primitive ({ ok: false, error }).
 *
 * Contoh:
 *   const result = validateBody(req.body, schema);
 *   if (!result.ok) return sendValidationError(res, result);
 *
 * @param {import('express').Response} res
 * @param {{ ok?: boolean, error?: string, errors?: string[] }} result
 * @returns {import('express').Response}
 */
export function sendValidationError(res, result) {
  const error = typeof result?.error === 'string' && result.error.length > 0
    ? result.error
    : 'Parameter tidak valid.';
  const details = Array.isArray(result?.errors) && result.errors.length > 0
    ? result.errors
    : [error];
  return res.status(400).json({ error, errorCode: 'VALIDATION_ERROR', details });
}
