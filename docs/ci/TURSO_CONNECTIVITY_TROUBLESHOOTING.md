# Turso Connectivity Troubleshooting

> Status: Active · Last updated: 2026-08-07 (Incident 2026-08-07 **RESOLVED**)

Panduan ini dipakai saat `npm run dev:all` gagal dengan `fetch failed`,
`getaddrinfo ENOENT`, atau error Better Auth yang ternyata berasal dari akses
database. Jangan ubah auth/OAuth sebelum layer Turso terbukti sehat.

## Diagnosis Order

1. Pastikan env runtime terbaca dari `server/.env` atau env proses:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, dan `GOOGLE_APPLICATION_CREDENTIALS`.
2. Redact URL sebelum ditampilkan. Yang boleh dicatat hanya `protocol`,
   `hostname`, `port`, dan path database bila tidak berisi credential.
3. Validasi DNS hostname:
   ```powershell
   nslookup <turso-hostname>
   Resolve-DnsName <turso-hostname>
   ```
4. Validasi resolver yang dipakai Node:
   ```powershell
   node --input-type=module -e "import dns from 'node:dns/promises'; console.log(await dns.lookup('<turso-hostname>', { all: true }))"
   ```
5. Jika DNS Node lulus, validasi TCP/HTTPS:
   ```powershell
   Test-NetConnection <turso-hostname> -Port 443
   curl.exe -I --max-time 15 https://<turso-hostname>
   ```
6. Jika DNS dan TCP lulus, baru validasi libSQL read-only:
   ```sql
   SELECT 1;
   SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
   ```

## Incident Log — 2026-08-07 (RESOLVED)

Gejala awal saat `npm run dev:all`:

```text
Database client Turso siap
[schema] ⚠️ schema stmt transien (fetch failed)
Error: getaddrinfo ENOENT cashflow-ryukinoir.aws-ap-northeast-1.turso.io
[Better Auth]: INTERNAL_SERVER_ERROR — TypeError: fetch failed (cause: getaddrinfo ENOENT)
```

Kondisi saat insiden (bukti audit pra-perbaikan):

```text
nslookup / Resolve-DnsName : PASS via configured IPv6 DNS
Node dns.lookup            : FAIL getaddrinfo ENOENT
Node dns.resolve*          : FAIL ECONNREFUSED (server 127.0.0.1)
curl HTTPS hostname        : FAIL could not resolve host
libSQL SELECT 1            : FAIL fetch failed, cause ENOENT
Node dns.getServers()      : [ "127.0.0.1" ]
```

Kesimpulan awal yang benar: ini masalah resolver/network lokal untuk jalur yang
dipakai Node/libSQL, **bukan** root cause Better Auth. Better Auth ikut error
karena session database-backed membutuhkan Turso.

## Incident Resolution — 2026-08-07 (Root Cause + Fix)

### Root Cause (evidence-based)

**Trigger insiden** — transisi reconnect Wi-Fi. Lease DHCP Wi-Fi dibuat ulang
pada `2026-08-07T17:28Z` (`LeaseObtainedTime=1786085307`, registry
`Tcpip\Parameters\Interfaces\{012b3126-...}`), yaitu tepat di sekitar waktu
insiden. Selama transisi, DNS Client tidak memiliki server valid yang dapat
dijangkau; router hanya mengiklankan DNS IPv6 `2404:c0:d400::5:1` yang tidak
merespons. Akibatnya OS resolver gagal (`getaddrinfo ENOENT`) → `fetch failed`
→ Better Auth `INTERNAL_SERVER_ERROR` + schema init gagal.

**Misteri `127.0.0.1` pada `dns.getServers()`** — BUKAN konfigurasi sisa yang
tersembunyi. Ini adalah **fallback bawaan c-ares** (library DNS yang dipakai
`dns.resolve*`/`dns.getServers` di Node). Bukti: source Node v24.15.0
`src/cares_wrap.cc`, komentar pada `ChannelWrap::EnsureServers()`:

```cpp
/* The fallback servers of cares is [ "127.0.0.1" ] with no user additional
 * setting. */
```

c-ares fallback ke `['127.0.0.1']` ketika tidak menemukan DNS server sistem.
Scan menyeluruh membuktikan registry Windows **bersih** dari 127.0.0.1
(global `Tcpip\Parameters\NameServer` kosong; semua per-interface kosong;
NRPT tanpa rule; `Dnscache\InterfaceSpecificParameters` tidak ada;
`GetNetworkParams` P/Invoke mengembalikan daftar kosong).

