import { z } from 'zod';
import type { Env } from '../types';
import { authenticate } from '../lib/auth';
import { inspectConfig } from '../lib/config';
import { decryptSecret, encryptSecret, fromByteaHex, toByteaHex } from '../lib/crypto';
import { clearOAuthCookie, createOAuthState, parseCookies, verifyOAuthState } from '../lib/oauth-state';
import { configError, apiError, json } from '../lib/responses';
import { adminSupabaseClient, userSupabaseClient } from '../lib/supabase';

const YOUTUBE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube',
];

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface YouTubeChannelResponse {
  id?: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: { default?: { url?: string } };
  };
}

export function buildAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function secureCookies(env: Env): boolean {
  return (env.ENVIRONMENT ?? 'development') !== 'development';
}

function frontendRedirect(env: Env, params: Record<string, string>): Response {
  const base = (env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const query = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${base}/channels?${query}`,
      'Cache-Control': 'no-store',
      'Set-Cookie': clearOAuthCookie(secureCookies(env)),
    },
  });
}

/** Prépare l'autorisation Google. Le cookie d'état est HttpOnly et signé. */
export async function handleOAuthStart(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { userId } = auth.context;

  const report = inspectConfig(env);
  if (!report.config.youtubeOAuth || !report.config.encryption) return configError(report.missing, cors);

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/youtube/oauth/callback`;
  const state = await createOAuthState(env.SECRETS_ENCRYPTION_KEY!, userId, Date.now(), secureCookies(env));
  const authorizationUrl = buildAuthorizationUrl(env.GOOGLE_CLIENT_ID!, redirectUri, state.value);

  return json({ authorizationUrl }, 200, { ...cors, 'Set-Cookie': state.cookie });
}

/** Échange le code Google, chiffre les jetons et enregistre la chaîne. */
export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const report = inspectConfig(env);
  if (!report.config.youtubeOAuth || !report.config.encryption) {
    return frontendRedirect(env, { oauth: 'error', reason: 'configuration' });
  }

  const url = new URL(request.url);
  const googleError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const cookies = parseCookies(request.headers.get('Cookie'));
  const state = await verifyOAuthState(env.SECRETS_ENCRYPTION_KEY!, cookies.stream24_oauth_state);

  if (googleError || !code || !state) {
    return frontendRedirect(env, { oauth: 'error', reason: 'state_invalid' });
  }

  const redirectUri = `${url.origin}/api/youtube/oauth/callback`;

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenResponse.ok) return frontendRedirect(env, { oauth: 'error', reason: 'token_exchange' });

    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokens.access_token || !tokens.refresh_token) {
      return frontendRedirect(env, { oauth: 'error', reason: 'missing_refresh_token' });
    }

    const channelResponse = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!channelResponse.ok) return frontendRedirect(env, { oauth: 'error', reason: 'channel_lookup' });

    const channelPayload = (await channelResponse.json()) as { items?: YouTubeChannelResponse[] };
    const channel = channelPayload.items?.[0];
    if (!channel?.id || !channel.snippet?.title) {
      return frontendRedirect(env, { oauth: 'error', reason: 'no_channel' });
    }

    const encrypted = await encryptSecret(
      env.SECRETS_ENCRYPTION_KEY!,
      JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type ?? 'Bearer',
        expiry_date: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      }),
    );

    const admin = adminSupabaseClient(env);
    const { data: savedChannel, error: channelError } = await admin
      .from('youtube_channels')
      .upsert(
        {
          user_id: state.userId,
          google_channel_id: channel.id,
          title: channel.snippet.title,
          handle: channel.snippet.customUrl ?? null,
          avatar_url: channel.snippet.thumbnails?.default?.url ?? null,
          status: 'connected',
          scopes: (tokens.scope ?? YOUTUBE_SCOPES.join(' ')).split(' '),
          connected_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,google_channel_id' },
      )
      .select('id')
      .single();

    if (channelError || !savedChannel) {
      return frontendRedirect(env, { oauth: 'error', reason: 'save_channel' });
    }

    const { error: tokenError } = await admin.from('youtube_channel_tokens').upsert(
      {
        channel_id: savedChannel.id,
        ciphertext: toByteaHex(encrypted.ciphertext),
        iv: toByteaHex(encrypted.iv),
        scope: tokens.scope ?? YOUTUBE_SCOPES.join(' '),
        expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      },
      { onConflict: 'channel_id' },
    );
    if (tokenError) return frontendRedirect(env, { oauth: 'error', reason: 'save_tokens' });

    return frontendRedirect(env, { oauth: 'success', channel: channel.id });
  } catch (caught) {
    console.error('Erreur callback OAuth Google', caught);
    return frontendRedirect(env, { oauth: 'error', reason: 'unexpected' });
  }
}

/** Révoque le refresh token auprès de Google puis supprime les données secrètes locales. */
export async function handleRevokeChannel(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticate(request, env, cors);
  if (!auth.ok) return auth.response;
  const { token, userId } = auth.context;

  const report = inspectConfig(env);
  if (!report.config.youtubeOAuth || !report.config.encryption) return configError(report.missing, cors);

  const channelId = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.uuid().safeParse(channelId).success) {
    return apiError(400, 'VALIDATION_ERROR', 'Identifiant de chaîne invalide.', undefined, cors);
  }

  const userClient = userSupabaseClient(env, token);
  const { data: channel, error: channelError } = await userClient
    .from('youtube_channels')
    .select('id,status')
    .eq('id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (channelError || !channel) return apiError(404, 'CHANNEL_NOT_FOUND', 'Chaîne introuvable.', undefined, cors);

  const admin = adminSupabaseClient(env);
  const { data: secretRow, error: secretError } = await admin
    .from('youtube_channel_tokens')
    .select('ciphertext,iv')
    .eq('channel_id', channelId)
    .maybeSingle();
  if (secretError) return apiError(500, 'DATABASE_ERROR', 'Impossible de lire le jeton chiffré.', undefined, cors);

  if (secretRow) {
    let refreshToken = '';
    try {
      const plaintext = await decryptSecret(
        env.SECRETS_ENCRYPTION_KEY!,
        fromByteaHex(secretRow.ciphertext),
        fromByteaHex(secretRow.iv),
      );
      refreshToken = (JSON.parse(plaintext) as { refresh_token?: string }).refresh_token ?? '';
    } catch {
      return apiError(500, 'DECRYPTION_ERROR', 'Jeton chiffré illisible.', undefined, cors);
    }

    if (refreshToken) {
      const revokeResponse = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      // Google répond 400 lorsque le jeton est déjà révoqué : on considère cela comme une révocation effective.
      if (!revokeResponse.ok && revokeResponse.status !== 400) {
        return apiError(502, 'REVOKE_FAILED', 'Google n’a pas pu révoquer le jeton.', undefined, cors);
      }
    }
  }

  await admin.from('youtube_channel_tokens').delete().eq('channel_id', channelId);
  await admin.from('youtube_channels').update({ status: 'revoked' }).eq('id', channelId);

  return json({ revoked: true, id: channelId }, 200, cors);
}
