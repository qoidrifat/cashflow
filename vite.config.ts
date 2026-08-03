import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
            return 'vendor-react';
          }
          // Debt cleanup (2026-08): dependency & arsip firebase/supabase dihapus total.
          // Verifikasi build: tidak ada chunk vendor-firebase/supabase di dist.
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
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
