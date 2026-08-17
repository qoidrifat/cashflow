# Google OAuth Localhost Troubleshooting (P3)

Dokumen troubleshooting untuk login Google di lingkungan lokal (dan
Freebuff Desktop Preview). Root cause `state_mismatch` yang diperbaiki di P3
dijelaskan lengkap agar tidak muncul kembali.

---

## 1. Architecture

```
Freebuff Preview / browser
        │  (origin http://127.0.0.1:5180)
        ▼
Frontend (Vite) ............ http://localhost:5180  (host: 127.0.0.1, port 5180)
        │  authClient baseURL = VITE_API_BASE_URL (LANGSUNG, bukan proxy)
        ▼
Backend / Auth (Express + Better Auth) ... http://localhost:5181
        │  betterAuth baseURL = BETTER_AUTH_URL (default http://localhost:5181)
        │  mount: /api/auth  (app.all('/api/auth/*', toNodeHandler(getAuth())))
        ▼
Google OAuth ................ https://accounts.google.com
        │  redirect_uri = http://localhost:5181/api/auth/callback/google
        ▼
Callback .................... http://localhost:5181/api/auth/callback/google
```

### URL kanonik

| Item | Nilai |
|------|-------|
| Frontend | `http://localhost:5180` (Vite `host: 127.0.0.1`) |
| Backend/Auth | `http://localhost:5181` |
| `VITE_API_BASE_URL` (root `.env.local`) | `http://localhost:5181` |
| `BETTER_AUTH_URL` (`server/.env`) | `http://localhost:5181` |
| Google Redirect URI | `http://localhost:5181/api/auth/callback/google` |
| Callback endpoint | `GET /api/auth/callback/google` |

> **Konsistensi host itu wajib.** `localhost` ≠ `127.0.0.1` untuk cookie
> (cookie host-only). Inisiasi OAuth di `localhost` + callback di
> `127.0.0.1` (atau sebaliknya) = state/session cookie tidak ikut.

---

## 2. Cookie strategy

- Cookie sesi: `better-auth.session_token` — `HttpOnly`, `SameSite=Lax`,
  `Secure` hanya di produksi (`useSecureCookies: isProduction`), prefix
  `better-auth` di-pin di `advanced.cookiePrefix`.
- **OAuth state (P3): disimpan SERVER-SIDE di tabel `verification`
  (migration 0001), bukan di cookie.** Callback divalidasi via parameter
  `state` itu sendiri. Konfigurasi:

  ```js
  account: {
    storeStateStrategy: 'database',   // dibaca runtime (options.account.*)
    skipStateCookieCheck: true,       // state tetap divalidasi via DB
  }
  ```

  Catatan penting: `advanced.storeStateStrategy` BUKAN dibaca runtime
  (create-context.mjs membaca `options.account.storeStateStrategy`; nilai lama
  di `advanced` = no-op yang menyesatkan) — konfigurasi jujur ditaruh di
  `account`.

---

## 3. Root cause `state_mismatch` (P3) — Freebuff Preview

### Gejala

Login via Preview Freebuff: klik "Masuk dengan Google" → tab Chrome baru →
pilih akun Google → `http://localhost:5181/api/auth/error?error=state_mismatch`
→ halaman "Something went wrong / CODE: state_mismatch".

### Bukti forensik (repro deterministik, `.test-data/oauth-repro2.mjs`)

| Skenario | Cookie state di callback? | Hasil |
|----------|---------------------------|-------|
| Same jar (inisiasi + callback browser sama) | Ya | state PASS → lanjut token exchange (`invalid_code` untuk kode palsu) |
| **Other jar (callback di tab Chrome eksternal)** | **Tidak** | **`state_mismatch` — error persis yang dilaporkan** |

### Penjelasan

1. Inisiasi login terjadi di **webview preview** Freebuff
   (`http://127.0.0.1:5180`) — POST `/api/auth/sign-in/social`.
2. Better Auth menaruh state OAuth; dengan strategi cookie, state diletakkan
   di cookie `better-auth.state` **milik jar browser yang menginisiasi**.
3. Freebuff meneruskan redirect Google ke **tab Chrome eksternal** (cookie jar
   terpisah — cookie tidak pernah berbagi antar jar).
4. Callback `http://localhost:5181/api/auth/callback/google` dieksekusi di
   tab Chrome tersebut **tanpa cookie state** → validation gagal →
   `state_mismatch`.

