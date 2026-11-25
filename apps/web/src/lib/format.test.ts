import { describe, expect, it } from 'vitest';
import { formatBytes, formatDateTime, formatDuration, formatRelative } from './format';

describe('formatBytes', () => {
  it('gère zéro et les valeurs invalides', () => {
    expect(formatBytes(0)).toBe('0 octet');
    expect(formatBytes(Number.NaN)).toBe('0 octet');
  });

  it('formate en français avec l’unité adaptée', () => {
    expect(formatBytes(1024)).toBe('1 Kio');
    expect(formatBytes(1536)).toBe('1,5 Kio');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 Gio');
  });
});

describe('formatDuration', () => {
  it('formate les minutes et secondes', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(65)).toBe('1 min 05 s');
    expect(formatDuration(3661)).toBe('1 h 01 min');
  });
});

describe('formatDateTime', () => {
  it('renvoie un tiret pour une date absente ou invalide', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('pas-une-date')).toBe('—');
  });

  it('formate une date ISO', () => {
    expect(formatDateTime('2026-01-02T03:04:00Z')).toContain('2026');
  });
});

describe('formatRelative', () => {
  it('utilise un repère temporel injecté', () => {
    const now = Date.parse('2026-01-02T12:00:00Z');
    expect(formatRelative('2026-01-02T11:59:30Z', now)).toContain('30 secondes');
  });
});
