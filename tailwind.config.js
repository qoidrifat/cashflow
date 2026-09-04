/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'rgb(var(--color-bg) / <alpha-value>)',
          surface: 'rgb(var(--color-surface) / <alpha-value>)',
          elevated: 'rgb(var(--color-elevated) / <alpha-value>)',
          card: 'rgb(var(--color-card) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          // Guard (check-tailwind-tokens.mjs) menemukan 5 token ini dipakai
          // 1136× di src tapi TIDAK terdaftar → class senyap tidak di-generate
          // (silent-drop sama dengan bug app-card 2026-09-04). CSS var sudah
          // ada di globals.css — cukup daftarkan di sini.
          text: 'rgb(var(--color-text) / <alpha-value>)',
          muted: 'rgb(var(--color-muted) / <alpha-value>)',
          subtle: 'rgb(var(--color-subtle) / <alpha-value>)',
          hover: 'rgb(var(--color-hover) / <alpha-value>)',
          overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
        },
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        navy: {
          50: '#f0f4f8',
          100: '#d9e2ec',
          200: '#bcccdc',
          300: '#9fb3c8',
          400: '#829ab1',
          500: '#627d98',
          600: '#486581',
          700: '#334e68',
          800: '#243b53',
          900: '#102a43',
          950: '#0a1a2e',
        },
        mint: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        soft: {
          purple: '#8b5cf6',
          pink: '#ec4899',
          amber: '#f59e0b',
          red: '#ef4444',
          blue: '#3b82f6',
        },
      },
      // P2.1 (contrast pass): nilai opacity di luar skala default Tailwind
      // (0,5,10,20,25,…) TIDAK pernah di-generate JIT → class seperti
      // `dark:bg-primary-500/12` senyap hilang → di dark mode pill/badge
      // memakai bg LIGHT (mis. primary-50 #eef2ff) → kontras 1.78:1 (gagal)
      // + visual salah (pill terang di kartu gelap). /12 (94×), /15 (15×),
      // /8 (10×), /24, /28 dipakai di src — daftarkan ke skala (design-system
      // fix, satu tempat untuk ~120 pemakaian).
      opacity: {
        8: '0.08',
        12: '0.12',
        15: '0.15',
        24: '0.24',
        28: '0.28',
        72: '0.72',
        78: '0.78',
        88: '0.88',
        98: '0.98',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        display: ['Outfit', 'Manrope', 'system-ui', 'sans-serif'],
      },
      // P2.3 — token typography SEMANTIC (docs/ui/DESIGN_TOKENS_AND_CONTRAST.md §6.3):
      // - text-meta  = meta non-esensial 10px (kategori C) — HANYA non-interaktif
      //   (guard: scripts/typography-lint.mjs menolak text-meta pada elemen interaktif,
      //   analog text-[10px]).
      // - text-label = section label / interaktif-min 11px (kategori B).
      // Pemetaan lain: caption → text-xs (12px), body → text-sm (14px) — default
      // Tailwind; tidak dibuat duplikat. Kode baru diharapkan memakai token ini,
      // bukan arbitrary text-[10px]/text-[11px] (pemakaian existing dibiarkan —
      // sudah ter-guard floor, migrasi massal = risiko visual tanpa nilai fungsional).
      fontSize: {
        meta: '10px',
        label: '11px',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s infinite',

      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },

      },
    },
  },
  plugins: [],
}
