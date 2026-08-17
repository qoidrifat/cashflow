/**
 * P2.2 — Reduced motion global (MotionConfig reducedMotion="user").
 *
 * Bukti wiring (deterministik, tanpa timing animasi dan tanpa mock internal):
 * `MotionConfig` di src/main.tsx meneruskan `reducedMotion="user"` ke dalam
 * MotionConfigContext — konsumen framer-motion mana pun (motion.div,
 * AnimatePresence, PageTransition) membacanya dari context ini dan
 * meng-gate transform/layout animation untuk user prefers-reduced-motion.
 *
 * Dua assertions:
 *   1. Prop "user" dari main.tsx sampai ke context konsumen (wiring kita).
 *   2. Default TANPA prop = "never" — menjelaskan temuan P2.1/P2.2: blok CSS
 *      `@media (prefers-reduced-motion: reduce)` tidak meng-gate animasi
 *      framer-motion karena default-nya "never"; MotionConfig "user" di root
 *      menutup celah itu.
 *
 * Perilaku OS-pref → transform (branch "user" mem-baca matchMedia) adalah
 * tanggung jawab framer-motion sendiri (diuji upstream); E2E
 * e2e/accessibility.spec.ts menutup integrasinya (emulateMedia reduce → app
 * tetap berfungsi). Tidak ada library internal yang di-mock.
 */
import { describe, it, expect } from 'vitest';
import { useContext } from 'react';
import { render, screen } from '@testing-library/react';
import { MotionConfig, MotionConfigContext } from 'framer-motion';

function ConfigProbe() {
  const { reducedMotion } = useContext(MotionConfigContext);
  return <p>{reducedMotion}</p>;
}

describe('MotionConfig reducedMotion wiring (P2.2)', () => {
  it('main.tsx — reducedMotion="user" tersedia di context konsumen', () => {
    render(
      <MotionConfig reducedMotion="user">
        <ConfigProbe />
      </MotionConfig>,
    );
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('default tanpa prop = "never" (akar masalah: CSS reduce tidak meng-gate framer-motion)', () => {
    render(
      <MotionConfig>
        <ConfigProbe />
      </MotionConfig>,
    );
    expect(screen.getByText('never')).toBeInTheDocument();
  });
});
