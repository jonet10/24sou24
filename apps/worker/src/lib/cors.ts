import { isConfigured } from './config';
import type { Env } from '../types';

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  const allowed = (env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => isConfigured(item));

  if (!allowed.includes(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-VPS-Signature, X-VPS-Timestamp',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
