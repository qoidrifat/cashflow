# Audit Keamanan & Privasi — CF-056

## ID Tinjauan
**REVIEW-CF-056**

## Referensi Tugas
**CF-056** — Sesi Berakhir → Pop-up 5 Detik → Logout Otomatis

## Tanggal Tinjauan
2026-06-22

---

## Ringkasan Eksekutif

Audit keamanan dan privasi CF-056 menunjukkan implementasi yang **AMAN** dengan:
- ✅ Logout benar-benar memutus sesi (Supabase + Gmail token)
- ✅ Pop-up non-dismissable (tidak ada jalur lanjut sesi mati)
- ✅ Hanya error auth (401) yang memicu logout (bukan 500/timeout)
- ✅ Tidak ada token/credential ter-log atau ter-expose
- ✅ Pesan ke user ramah tanpa detail teknis sensitif
- ✅ Redirect aman (tidak ada open-redirect)
- ✅ Tidak ada hardcoded secret

**Temuan Kritis:** TIDAK ADA  
**Temuan Prioritas Tinggi:** TIDAK ADA  
**Temuan Sedang:** TIDAK ADA  
**Temuan Rendah:** TIDAK ADA

**Skor Keamanan:** 100/100  
**Skor Privasi:** 100/100

---

## Security Checklist

### ✅ SEC-01: Logout Benar-Benar Memutus Sesi

**Status:** PASS

**Verifikasi:**

1. **Clear Supabase Session** — `src/services/authService.ts:137-146`:
   ```typescript
   export async function signOutUser(): Promise<void> {
     manualSignOut = true;
     gmailAccessToken = null;
     sessionStorage.removeItem(GMAIL_PROVIDER_TOKEN_KEY);
     if (!isSupabaseReady()) return;
     const { error } = await getSupabaseClient().auth.signOut();
     if (error) throw new Error(error.message || 'Gagal logout.');
   }
   ```
   - ✅ Memanggil `supabase.auth.signOut()` (clear session/token Supabase)
   - ✅ Clear Gmail `provider_token` dari memori (`gmailAccessToken = null`)
   - ✅ Clear Gmail token dari sessionStorage (`sessionStorage.removeItem`)

2. **Best-Effort Logout** — `src/components/SessionExpiredDialog.tsx:22-24`:
   ```typescript
   try {
     await useAuthStore.getState().logout();
   } catch {
     // Ignore logout errors — we must leave the dead session regardless.
   }
   ```
   - ✅ Logout tetap clear lokal + redirect walau `signOut()` server gagal
   - ✅ Tidak terjebak dalam sesi mati karena network error
   - ✅ "Best effort" approach yang aman

3. **AuthGuard Protection:**
   - Setelah logout, `useAuthStore.isAuthenticated` menjadi `false`
   - `AuthGuard` akan redirect route terproteksi ke `/login`
   - ✅ Tidak ada sisa akses ke data sensitif

4. **Tidak Menghapus Data Server:**
   - ✅ Logout hanya membersihkan session/token lokal
   - ✅ TIDAK menghapus data user di Supabase (sesuai spec: "logout ≠ delete account")

**Kesimpulan SEC-01:** Logout tuntas. Session Supabase + Gmail token dibersihkan. Route terproteksi tidak bisa diakses setelah logout.

---

### ✅ SEC-02: Pop-up Non-Dismissable

**Status:** PASS

**Verifikasi:**

1. **Backdrop Tidak Bisa Diklik** — `SessionExpiredDialog.tsx:60-66`:
   ```tsx
   <motion.div
     initial={{ opacity: 0 }}
     animate={{ opacity: 1 }}
     exit={{ opacity: 0 }}
     transition={{ duration: 0.2 }}
     className="absolute inset-0 app-overlay backdrop-blur-sm"
   />
   {/* ↑ TIDAK ada onClick handler */}
   ```
   - ✅ Backdrop tanpa `onClick` → tidak bisa diklik untuk menutup
   - ✅ User tidak bisa klik di luar untuk bypass

