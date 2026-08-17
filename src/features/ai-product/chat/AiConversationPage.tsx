/**
 * AI Chat — Natural Conversation (Sprint 1.5 — P8).
 *
 * Percakapan finansial natural ("Kenapa uangku habis minggu ini?") yang
 * menjawab dengan jawaban kaya: ringkasan → grafik → kategori → transaksi →
 * insight → aksi. Data dihitung server (POST /api/ai-product/conversation):
 * Gemini untuk narasi, agregasi deterministik sebagai sumber kebenaran.
 *
 * UX lengkap: suggested queries, period selector 7/30/90, bubble user/AI,
 * skeleton saat memuat, error state + retry, empty state awal.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircleQuestion, RotateCcw, Send, Sparkles } from 'lucide-react';
import Header from '../../../components/layout/Header';
import Card from '../../../components/ui/Card';
import EmptyState from '../../../components/ui/EmptyState';
import { ChartSkeleton } from '../../../components/ui/Skeleton';
import { cn } from '../../../lib/utils';
import {
  askFinancialQuestion,
  CONVERSATION_PERIOD_OPTIONS,
  CONVERSATION_SUGGESTED_QUERIES,
  type ConversationAnswer,
} from '../../../services/conversationService';
import ConversationAnswerView from './ConversationAnswer';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  query?: string;
  /** Periode yang dipakai untuk query ini — disimpan per-pesan agar retry lama tidak tertimpa. */
  periodDays?: number;
  answer?: ConversationAnswer;
  error?: string;
}

let messageSeq = 0;
const nextId = () => `msg-${Date.now()}-${++messageSeq}`;

export default function AiConversationPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  const submit = useCallback(
    async (query: string, days: number, replaceId?: string) => {
      const trimmed = query.trim();
      if (!trimmed || sending) return;

      // Bila retry: ganti pesan error lama dengan loading; bila baru: tambah.
      setSending(true);
      if (replaceId) {
        setMessages((prev) => prev.filter((m) => m.id !== replaceId));
      } else {
        setMessages((prev) => [...prev, { id: nextId(), role: 'user', query: trimmed }]);
      }
      const pendingId = nextId();
      setMessages((prev) => [...prev, { id: pendingId, role: 'assistant', query: trimmed }]);

      try {
        const answer = await askFinancialQuestion({ query: trimmed, periodDays: days });
        setMessages((prev) =>
          prev.map((m) => (m.id === pendingId ? { ...m, answer } : m)),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Terjadi kesalahan.';
        // Query & periode disimpan di pesan error itu sendiri agar tombol retry
        // selalu memakai payload yang benar (bukan yang terakhir gagal).
        setMessages((prev) =>
          prev.map((m) => (m.id === pendingId ? { ...m, error: message, query: trimmed, periodDays: days } : m)),
        );
      } finally {
        setSending(false);
        setInput('');
      }
    },
    [sending],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input, periodDays);
  };

  return (
    <div>
      <Header title="AI Chat" />
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        {/* Hero */}
        <Card className="overflow-hidden border-primary-200/60 bg-gradient-to-br from-primary-50 via-app-card to-soft-purple/40 dark:border-primary-400/20 dark:from-primary-500/10 dark:via-app-card dark:to-soft-purple/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-soft-purple text-white shadow-lg shadow-primary-500/25">
              <MessageCircleQuestion className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-app-text">Tanya keuanganmu dengan bahasa sehari-hari</h2>
              <p className="text-xs text-app-subtle">
                AI membaca transaksimu lalu menjawab dengan ringkasan, grafik, dan langkah konkret.
              </p>
            </div>
          </div>

          {/* Suggested queries */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {CONVERSATION_SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                disabled={sending}
                onClick={() => submit(q, periodDays)}
                className="inline-flex items-center gap-1 rounded-full border border-app-border bg-app-bg px-2.5 py-1 text-[11px] font-medium text-app-text transition-colors hover:border-primary-500/40 hover:bg-primary-500/10 disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3 text-primary-500" />
                {q}
              </button>
            ))}
          </div>
        </Card>

        {/* Riwayat percakapan */}
        <div className="mt-4 space-y-4">
          {messages.length === 0 && (
            <EmptyState
              icon={<MessageCircleQuestion className="h-8 w-8" />}
              title="Mulai percakapan finansial"
              description="Contoh: 'Kenapa uangku habis minggu ini?' — pilih salah satu pertanyaan di atas atau ketik pertanyaanmu sendiri."
            />
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary-500 px-3.5 py-2.5 text-sm text-white shadow-sm">
                  {m.query}
                </div>
              </div>
            ) : m.answer ? (
              <div key={m.id} className="flex flex-col gap-1.5">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-app-subtle">AI · {m.answer.period.label}</p>
                <ConversationAnswerView answer={m.answer} />
              </div>
            ) : m.error ? (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-red-500/30 bg-red-500/10 px-3.5 py-2.5">
                  <p className="text-sm text-red-600 dark:text-red-300">Gagal menganalisis.</p>
                  <p className="mt-0.5 text-xs text-app-muted">{m.error}</p>
                  <button
                    type="button"
                    onClick={() => m.query && submit(m.query, m.periodDays ?? 30, m.id)}
                    disabled={sending || !m.query}
                    className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> Coba lagi
                  </button>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex items-start gap-2">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-500/12 text-primary-600 dark:text-primary-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </div>
                <div className="w-full flex-1">
                  <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-app-subtle">
                    AI sedang menganalisis...
                  </p>
                  <Card className="!p-4">
                    <ChartSkeleton />
                    {/* grid-cols-1 di mobile: skeleton w-40 (160px) tidak muat di
                        kolom 1/3 (~100px) → overflow horizontal saat loading
                        (P2.2 responsive). */}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[1, 2, 3].map((i) => <ChartSkeleton key={i} />)}
                    </div>
                  </Card>
                </div>
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </div>

        {/* Komposer */}
        <form onSubmit={onSubmit} className="sticky bottom-4 mt-5">
          <Card className="!p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1" role="group" aria-label="Periode analisis">
                <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-app-subtle">Periode</span>
                {CONVERSATION_PERIOD_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPeriodDays(d)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      periodDays === d
                        ? 'bg-primary-500 text-white'
                        : 'bg-app-bg text-app-muted hover:bg-app-hover hover:text-app-text',
                    )}
                  >
                    {d === 7 ? '7 hari' : d === 90 ? '90 hari' : '30 hari'}
                  </button>
                ))}
              </div>
              <p className="hidden text-[10px] text-app-subtle sm:block">Jawaban dari data transaksimu · privasi terjaga</p>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit(input, periodDays);
                  }
                }}
                rows={2}
                placeholder="Tanyakan apa saja... mis. 'Kategori apa paling boros bulan ini?'"
                className="flex-1 resize-none rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-sm text-app-text placeholder:text-app-subtle focus:border-primary-500/50 focus:ring-2 focus:ring-primary-500/30 focus:outline-none"
                aria-label="Pertanyaan finansial"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-40"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="hidden sm:inline">Kirim</span>
              </button>
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}
