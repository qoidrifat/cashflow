# Panduan Sinkronisasi Gmail untuk CashFlow GenZ

Panduan ini menjelaskan cara menghubungkan aplikasi CashFlow GenZ dengan Gmail supaya aplikasi bisa meminta izin membaca email transaksi dan mengambil data transaksi dari email.

Target pembaca: pemula.

## Gambaran Singkat

Aplikasi ini memakai:

- Google Identity Services untuk login Google resmi.
- OAuth 2.0 untuk meminta izin akses Gmail.
- Gmail API untuk membaca email transaksi.
- Scope Gmail yang dipakai:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Artinya aplikasi hanya meminta izin membaca email. Aplikasi tidak meminta izin mengirim, menghapus, atau mengubah email.

## Yang Harus Disiapkan

Pastikan kamu punya:

- Akun Google.
- Akses ke Google Cloud Console.
- Project CashFlow GenZ berjalan lokal di:

```text
http://127.0.0.1:5180
```

- File `.env.local` sudah berisi:

```env
VITE_GOOGLE_CLIENT_ID=128646662860-307jor7aq7ga73dl3gfkndvm759f8u27.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=isi_dengan_google_api_key_kamu_jika_dipakai
```

Catatan penting:

`VITE_GOOGLE_API_KEY` bukan pengganti OAuth. API key hanya membantu mengidentifikasi project Google/API usage. Untuk membaca inbox Gmail pribadi, aplikasi tetap wajib mendapatkan izin user melalui OAuth scope `gmail.readonly`.

## Langkah 1 - Buka Google Cloud Console

1. Buka:

```text
https://console.cloud.google.com/
```

2. Login dengan akun Google kamu.
3. Pilih project yang dipakai untuk OAuth Client ID aplikasi ini.

OAuth Client ID yang sedang dipakai:

```text
128646662860-307jor7aq7ga73dl3gfkndvm759f8u27.apps.googleusercontent.com
```

Kalau kamu tidak menemukan project-nya, berarti Client ID itu dibuat di project lain atau akun Google lain.

## Langkah 2 - Aktifkan Gmail API

1. Di sidebar Google Cloud, buka:

```text
APIs & Services > Library
```

2. Cari:

```text
Gmail API
```

3. Klik `Gmail API`.
4. Klik tombol `Enable`.

Jika Gmail API belum diaktifkan, aplikasi bisa login Google, tetapi akan gagal saat meminta izin atau membaca Gmail.

## Langkah 3 - Atur OAuth Consent Screen

OAuth consent screen adalah layar izin yang muncul saat user memberi akses ke Gmail.

1. Buka:

```text
APIs & Services > OAuth consent screen
```

2. Jika diminta memilih audience/user type, pilih:

```text
External
```

Untuk aplikasi pribadi atau testing dengan akun Gmail biasa, `External` adalah pilihan yang umum.

3. Isi App information:

```text
App name: CashFlow GenZ
User support email: email kamu
Developer contact information: email kamu
```

4. Simpan dan lanjutkan.

## Langkah 4 - Tambahkan Scope Gmail

1. Masih di OAuth consent screen, cari bagian `Data Access` atau `Scopes`.
2. Klik `Add or remove scopes`.
3. Tambahkan scope ini:

```text
https://www.googleapis.com/auth/gmail.readonly
```

4. Simpan.

Catatan penting:

- Scope Gmail termasuk scope sensitif/restricted menurut Google.
- Untuk testing pribadi, biasanya cukup tambahkan akun kamu sebagai test user.
- Untuk aplikasi publik production, Google bisa meminta proses verifikasi aplikasi.

## Langkah 5 - Tambahkan Test User

Kalau app masih mode testing, hanya email yang masuk daftar test user yang bisa memberikan izin.

1. Buka:

```text
APIs & Services > OAuth consent screen
```

2. Cari bagian `Audience` atau `Test users`.
3. Klik `Add users`.
4. Masukkan email yang akan dipakai login, misalnya:

```text
Qoidrifat23@gmail.com
```

5. Simpan.

Jika email login belum dimasukkan sebagai test user, biasanya muncul error akses ditolak atau app belum tersedia.

## Langkah 6 - Perbaiki Authorized JavaScript Origins

Error yang pernah muncul:

```text
Error 400: origin_mismatch
origin=http://127.0.0.1:5180
```

Artinya Google menolak request karena alamat aplikasi lokal belum didaftarkan.

Cara memperbaiki:

1. Buka:

```text
APIs & Services > Credentials
```

2. Klik OAuth Client ID yang dipakai aplikasi.
3. Pastikan application type adalah:

```text
Web application
```

4. Di bagian `Authorized JavaScript origins`, tambahkan:

```text
http://127.0.0.1:5180
```

Sebaiknya tambahkan juga:

```text
http://localhost:5180
```

5. Klik `Save`.
6. Tunggu beberapa menit.
7. Hard refresh browser.

Penting:

- `http://127.0.0.1:5180` dan `http://localhost:5180` dianggap berbeda oleh Google.
- Port juga harus sama persis.
- `http://127.0.0.1:5173` berbeda dengan `http://127.0.0.1:5180`.

Project ini sudah dikunci agar dev server berjalan di:

```text
http://127.0.0.1:5180
```