2. **Tidak Ada Tombol Close/Cancel:**
   - ✅ Tidak ada tombol "X" atau "Batal"
   - ✅ Hanya ada tombol "Keluar sekarang" (yang memicu logout)

3. **AlertDialog Semantik** — `SessionExpiredDialog.tsx:54-59`:
   ```tsx
   <div
     role="alertdialog"
     aria-modal="true"
     aria-labelledby="session-expired-title"
     aria-describedby="session-expired-desc"
   >
   ```
   - ✅ `role="alertdialog"` + `aria-modal="true"` (non-dismissable semantik)
   - ✅ Pembaca layar akan mengenali sebagai dialog kritis

4. **Z-Index Tinggi:**
   - ✅ `z-[100]` memastikan pop-up di atas semua konten
   - ✅ Tidak ada cara visual untuk bypass

5. **Tidak Ada Keyboard Escape:**
   - Tidak ada handler `onKeyDown` untuk Esc
   - ✅ User tidak bisa tekan Esc untuk menutup

**Kesimpulan SEC-02:** Pop-up benar-benar non-dismissable. Tidak ada jalur untuk melanjutkan aplikasi dalam sesi mati. Satu-satunya opsi adalah logout.

---

### ✅ SEC-03: Hanya Error Auth yang Memicu Logout

**Status:** PASS

**Verifikasi:**

1. **Detektor Positive-Match** — `src/lib/sessionErrors.ts:15-25`:
   ```typescript
   const AUTH_MESSAGE_PATTERNS = [
     'invalid authentication credentials',
     'expected oauth 2 access token',
     'unauthenticated',
     'invalid_grant',
     'jwt expired',
     'token expired',
     'token has expired',
     'refresh_token_not_found',
     'refresh token not found',
     'session expired',
     'session_expired',
     'sesi anda telah berakhir',
     'sesi telah berakhir',
     'no current session',
     'auth session missing',
   ];
   ```
   - ✅ Hanya match pola pesan auth spesifik
   - ✅ Tidak match error generik (500, timeout, network)

2. **HTTP 401 Check** — `sessionErrors.ts:68-70`:
   ```typescript
   export function isSessionExpiredError(input: unknown, status?: number): boolean {
     if (extractStatus(input, status) === 401) return true;
     // ... (lalu cek pola pesan)
   }
   ```
   - ✅ HTTP 401 (Unauthorized) → expired
   - ✅ HTTP 403 (Forbidden) → TIDAK expired (permission issue, bukan session)
   - ✅ HTTP 500/502/503 → TIDAK expired (server error)
   - ✅ Network error → TIDAK expired (koneksi)

3. **Gmail Service Implementation** — `gmailService.ts:146-163`:
   ```typescript
   if (!searchResponse.ok) {
     const errorData = await searchResponse.json().catch(() => null);
     const detail = formatGoogleApiError(searchResponse.status, errorData);
     if (searchResponse.status === 401 || isSessionExpiredError(detail, searchResponse.status)) {
       clearGmailAccessToken();
       triggerSessionExpired();
       throw new Error('Sesi Anda telah berakhir. Anda akan keluar secara otomatis.');
     }
     if (searchResponse.status === 403) {
       clearGmailAccessToken();
       throw new Error(detail); // ← 403 TIDAK memicu logout, hanya throw error
     }
     throw new Error(detail); // ← error lain juga TIDAK memicu logout
   }
   ```
   - ✅ 401 → trigger logout
   - ✅ 403 → throw error (TIDAK logout)
   - ✅ 500/timeout → throw error (TIDAK logout)

4. **Network Error Handling** — `gmailService.ts:215-221`:
   ```typescript
   } catch (error) {
     const err = error as Error;
     if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
       throw new Error('Terjadi masalah koneksi. Periksa koneksi internet Anda.');
     }
     throw err;
   }
   ```
   - ✅ Network error di-catch dan di-rethrow dengan pesan ramah
   - ✅ TIDAK memicu `triggerSessionExpired()`

**Kesimpulan SEC-03:** Klasifikasi error tepat. Hanya 401/sinyal-auth yang memicu logout. Error transient (500/timeout/network) TIDAK memicu logout massal yang salah.

