Kamu adalah Senior Frontend Developer, React Engineer, UI/UX Designer, Product Designer, Firebase Architect, dan AI Integration Specialist yang sangat berpengalaman dalam membangun aplikasi web modern berbasis React.

Saya ingin kamu membantu saya mengembangkan aplikasi web dari nol bernama:

“CashFlow GenZ”

Aplikasi ini adalah web app manajemen keuangan pribadi yang berfokus pada pencatatan pengeluaran dan pemasukan dana secara realtime, terintegrasi dengan Gmail Google, menggunakan AI dari Gemini API untuk membaca transaksi dari email, serta memiliki desain profesional modern minimalis, clean, elegan, dan cocok untuk Gen Z.

==================================================

1. TUJUAN APLIKASI
   ==================================================

Bangun aplikasi web berbasis React untuk membantu pengguna mencatat, memantau, menganalisis, dan mengelola keuangan pribadi secara mudah, cepat, realtime, dan tidak ribet.

Aplikasi harus bisa:

* Mencatat pemasukan
* Mencatat pengeluaran
* Mengelompokkan transaksi berdasarkan kategori
* Menampilkan total saldo realtime
* Menampilkan grafik keuangan
* Membaca email transaksi dari Gmail secara aman
* Mendeteksi email transaksi secara otomatis
* Mengubah isi email transaksi menjadi data keuangan menggunakan Gemini API
* Memberikan insight pengeluaran dan pemasukan
* Memberikan reminder budget
* Menampilkan laporan harian, mingguan, bulanan, dan tahunan
* Export data ke CSV/PDF jika memungkinkan

==================================================
2. TARGET USER
==============

Target pengguna:

* Mahasiswa
* Pekerja muda
* Freelancer
* Gen Z
* Pengguna yang ingin mencatat keuangan tanpa ribet
* Pengguna yang sering menerima email transaksi dari bank, e-wallet, marketplace, payment gateway, QRIS, dan subscription service

Karakter user:

* Suka desain clean
* Tidak suka aplikasi yang ribet
* Ingin input transaksi cepat
* Suka grafik dan visualisasi
* Butuh reminder budget
* Butuh otomatisasi dari Gmail
* Ingin aplikasi terlihat modern seperti fintech

==================================================
3. PLATFORM & TEKNOLOGI
=======================

Gunakan stack berikut:

Frontend:

* React
* Vite
* JavaScript atau TypeScript, prioritaskan TypeScript jika memungkinkan
* React Router DOM
* Tailwind CSS
* Framer Motion untuk animasi halus
* Lucide React untuk icon
* Recharts untuk grafik
* React Hook Form untuk form
* Zod untuk validasi form
* Zustand atau Context API untuk state management ringan

Backend / Realtime:

* Firebase Authentication
* Cloud Firestore
* Firebase Cloud Functions jika dibutuhkan
* Firebase Hosting jika ingin deploy
* Firebase Cloud Messaging atau browser notification jika memungkinkan

Integrasi Google:

* Google Sign-In
* Gmail API
* OAuth 2.0
* Google Account Integration

AI / Automation:

* Gemini API / Google AI Studio
* AI digunakan untuk membaca, mengklasifikasi, dan mengekstrak informasi transaksi dari email Gmail

Database lokal / cache:

* Firestore offline persistence jika memungkinkan
* LocalStorage untuk preferensi ringan seperti theme
* IndexedDB jika diperlukan untuk cache lanjutan

==================================================
4. FITUR UTAMA
==============

A. Authentication

Buat fitur:

* Login dengan akun Google
* Logout
* Menyimpan session user
* Proteksi halaman dashboard jika belum login
* Redirect otomatis jika user belum login
* Tampilkan profil user dari akun Google

B. Dashboard

Dashboard harus menampilkan:

* Total saldo saat ini
* Total pemasukan bulan ini
* Total pengeluaran bulan ini
* Sisa budget bulan ini
* Ringkasan transaksi terbaru
* Grafik cashflow
* Insight singkat dari AI
* Tombol quick action:

  * Tambah Pemasukan
  * Tambah Pengeluaran
  * Scan Gmail
  * Lihat Laporan

Dashboard harus realtime menggunakan Firestore listener.

C. Manajemen Transaksi

User bisa:

* Menambahkan transaksi manual
* Mengedit transaksi
* Menghapus transaksi
* Melihat detail transaksi
* Memilih jenis transaksi:

  * Pemasukan
  * Pengeluaran
* Memilih kategori
* Menambahkan nominal
* Menambahkan tanggal
* Menambahkan catatan
* Menambahkan merchant
* Menambahkan metode pembayaran:

  * Cash
  * Transfer Bank
  * QRIS
  * E-wallet
  * Kartu Debit
  * Kartu Kredit
  * Lainnya

D. Kategori Transaksi

Buat kategori default.

Kategori Pengeluaran:

* Makanan & Minuman
* Transportasi
* Belanja
* Tagihan
* Hiburan
* Pendidikan
* Kesehatan
* Langganan
* Keluarga
* Investasi
* Lainnya

Kategori Pemasukan:

* Gaji
* Freelance
* Bisnis
* Hadiah
* Cashback
* Investasi
* Refund
* Lainnya

User juga bisa:

* Menambah kategori custom
* Mengedit kategori
* Menghapus kategori
* Memilih icon kategori
* Memilih warna kategori

E. Integrasi Gmail

Aplikasi harus terhubung dengan Gmail user melalui Gmail API.

Fitur Gmail:

* Meminta izin akses Gmail secara aman
* Membaca email transaksi dari Gmail
* Memfilter email dari:

  * Bank
  * E-wallet
  * Marketplace
  * Payment gateway
  * QRIS
  * Subscription service
  * Notifikasi transaksi
* Mendeteksi email yang berisi transaksi keuangan
* Mengambil data:

  * Nominal transaksi
  * Jenis transaksi
  * Tanggal transaksi
  * Merchant / pengirim
  * Metode pembayaran
  * Kategori transaksi
  * Deskripsi transaksi
* Menampilkan hasil ekstraksi ke user untuk dikonfirmasi
* Menyimpan transaksi otomatis ke Firestore setelah disetujui user
* Menandai transaksi yang berasal dari Gmail
* Memberikan label “Auto from Gmail”
* Hindari membaca email pribadi yang tidak relevan

Catatan keamanan penting:

* Jangan menyimpan isi email lengkap ke Firestore
* Simpan hanya data transaksi hasil ekstraksi
* Gunakan OAuth scope Gmail seminimal mungkin
* Jangan hardcode API key sensitif di frontend production
* Untuk production, panggil Gemini API lewat Firebase Cloud Functions agar API key tidak bocor
* Berikan halaman Privacy & Permission yang menjelaskan data apa yang dibaca dan disimpan

F. AI Transaction Extractor

Gunakan Gemini API untuk mengubah isi email transaksi menjadi data JSON.

AI harus bisa membaca email seperti:

* Notifikasi transfer masuk
* Notifikasi transfer keluar
* Pembayaran QRIS
* Pembelian marketplace
* Top up e-wallet
* Pembayaran tagihan
* Subscription bulanan
* Cashback
* Refund

Output AI wajib berbentuk JSON valid seperti ini:

{
"is_transaction": true,
"transaction_type": "expense",
"amount": 125000,
"currency": "IDR",
"date": "2026-06-18",
"merchant": "Shopee",
"category": "Belanja",
"payment_method": "Transfer Bank",
"description": "Pembelian barang di Shopee",
"confidence_score": 0.92
}

Jika email bukan transaksi, output:

{
"is_transaction": false,
"reason": "Email tidak mengandung informasi transaksi keuangan"
}

G. Realtime Sync

Semua data harus realtime:

* Saat user menambah transaksi, dashboard langsung berubah
* Saat Gmail berhasil membaca transaksi baru, data langsung muncul
* Grafik update otomatis
* Saldo update otomatis
* Budget update otomatis
* Gunakan Firestore onSnapshot listener
* Gunakan loading state, error state, dan empty state yang rapi

H. Budgeting

User bisa:

* Membuat budget bulanan
* Membuat budget per kategori
* Melihat sisa budget
* Mendapat warning jika pengeluaran hampir melewati batas
* Mendapat warning jika budget sudah habis

Contoh:

* Budget makan: Rp1.000.000/bulan
* Sudah dipakai: Rp750.000
* Sisa: Rp250.000
* Status: Aman / Waspada / Overbudget

