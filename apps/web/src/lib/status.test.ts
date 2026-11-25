import { describe, expect, it } from 'vitest';
import { toVisibleStatus } from '@stream24/shared';

const now = Date.parse('2026-01-02T12:00:00Z');
const fresh = new Date(now - 5000).toISOString();
const stale = new Date(now - 120_000).toISOString();

describe('toVisibleStatus', () => {
  it('n’affiche « en direct » qu’avec un heartbeat frais confirmant live', () => {
    expect(toVisibleStatus('live', 'live', fresh, now)).toBe('en_direct');
    expect(toVisibleStatus('live', 'live', stale, now)).toBe('en_attente');
    expect(toVisibleStatus('live', 'live', null, now)).toBe('en_attente');
  });

  it('signale les erreurs du moteur', () => {
    expect(toVisibleStatus('live', 'error', fresh, now)).toBe('erreur');
  });

  it('distingue arrêt, pause et démarrage', () => {
    expect(toVisibleStatus('stopped', 'stopped', fresh, now)).toBe('arrete');
    expect(toVisibleStatus('paused', 'paused', fresh, now)).toBe('en_pause');
    expect(toVisibleStatus('starting', 'starting', fresh, now)).toBe('demarrage');
    expect(toVisibleStatus('restarting', 'idle', stale, now)).toBe('demarrage');
  });
});
