/**
 * Unit test: server/lib/validation.js — P1-2 Shared Validation Foundation.
 *
 * Menguji validator primitive + helper komposisi sebagai fungsi MURNI
 * (tanpa Express, DB, atau logger):
 *   - validateRequiredString / validateOptionalString
 *   - validateEnum (array & Set whitelist)
 *   - validateInt (numeric-string coercion, clamp vs reject)
 *   - validateAmount (finite, negatif, max)
 *   - validateIsoDate (fail-closed via Date.parse)
 *   - validateBoolean (true/false + 'true'/'false'/'1'/'0')
 *   - validateId (string / integer positif, normalisasi)
 *   - validateBody (kumpul semua error + strip field tak dikenal)
 *   - validateQuery (koersi string query param)
 *   - sendValidationError (bentuk body 400 standar)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  validateRequiredString,
  validateOptionalString,
  validateEnum,
  validateInt,
  validateAmount,
  validateIsoDate,
  validateBoolean,
  validateId,
  validateBody,
  validateQuery,
  sendValidationError,
} from '../../server/lib/validation.js';

describe('validateRequiredString', () => {
  it('string valid di-trim dan lolos', () => {
    expect(validateRequiredString('  hello  ', { field: 'name' })).toEqual({ ok: true, value: 'hello' });
  });

  it('non-string ditolak (number, boolean, object, array, undefined, null)', () => {
    for (const v of [42, true, false, {}, ['a'], undefined, null]) {
      const res = validateRequiredString(v, { field: 'name' });
      expect(res.ok, String(v)).toBe(false);
      if (!res.ok) expect(res.error).toContain('name');
    }
  });

  it('string kosong / hanya-whitespace ditolak', () => {
    expect(validateRequiredString('', { field: 'name' }).ok).toBe(false);
    expect(validateRequiredString('   \t\n', { field: 'name' }).ok).toBe(false);
  });

  it('min & max ditegakkan pada nilai yang sudah di-trim', () => {
    expect(validateRequiredString('abc', { field: 'name', min: 5 }).ok).toBe(false);
    expect(validateRequiredString('abcdef', { field: 'name', min: 5, max: 10 })).toEqual({ ok: true, value: 'abcdef' });
    expect(validateRequiredString('x'.repeat(11), { field: 'name', max: 10 }).ok).toBe(false);
  });

  it('max default membatasi string raksasa (1000)', () => {
    expect(validateRequiredString('a'.repeat(1000), { field: 'name' }).ok).toBe(true);
    expect(validateRequiredString('a'.repeat(1001), { field: 'name' }).ok).toBe(false);
  });

  it('pesan error selalu string human-readable menyebut field', () => {
    const res = validateRequiredString('', { field: 'title' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(typeof res.error).toBe('string');
      expect(res.error).toContain('title');
    }
  });
});

describe('validateOptionalString', () => {
  it('undefined/null → ok dengan value undefined', () => {
    expect(validateOptionalString(undefined, { field: 'q' })).toEqual({ ok: true, value: undefined });
    expect(validateOptionalString(null, { field: 'q' })).toEqual({ ok: true, value: undefined });
  });

  it('string kosong/whitespace dinormalisasi menjadi undefined (bukan error)', () => {
    expect(validateOptionalString('', { field: 'q' })).toEqual({ ok: true, value: undefined });
    expect(validateOptionalString('   ', { field: 'q' })).toEqual({ ok: true, value: undefined });
  });

  it('string non-kosong di-trim dan lolos', () => {
    expect(validateOptionalString('  kopi  ', { field: 'q' })).toEqual({ ok: true, value: 'kopi' });
  });

  it('non-string ditolak fail-closed', () => {
    expect(validateOptionalString(42 as unknown as string, { field: 'q' }).ok).toBe(false);
    expect(validateOptionalString({} as unknown as string, { field: 'q' }).ok).toBe(false);
  });

  it('max ditegakkan (default 1000)', () => {
    expect(validateOptionalString('a'.repeat(1001), { field: 'q' }).ok).toBe(false);
    expect(validateOptionalString('abcde', { field: 'q', max: 3 }).ok).toBe(false);
    expect(validateOptionalString('abc', { field: 'q', max: 3 })).toEqual({ ok: true, value: 'abc' });
  });
});

describe('validateEnum', () => {
  const values = ['asc', 'desc'];

  it('anggota whitelist lolos apa adanya', () => {
    expect(validateEnum('asc', { field: 'sortOrder', values })).toEqual({ ok: true, value: 'asc' });
  });

  it('menerima whitelist berupa Set', () => {
    const set = new Set(['transaction', 'budget']);
    expect(validateEnum('budget', { field: 'type', values: set })).toEqual({ ok: true, value: 'budget' });
    expect(validateEnum('hacked', { field: 'type', values: set }).ok).toBe(false);
  });

  it('nilai di luar whitelist ditolak dengan daftar pilihan di pesan', () => {
    const res = validateEnum('sideways', { field: 'sortOrder', values });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('asc');
      expect(res.error).toContain('desc');
    }
  });

  it('opsional (default): absen/kosong → undefined', () => {
    expect(validateEnum(undefined, { field: 'sortOrder', values })).toEqual({ ok: true, value: undefined });
    expect(validateEnum(null, { field: 'sortOrder', values })).toEqual({ ok: true, value: undefined });
    expect(validateEnum('', { field: 'sortOrder', values })).toEqual({ ok: true, value: undefined });
  });

  it('required: absen → error', () => {
    expect(validateEnum(undefined, { field: 'sortOrder', values, required: true }).ok).toBe(false);
    expect(validateEnum('', { field: 'sortOrder', values, required: true }).ok).toBe(false);
  });
});

describe('validateInt', () => {
  it('number bulat lolos; float/NaN/Infinity ditolak', () => {
    expect(validateInt(42, { field: 'limit' })).toEqual({ ok: true, value: 42 });
    expect(validateInt(0, { field: 'offset' })).toEqual({ ok: true, value: 0 });
    expect(validateInt(4.5, { field: 'limit' }).ok).toBe(false);
    expect(validateInt(Number.NaN, { field: 'limit' }).ok).toBe(false);
    expect(validateInt(Number.POSITIVE_INFINITY, { field: 'limit' }).ok).toBe(false);
  });

  it('numeric string dikoersi via Number(); string sampah ditolak', () => {
    expect(validateInt('100', { field: 'limit' })).toEqual({ ok: true, value: 100 });
    expect(validateInt('-3', { field: 'delta' })).toEqual({ ok: true, value: -3 });
    expect(validateInt('12.5', { field: 'limit' }).ok).toBe(false);
    expect(validateInt('abc', { field: 'limit' }).ok).toBe(false);
    expect(validateInt('1e2', { field: 'limit' })).toEqual({ ok: true, value: 100 });
  });

  it('tipe lain (boolean/object/array) ditolak', () => {
    expect(validateInt(true as unknown as number, { field: 'limit' }).ok).toBe(false);
    expect(validateInt([1] as unknown as number, { field: 'limit' }).ok).toBe(false);
    expect(validateInt({} as unknown as number, { field: 'limit' }).ok).toBe(false);
  });

  it('mode reject (default): di luar rentang → error', () => {
    expect(validateInt(101, { field: 'limit', min: 1, max: 100 }).ok).toBe(false);
    expect(validateInt(0, { field: 'limit', min: 1, max: 100 }).ok).toBe(false);
    const res = validateInt(101, { field: 'limit', max: 100 });
    if (!res.ok) expect(res.error).toContain('100');
  });

  it('mode clamp: nilai dipotong ke rentang (pola GET notifications)', () => {
    expect(validateInt(500, { field: 'limit', min: 1, max: 100, clamp: true })).toEqual({ ok: true, value: 100 });
    expect(validateInt(-5, { field: 'offset', min: 0, clamp: true })).toEqual({ ok: true, value: 0 });
    expect(validateInt('50', { field: 'limit', min: 1, max: 100, clamp: true })).toEqual({ ok: true, value: 50 });
  });

  it('opsional absen → undefined; required absen → error', () => {
    expect(validateInt(undefined, { field: 'limit' })).toEqual({ ok: true, value: undefined });
    expect(validateInt(null, { field: 'limit' })).toEqual({ ok: true, value: undefined });
    expect(validateInt(undefined, { field: 'limit', required: true }).ok).toBe(false);
    expect(validateInt(null, { field: 'page', required: true }).ok).toBe(false);
  });

  it('string kosong: opsional → undefined, required → error', () => {
    expect(validateInt('', { field: 'limit' })).toEqual({ ok: true, value: undefined });
    expect(validateInt('', { field: 'limit', required: true }).ok).toBe(false);
  });
});

describe('validateAmount', () => {
  it('number finite lolos; numeric string dikoersi', () => {
    expect(validateAmount(125000, { field: 'amount' })).toEqual({ ok: true, value: 125000 });
    expect(validateAmount('45000.5', { field: 'amount' })).toEqual({ ok: true, value: 45000.5 });
    expect(validateAmount(0, { field: 'amount' })).toEqual({ ok: true, value: 0 });
  });

  it('NaN/Infinity ditolak fail-closed', () => {
    expect(validateAmount(Number.NaN, { field: 'amount' }).ok).toBe(false);
    expect(validateAmount(Number.POSITIVE_INFINITY, { field: 'amount' }).ok).toBe(false);
    expect(validateAmount(Number.NEGATIVE_INFINITY, { field: 'amount' }).ok).toBe(false);
    expect(validateAmount('abc', { field: 'amount' }).ok).toBe(false);
  });

  it('negatif ditolak kecuali allowNegative', () => {
    expect(validateAmount(-100, { field: 'amount' }).ok).toBe(false);
    const res = validateAmount(-100, { field: 'amount' });
    if (!res.ok) expect(res.error).toContain('negatif');
    expect(validateAmount(-100, { field: 'amount', allowNegative: true })).toEqual({ ok: true, value: -100 });
  });

  it('max ditegakkan (inklusif)', () => {
    expect(validateAmount(100, { field: 'amount', max: 100 })).toEqual({ ok: true, value: 100 });
    expect(validateAmount(100.01, { field: 'amount', max: 100 }).ok).toBe(false);
  });

  it('required vs opsional untuk absen/string kosong', () => {
    expect(validateAmount(undefined, { field: 'amount' })).toEqual({ ok: true, value: undefined });
    expect(validateAmount(undefined, { field: 'amount', required: true }).ok).toBe(false);
    expect(validateAmount(null, { field: 'amount', required: true }).ok).toBe(false);
    expect(validateAmount('', { field: 'amount' })).toEqual({ ok: true, value: undefined });
    expect(validateAmount('', { field: 'amount', required: true }).ok).toBe(false);
  });
});

describe('validateIsoDate', () => {
  it('string ISO valid dinormalisasi ke toISOString()', () => {
    expect(validateIsoDate('2026-08-04T00:00:00.000Z', { field: 'from' }))
      .toEqual({ ok: true, value: '2026-08-04T00:00:00.000Z' });
    expect(validateIsoDate('2026-08-04', { field: 'from' })).toEqual({ ok: true, value: '2026-08-04T00:00:00.000Z' });
  });

  it('epoch ms (number) diterima dan dinormalisasi', () => {
    const ms = Date.UTC(2026, 7, 4);
    expect(validateIsoDate(ms, { field: 'from' })).toEqual({ ok: true, value: '2026-08-04T00:00:00.000Z' });
  });

  it('tanggal tak terparse ditolak fail-closed (pola parseDateRange)', () => {
    expect(validateIsoDate('bukan-tanggal', { field: 'from' }).ok).toBe(false);
    expect(validateIsoDate('2026-13-45', { field: 'from' }).ok).toBe(false);
    expect(validateIsoDate(Number.NaN, { field: 'from' }).ok).toBe(false);
    expect(validateIsoDate({} as unknown as string, { field: 'from' }).ok).toBe(false);
  });

  it('opsional absen → undefined; required absen → error', () => {
    expect(validateIsoDate(undefined, { field: 'from' })).toEqual({ ok: true, value: undefined });
    expect(validateIsoDate(null, { field: 'from' })).toEqual({ ok: true, value: undefined });
    expect(validateIsoDate(undefined, { field: 'from', required: true }).ok).toBe(false);
    expect(validateIsoDate('', { field: 'from' })).toEqual({ ok: true, value: undefined });
    expect(validateIsoDate('', { field: 'from', required: true }).ok).toBe(false);
  });
});

describe('validateBoolean', () => {
  it('boolean asli lolos', () => {
    expect(validateBoolean(true, { field: 'unreadOnly' })).toEqual({ ok: true, value: true });
    expect(validateBoolean(false, { field: 'unreadOnly' })).toEqual({ ok: true, value: false });
  });

  it("string 'true'/'false'/'1'/'0' dikoersi (case-insensitive, trim)", () => {
    expect(validateBoolean('true', { field: 'unreadOnly' })).toEqual({ ok: true, value: true });
    expect(validateBoolean('FALSE', { field: 'unreadOnly' })).toEqual({ ok: true, value: false });
    expect(validateBoolean('1', { field: 'unreadOnly' })).toEqual({ ok: true, value: true });
    expect(validateBoolean(' 0 ', { field: 'unreadOnly' })).toEqual({ ok: true, value: false });
  });

  it('string lain / number / object ditolak', () => {
    expect(validateBoolean('yes', { field: 'unreadOnly' }).ok).toBe(false);
    expect(validateBoolean(2 as unknown as boolean, { field: 'unreadOnly' }).ok).toBe(false);
    expect(validateBoolean({} as unknown as boolean, { field: 'unreadOnly' }).ok).toBe(false);
  });

  it('required vs opsional untuk absen', () => {
    expect(validateBoolean(undefined, { field: 'unreadOnly' })).toEqual({ ok: true, value: undefined });
    expect(validateBoolean(null, { field: 'unreadOnly' })).toEqual({ ok: true, value: undefined });
    expect(validateBoolean(undefined, { field: 'unreadOnly', required: true }).ok).toBe(false);
  });
});

describe('validateId', () => {
  it('integer positif lolos sebagai number', () => {
    expect(validateId(7, { field: 'id' })).toEqual({ ok: true, value: 7 });
  });

  it('number non-positif / pecahan ditolak', () => {
    expect(validateId(0, { field: 'id' }).ok).toBe(false);
    expect(validateId(-1, { field: 'id' }).ok).toBe(false);
    expect(validateId(1.5, { field: 'id' }).ok).toBe(false);
  });

  it('string digit dinormalisasi menjadi number', () => {
    expect(validateId('123', { field: 'id' })).toEqual({ ok: true, value: 123 });
    expect(validateId(' 12 ', { field: 'id' })).toEqual({ ok: true, value: 12 });
  });

  it('string non-digit (UUID dll.) lolos apa adanya setelah trim', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(validateId(uuid, { field: 'id' })).toEqual({ ok: true, value: uuid });
  });

  it('kosong, terlalu panjang, dan tipe asing ditolak', () => {
    expect(validateId('', { field: 'id' }).ok).toBe(false);
    expect(validateId('   ', { field: 'id' }).ok).toBe(false);
    expect(validateId(undefined, { field: 'id' }).ok).toBe(false);
    expect(validateId(null, { field: 'id' }).ok).toBe(false);
    expect(validateId('x'.repeat(192), { field: 'id' }).ok).toBe(false);
    expect(validateId({} as unknown as string, { field: 'id' }).ok).toBe(false);
    expect(validateId('0', { field: 'id' }).ok).toBe(false);
  });
});

describe('validateBody', () => {
  const schema = {
    title: { validate: validateRequiredString, options: { max: 100 } },
    type: { validate: validateEnum, options: { values: ['transaction', 'budget'], required: true } },
    amount: { validate: validateAmount },
  };

  it('body valid → cleaned object hanya berisi field schema', () => {
    const res = validateBody(
      { title: '  Kopi  ', type: 'transaction', amount: 25000, hackerField: 'evil' },
      schema,
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ title: 'Kopi', type: 'transaction', amount: 25000 });
    expect(res.value).not.toHaveProperty('hackerField');
    expect(res.errors).toEqual([]);
  });

  it('SEMUA error dikumpulkan (tidak fail-fast)', () => {
    const res = validateBody({ title: '', type: 'hacked', amount: Number.NaN }, schema);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(3);
    expect(res.error).toBe(res.errors.join('; '));
    expect(typeof res.error).toBe('string');
  });

  it('field opsional absen tidak muncul di cleaned object', () => {
    const res = validateBody({ title: 'Kopi', type: 'budget' }, schema);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ title: 'Kopi', type: 'budget' });
    expect(Object.keys(res.value)).not.toContain('amount');
  });

  it('field tak dikenal selalu dibuang, bahkan saat ada error', () => {
    const res = validateBody({ title: '', type: 'transaction', extra: 1 }, schema);
    expect(res.ok).toBe(false);
    expect(res.value).not.toHaveProperty('extra');
  });

  it('body bukan objek (null/array/primitive) → satu error, fail-closed', () => {
    for (const body of [null, ['a'], 'str', 42, undefined]) {
      const res = validateBody(body, schema);
      expect(res.ok, String(body)).toBe(false);
      expect(res.errors.length).toBe(1);
      expect(res.value).toEqual({});
    }
  });

  it('descriptor boleh fungsi langsung (field otomatis dari key)', () => {
    const res = validateBody({ search: '  nasi goreng  ' }, { search: validateOptionalString });
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ search: 'nasi goreng' });
    const bad = validateBody({ search: 42 }, { search: validateOptionalString });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('search');
  });

  it('options.field eksplisit menang atas nama key', () => {
    const res = validateBody({ title: '' }, { title: { validate: validateRequiredString, options: { field: 'judul' } } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('judul');
  });

  it('validator yang melempar dianggap kegagalan validasi (fail-closed)', () => {
    const throwing = () => { throw new Error('boom'); };
    const res = validateBody({ x: 1 }, { x: throwing });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(1);
  });

  it('descriptor tanpa fungsi validate → error skema (fail-closed)', () => {
    const res = validateBody({ x: 1 }, { x: { options: {} } });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('x');
  });
});

describe('validateQuery', () => {
  const schema = {
    limit: { validate: validateInt, options: { min: 1, max: 100, clamp: true } },
    offset: { validate: validateInt, options: { min: 0, clamp: true } },
    type: { validate: validateEnum, options: { values: new Set(['transaction', 'budget', 'gmail', 'system']) } },
    unreadOnly: { validate: validateBoolean },
    from: { validate: validateIsoDate },
    search: { validate: validateOptionalString, options: { max: 100 } },
  };

  it('query string khas GET dinormalisasi penuh', () => {
    const res = validateQuery(
      { limit: '50', offset: '0', type: 'gmail', unreadOnly: 'true', from: '2026-08-01', search: 'kopi' },
      schema,
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({
      limit: 50,
      offset: 0,
      type: 'gmail',
      unreadOnly: true,
      from: '2026-08-01T00:00:00.000Z',
      search: 'kopi',
    });
  });

  it('limit di luar rentang di-clamp, bukan ditolak (pola GET /api/notifications)', () => {
    const res = validateQuery({ limit: '9999', offset: '-5' }, schema);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ limit: 100, offset: 0 });
  });

  it('nilai query invalid mengumpulkan semua error', () => {
    const res = validateQuery({ type: 'hacked', unreadOnly: 'maybe', from: 'junk' }, schema);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(3);
  });

  it('query param kosong dinormalisasi menjadi absen (tidak error)', () => {
    const res = validateQuery({ search: '', limit: '', type: '' }, schema);
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({});
  });

  it('nilai array (?key=a&key=b) ditolak fail-closed oleh validator primitive', () => {
    const res = validateQuery({ search: ['a', 'b'] }, schema);
    expect(res.ok).toBe(false);
  });

  it('query bukan objek (null/undefined) → error', () => {
    expect(validateQuery(null, schema).ok).toBe(false);
    expect(validateQuery(undefined, schema).ok).toBe(false);
  });
});

describe('sendValidationError', () => {
  const mockRes = () => {
    const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
      status: vi.fn(),
      json: vi.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  };

  it('hasil validateBody → 400 dengan error/errorCode/details', () => {
    const result = validateBody({ title: '', type: 'x' }, {
      title: { validate: validateRequiredString },
      type: { validate: validateEnum, options: { values: ['a'], required: true } },
    });
    expect(result.ok).toBe(false);
    const res = mockRes();
    sendValidationError(res as never, result as never);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.errorCode).toBe('VALIDATION_ERROR');
    expect(body.error).toBe((result as { errors: string[] }).errors.join('; '));
    expect(body.details).toEqual((result as { errors: string[] }).errors);
    expect(typeof body.error).toBe('string');
  });

  it('hasil satu validator primitive → details berisi pesan tunggal', () => {
    const result = validateRequiredString('', { field: 'title' });
    const res = mockRes();
    sendValidationError(res as never, result as never);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toContain('title');
    expect(body.details).toEqual([body.error]);
    expect(body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('hasil rusak/kosong tetap mengirim fallback yang aman (bukan melempar)', () => {
    const res = mockRes();
    sendValidationError(res as never, {} as never);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe('Parameter tidak valid.');
    expect(body.details).toEqual(['Parameter tidak valid.']);
  });

  it('mengembalikan res agar bisa `return sendValidationError(res, r)`', () => {
    const res = mockRes();
    const returned = sendValidationError(res as never, { ok: false, error: 'x' } as never);
    expect(returned).toBe(res);
  });
});
