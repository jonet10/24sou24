const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bytesToHex(new Uint8Array(digest));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Chiffre un secret avec AES-GCM ; l'IV est aléatoire et stocké avec le ciphertext. */
export async function encryptSecret(
  secretKey: string,
  plaintext: string,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secretKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoder.encode(plaintext));
  return { ciphertext: new Uint8Array(encrypted), iv };
}

export async function decryptSecret(secretKey: string, ciphertext: Uint8Array, iv: Uint8Array): Promise<string> {
  const key = await aesKey(secretKey);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new TextDecoder().decode(decrypted);
}

/** Représentation bytea acceptée par PostgreSQL via PostgREST (`\x...`). */
export function toByteaHex(bytes: Uint8Array): string {
  return `\\x${bytesToHex(bytes)}`;
}

export function fromByteaHex(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string') throw new Error('Valeur bytea invalide.');
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Valeur bytea invalide.');
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

export async function hmacSha256Hex(key: Uint8Array, data: string): Promise<string> {
  return bytesToHex(await hmacSha256(key, data));
}

/** Comparaison en temps constant de deux empreintes hexadécimales. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
