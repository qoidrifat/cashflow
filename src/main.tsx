
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import './styles/globals.css';
import App from './app/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* P2.2 — reduced motion global: user dengan prefers-reduced-motion: reduce
        mendapat transform/layout animation nonaktif (framer-motion built-in).
        Opacity fade tetap berjalan (ringan, non-motion) — konsisten dengan
        blok CSS @media (prefers-reduced-motion: reduce) di globals.css. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
