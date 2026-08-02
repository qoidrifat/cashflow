# Supabase Auth Google dan Gmail API Setup

Tanggal: 2026-06-20

CashFlow sekarang memakai Supabase Auth Google Provider. Gmail Sync memakai Google provider token dari Supabase session, bukan lagi Google Identity Services token client terpisah.

## A. Supabase Dashboard

1. Buka <https://supabase.com/dashboard>.

2. Pilih project CashFlow.

3. Masuk ke Authentication.

4. Masuk ke Providers.

5. Pilih Google.

6. Aktifkan Google Provider.

7. Isi Google Client ID.

8. Isi Google Client Secret.

9. Simpan.

## B. Google Cloud Console

1. Buka <https://console.cloud.google.com>.

2. Pilih project Google untuk OAuth CashFlow.

3. Buka APIs & Services -> Library.

4. Cari dan aktifkan Gmail API.

5. Buka OAuth consent screen.

6. Tambahkan scope:

   * `openid`

   * `email`

   * `profile`

   * `https://www.googleapis.com/auth/gmail.readonly`

7. Jika app masih Testing, tambahkan email user ke Test users.

8. Buka APIs & Services -> Credentials.

9. Buat OAuth Client ID tipe Web Application.

10. Tambahkan Authorized redirect URI:

* `https://<PROJECT_REF>.supabase.co/auth/v1/callback`

11. Tambahkan Authorized JavaScript origins jika diperlukan untuk domain aplikasi:

* `http://localhost:5180`

* `http://127.0.0.1:5180`

* URL production nanti.

## C. Supabase Site URL dan Redirect URLs

Di Supabase Dashboard:

1. Authentication -> URL Configuration.

2. Isi Site URL local:

   * `http://localhost:5180`

3. Tambahkan Redirect URLs:

   * `http://localhost:5180/auth/callback`

   * `http://127.0.0.1:5180/auth/callback`

   * URL production `/auth/callback` jika sudah deploy.

## D. Implementasi App

Login memakai:

```ts
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    scopes: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    queryParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
    redirectTo: `${window.location.origin}/auth/callback`,
  },
});
```

Gmail API memakai:

```ts
Authorization: Bearer ${session.provider_token}
```

Catatan penting:

* Supabase mengembalikan provider token saat OAuth callback/auth state change.

* Provider token dapat expire.

* Supabase Auth tidak otomatis refresh Google provider token untuk app.

* Jika token hilang/expired, user harus reconnect Gmail atau login ulang dengan consent.

## E. Troubleshooting

| Masalah                         | Solusi                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `provider_token` kosong         | Pastikan scope Gmail ada di `signInWithOAuth`, Google consent screen, dan user consent ulang                                 |
| `provider_refresh_token` kosong | Gunakan `access_type=offline` dan `prompt=consent`; Google tidak selalu mengembalikan refresh token jika user pernah consent |
| `redirect_uri_mismatch`         | Tambahkan Supabase callback URL ke Google OAuth Client                                                                       |
| `access_denied`                 | User menolak consent atau belum masuk Test users                                                                             |
| `insufficientPermissions`       | Scope Gmail readonly belum diizinkan                                                                                         |
| Gmail API disabled              | Aktifkan Gmail API di Google Cloud project OAuth yang sama                                                                   |
| App belum verified              | Untuk scope sensitif, gunakan Test users saat development atau ajukan verification untuk production                          |
| Token expired                   | Klik Hubungkan Gmail/Login ulang untuk consent dan provider token baru                                                       |

## F. Checklist Setup Manual

* [x] Supabase Google Provider aktif.
* [x] Google Client ID/Secret benar.
* [x] Gmail API aktif.
* [x] OAuth consent screen berisi Gmail readonly scope.
* [x] Test user ditambahkan jika app Testing.
* [x] Supabase callback URI ada di Google OAuth Client.
* [x] App `/auth/callback` ada di Redirect URLs Supabase.
* [ ] Login ulang menghasilkan `session.provider_token`.
