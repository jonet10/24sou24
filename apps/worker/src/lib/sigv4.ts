import { hmacSha256, hmacSha256Hex, sha256Hex } from './crypto';

const SERVICE = 's3';
const REGION = 'auto';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const DEFAULT_EXPIRY_SECONDS = 900;

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
  expiresIn: number;
}

export interface PresignedGet {
  url: string;
  expiresAt: string;
  expiresIn: number;
}

export interface PresignR2PutParams {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  key: string;
  mimeType: string;
  expiresIn?: number;
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
}

/** Génère une URL PUT signée AWS SigV4 pour un bucket R2. Aucun secret n'est renvoyé au client. */
export async function presignR2Put(params: PresignR2PutParams, now: number = Date.now()): Promise<PresignedPut> {
  const expiresIn = params.expiresIn ?? DEFAULT_EXPIRY_SECONDS;
  const date = new Date(now);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = `${params.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${rfc3986(params.bucket)}/${params.key.split('/').map(rfc3986).join('/')}`;
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const credential = `${params.accessKeyId}/${scope}`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'content-type;host',
  };
  const canonicalQueryString = canonicalQuery(queryParams);
  const canonicalHeaders = `content-type:${params.mimeType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  let signingKey = new TextEncoder().encode(`AWS4${params.secretAccessKey}`);
  for (const part of [dateStamp, REGION, SERVICE, 'aws4_request']) {
    signingKey = await hmacSha256(signingKey, part);
  }
  const signature = await hmacSha256Hex(signingKey, stringToSign);

  return {
    url: `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`,
    headers: { 'Content-Type': params.mimeType },
    expiresAt: new Date(now + expiresIn * 1000).toISOString(),
    expiresIn,
  };
}

/** URL GET signée pour que l'agent FFmpeg lise la vidéo directement depuis R2. */
export async function presignR2Get(
  params: Omit<PresignR2PutParams, 'mimeType' | 'expiresIn'> & { expiresIn?: number },
  now: number = Date.now(),
): Promise<PresignedGet> {
  const expiresIn = params.expiresIn ?? 86_400;
  const date = new Date(now);
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = `${params.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${rfc3986(params.bucket)}/${params.key.split('/').map(rfc3986).join('/')}`;
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${params.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQueryString = canonicalQuery(queryParams);
  const canonicalRequest = ['GET', canonicalUri, canonicalQueryString, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join(
    '\n',
  );
  const stringToSign = [ALGORITHM, amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  let signingKey = new TextEncoder().encode(`AWS4${params.secretAccessKey}`);
  for (const part of [dateStamp, REGION, SERVICE, 'aws4_request']) {
    signingKey = await hmacSha256(signingKey, part);
  }
  const signature = await hmacSha256Hex(signingKey, stringToSign);

  return {
    url: `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now + expiresIn * 1000).toISOString(),
    expiresIn,
  };
}
