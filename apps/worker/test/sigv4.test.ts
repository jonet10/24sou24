import { describe, expect, it } from 'vitest';
import { presignR2Get, presignR2Put } from '../src/lib/sigv4';

const now = Date.parse('2026-01-02T03:04:05Z');
const base = {
  accountId: '123456789',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  bucket: 'stream24-videos',
  key: 'users/user-1/videos/video-1/film.mp4',
  mimeType: 'video/mp4',
};

describe('presignR2Put', () => {
  it('construit une URL R2 signée sans exposer le secret', async () => {
    const result = await presignR2Put(base, now);
    const url = new URL(result.url);

    expect(url.host).toBe('123456789.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/stream24-videos/users/user-1/videos/video-1/film.mp4');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260102T030405Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIDEXAMPLE/20260102/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.href).not.toContain('secret');
    expect(result.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(result.expiresIn).toBe(900);
  });

  it('est déterministe pour une même date et change avec le secret', async () => {
    const first = await presignR2Put(base, now);
    const second = await presignR2Put(base, now);
    const differentSecret = await presignR2Put({ ...base, secretAccessKey: 'autre-secret' }, now);

    expect(first.url).toBe(second.url);
    expect(new URL(first.url).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(differentSecret.url).searchParams.get('X-Amz-Signature'),
    );
  });

  it('échappe les caractères spéciaux du nom de fichier', async () => {
    const result = await presignR2Put({ ...base, key: 'users/u/v/v/film (1)+.mp4' }, now);
    expect(result.url).toContain('film%20%281%29%2B.mp4');
  });
});

describe('presignR2Get', () => {
  it('signe une URL de lecture longue pour la boucle FFmpeg', async () => {
    const result = await presignR2Get(
      {
        accountId: base.accountId,
        accessKeyId: base.accessKeyId,
        secretAccessKey: base.secretAccessKey,
        bucket: base.bucket,
        key: base.key,
      },
      now,
    );
    const url = new URL(result.url);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('86400');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toBe(new Date(now + 86_400_000).toISOString());
  });
});
