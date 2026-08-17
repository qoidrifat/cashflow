/**
 * AI Timeline — metadata event_type & status (P9).
 *
 * Murni presentasi: label Bahasa Indonesia, ikon lucide, dan tone Tailwind
 * (dark-mode aware, pola existing: bg-*-50 dark:bg-*-500/12).
 */
import {
  Bot,
  BrainCircuit,
  Lightbulb,
  MessageCircleQuestion,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  CheckCircle2,
  Eye,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

export interface EventTypeMeta {
  label: string;
  icon: LucideIcon;
  /** Tone ikon (warna latar). */
  iconTone: string;
  /** Badge chip. */
  chipTone: string;
}

export const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  insight: {
    label: 'Insight',
    icon: Lightbulb,
    iconTone: 'bg-amber-50 dark:bg-amber-500/12 text-amber-600 dark:text-amber-300',
    chipTone: 'bg-amber-500/12 text-amber-600 dark:text-amber-300 border-amber-500/30',
  },
  recommendation: {
    label: 'Rekomendasi',
    icon: Sparkles,
    iconTone: 'bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-300',
    chipTone: 'bg-primary-500/12 text-primary-600 dark:text-primary-300 border-primary-500/30',
  },
  conversation: {
    label: 'Percakapan',
    icon: MessageCircleQuestion,
    iconTone: 'bg-cyan-50 dark:bg-cyan-500/12 text-cyan-600 dark:text-cyan-300',
    chipTone: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
  },
  feedback: {
    label: 'Feedback',
    icon: ThumbsUp,
    iconTone: 'bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300',
    chipTone: 'bg-mint-500/12 text-mint-600 dark:text-mint-300 border-mint-500/30',
  },
  memory_update: {
    label: 'Memory',
    icon: BrainCircuit,
    iconTone: 'bg-violet-50 dark:bg-violet-500/12 text-violet-600 dark:text-violet-300',
    chipTone: 'bg-violet-500/12 text-violet-600 dark:text-violet-300 border-violet-500/30',
  },
  risk: {
    label: 'Risiko',
    icon: ShieldAlert,
    iconTone: 'bg-red-50 dark:bg-red-500/12 text-red-500 dark:text-red-300',
    chipTone: 'bg-red-500/12 text-red-500 dark:text-red-300 border-red-500/30',
  },
  other: {
    label: 'AI',
    icon: Bot,
    iconTone: 'bg-slate-100 dark:bg-slate-500/12 text-slate-600 dark:text-slate-300',
    chipTone: 'bg-slate-500/12 text-slate-600 dark:text-slate-300 border-slate-500/30',
  },
};

export const EVENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_TYPE_META).map(([k, v]) => [k, v.label]),
);

/** Label event_type — fallback aman untuk nilai tak dikenal. */
export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] || 'AI';
}

/** Ikon event_type — fallback Bot. */
export function eventTypeIcon(eventType: string): LucideIcon {
  return EVENT_TYPE_META[eventType]?.icon || Bot;
}

/** Filter chips halaman (P9 §15): Semua + event type utama. */
export interface TimelineFilterOption {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const TIMELINE_FILTERS: TimelineFilterOption[] = [
  { key: 'all', label: 'Semua', icon: Bot },
  { key: 'insight', label: 'Insights', icon: Lightbulb },
  { key: 'recommendation', label: 'Rekomendasi', icon: Sparkles },
  { key: 'conversation', label: 'Percakapan', icon: MessageCircleQuestion },
  { key: 'feedback', label: 'Feedback', icon: ThumbsUp },
  { key: 'memory_update', label: 'Memory', icon: BrainCircuit },
];

// ── Status (P9 §12) ──────────────────────────────────────────────────────────

export interface StatusMeta {
  label: string;
  tone: string;
  icon: LucideIcon;
}

export const STATUS_META: Record<string, StatusMeta> = {
  new: {
    label: 'Baru',
    tone: 'bg-primary-500/12 text-primary-600 dark:text-primary-300 border-primary-500/30',
    icon: Eye,
  },
  viewed: {
    label: 'Dilihat',
    tone: 'bg-slate-500/12 text-slate-600 dark:text-slate-300 border-slate-500/30',
    icon: Eye,
  },
  completed: {
    label: 'Selesai',
    tone: 'bg-mint-500/12 text-mint-600 dark:text-mint-300 border-mint-500/30',
    icon: CheckCircle2,
  },
  dismissed: {
    label: 'Dibuang',
    tone: 'bg-red-500/12 text-red-500 dark:text-red-300 border-red-500/30',
    icon: Trash2,
  },
};

export function statusLabel(status: string): string {
  return STATUS_META[status]?.label || status;
}
