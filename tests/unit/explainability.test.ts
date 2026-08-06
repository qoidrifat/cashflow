import { describe, expect, it } from 'vitest';
import {
  interpretConfidence,
  fallbackReason,
  formatProcessingTime,
  formatTimestamp,
  CONFIDENCE_BADGE_STYLES,
} from '../../src/lib/explainability';

describe('explainability — interpretConfidence', () => {
  it('memetakan confidence ke label & bucket sesuai threshold', () => {
    expect(interpretConfidence(0.98)).toMatchObject({ label: 'Sangat yakin', bucket: 'very_high', percent: 98 });
    expect(interpretConfidence(0.9)).toMatchObject({ label: 'Sangat yakin', bucket: 'very_high' });
    expect(interpretConfidence(0.72)).toMatchObject({ label: 'Yakin', bucket: 'high', percent: 72 });
    expect(interpretConfidence(0.7)).toMatchObject({ label: 'Yakin', bucket: 'high' });
    expect(interpretConfidence(0.54)).toMatchObject({ label: 'Cukup yakin', bucket: 'medium' });
    expect(interpretConfidence(0.5)).toMatchObject({ label: 'Cukup yakin', bucket: 'medium' });
    expect(interpretConfidence(0.3)).toMatchObject({ label: 'Perlu verifikasi', bucket: 'low' });
  });

  it('menangani nilai null/undefined/NaN dengan aman', () => {
    expect(interpretConfidence(null)).toBeNull();
    expect(interpretConfidence(undefined)).toBeNull();
    expect(interpretConfidence(Number.NaN)).toBeNull();
    expect(interpretConfidence('abc' as unknown as number)).toBeNull();
  });

  it('meng-clamp nilai di luar rentang 0-1', () => {
    expect(interpretConfidence(1.5)?.percent).toBe(100);
    expect(interpretConfidence(-0.5)?.percent).toBe(0);
  });

  it('setiap bucket punya style badge', () => {
    for (const bucket of ['very_high', 'high', 'medium', 'low'] as const) {
      expect(CONFIDENCE_BADGE_STYLES[bucket]).toBeTruthy();
    }
  });
});

describe('explainability — fallbackReason', () => {
  it('tidak memberi alasan fallback bila sumber Gemini', () => {
    expect(fallbackReason('gemini')).toBeNull();
  });
  it('menjelaskan fallback rule-based', () => {
    expect(fallbackReason('rule-based')).toContain('AI tidak tersedia');
  });
  it('menjelaskan sumber lain', () => {
    expect(fallbackReason('local')).toBeTruthy();
    expect(fallbackReason('custom')).toContain('custom');
  });
});

describe('explainability — format helpers', () => {
  it('formatProcessingTime ramah user', () => {
    expect(formatProcessingTime(400)).toBe('400 ms');
    expect(formatProcessingTime(1500)).toBe('1.5 dtk');
    expect(formatProcessingTime(undefined)).toBeNull();
    expect(formatProcessingTime(Number.NaN)).toBeNull();
  });

  it('formatTimestamp memformat ISO ke lokal, null bila invalid', () => {
    expect(formatTimestamp('2026-08-07T10:30:00')).toBeTruthy();
    expect(formatTimestamp('not-a-date')).toBeNull();
    expect(formatTimestamp(undefined)).toBeNull();
  });
});
