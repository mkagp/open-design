import type { NextFunction, Request, Response } from 'express';

import type { ClerkAuthConfig } from './config.js';
import { readSessionCookie } from './cookies.js';

type SendApiError = (
  res: Response,
  status: number,
  code: string,
  message: string,
  extras?: Record<string, unknown>,
) => void;

const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/version',
  '/api/daemon/status',
  '/api/auth/config',
  '/api/auth/session',
  '/api/auth/logout',
]);

function bearerTokenFromRequest(req: Request): string | null {
  const auth = req.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  return match?.[1] ?? null;
}

function isProtectedRequest(req: Request): boolean {
  return req.path === '/api' || req.path.startsWith('/api/') || req.path === '/artifacts' || req.path.startsWith('/artifacts/');
}

function isPublicRequest(req: Request): boolean {
  if (PUBLIC_API_PATHS.has(req.path)) return true;
  if (req.path.startsWith('/api/tools/')) return true;
  return false;
}

export function createDeploymentAuthMiddleware(options: {
  config: ClerkAuthConfig;
  apiToken: string;
  isLoopbackPeerAddress: (address: unknown) => boolean;
  sendApiError: SendApiError;
}) {
  const { config, apiToken, isLoopbackPeerAddress, sendApiError } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    if (!isProtectedRequest(req) || isPublicRequest(req)) return next();

    if (!config.enabled) {
      if (apiToken.length === 0) return next();
      if (req.path.startsWith('/artifacts/')) return next();
      if (isLoopbackPeerAddress(req.socket?.remoteAddress)) return next();
      if (bearerTokenFromRequest(req) === apiToken) return next();
      return sendApiError(res, 401, 'API_TOKEN_REQUIRED', 'Authorization: Bearer <OD_API_TOKEN> required');
    }

    const session = readSessionCookie(req, config.cookieSecret);
    if (session) return next();
    if (apiToken.length > 0 && bearerTokenFromRequest(req) === apiToken) return next();
    return sendApiError(res, 401, 'AUTH_REQUIRED', 'Authentication required');
  };
}