I. Reports & Analytics

Buat halaman laporan:

* Harian
* Mingguan
* Bulanan
* Tahunan

Tampilkan:

* Total pemasukan
* Total pengeluaran
* Net cashflow
* Kategori pengeluaran terbesar
* Merchant paling sering
* Grafik line chart cashflow
* Pie chart kategori
* Bar chart pengeluaran
* Insight AI

Contoh insight:

“Pengeluaran makanan kamu naik 28% dibanding bulan lalu. Coba set limit harian biar cashflow tetap aman.”

J. Notifikasi

Buat fitur notifikasi:

* Reminder input transaksi harian
* Warning budget hampir habis
* Transaksi Gmail baru terdeteksi
* Laporan mingguan
* Laporan bulanan

Gunakan browser notification atau Firebase Cloud Messaging jika memungkinkan.

K. Search & Filter

User bisa mencari transaksi berdasarkan:

* Nama merchant
* Kategori
* Nominal
* Jenis transaksi
* Metode pembayaran
* Rentang tanggal
* Sumber transaksi manual / Gmail

L. Profile & Settings

Halaman pengaturan berisi:

* Profil user
* Email Google terhubung
* Sinkronisasi Gmail aktif/nonaktif
* Mode konfirmasi transaksi Gmail aktif/nonaktif
* Tema aplikasi light/dark/system
* Mata uang default
* Reset data
* Export data
* Privacy policy
* Logout

M. Export Data

User bisa export data ke:

* CSV
* PDF laporan bulanan
* Excel jika memungkinkan

==================================================
5. DESIGN UI/UX
===============

Gunakan desain:

* Profesional
* Modern
* Minimalis
* Clean
* Elegan
* Gen Z friendly
* Smooth
* Tidak terlalu ramai
* Banyak whitespace
* Rounded corner
* Soft shadow
* Micro interaction
* Card-based layout
* Responsive layout
* Mobile-first
* Desktop-friendly

Style visual:

* Fintech modern
* Dark mode dan light mode
* Warna utama:

  * Deep navy
  * Soft purple
  * Mint green
  * Clean white
  * Soft gray
* Jangan gunakan warna terlalu norak
* Hindari UI yang terlalu rame
* Gunakan typography yang rapi
* Gunakan icon modern

Layout utama:

Desktop:

* Sidebar navigation di kiri
* Header/topbar
* Main content
* Summary cards
* Chart area
* Recent transactions

Mobile:

* Bottom navigation
* Floating action button
* Card-based layout
* Sheet/modal untuk form transaksi

Navigation:

* Home
* Transactions
* Budget
* Reports
* Gmail Sync
* Profile

Komponen UI:

* Balance card
* Income card
* Expense card
* Budget card
* Quick action button
* Transaction list item
* Category chip
* Animated chart
* Empty state
* Loading skeleton
* Confirmation modal
* Floating action button
* Toast notification
* Modal detail transaksi
* Responsive sidebar
* Mobile bottom navigation

==================================================
6. STRUKTUR HALAMAN
===================

Buat halaman berikut:

1. Splash / Loading Screen
2. Landing Page
3. Login Page
4. Home Dashboard
5. Add Transaction Page
6. Edit Transaction Page
7. Transaction Detail Modal
8. Transaction History Page
9. Gmail Sync Page
10. Gmail Transaction Review Page
11. Budget Page
12. Add Budget Modal
13. Reports Page
14. Category Management Page
15. Profile Page
16. Settings Page
17. Privacy & Permission Page
18. Not Found Page

==================================================
7. ARSITEKTUR PROJECT
=====================

Gunakan struktur folder React yang rapi:

src/
├── app/
│   ├── App.tsx
│   ├── router.tsx
│   └── providers.tsx
├── assets/
├── components/
│   ├── common/
│   ├── layout/
│   ├── charts/
│   ├── forms/
│   └── ui/
├── config/
│   ├── firebase.ts
│   ├── env.ts
│   └── constants.ts
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── transactions/
│   ├── categories/
│   ├── budgets/
│   ├── reports/
│   ├── gmail/
│   └── profile/
├── hooks/
├── lib/
│   ├── firebase/
│   ├── gmail/
│   ├── gemini/
│   └── utils/
├── services/
│   ├── authService.ts
│   ├── transactionService.ts
│   ├── budgetService.ts
│   ├── categoryService.ts
│   ├── gmailService.ts
│   └── geminiService.ts
├── store/
├── styles/
├── types/
└── main.tsx

