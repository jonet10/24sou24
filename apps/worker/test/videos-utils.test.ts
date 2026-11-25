import { describe, expect, it } from 'vitest';
import { parseByteRange, sanitizeFileName } from '../src/routes/videos';

describe('sanitizeFileName', () => {
  it('supprime les chemins et les caractères dangereux', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\dossier\\film é-été.mp4')).toBe('film_e-ete.mp4');
    expect(sanitizeFileName('...')).toBe('video');
  });
});

describe('parseByteRange', () => {
  it('gère les plages bornées, ouvertes et suffixées', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ offset: 0, length: 100 });
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ offset: 500, length: 500 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ offset: 900, length: 100 });
  });

  it('rejette les plages invalides', () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange('bytes=100-50', 1000)).toBeNull();
    expect(parseByteRange('bytes=1000-', 1000)).toBeNull();
  });
});
