export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers: HeadersInit = {},
): Response {
  return json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status, headers);
}

export function configError(missing: string[], headers: HeadersInit = {}): Response {
  return apiError(
    503,
    'CONFIG_MISSING',
    `STREAM24 n’est pas configuré : ${missing.join(' ; ')}. Aucune diffusion ne peut être lancée.`,
    { missing },
    headers,
  );
}