Gunakan pendekatan feature-based architecture:

* features/auth
* features/dashboard
* features/transactions
* features/budgets
* features/reports
* features/gmail
* features/profile

==================================================
8. DATA MODEL
=============

Buat TypeScript types berikut:

User:

* id
* name
* email
* photoUrl
* createdAt
* updatedAt

Transaction:

* id
* userId
* type: income | expense | transfer | refund
* amount
* categoryId
* categoryName
* merchant
* paymentMethod
* note
* date
* source: manual | gmail
* gmailMessageId
* confidenceScore
* createdAt
* updatedAt

Category:

* id
* userId
* name
* type: income | expense
* icon
* color
* isDefault
* createdAt

Budget:

* id
* userId
* categoryId
* categoryName
* amount
* usedAmount
* month
* year
* status: safe | warning | overbudget
* createdAt
* updatedAt

GmailSyncLog:

* id
* userId
* messageId
* subject
* sender
* extractedTransactionId
* status: pending | approved | rejected | skipped | duplicate | failed
* confidenceScore
* scannedAt

ExtractedTransaction:

* is_transaction
* transaction_type
* amount
* currency
* date
* merchant
* category
* payment_method
* description
* confidence_score
* reason

==================================================
9. FIRESTORE COLLECTION STRUCTURE
=================================

Gunakan struktur Firestore:

users/{userId}

users/{userId}/transactions/{transactionId}

users/{userId}/categories/{categoryId}

users/{userId}/budgets/{budgetId}

users/{userId}/gmailSyncLogs/{logId}

Pastikan Firestore Security Rules aman:

* User hanya bisa membaca dan menulis datanya sendiri
* Tidak boleh akses data user lain
* Validasi userId harus sesuai request.auth.uid
* Wajib login untuk akses data
* Field penting divalidasi
* Tidak boleh write amount negatif
* Tidak boleh write transaksi tanpa userId yang sesuai

==================================================
10. SECURITY & PRIVACY
======================

Prioritaskan keamanan:

* Gunakan Firebase Authentication
* Gunakan Firestore Security Rules
* Gunakan OAuth scope Gmail minimum
* Jangan menyimpan token sembarangan
* Jangan menyimpan full email body
* Jangan membaca email yang tidak relevan
* Tampilkan halaman permission yang jelas kepada user
* Berikan opsi disconnect Gmail
* Berikan opsi delete semua data
* Gunakan HTTPS
* Jangan hardcode API key Gemini di frontend production
* Untuk production, gunakan Firebase Cloud Functions sebagai proxy ke Gemini API

==================================================
11. REALTIME BEHAVIOR
=====================

Implementasikan realtime:

* Dashboard menggunakan Firestore onSnapshot
* Data transaksi realtime
* Data budget realtime
* Data kategori realtime
* Perubahan transaksi langsung mengubah saldo
* Budget langsung update
* Grafik langsung refresh
* Gmail sync otomatis memperbarui transaksi
* Tambahkan loading, error, dan empty state

==================================================
12. FLOW GMAIL SYNC
===================

Buat flow Gmail sync seperti ini:

1. User login dengan Google
2. User membuka halaman Gmail Sync
3. User memberikan permission Gmail
4. Aplikasi mengambil email relevan menggunakan Gmail API
5. Aplikasi memfilter email transaksi
6. Isi email relevan dikirim ke Gemini API melalui Firebase Cloud Functions
7. Gemini mengekstrak data transaksi ke JSON
8. Jika confidence_score tinggi, tampilkan ke user untuk review
9. User approve atau reject
10. Jika approve, simpan transaksi ke Firestore
11. Dashboard update realtime

Jika mode auto-save aktif:

* Transaksi dengan confidence_score di atas 0.90 boleh langsung disimpan
* Transaksi dengan confidence_score di bawah 0.90 harus masuk halaman review

Untuk duplikasi:

* Gunakan gmailMessageId
* Jangan simpan email yang sama dua kali

==================================================
13. AI PROMPT INTERNAL UNTUK GEMINI
===================================

