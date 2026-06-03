import { verifyToken } from '@clerk/backend';

import type { ClerkAuthConfig } from './config.js';

export type VerifiedClerkSession = {
  userId: string;
  email?: string;
  expiresAt?: number;
};

export async function verifyClerkSessionToken(
  config: Extract<ClerkAuthConfig, { enabled: true }>,
  token: string,
): Promise<VerifiedClerkSession> {
  const payload = await verifyToken(token, {
    secretKey: config.secretKey,
    authorizedParties: [config.appOrigin],
    ...(config.jwtKey ? { jwtKey: config.jwtKey } : {}),
  });
  const claims = payload as Record<string, unknown>;
  const userId = claims.sub;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('Clerk token did not include a user id');
  }
  const email = [claims.email, claims.primary_email, claims.email_address].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return {
    userId,
    ...(email ? { email } : {}),
    ...(typeof claims.exp === 'number' ? { expiresAt: claims.exp } : {}),
  };
}