Cookie tidak bisa menembus jar berbeda — ini bukan masalah atribut cookie
(SameSite/Domain/Secure), jadi tidak ada konfigurasi cookie yang bisa
memperbaikinya.

### Solusi

State disimpan server-side (tabel `verification`) dan callback divalidasi via
parameter `state` — tidak bergantung cookie jar mana yang mengeksekusi
callback. `account.skipStateCookieCheck: true` menghapus HANYA lapisan cookie
yang mustahil lintas-jar; pola sama dengan plugin resmi better-auth
`oauth-proxy` (`parseGenericState(ctx, state, { skipStateCookieCheck: true })`).

**Keamanan TIDAK diturunkan** (semua di-lock oleh `e2e/oauth-state.spec.ts`):

| Kasus | Hasil |
|-------|-------|
| state valid (jar mana pun) | PASS → token exchange |
| state di-tamper / tidak dikenal | REJECTED (`state_mismatch`) |
| state hilang | REJECTED (`state_not_found`) |
| state kedaluwarsa (10 menit / baris `expiresAt`) | REJECTED (`state_mismatch`) |
| replay (callback kedua dengan state sama) | REJECTED (state sekali pakai — baris dihapus saat sukses) |
| origin check / CSRF check | TETAP AKTIF (`disableOriginCheck: false`, `disableCSRFCheck: false`) |

---

## 4. Google Redirect URI (Google Cloud Console)

Wajib terdaftar di **Google Cloud Console → Credentials → OAuth 2.0 Client
IDs → Authorized redirect URIs**:

```
http://localhost:5181/api/auth/callback/google
```

- Harus **PERSIS** — tanpa trailing slash, host `localhost` (bukan
  `127.0.0.1`), port 5181. Google mencocokkan exact string.
- Development & production biasanya memakai URI berbeda
  (mis. `https://cashflow.example.com/api/auth/callback/google` di produksi).
  Tambahkan keduanya; jangan hapus URI lama tanpa alasan.