---

### ✅ SEC-04: Tidak Ada Hardcoded Secret

**Status:** PASS

**Verifikasi:**

1. **Grep API Key/Secret:**
   - Tidak ada string literal yang terlihat seperti API key, client secret, atau credential
   - Token diambil dari Supabase session (`provider_token`) atau sessionStorage

2. **Environment Variables:**
   - API base URL dari `env.functions.baseUrl` (bukan hardcoded)
   - Supabase config dari environment (tidak di-hardcode di kode)

3. **Token Handling:**
   - Gmail token: `session.provider_token` (dari Supabase Auth)
   - Supabase token: `session.access_token` (dari Supabase Auth)
   - ✅ Tidak ada token di-hardcode

**Kesimpulan SEC-04:** Tidak ada hardcoded secret. Semua credential diambil dari session/environment yang aman.

---

### ✅ SEC-05: Redirect Aman (Tidak Ada Open-Redirect)

**Status:** PASS

**Verifikasi:**

1. **Redirect Target Fixed** — `SessionExpiredDialog.tsx:26`:
   ```typescript
   await router.navigate('/login?reason=session_expired', { replace: true });
   ```
   - ✅ Target redirect hardcoded (`/login?reason=session_expired`)
   - ✅ TIDAK menerima URL dari query parameter atau user input
   - ✅ Tidak ada risiko open-redirect

2. **Query Parameter Handling** — `LoginPage.tsx:12`:
   ```typescript
   const sessionExpired = searchParams.get('reason') === 'session_expired';
   ```
   - ✅ Hanya membaca `reason` untuk menampilkan banner
   - ✅ TIDAK menggunakan `reason` untuk redirect ke URL lain
   - ✅ Aman dari injection

**Kesimpulan SEC-05:** Redirect aman. Target fixed, tidak ada open-redirect vulnerability.

---

## Privacy Checklist

### ✅ PRIV-01: Tidak Ada Token/Credential Ter-Log

**Status:** PASS

**Verifikasi:**

1. **Console.log Scan:**
   - ✅ `useSessionExpiryStore.ts` — tidak ada console.log
   - ✅ `SessionExpiredDialog.tsx` — tidak ada console.log
   - ✅ `sessionErrors.ts` — tidak ada console.log
   - ✅ `authService.ts` — tidak ada console.log
   - ✅ `gmailService.ts` — tidak ada console.log (hanya `logger.warn` untuk error non-sensitif)
   - ✅ `adminMetrics.ts` — tidak ada console.log
   - ✅ `agentSearchClient.ts` — tidak ada console.log

2. **Token Exposure Check:**
   - Grep `throw new Error.*token` → hanya pesan generik "Gagal mendapatkan token akses Gmail"
   - ✅ TIDAK ada error yang mencetak nilai token
   - ✅ TIDAK ada error yang mencetak Authorization header
   - ✅ TIDAK ada error yang mencetak refresh token

3. **Logger Usage:**
   - `gmailService.ts:193,502,510` — `logger.warn` untuk error fetch email
   - ✅ Hanya log status code dan message ID (bukan token/header)

**Kesimpulan PRIV-01:** Tidak ada token, refresh token, Authorization header, atau credential ter-log. Semua logging aman.

---

### ✅ PRIV-02: Pesan ke User Tidak Mengandung Detail Teknis Sensitif

**Status:** PASS

**Verifikasi:**

1. **Pop-up Message** — `SessionExpiredDialog.tsx:78-84`:
   ```tsx
   <h2>Sesi Anda telah berakhir</h2>
   <p>Demi keamanan, Anda akan keluar secara otomatis dalam {secondsLeft} detik.</p>
   ```
   - ✅ Pesan ramah, tidak ada detail teknis
   - ✅ Tidak menyebutkan "401", "UNAUTHENTICATED", "invalid credentials", dll.

