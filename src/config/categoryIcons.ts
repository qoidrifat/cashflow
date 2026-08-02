/**
 * Category Icon & Color Mapping
 *
 * Comprehensive mapping for all expense and income categories.
 * Case-insensitive matching with aliases for alternative names.
 * Fallback untuk kategori yang tidak dikenal.
 */

import {
  UtensilsCrossed, Coffee, CupSoda,
  Car, Bus, Train,
  ShoppingBag, ShoppingCart,
  Receipt, ReceiptText, FileText, ClipboardList,
  Gamepad2, Clapperboard, Music,
  GraduationCap, BookOpen, Book,
  HeartPulse, Stethoscope, Pill,
  Repeat, CalendarClock, BadgeCheck,
  Users, Home, Heart,
  TrendingUp, ChartCandlestick, LineChart,
  Plane, Luggage,
  Hotel, BedDouble,
  Ticket, Badge,
  Landmark, CreditCard,
  ArrowLeftRight, Send,
  RotateCcw, Undo2,
  BadgePercent, Gift,
  MoreHorizontal, CircleEllipsis,
  Wallet, Briefcase, BriefcaseBusiness,
  Laptop, Code2, PenTool,
  Store, Building2,
  Banknote, Coins,
  ArrowDownToLine, Download,
  Sparkles,
  CircleDollarSign,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

// ===================== Types =====================

export interface CategoryMeta {
  icon: LucideIcon;
  color: string;
  /** CSS class for light mode background */
  bgLight: string;
  /** CSS class for dark mode background */
  bgDark: string;
  /** CSS class for text/icon color in light mode */
  textLight: string;
  /** CSS class for text/icon color in dark mode */
  textDark: string;
  /** Border class for light mode */
  borderLight?: string;
  /** Border class for dark mode */
  borderDark?: string;
}

type CategoryType = 'expense' | 'income';

// ===================== Color Palettes =====================

const COLORS = {
  orange: '#f59e0b',
  amber: '#d97706',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  red: '#ef4444',
  pink: '#ec4899',
  indigo: '#6366f1',
  emerald: '#10b981',
  cyan: '#06b6d4',
  rose: '#f43f5e',
  green: '#22c55e',
  sky: '#0ea5e9',
  violet: '#7c3aed',
  yellow: '#eab308',
  slate: '#64748b',
  teal: '#14b8a6',
  lime: '#84cc16',
  mint: '#14b8a6',
  gray: '#6b7280',
};

// ===================== Icon Mapping =====================

/**
 * Mapping nama kategori → icon Lucide component
 * Support full name, lowercase, and aliases
 */
const ICON_MAP: Record<string, LucideIcon> = {
  // Makanan & Minuman
  'makanan & minuman': UtensilsCrossed,
  'makanan': UtensilsCrossed,
  'food': UtensilsCrossed,
  'minuman': CupSoda,
  'kopi': Coffee,
  'coffee': Coffee,
  'restoran': UtensilsCrossed,

  // Transportasi
  'transportasi': Car,
  'transport': Car,
  'bensin': Car,
  'parkir': Car,
  'tol': Car,

  // Belanja
  'belanja': ShoppingBag,
  'shopping': ShoppingBag,
  'purchase': ShoppingCart,
  'belanja online': ShoppingCart,

  // Tagihan
  'tagihan': ReceiptText,
  'bills': ReceiptText,
  'listrik': ReceiptText,
  'pdam': ReceiptText,
  'internet': ReceiptText,
  'pulsa': ReceiptText,

  // Hiburan
  'hiburan': Gamepad2,
  'entertainment': Gamepad2,
  'film': Clapperboard,
  'nonton': Clapperboard,
  'game': Gamepad2,
  'musik': Music,
  'music': Music,

  // Pendidikan
  'pendidikan': GraduationCap,
  'education': GraduationCap,
  'sekolah': GraduationCap,
  'kuliah': GraduationCap,
  'kursus': BookOpen,
  'les': BookOpen,
  'buku': Book,

  // Kesehatan
  'kesehatan': HeartPulse,
  'health': HeartPulse,
  'rumah sakit': HeartPulse,
  'dokter': Stethoscope,
  'obat': Pill,
  'apotek': Pill,

  // Langganan
  'langganan': Repeat,
  'subscription': Repeat,
  'netflix': Repeat,
  'spotify': Repeat,
  'youtube premium': BadgeCheck,

  // Keluarga
  'keluarga': Users,
  'family': Users,
  'rumah': Home,
  'anak': Heart,

  // Investasi
  'investasi': TrendingUp,
  'investment': TrendingUp,
  'saham': ChartCandlestick,
  'reksadana': LineChart,
  'emas': ChartCandlestick,
  'crypto': LineChart,

  // Travel
  'travel': Plane,
  'perjalanan': Plane,
  'liburan': Luggage,

  // Hotel
  'hotel': Hotel,
  'penginapan': BedDouble,

  // Tiket
  'tiket': Ticket,
  'ticket': Ticket,
  'e-tiket': Badge,
  'e-ticket': Badge,

  // Bank
  'bank': Landmark,
  'line bank': Landmark,
  'bca': Landmark,

  // Transfer
  'transfer': ArrowLeftRight,
  'transfer bank': ArrowLeftRight,
  'kirim': Send,

  // Refund
  'refund': RotateCcw,
  'pengembalian dana': Undo2,

  // Cashback
  'cashback': BadgePercent,
  'cash back': Gift,

  // Lainnya (expense)
  'lainnya': MoreHorizontal,
  'other': MoreHorizontal,
  'lainnya-expense': CircleEllipsis,

  // === INCOME ===

  // Gaji
  'gaji': Briefcase,
  'salary': Briefcase,
  'payroll': BriefcaseBusiness,
  'honor': Wallet,

  // Freelance
  'freelance': Laptop,
  'freelancer': Laptop,
  'coding': Code2,
  'design': PenTool,

  // Bisnis
  'bisnis': Building2,
  'business': Building2,
  'toko': Store,
  'usaha': Store,

  // Hadiah
  'hadiah': Gift,
  'gift': Gift,
  'bonus': Sparkles,
  'reward': Gift,

  // Cashback (income)
  'cashback-income': BadgePercent,
  'coins': Coins,

  // Refund (income)
  'refund-income': Undo2,

  // Investasi (income)
  'investasi-income': TrendingUp,
  'dividen': LineChart,

  // Transfer Masuk
  'transfer masuk': ArrowDownToLine,
  'dana masuk': Download,
  'pemasukan': CircleDollarSign,

  // Bonus
  'bonus-income': Sparkles,
  'reward-income': BadgeCheck,

  // Lainnya (income)
  'lainnya-income': MoreHorizontal,
  'other-income': CircleEllipsis,
};

// ===================== Color Mapping =====================

const COLOR_MAP: Record<string, string> = {
  'makanan & minuman': COLORS.orange,
  'makanan': COLORS.orange,
  'transportasi': COLORS.blue,
  'belanja': COLORS.purple,
  'tagihan': COLORS.red,
  'hiburan': COLORS.pink,
  'pendidikan': COLORS.indigo,
  'kesehatan': COLORS.emerald,
  'langganan': COLORS.cyan,
  'keluarga': COLORS.rose,
  'investasi': COLORS.green,
  'travel': COLORS.sky,
  'hotel': COLORS.violet,
  'tiket': COLORS.yellow,
  'bank': COLORS.slate,
  'line bank': COLORS.blue,
  'transfer': COLORS.teal,
  'refund': COLORS.lime,
  'pengembalian dana': COLORS.lime,
  'cashback': COLORS.mint,
  'lainnya': COLORS.gray,
  'lainnya-expense': COLORS.gray,
  'gaji': COLORS.green,
  'freelance': COLORS.blue,
  'bisnis': COLORS.purple,
  'hadiah': COLORS.pink,
  'bonus': COLORS.yellow,
  'cashback-income': COLORS.mint,
  'refund-income': COLORS.lime,
  'investasi-income': COLORS.emerald,
  'transfer masuk': COLORS.teal,
  'lainnya-income': COLORS.gray,
};

// ===================== Tailwind Class Helpers =====================

/**
 * Get Tailwind CSS classes for icon container background + text color
 * Based on the category's color
 */
function getColorClasses(color: string): { bgLight: string; bgDark: string; textLight: string; textDark: string } {
  const colorMap: Record<string, { bgLight: string; bgDark: string; textLight: string; textDark: string }> = {
    [COLORS.orange]:   { bgLight: 'bg-amber-50',   bgDark: 'dark:bg-amber-500/12',   textLight: 'text-amber-600',   textDark: 'dark:text-amber-300' },
    [COLORS.amber]:    { bgLight: 'bg-amber-50',   bgDark: 'dark:bg-amber-500/12',   textLight: 'text-amber-600',   textDark: 'dark:text-amber-300' },
    [COLORS.blue]:     { bgLight: 'bg-blue-50',    bgDark: 'dark:bg-blue-500/12',    textLight: 'text-blue-600',    textDark: 'dark:text-blue-300' },
    [COLORS.purple]:   { bgLight: 'bg-purple-50',  bgDark: 'dark:bg-purple-500/12',  textLight: 'text-purple-600',  textDark: 'dark:text-purple-300' },
    [COLORS.red]:      { bgLight: 'bg-red-50',     bgDark: 'dark:bg-red-500/12',     textLight: 'text-red-600',    textDark: 'dark:text-red-300' },
    [COLORS.pink]:     { bgLight: 'bg-pink-50',    bgDark: 'dark:bg-pink-500/12',    textLight: 'text-pink-600',   textDark: 'dark:text-pink-300' },
    [COLORS.indigo]:   { bgLight: 'bg-indigo-50',  bgDark: 'dark:bg-indigo-500/12',  textLight: 'text-indigo-600',  textDark: 'dark:text-indigo-300' },
    [COLORS.emerald]:  { bgLight: 'bg-emerald-50', bgDark: 'dark:bg-emerald-500/12', textLight: 'text-emerald-600', textDark: 'dark:text-emerald-300' },
    [COLORS.cyan]:     { bgLight: 'bg-cyan-50',    bgDark: 'dark:bg-cyan-500/12',    textLight: 'text-cyan-600',   textDark: 'dark:text-cyan-300' },
    [COLORS.rose]:     { bgLight: 'bg-rose-50',    bgDark: 'dark:bg-rose-500/12',    textLight: 'text-rose-600',   textDark: 'dark:text-rose-300' },
    [COLORS.green]:    { bgLight: 'bg-green-50',   bgDark: 'dark:bg-green-500/12',   textLight: 'text-green-600',  textDark: 'dark:text-green-300' },
    [COLORS.sky]:      { bgLight: 'bg-sky-50',     bgDark: 'dark:bg-sky-500/12',     textLight: 'text-sky-600',    textDark: 'dark:text-sky-300' },
    [COLORS.violet]:   { bgLight: 'bg-violet-50',  bgDark: 'dark:bg-violet-500/12',  textLight: 'text-violet-600', textDark: 'dark:text-violet-300' },
    [COLORS.yellow]:   { bgLight: 'bg-yellow-50',  bgDark: 'dark:bg-yellow-500/12',  textLight: 'text-yellow-600', textDark: 'dark:text-yellow-300' },
    [COLORS.slate]:    { bgLight: 'bg-slate-50',   bgDark: 'dark:bg-slate-500/12',   textLight: 'text-slate-600',  textDark: 'dark:text-slate-300' },
    [COLORS.teal]:     { bgLight: 'bg-teal-50',    bgDark: 'dark:bg-teal-500/12',    textLight: 'text-teal-600',   textDark: 'dark:text-teal-300' },
    [COLORS.lime]:     { bgLight: 'bg-lime-50',    bgDark: 'dark:bg-lime-500/12',    textLight: 'text-lime-600',   textDark: 'dark:text-lime-300' },
    [COLORS.mint]:     { bgLight: 'bg-emerald-50', bgDark: 'dark:bg-emerald-500/12', textLight: 'text-emerald-600', textDark: 'dark:text-emerald-300' },
  };

  return colorMap[color] || { bgLight: 'bg-gray-50', bgDark: 'dark:bg-gray-500/12', textLight: 'text-gray-600', textDark: 'dark:text-gray-300' };
}

// ===================== Public API =====================

/**
 * Get icon component for a category name
 * Case-insensitive, supports aliases
 */
export function getCategoryIcon(name: string | null | undefined): LucideIcon {
  if (!name) return CircleEllipsis;
  const key = name.toLowerCase().trim();

  // Exact match
  if (ICON_MAP[key]) return ICON_MAP[key];

  // Partial match: check if any key is contained in the name
  const match = Object.entries(ICON_MAP).find(([k]) => key.includes(k));
  return match ? match[1] : CircleEllipsis;
}

/**
 * Get color hex for a category name
 */
export function getCategoryColor(name: string | null | undefined, type?: CategoryType): string {
  if (!name) return COLORS.gray;
  const key = name.toLowerCase().trim();

  if (COLOR_MAP[key]) return COLOR_MAP[key];

  // Partial match
  const match = Object.entries(COLOR_MAP).find(([k]) => key.includes(k));
  if (match) return match[1];

  // Fallback by type
  return type === 'income' ? COLORS.green : COLORS.gray;
}

/**
 * Get complete category metadata (icon, color, CSS classes)
 */
export function getCategoryMeta(name: string | null | undefined, type?: CategoryType): CategoryMeta {
  const icon = getCategoryIcon(name);
  const color = getCategoryColor(name, type);
  const css = getColorClasses(color);

  return {
    icon,
    color,
    bgLight: css.bgLight,
    bgDark: css.bgDark,
    textLight: css.textLight,
    textDark: css.textDark,
  };
}

/**
 * Get income/expense icon for a transaction type
 */
export function getTypeIcon(type: string): LucideIcon {
  switch (type) {
    case 'income': return TrendingUp;
    case 'expense': return TrendingDown;
    case 'transfer': return ArrowLeftRight;
    case 'refund': return Undo2;
    default: return TrendingUp;
  }
}

// Re-import TrendingDown locally to avoid circular issues
import { TrendingDown } from 'lucide-react';

export { COLORS };