- Client ID/Secret ada di `server/.env` (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`) — JANGAN commit / tampilkan nilai asli.

---

## 5. Common `state_mismatch` causes & debugging

| Cause | Diagnosis | Fix |
|-------|-----------|-----|
| Callback di cookie jar berbeda dari inisiasi (Freebuff) | Reproduksi cross-jar (lihat §3) | Sudah diperbaiki P3 (state di DB) |
| Host tidak konsisten (localhost vs 127.0.0.1) | Bandingkan `VITE_API_BASE_URL`, `BETTER_AUTH_URL`, redirect URI | Samakan host di semua konfigurasi |
| State expired (> 10 menit memilih akun) | Log: `expiresAt` dalam error | Ulangi login |
| State sudah dikonsumsi (double callback / replay) | Log: `verification not found` setelah callback sukses | Single-use memang menolak; bukan bug |
| `advanced.storeStateStrategy` diubah kembali ke `'cookie'` | `grep storeStateStrategy server/lib/auth.js` | Harus di `account` (bukan advanced) |

### Debugging aman (tanpa membocorkan secret)

- Gunakan hash: `state_present=true`, `state_hash=sha256(...)` — jangan log
  raw state / authorization code / token.
- Cek cookie metadata (nama/domain/HttpOnly/SameSite) — jangan print value.
- Cek tabel `verification`: `SELECT id, identifier, expiresAt FROM verification`
  (state yang valid tersimpan di sini; hilang setelah callback sukses).

---

## 6. Browser verification procedure

```
1. npm run dev:server   (backend 5181)
2. npm run dev          (frontend 5180)
3. Buka http://localhost:5180 → Login → "Masuk dengan Google"
4. Amati authorization URL (state ada, redirect_uri = localhost:5181/...)
5. Pilih akun Google → callback → dashboard
6. Refresh → sesi tetap ada → Logout → login lagi → sukses
```

Verifikasi cross-context (Freebuff):
```
1. Buka app di Freebuff Preview (http://127.0.0.1:5180)
2. Login → tab Chrome eksternal terbuka → pilih akun Google
3. Callback TIDAK boleh state_mismatch (P3)
```

### Real Google OAuth — checklist verifikasi manual (status: NOT VERIFIED)

Alur Google asli (account selection → code exchange → session) TIDAK bisa
di-otomasi tanpa kredensial Google sungguhan. Guard otomatis mengunci seluruh
lifecycle STATE (valid/tampered/missing/expired/replay) — lihat
`e2e/oauth-state.spec.ts` (35/35 PASS, 2026-08-17). **Status `VERIFIED` hanya
boleh diberikan setelah checklist di bawah selesai dengan akun Google nyata.**

```text
[ ] 1. Buka http://localhost:5180/login — halaman login render
[ ] 2. Klik "Masuk dengan Google" — redirect ke accounts.google.com
[ ] 3. Otorisasi URL berisi: client_id, redirect_uri=http://localhost:5181/api/auth/callback/google,
         response_type=code, scope, state (random, non-empty)
[ ] 4. Pilih akun Google nyata (consent bila diminta)
[ ] 5. Callback http://localhost:5181/api/auth/callback/google — TIDAK state_mismatch
[ ] 6. Dashboard terbuka (tidak redirect balik ke login)
[ ] 7. GET /api/auth/session → authenticated (user id + email)
[ ] 8. Refresh /dashboard → sesi tetap ada
[ ] 9. Tab baru → /dashboard → tetap authenticated
[ ] 10. Logout → GET /api/auth/session → unauthenticated; /dashboard → redirect login
[ ] 11. Login lagi → state BARU → sukses
[ ] 12. (Freebuff) Preview 127.0.0.1:5180 → login → tab Chrome eksternal → akun Google
         → callback → dashboard
```

Hasil tiap langkah: catat URL, HTTP status, console/network, metadata cookie
(tanpa nilai), halaman akhir. Setelah semua PASS → ubah status di
`docs/repository/QUALITY_REVIEW.md` dari NOT VERIFIED → VERIFIED (dengan tanggal).
Jangan pernah menyatakan VERIFIED hanya berdasarkan automated test.

---

## 7. Security restrictions

- JANGAN disable state validation / terima state apa pun.
- JANGAN hapus CSRF/origin check (`disableOriginCheck`/`disableCSRFCheck`
  wajib `false`).
- JANGAN log raw state, authorization code, access/refresh token, client
  secret, atau session token.
- JANGAN gunakan `SameSite=None` tanpa alasan; cookie tetap `HttpOnly +
  SameSite=Lax` (+ `Secure` di produksi).
- JANGAN commit `.env.local` / `server/.env`.

---

## 8. P0.8 — HOSTNAME CONSISTENCY & SESSION COOKIE REGRESSION

### Gejala
`/login` → Masuk dengan Google → pilih akun → Google selesai → **kembali `/login`**
(bukan `/dashboard`), padahal callback HTTP `302` dan session `Set-Cookie` dikirim.

### Evidence forensik (real browser, negative + positive control)
| Origin halaman | Request `get-session` | Cookie `SameSite=Lax` dikirim? |
| --- | --- | --- |
| `http://127.0.0.1:5180` | `http://localhost:5181` | **TIDAK** (cross-site) → `200 null` |
| `http://localhost:5180` | `http://localhost:5181` | **YA** (same-site) |

Browser menganggap `127.0.0.1` dan `localhost` sebagai dua *site* berbeda.
Cookie Better Auth **host-only `localhost` + `SameSite=Lax`** ditahan browser
pada fetch subrequest lintas-site (`get-session`) → `null` → frontend anggap
unauthenticated → `/login`. Config CORS, `credentials: include`, `trustedOrigins`
sudah benar sejak awal; yang salah hanya konsistensi hostname.

### Root cause
`SameSite=Lax` + origin frontend `127.0.0.1` vs backend `localhost` =
cross-site → session cookie tidak dikirim pada request session (bukan kegagalan
state/callback/session/CORS).

### Perbaikan minimal (konfigurasi, bukan security)
Sinkronkan dev origin ke **canonical `localhost`**. Vite tetap *bind*
`127.0.0.1` (agar `http://localhost:5180` ter-resolusi), tetapi **browser wajib
dibuka di `http://localhost:5180`**.

| File | Sebelum | Sesudah |
| --- | --- | --- |
| `package.json` `dev` | `vite --host localhost --port 5180` | `vite --host 127.0.0.1 --port 5180` |
| `scripts/dev-all.mjs` | `['--host','localhost',...]` | `['--port',...,'--host','127.0.0.1']` |

Alasan: `--host localhost` di Windows dev ini bisa bind `[::1]`-only (footgun
docs). Me-pin bind ke `127.0.0.1` membuat `localhost:5180` dapat diakses
deterministik tanpa menurunkan origin ke dua hostname.

### Security decision
- **Tidak** melemahkan: `SameSite=Lax` dipertahankan, `HttpOnly` dipertahankan,
  CSRF & Origin check tetap enabled, state tetap single-use di database,
  `skipStateCookieCheck=true` tetap, `Secure=false` hanya karena HTTP dev.
- **Tidak** pakai `SameSite=None` sebagai workaround.
- Kanonik = `localhost:5180` frontend ↔ `localhost:5181` backend. `127.0.0.1`
  bukan origin canonical untuk flow autentikasi.

### Regression test
`e2e/oauth-session-host-consistency.spec.ts` (deterministik, tanpa secret,
tanpa Google nyata):
- **positive control**: origin `localhost` → API `localhost` ⇒ cookie `Lax` dikirim.
- **negative control**: origin `127.0.0.1` → API `localhost` ⇒ cookie TIDAK dikirim.

Menjaga invariant transport yang menjadi akar kegagalan, sehingga regresi host
tidak muncul kembali.

### Canonical development origin
```
Frontend : http://localhost:5180
Backend  : http://localhost:5181
callback : http://localhost:5181/api/auth/callback/google
```

---

## 9. P0.10 — ACCOUNT VERIFICATION AUDIT (Provider Capability)

### Temuan forensik (basis database + kode, bukan asumsi)
- `wallet_accounts` saat ini HANYA berisi **satu** baris:
  `LINE Bank | bank | balance_anchor_status=verified`.
- **blu, Bank Jago, ShopeePay, DANA TIDAK ada** sebagai baris `wallet_accounts`
  di database dev.
- Mekanisme "verifikasi" yang ada hanyalah **verifikasi saldo-nyata / balance
  anchor** (P2.7): `POST /api/reconciliation/verify-balance` →
  `balance_anchor_status` (verified / mismatch). **BUKAN verifikasi identitas
  institusi/provider.**
- Tidak ada subsystem verifikasi identitas bank/e-wallet, tidak ada provider
  adapter, tidak ada registry provider.

### Capability matrix aktual (dari source + DB)
| Provider | Ada di UI/DB | Verification mechanism | CTA | Status |
| --- | --- | --- | --- | --- |
| LINE Bank | YA (1 akun, anchor=verified) | balance-anchor (P2.7) | ✓ Terverifikasi — perbarui | VERIFIED (anchor) |
| blu | TIDAK ada | tidak ada | — | NOT_IMPLEMENTED / tidak ada akun |
| Bank Jago | TIDAK ada | tidak ada | — | NOT_IMPLEMENTED / tidak ada akun |
| ShopeePay | TIDAK ada | tidak ada | — | NOT_IMPLEMENTED / tidak ada akun |
| DANA | TIDAK ada | tidak ada | — | NOT_IMPLEMENTED / tidak ada akun |

### Keputusan (mandat P0.10 §20)
**TIDAK membuat verifikasi palsu.** Aplikasi tidak memiliki integrasi nyata
untuk verifikasi identitas blu/Bank Jago/ShopeePay/DANA. Menampilkan tombol
"Verifikasi Akun" yang berakhir gagal/tanpa validasi = melanggar aturan.
Status jujur = `NOT_IMPLEMENTED` (akun tersebut memang belum didaftarkan /
belum ada mekanisme verifikasi identitas provider).

### Ownership & anti-IDOR (P0.9, dikonfirmasi)
- `GET /api/wallets` → `WHERE user_id = req.user.id`.
- `POST /api/wallets` → userId dari session; body divalidasi (anti mass-assignment).
- `verify-balance` → `userId = req.user.id`; akun user lain ditolak engine.
- Tidak ada `PATCH verified=true` dari client. Status `verified` hanya ditulis
  backend lewat `verifyAccountBalance`.

### Hasil regresi (lihat Laporan P0.10)
Hostname P0.8 2/2, oauth-state 6/6, reconciliation ownership 21/21 — PASS.
Data finansial/Gmail tidak berubah. **Tidak ada perubahan kode P0.10.**