## Langkah 7 - Jalankan Aplikasi Lokal

Di terminal project:

```bash
npm run dev
```

Buka:

```text
http://127.0.0.1:5180
```

Login dengan Google.

## Langkah 8 - Hubungkan Gmail di Aplikasi

Setelah login:

1. Masuk ke halaman:

```text
Gmail Sync
```

2. Klik:

```text
Hubungkan Gmail
```

3. Google akan menampilkan layar izin.
4. Pilih akun Google.
5. Izinkan akses Gmail read-only.
6. Setelah berhasil, klik:

```text
Scan Email
```

## Cara Kerja di Kode

File utama yang berhubungan dengan Gmail:

```text
src/services/authService.ts
src/services/gmailService.ts
src/features/gmail/GmailSyncPage.tsx
```

Alur sederhananya:

1. User login dengan Google Identity Services.
2. App menyimpan session Google lokal di browser.
3. Saat user klik `Hubungkan Gmail`, app meminta access token Gmail dengan scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

4. Token dipakai untuk memanggil Gmail API.
5. Email transaksi difilter.
6. Data transaksi bisa diproses lagi oleh AI/Gemini.

## Catatan Keamanan

Untuk development lokal, access token Gmail disimpan sementara di `sessionStorage`.

Untuk production yang lebih aman:

- Jangan simpan token jangka panjang di frontend.
- Gunakan backend atau Firebase Cloud Functions.
- Verifikasi Google ID token di backend.
- Panggil Gemini API dari backend, bukan dari frontend.
- Jangan simpan isi email lengkap ke database.
- Simpan hanya hasil ekstraksi transaksi.

## Troubleshooting

### 1. Error `origin_mismatch`

Penyebab:

Alamat app belum masuk `Authorized JavaScript origins`.

Solusi:

Tambahkan origin ini di OAuth Client:

```text
http://127.0.0.1:5180
http://localhost:5180
```

### 2. Error `access_denied`

Penyebab umum:

- Email belum masuk test user.
- OAuth consent screen belum lengkap.
- Scope Gmail belum ditambahkan.

Solusi:

- Tambahkan email login ke test users.
- Pastikan scope Gmail readonly sudah ada.
- Pastikan Gmail API sudah enable.

### 3. Tombol Google tidak muncul

Cek `.env.local`:

```env
VITE_GOOGLE_CLIENT_ID=128646662860-307jor7aq7ga73dl3gfkndvm759f8u27.apps.googleusercontent.com
```

Lalu restart dev server:

```bash
npm run dev
```

### 4. Gmail API gagal walau login sukses

Login Google dan izin Gmail adalah dua hal berbeda.

Login hanya membuktikan identitas user.

Gmail Sync butuh izin tambahan:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Jadi pastikan kamu klik `Hubungkan Gmail` di halaman Gmail Sync.

### 5. Scan Gmail masih menampilkan data aneh atau kosong

Penyebab umum:

- Inbox memang tidak memiliki email yang cocok dengan kata kunci transaksi dalam 180 hari terakhir.
- Email transaksi hanya berupa gambar/attachment sehingga teksnya sulit dibaca.
- Format email bank/e-wallet berbeda sehingga extractor lokal belum mengenali nominal/merchant.
- Gemini/Cloud Functions belum dikonfigurasi, jadi aplikasi memakai extractor lokal berbasis pola teks.

Solusi:

- Coba cari manual di Gmail dengan kata kunci seperti `qris`, `pembayaran`, `transfer`, `tagihan`, `cashback`, atau `refund`.
- Pastikan email tersebut muncul di hasil pencarian Gmail.
- Untuk hasil ekstraksi lebih akurat, siapkan `VITE_FUNCTIONS_BASE_URL` dan jalankan extractor Gemini dari backend/Cloud Functions.

### 6. Firebase belum dikonfigurasi

Untuk sekarang aplikasi sudah bisa berjalan dengan mode lokal memakai `localStorage`.

Namun jika ingin data benar-benar realtime lintas device, kamu tetap perlu mengisi Firebase config:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Tanpa Firebase, data hanya tersimpan di browser yang sama.

## Checklist Cepat

Gunakan checklist ini kalau ingin memastikan setup sudah benar:

- [ ] Gmail API sudah `Enable`.
- [ ] OAuth consent screen sudah dibuat.
- [ ] App type/audience sesuai.
- [ ] Email kamu sudah masuk test user.
- [ ] Scope `gmail.readonly` sudah ditambahkan.
- [ ] OAuth Client type adalah `Web application`.
- [ ] Authorized JavaScript origins berisi `http://127.0.0.1:5180`.
- [ ] `.env.local` berisi `VITE_GOOGLE_CLIENT_ID`.
- [ ] App dijalankan di `http://127.0.0.1:5180`.
- [ ] Sudah login Google.
- [ ] Sudah klik `Hubungkan Gmail`.
- [ ] Sudah klik `Scan Email`.

## Referensi Resmi

- Google Identity Services setup:
  https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- OAuth 2.0 untuk JavaScript client:
  https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow
- OAuth consent screen:
  https://developers.google.com/workspace/guides/configure-oauth-consent
- Gmail API scopes:
  https://developers.google.com/workspace/gmail/api/auth/scopes
