import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, fromByteaHex, toByteaHex } from '../src/lib/crypto';

describe('chiffrement des secrets', () => {
  it('chiffre puis déchiffre un jeton avec un IV aléatoire', async () => {
    const secret = 'cle-de-test';
    const plaintext = JSON.stringify({ refresh_token: 'secret-jeton' });
    const first = await encryptSecret(secret, plaintext);
    const second = await encryptSecret(secret, plaintext);

    expect(first.iv).toHaveLength(12);
    expect(first.ciphertext.byteLength).toBeGreaterThan(plaintext.length);
    expect(toByteaHex(first.iv)).not.toBe(toByteaHex(second.iv));
    expect(await decryptSecret(secret, first.ciphertext, first.iv)).toBe(plaintext);
  });

  it('échoue à déchiffrer avec une autre clé', async () => {
    const encrypted = await encryptSecret('cle-a', 'secret');
    await expect(decryptSecret('cle-b', encrypted.ciphertext, encrypted.iv)).rejects.toThrow();
  });

  it('convertit les bytea sans altérer les octets', async () => {
    const encrypted = await encryptSecret('cle', 'secret');
    const encoded = toByteaHex(encrypted.ciphertext);
    expect(encoded.startsWith('\\x')).toBe(true);
    expect(fromByteaHex(encoded)).toEqual(encrypted.ciphertext);
    expect(() => fromByteaHex('zz')).toThrow();
  });
});
