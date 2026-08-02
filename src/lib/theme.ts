import type { ThemeMode } from '../types';
import { STORAGE_KEYS } from '../config/constants';

const DARK_THEME_COLOR = '#081526';
const LIGHT_THEME_COLOR = '#f7f8fb';

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';

  const value = window.localStorage.getItem(STORAGE_KEYS.THEME);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return;

  const resolvedTheme = resolveTheme(theme);
  const root = document.documentElement;
  const metaThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  root.classList.toggle('dark', resolvedTheme === 'dark');
  root.dataset.theme = theme;
  root.dataset.resolvedTheme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;

  if (metaThemeColor) {
    metaThemeColor.content = resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  }
}

