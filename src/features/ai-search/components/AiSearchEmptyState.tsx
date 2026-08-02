import { SearchX, DatabaseZap } from 'lucide-react';
import Card from '../../../components/ui/Card';

export default function AiSearchEmptyState({ hasSearched, notSynced = false }: { hasSearched: boolean; notSynced?: boolean }) {
  if (notSynced) {
    return (
      <Card className="border-dashed">
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-500 dark:bg-amber-500/12">
            <DatabaseZap className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-app-text">Belum ada data tersinkron</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-app-muted">
            Data untuk tab ini belum dikirim ke Agent Search. Klik tombol "Sync" di atas
            untuk mengindeks datamu, lalu coba cari lagi.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-dashed">
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-app-hover text-app-muted">
          <SearchX className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-app-text">
          {hasSearched ? 'Tidak ada hasil untuk query ini' : 'Mulai dengan bahasa natural'}
        </h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-app-muted">
          {hasSearched
            ? 'Coba gunakan kata kunci lain. Datamu sudah tersinkron tapi tidak ada yang cocok dengan pencarian ini.'
            : 'Tanyakan panduan, transaksi, insight, Gmail Sync, atau bukti transaksi yang ingin kamu cari.'}
        </p>
      </div>
    </Card>
  );
}
