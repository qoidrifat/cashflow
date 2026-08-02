/**
 * Navigation Configuration
 *
 * Source of truth for all navigation items across desktop sidebar,
 * mobile bottom nav, and "Lainnya" menu.
 */

import {
  LayoutDashboard,
  ArrowLeftRight,
  PiggyBank,
  BarChart3,
  Mail,
  RefreshCw,
  BriefcaseBusiness,
  Sparkles,
  Tags,
  UserCircle,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Primary mobile navigation items (bottom nav)
 * Maksimal 5 item termasuk tombol 'Lainnya' (dibuat di komponen).
 * Hanya 4 item di sini; 'Lainnya' adalah button terpisah di BottomNav.
 */
export const primaryMobileNav: NavItem[] = [
  { label: 'Beranda', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Transaksi', href: '/transactions', icon: ArrowLeftRight },
  { label: 'Budget', href: '/budgets', icon: PiggyBank },
  { label: 'Gmail', href: '/gmail-sync', icon: Mail },
];

/**
 * "Lainnya" menu items (bottom sheet from bottom nav)
 * Berisi fitur yang tidak muat di bottom nav utama.
 * Termasuk Laporan sebagai item pertama agar tetap mudah diakses.
 */
export const moreMenuNav: NavItem[] = [
  { label: 'Laporan', href: '/reports', icon: BarChart3 },
  { label: 'Rutin', href: '/recurring', icon: RefreshCw },
  { label: 'Suite', href: '/professional', icon: BriefcaseBusiness },
  { label: 'AI Search', href: '/suite/ai-search', icon: Sparkles },
  { label: 'Kategori', href: '/categories', icon: Tags },
];

/**
 * Profile dropdown menu items
 * Muncul saat avatar diklik di header
 */
export const profileMenuNav: NavItem[] = [
  { label: 'Profil', href: '/profile', icon: UserCircle },
  { label: 'Pengaturan', href: '/settings', icon: Settings },
];

/**
 * Desktop sidebar items (semua fitur)
 */
export const sidebarNav: NavItem[] = [
  ...primaryMobileNav,
  ...moreMenuNav,
  { label: 'Pengaturan', href: '/settings', icon: Settings },
  { label: 'Profil', href: '/profile', icon: UserCircle },
];

/**
 * BarChart3 is still needed by the Sidebar component if it renders the Lainnya item.
 * On desktop, there's no need for the divider, but keeping it here for consistency.
 */