**Pemilik historis `127.0.0.1:53`** — ReasonLabs "Safer Web" DNS (produk
keamanan). Binary sudah dihapus (`C:\Program Files\ReasonLabs\DNS\` kosong),
tetapi 3 service orphan tetap Auto-start dan gagal tiap boot:
`rsDNSSvc`, `rsDNSResolver`, `rsDNSClientSvc`. Saat produk ini aktif, ia
menjalankan resolver lokal di `127.0.0.1:53` dan menunjuk DNS ke sana — pola
yang sama dengan gejala insiden. Service orphan ini adalah risiko laten.

**Residu `nslookup` default timeout** — nslookup memilih DNS IPv6 dari ISP
(`2404:c0:d400::5:1`, dari DHCP) yang tidak merespons. Tidak berdampak ke
aplikasi (Node memakai jalur IPv4/getaddrinfo).

### Fix yang Diterapkan (Windows/network layer — terminal admin/UAC)

| Perubahan | Perintah | Status |
|---|---|---|
| DNS statis adapter Wi-Fi | `Set-DnsClientServerAddress -InterfaceAlias 'Wi-Fi' -ServerAddresses @('192.168.1.1','1.1.1.1')` | ✅ diterapkan |
| Global DNS NameServer | `Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name NameServer -Value '192.168.1.1,1.1.1.1'` | ✅ diterapkan |
| Disable service orphan ReasonLabs | `sc config rsDNSSvc start= disabled` (+ `rsDNSResolver`, `rsDNSClientSvc`) | ✅ diterapkan |

Catatan: `netsh interface ipv4 set dnsservers "Wi-Fi" static ...` gagal dengan
"Element not found" di sesi ini; cmdlet `Set-DnsClientServerAddress` adalah
cara yang andal.

### Validasi Setelah Fix

```text
Node dns.lookup   : PASS  → 54.178.40.18 (konsisten x3)
curl -Iv https://cashflow-ryukinoir.aws-ap-northeast-1.turso.io
                  : PASS  → TLS OK, HTTP 401 (wajar tanpa token)
Test-NetConnection 54.178.40.18 -Port 443 : PASS
libSQL SELECT 1   : PASS  → [ { ok: 1 } ]
Get-DnsClientServerAddress Wi-Fi : {192.168.1.1, 1.1.1.1} (static)
Global NameServer : [192.168.1.1, 1.1.1.1] (sebelumnya kosong)
```

Boot `npm run dev:all` (restart bersih, `node --watch`):

```text
Database client Turso siap ✅
Vertex AI Gemini siap ✅
Better Auth siap dengan Google OAuth ✅
CashFlow AI Proxy berjalan ✅
Alert scheduler aktif ✅
Vertex AI connectivity OK ✅
Schema database Turso terverifikasi ✅
Frontend ✓ 5180 · Backend ✓ 5181
```

Endpoint:

```text
GET /api/health → {"ok":true,"geminiReady":true,...}
GET /api/ready  → {"ok":true,"ready":true,"dependencies":{"turso":"ok","vertexAi":"ok"}}
GET /api/auth/get-session → 200 null (tanpa session — benar)
```

Browser (http://localhost:5180): login page render, zero console errors.

Test suite: Typecheck 0 · Lint 0 · Unit **561 passed + 5 skipped (saat insiden — suite kini 786)** · Build PASS
(25.6s).

### Yang TIDAK Diubah (sesuai aturan insiden)

- Tidak ada perubahan kode aplikasi (0 file source diubah untuk DNS).
- Turso URL/token tidak diubah; TLS tidak di-disable; sertifikat tidak
  di-validate-off.
- Tidak ada retry blanket runtime baru; tidak ada DNS hardcoded di kode app.
- Better Auth / Google OAuth / Vertex AI / SSE tidak disentuh.

### Rollback (bila diperlukan)

```powershell
# Kembalikan DNS Wi-Fi ke DHCP
Set-DnsClientServerAddress -InterfaceAlias 'Wi-Fi' -ResetServerAddresses
# Hapus global NameServer (kembali ke kosong)
Remove-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name NameServer
# Aktifkan kembali service ReasonLabs (hanya bila produk di-install ulang)
sc config rsDNSSvc start= auto
sc config rsDNSResolver start= auto
sc config rsDNSClientSvc start= auto
```

### Residual yang DIDOKUMENTASIKAN (bukan bug)

1. **`dns.getServers()` = `['127.0.0.1']` dan `dns.resolve4()` ECONNREFUSED**
   tetap bertahan bahkan setelah perbaikan Windows layer. Ini **perilaku
   internal c-ares** (fallback default terdokumentasi). Verifikasi: 0 kode
   CashFlow memakai `resolve4`/`getServers`/`node:dns`; semua jalur runtime
   (fetch, `@libsql/client`) memakai `dns.lookup` → OS resolver yang sehat.
   **Jangan** "perbaiki" dengan hardcode resolver di kode aplikasi.
2. **nslookup default timeout** karena DNS IPv6 ISP tidak merespons; gunakan
   `nslookup <host> <ipv4-dns>` atau `Resolve-DnsName` untuk verifikasi.
3. **`BETTER_AUTH_SECRET`** memakai fallback development di dev; wajib di-set
   sebelum produksi (lihat `.env.example`).

## Safe Fixes

- Perbaiki DNS/network lokal agar Node dan curl bisa resolve hostname Turso
  (contoh di atas: set DNS adapter via `Set-DnsClientServerAddress`).
- Cek VPN, proxy, firewall, DNS over IPv6, dan resolver ISP.
- Jika resolver lokal bermasalah, set DNS adapter ke resolver yang dapat
  diakses dari jaringan tersebut, lalu ulangi diagnosis Node/curl.
- Verifikasi database URL aktual via Turso dashboard/CLI yang sudah login bila
  hostname tetap gagal dari beberapa resolver.
- Service orphan dari produk yang sudah di-uninstall (contoh: `rsDNS*`
  ReasonLabs) → `sc config <name> start= disabled` (admin).

## Do Not

- Jangan membuat database Turso baru untuk mengatasi DNS.
- Jangan mengganti provider database atau fallback ke SQLite.
- Jangan menambah blanket retry pada runtime query.
- Jangan retry otomatis write non-idempotent.
- Jangan print `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`,
  `GOOGLE_CLIENT_SECRET`, atau credential Vertex.
- Jangan hardcode `1.1.1.1`/`8.8.8.8`/IP ke source code aplikasi.
- Jangan disable TLS atau validasi sertifikat.

## Expected Healthy Result

```text
DNS                  : PASS di Node dan PowerShell
TCP 443              : PASS
libSQL SELECT 1      : PASS
schema initialization: PASS
Better Auth          : tidak lagi INTERNAL_SERVER_ERROR/fetch failed
/ api/ready          : {"dependencies":{"turso":"ok","vertexAi":"ok"}}
```