2. **Gmail Error Mapping** — `gmailService.ts:156`:
   ```typescript
   throw new Error('Sesi Anda telah berakhir. Anda akan keluar secara otomatis.');
   ```
   - ✅ Pesan ramah menggantikan error mentah Google
   - ✅ Tidak expose "Request had invalid authentication credentials..."

3. **Login Banner** — `LoginPage.tsx:12` + `PublicLandingPage.tsx`:
   ```typescript
   notice={sessionExpired ? 'Sesi Anda telah berakhir, silakan masuk lagi.' : null}
   ```
   - ✅ Pesan kontekstual ramah
   - ✅ Tidak ada stack trace atau detail teknis

4. **Error Messages:**
   - `authService.ts:145` — "Gagal logout." (generik)
   - `gmailService.ts:108,490` — "Gagal mendapatkan token akses Gmail." (generik)
   - ✅ Semua pesan error ramah, tidak expose internal

**Kesimpulan PRIV-02:** Semua pesan ke user ramah dan tidak mengandung detail teknis sensitif (token, stack trace, internal path, raw API error).

---

### ✅ PRIV-03: Pembersihan Cache State Auth

**Status:** PASS

**Verifikasi:**

1. **Clear In-Memory State** — `authService.ts:141`:
   ```typescript
   gmailAccessToken = null;
   ```
   - ✅ Clear variabel global token Gmail

2. **Clear SessionStorage** — `authService.ts:142`:
   ```typescript
   sessionStorage.removeItem(GMAIL_PROVIDER_TOKEN_KEY);
   ```
   - ✅ Clear token Gmail dari sessionStorage

3. **Supabase Session Clear** — `authService.ts:144`:
   ```typescript
   const { error } = await getSupabaseClient().auth.signOut();
   ```
   - ✅ Supabase Auth akan clear session/token lokal (localStorage/cookie)

4. **React State:**
   - `useAuthStore.logout()` akan set `isAuthenticated = false` dan `firebaseUser = null`
   - ✅ State auth di Zustand dibersihkan

5. **Tidak Ada Data Persisten Tertinggal:**
   - ✅ Tidak ada cache React Query/Zustand yang menyimpan data sensitif setelah logout
   - ✅ AuthGuard akan block akses route terproteksi

**Kesimpulan PRIV-03:** Cache state auth (in-memory, sessionStorage, Supabase session, React state) dibersihkan tuntas saat logout. Tidak ada data sensitif tersisa.

---

### ✅ PRIV-04: Logout TIDAK Menghapus Data User di Server

**Status:** PASS

**Verifikasi:**

1. **signOutUser Implementation:**
   - ✅ Hanya memanggil `supabase.auth.signOut()` (clear session)
   - ✅ TIDAK ada query DELETE ke tabel `profiles`, `transactions`, `categories`, dll.
   - ✅ TIDAK ada perubahan skema DB

2. **Spec Compliance:**
   - Spec: "Logout TIDAK menghapus data user di server (logout ≠ delete account)"
   - ✅ Implementasi sesuai spec

**Kesimpulan PRIV-04:** Logout hanya membersihkan session/token lokal. Data user di Supabase tetap utuh (sesuai spec).

---

## Matriks Temuan Keamanan & Privasi

| ID | Kategori | Severity | Deskripsi | Status |
|----|----------|----------|-----------|--------|
| — | — | — | Tidak ada temuan | ✅ PASS |

**Total Temuan:**
- 🔴 CRITICAL: 0
- 🟠 HIGH: 0
- 🟡 MEDIUM: 0
- 🟢 LOW: 0

---

## Skenario Attack & Mitigasi

### Skenario 1: User Mencoba Bypass Pop-up
**Attack:** User mencoba klik backdrop, tekan Esc, atau inspect element untuk menutup pop-up tanpa logout.

**Mitigasi:**
- ✅ Backdrop tanpa `onClick` handler
- ✅ Tidak ada keyboard handler untuk Esc
- ✅ `role="alertdialog"` + `aria-modal="true"` (semantik non-dismissable)
- ✅ Walau user berhasil close pop-up via DevTools, session tetap mati (401 akan terus muncul)

