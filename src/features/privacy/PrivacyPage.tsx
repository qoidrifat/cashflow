import { Database, KeyRound, MailCheck, Shield, Trash2 } from 'lucide-react';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';

const sections = [
  {
    icon: MailCheck,
    title: 'Data Gmail yang Dibaca',
    body: 'Aplikasi hanya mencari email yang berpotensi berisi transaksi seperti bank, e-wallet, marketplace, QRIS, payment gateway, tagihan, cashback, refund, dan subscription.',
  },
  {
    icon: Database,
    title: 'Data yang Disimpan',
    body: 'Supabase hanya menyimpan hasil ekstraksi transaksi: nominal, tanggal, merchant, kategori, metode pembayaran, sumber Gmail, messageId, dan confidence score. Isi email lengkap tidak disimpan.',
  },
  {
    icon: KeyRound,
    title: 'API Key & Token',
    body: 'Gemini API untuk production dipanggil lewat server proxy. API key sensitif tidak boleh di-hardcode di frontend production.',
  },
  {
    icon: Shield,
    title: 'Scope Minimum',
    body: 'OAuth Gmail wajib memakai scope seminimal mungkin dan user harus bisa memutus sinkronisasi Gmail kapan pun dari pengaturan.',
  },
  {
    icon: Trash2,
    title: 'Kontrol User',
    body: 'User memiliki opsi export data, reset data, disconnect Gmail, dan logout. Akses data dibatasi oleh Supabase RLS berbasis user_id.',
  },
];

export default function PrivacyPage() {
  return (
    <div>
      <Header title="Privasi & Izin" />

      <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
        <Card className="fintech-surface">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary-600 dark:text-primary-300">
              Permission brief
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold text-app-text">
              Gmail dibaca seperlunya, transaksi disimpan secukupnya.
            </h2>
            <p className="mt-3 text-sm leading-6 text-app-muted">
              Halaman ini menjelaskan batas data yang diproses agar integrasi Gmail dan Gemini tetap transparan, aman, dan sesuai kebutuhan aplikasi.
            </p>
          </div>
        </Card>

        <div className="grid gap-3">
          {sections.map((section) => (
            <Card key={section.title}>
              <div className="flex gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-900/25 dark:text-primary-300">
                  <section.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-app-text">{section.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-app-muted">{section.body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
