import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Perf (Sprint 1.8): polyfill modulepreload Vite meng-import statis `__vite__mapDeps`
    // dari chunk vendor (mis. vendor-charts) → recharts+d3 (385 kB) dievaluasi di
    // initial load walau halamannya lazy. Browser modern (2026) sudah mendukung
    // <link rel=modulepreload> native — polyfill tidak diperlukan. Verifikasi build:
    // entry chunk tidak lagi memuat static import dari vendor-charts/vendor-motion.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
            return 'vendor-react';
          }
          // Debt cleanup (2026-08): dependency & arsip firebase/supabase dihapus total.
          // Verifikasi build: tidak ada chunk vendor-firebase/supabase di dist.
          // NOTE (Sprint 1.8): rule recharts/d3 DIHAPUS — recharts hanya dipakai
          // Dashboard/Reports/Monitoring (semua lazy). Kalau dikelompokkan ke
          // vendor-charts, Vite menaruh __vite__mapDeps di sana dan entry chunk
          // static-import recharts+d3 (385 kB) di initial load. Tanpa rule ini
          // recharts jadi shared chunk otomatis yang hanya di-fetch saat halaman
          // chart pertama dibuka. Verifikasi: entry tidak static-import charts.
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return undefined;
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    // Proxy /api/* ke Express server (port 5181)
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5181',
        changeOrigin: true,
      },
    },
  },
})