Gunakan prompt internal ini untuk ekstraksi email:

“Kamu adalah AI financial transaction extractor. Tugasmu adalah membaca teks email dan menentukan apakah email tersebut mengandung transaksi keuangan. Jangan mengarang data. Jika data tidak tersedia, isi dengan null. Output harus JSON valid tanpa markdown.

Ambil informasi:

* is_transaction
* transaction_type: income / expense / transfer / refund
* amount
* currency
* date
* merchant
* category
* payment_method
* description
* confidence_score

Gunakan kategori bahasa Indonesia:

Makanan & Minuman, Transportasi, Belanja, Tagihan, Hiburan, Pendidikan, Kesehatan, Langganan, Keluarga, Investasi, Gaji, Freelance, Bisnis, Cashback, Refund, Lainnya.

Email:

{{EMAIL_TEXT}}

Output JSON:”

==================================================
14. VALIDASI & EDGE CASE
========================

Tangani kasus berikut:

* Firestore Database default belum dibuat
* Firebase config salah project
* Email bukan transaksi
* Nominal tidak ditemukan
* Tanggal tidak ditemukan
* Transaksi duplikat
* Email transaksi lama
* Gmail API error
* Token expired
* User revoke permission
* Internet mati
* Firestore gagal sync
* Gemini API gagal membaca email
* Confidence score rendah
* Data transaksi ambigu
* User belum login
* Permission Gmail ditolak
* API key tidak tersedia
* Environment variable belum diatur

==================================================
15. ENVIRONMENT VARIABLE
========================

Gunakan file .env.local dengan format:

VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GOOGLE_CLIENT_ID=
VITE_FUNCTIONS_BASE_URL=

Catatan:

* Jangan commit file .env.local
* Buat file .env.example sebagai contoh
* Untuk production, jangan taruh Gemini API key di frontend
* Gemini API key harus dipakai lewat backend atau Firebase Cloud Functions

==================================================
16. OUTPUT YANG SAYA INGINKAN
=============================

Berikan hasil dalam beberapa tahap.

Tahap 1:

* Analisis kebutuhan aplikasi
* Daftar fitur prioritas
* User flow lengkap
* Struktur database
* Struktur folder project
* Roadmap pengembangan

Tahap 2:

* Setup React + Vite + TypeScript
* Setup Tailwind CSS
* Setup Firebase
* Setup Google Auth
* Setup Firestore
* Setup React Router
* Setup layout responsive
* Setup theme light/dark

Tahap 3:

* Buat UI screen utama
* Buat navigation
* Buat reusable components
* Buat dashboard modern minimalis
* Buat mobile bottom navigation
* Buat desktop sidebar

Tahap 4:

* Buat fitur CRUD transaksi
* Buat kategori
* Buat budget
* Buat laporan
* Buat search dan filter

Tahap 5:

* Integrasikan Gmail API
* Buat Gmail Sync Page
* Buat Gmail Transaction Review Page
* Buat Gemini Transaction Extractor
* Buat duplicate checking dengan gmailMessageId

Tahap 6:

* Implementasikan realtime sync
* Implementasikan notification
* Implementasikan export CSV/PDF
* Implementasikan loading, error, empty state

Tahap 7:

* Audit security
* Optimasi performa
* Testing
* Error handling
* Final polish UI/UX
* Siapkan deployment ke Firebase Hosting atau Vercel

==================================================
17. CARA KERJA
==============

Jangan langsung membuat semuanya dalam satu jawaban besar.

Mulai dari:

1. Analisis kebutuhan aplikasi
2. Rekomendasi arsitektur terbaik
3. Struktur folder
4. Database schema
5. Roadmap pengembangan
6. Baru lanjutkan ke kode secara bertahap

Setiap kali membuat kode:

* Berikan file path
* Berikan kode lengkap
* Jangan potong kode penting
* Jelaskan fungsi file secara singkat
* Pastikan tidak ada error import
* Pastikan mengikuti best practice React modern
* Pastikan desain UI konsisten dan profesional
* Pastikan responsive di mobile dan desktop
* Pastikan Firestore realtime berjalan dengan onSnapshot
* Pastikan security dan privacy menjadi prioritas

Gunakan bahasa Indonesia yang jelas, detail, dan mudah dipahami.
