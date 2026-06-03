import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const OD_SESSION_COOKIE = 'od_session';

export type OdSession = {
  userId: string;
  orgId: string;
  email?: string;
  expiresAt: number;
};

type StoredSession = OdSession & {
  v: 1;
};

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function signSessionCookie(session: OdSession, secret: string): string {
  const stored: StoredSession = { v: 1, ...session };
  const payload = base64url(JSON.stringify(stored));
  const signature = signValue(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySessionCookie(value: string | undefined, secret: string, nowMs = Date.now()): OdSession | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = signValue(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<StoredSession>;
    if (
      decoded.v !== 1 ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.orgId !== 'string' ||
      typeof decoded.expiresAt !== 'number'
    ) {
      return null;
    }
    if (decoded.expiresAt <= Math.floor(nowMs / 1000)) return null;
    return {
      userId: decoded.userId,
      orgId: decoded.orgId,
      ...(typeof decoded.email === 'string' ? { email: decoded.email } : {}),
      expiresAt: decoded.expiresAt,
    };
  } catch {
    return null;
  }
}

export function readSessionCookie(req: Request, secret: string, nowMs = Date.now()): OdSession | null {
  return verifySessionCookie(parseCookieHeader(req.get('cookie'))[OD_SESSION_COOKIE], secret, nowMs);
}

export function setSessionCookie(res: Response, session: OdSession, secret: string, maxAgeSeconds: number): void {
  res.cookie(OD_SESSION_COOKIE, signSessionCookie(session, secret), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.cookie(OD_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
