import type { Express, Response } from 'express';
import type {
  AuthConfigResponse,
  AuthSessionCreateRequest,
  AuthSessionResponse,
} from '@open-design/contracts';

import type { ClerkAuthConfig } from './config.js';
import { verifyClerkSessionToken } from './clerk.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies.js';
import { isClerkOrgMember } from './membership.js';

type SendApiError = (
  res: Response,
  status: number,
  code: string,
  message: string,
  extras?: Record<string, unknown>,
) => void;

export function publicAuthConfig(config: ClerkAuthConfig): AuthConfigResponse {
  if (!config.enabled) return { enabled: false, provider: null };
  return {
    enabled: true,
    provider: 'clerk',
    publishableKey: config.publishableKey,
    appOrigin: config.appOrigin,
    clerkDomain: config.clerkDomain,
    signInUrl: config.signInUrl,
    signUpUrl: config.signUpUrl,
    orgId: config.orgId,
  };
}

export function registerAuthRoutes(
  app: Express,
  options: { config: ClerkAuthConfig; sendApiError: SendApiError },
): void {
  const { config, sendApiError } = options;

  app.get('/api/auth/config', (_req, res) => {
    res.json(publicAuthConfig(config));
  });

  app.get('/api/auth/session', (req, res) => {
    if (!config.enabled) {
      const body: AuthSessionResponse = { authenticated: false };
      return res.json(body);
    }
    const session = readSessionCookie(req, config.cookieSecret);
    const body: AuthSessionResponse = session
      ? {
          authenticated: true,
          userId: session.userId,
          orgId: session.orgId,
          ...(session.email ? { email: session.email } : {}),
          expiresAt: session.expiresAt,
        }
      : { authenticated: false };
    return res.json(body);
  });

  app.post('/api/auth/session', async (req, res) => {
    if (!config.enabled) {
      const body: AuthSessionResponse = { authenticated: false };
      return res.json(body);
    }
    const body = req.body as Partial<AuthSessionCreateRequest> | undefined;
    const clerkToken = typeof body?.clerkToken === 'string' ? body.clerkToken : '';
    if (!clerkToken) {
      return sendApiError(res, 401, 'CLERK_TOKEN_REQUIRED', 'Clerk session token required');
    }

    let verified: Awaited<ReturnType<typeof verifyClerkSessionToken>>;
    try {
      verified = await verifyClerkSessionToken(config, clerkToken);
    } catch {
      return sendApiError(res, 401, 'CLERK_TOKEN_INVALID', 'Clerk session token is invalid');
    }

    if (!(await isClerkOrgMember(config, verified.userId))) {
      return sendApiError(res, 403, 'ORG_MEMBERSHIP_REQUIRED', 'User is not a member of the configured Clerk organization');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = Math.min(
      nowSeconds + config.sessionTtlSeconds,
      verified.expiresAt ?? Number.POSITIVE_INFINITY,
    );
    const session = {
      userId: verified.userId,
      orgId: config.orgId,
      ...(verified.email ? { email: verified.email } : {}),
      expiresAt,
    };
    setSessionCookie(res, session, config.cookieSecret, Math.max(1, expiresAt - nowSeconds));
    const response: AuthSessionResponse = { authenticated: true, ...session };
    return res.json(response);
  });

  app.post('/api/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    const body: AuthSessionResponse = { authenticated: false };
    res.json(body);
  });
}
