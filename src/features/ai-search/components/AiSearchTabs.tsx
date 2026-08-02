import type { ComponentType } from 'react';
import { BrainCircuit, HelpCircle, MailSearch, ReceiptText, Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AiSearchTab } from '../services/agentSearchClient';

export const AI_SEARCH_TABS: Array<{
  id: AiSearchTab;
  label: string;
  placeholder: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: 'help', label: 'Bantuan', placeholder: 'Tanya cara pakai CashFlow...', icon: HelpCircle },
  { id: 'transactions', label: 'Transaksi', placeholder: 'Contoh: cari transaksi tiket Bali bulan Juni', icon: Search },
  { id: 'insight', label: 'Insight', placeholder: 'Contoh: kategori apa yang paling boros bulan ini?', icon: BrainCircuit },
  { id: 'gmail', label: 'Gmail Sync', placeholder: 'Contoh: email mana yang gagal diproses?', icon: MailSearch },
  { id: 'receipts', label: 'Bukti', placeholder: 'Contoh: cari struk cash bulan ini', icon: ReceiptText },
];

export default function AiSearchTabs({
  activeTab,
  onChange,
}: {
  activeTab: AiSearchTab;
  onChange: (tab: AiSearchTab) => void;
}) {
  return (
    <div className="overflow-x-auto scrollbar-hide">
      <div className="flex min-w-max gap-2 rounded-2xl border border-app-border bg-app-elevated/72 p-1.5">
        {AI_SEARCH_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                'inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all',
                active
                  ? 'bg-primary-600 text-white shadow-sm shadow-primary-500/25'
                  : 'text-app-muted hover:bg-app-hover hover:text-app-text',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
