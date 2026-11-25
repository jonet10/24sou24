import { describe, expect, it } from 'vitest';
import { decideAction, redactLogs } from '../src/routes/streams';

describe('decideAction', () => {
  it('arrête une diffusion active quand l’utilisateur demande l’arrêt', () => {
    expect(decideAction('stopped', 'live')).toBe('stop');
    expect(decideAction('stopped', 'starting')).toBe('stop');
    expect(decideAction('stopped', 'idle')).toBeNull();
  });

  it('démarre seulement quand le moteur n’est pas en direct ni en cours de démarrage', () => {
    expect(decideAction('starting', 'idle')).toBe('start');
    expect(decideAction('starting', 'starting')).toBeNull();
    expect(decideAction('live', 'starting')).toBeNull();
    expect(decideAction('live', 'live')).toBeNull();
    expect(decideAction('live', 'error')).toBe('start');
  });

  it('gère pause et redémarrage', () => {
    expect(decideAction('paused', 'live')).toBe('pause');
    expect(decideAction('paused', 'stopped')).toBeNull();
    expect(decideAction('restarting', 'live')).toBe('restart');
    expect(decideAction('restarting', 'idle')).toBe('restart');
  });
});

describe('redactLogs', () => {
  it('masque les URL RTMP et les jetons longs', () => {
    const redacted = redactLogs(
      'ffmpeg rtmp://a.rtmp.youtube.com/live2/abcdefghijklmnopqrstu a échoué',
    );
    expect(redacted).not.toContain('abcdefghijklmnopqrstu');
    expect(redacted).toContain('[URL RTMP masquée]');
  });
});