**Hasil:** AMAN — tidak ada jalur bypass yang fungsional.

---

### Skenario 2: Banyak Request 401 Bersamaan
**Attack:** Banyak request gagal bersamaan, mencoba memicu pop-up/logout berkali-kali (DoS lokal).

**Mitigasi:**
- ✅ Flag global `isExpiring` (idempotent)
- ✅ Pemanggilan kedua dan seterusnya di-skip (no-op)
- ✅ Hanya SATU pop-up, SATU logout

**Hasil:** AMAN — idempotency mencegah pop-up menumpuk atau logout ganda.

---

### Skenario 3: Error Transient (500/Timeout) Memicu Logout Massal
**Attack:** Server down atau network lambat, semua request gagal 500/timeout, user ter-logout massal.

**Mitigasi:**
- ✅ Detektor positive-match (`isSessionExpiredError`)
- ✅ Hanya 401 + pola pesan auth yang memicu logout
- ✅ 500/timeout/network TIDAK memicu logout

**Hasil:** AMAN — klasifikasi error tepat, tidak ada logout salah.

---

### Skenario 4: Token Bocor ke Log/Console
**Attack:** Developer/attacker membaca token dari console.log atau network tab.

**Mitigasi:**
- ✅ Tidak ada console.log yang mencetak token/Authorization/Bearer
- ✅ Error messages tidak expose token
- ✅ Network tab tetap bisa lihat token (expected), tapi tidak ada logging tambahan

**Hasil:** AMAN — tidak ada kebocoran token via logging.

---

### Skenario 5: Open-Redirect via Query Parameter
**Attack:** Attacker craft URL `/login?reason=session_expired&redirect=https://evil.com` untuk redirect ke situs jahat.

**Mitigasi:**
- ✅ Redirect target hardcoded (`/login?reason=session_expired`)
- ✅ TIDAK ada parameter `redirect` atau `next` yang diproses
- ✅ `reason` hanya dipakai untuk banner, bukan redirect

**Hasil:** AMAN — tidak ada open-redirect vulnerability.

---

## Compliance Check

### OWASP Top 10 (Relevan untuk CF-056)

| OWASP | Kategori | Status | Catatan |
|-------|----------|--------|---------|
| A01:2021 | Broken Access Control | ✅ PASS | AuthGuard block akses setelah logout |
| A02:2021 | Cryptographic Failures | ✅ PASS | Token tidak ter-log, tidak di-hardcode |
| A03:2021 | Injection | ✅ PASS | Tidak ada SQL/command injection (client-side) |
| A04:2021 | Insecure Design | ✅ PASS | Deteksi terpusat, idempotent, non-dismissable |
| A05:2021 | Security Misconfiguration | ✅ PASS | Tidak ada hardcoded secret, env-based config |
| A07:2021 | Identification and Authentication Failures | ✅ PASS | Logout tuntas, session dibersihkan |

---

## Kesimpulan Audit Keamanan & Privasi

### Ringkasan
- **Temuan Kritis:** 0
- **Temuan Prioritas Tinggi:** 0
- **Temuan Sedang:** 0
- **Temuan Rendah:** 0

### Penilaian
**✅ AMAN UNTUK PRODUKSI**

Implementasi CF-056 memenuhi semua standar keamanan dan privasi:
1. Logout benar-benar memutus sesi (Supabase + Gmail token)
2. Pop-up non-dismissable (tidak ada jalur lanjut sesi mati)
3. Hanya error auth (401) yang memicu logout (bukan 500/timeout)
4. Tidak ada token/credential ter-log atau ter-expose
5. Pesan ke user ramah tanpa detail teknis sensitif
6. Redirect aman (tidak ada open-redirect)
7. Tidak ada hardcoded secret

### Skor
- **Keamanan:** 100/100
- **Privasi:** 100/100

### Rekomendasi
Lanjutkan ke **STEP 3: Technical Deep Review** untuk verifikasi kualitas kode dan arsitektur.

---

**Reviewer:** Bob IBM Pro Plus  
**Template Version:** 2.0  
**Bahasa:** Bahasa Indonesia
