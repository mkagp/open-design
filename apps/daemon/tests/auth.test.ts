import type http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clerkMocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
}));

vi.mock('@clerk/backend', () => ({
  verifyToken: clerkMocks.verifyToken,
  createClerkClient: vi.fn(() => ({
    organizations: {
      getOrganizationMembershipList: clerkMocks.getOrganizationMembershipList,
    },
  })),
}));

import { signSessionCookie } from '../src/auth/cookies.js';
import { loadAuthConfigFromEnv } from '../src/auth/config.js';
import { startServer } from '../src/server.js';

const ENV_KEYS = [
  'OD_AUTH_ENABLED',
  'OD_PUBLIC_BASE_URL',
  'OD_ALLOWED_ORIGINS',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'OD_AUTH_CLERK_ORG_ID',
  'OD_AUTH_CLERK_DOMAIN',
  'OD_AUTH_PRIMARY_SIGN_IN_URL',
  'OD_AUTH_PRIMARY_SIGN_UP_URL',
  'OD_AUTH_COOKIE_SECRET',
  'OD_AUTH_SESSION_TTL_SECONDS',
  'CLERK_JWT_KEY',
  'OD_API_TOKEN',
] as const;

const previousEnv = new Map<string, string | undefined>();

let server: http.Server | undefined;
let shutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';

function setAuthEnv() {
  process.env.OD_AUTH_ENABLED = '1';
  process.env.OD_PUBLIC_BASE_URL = 'https://design.mkagp.com';
  process.env.OD_ALLOWED_ORIGINS = 'https://design.mkagp.com';
  process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_public';
  process.env.CLERK_SECRET_KEY = 'sk_test_secret';
  process.env.OD_AUTH_CLERK_ORG_ID = 'org_test';
  process.env.OD_AUTH_CLERK_DOMAIN = 'mkagp.com';
  process.env.OD_AUTH_PRIMARY_SIGN_IN_URL = 'https://login.mkagrowth.com/sign-in';
  process.env.OD_AUTH_PRIMARY_SIGN_UP_URL = 'https://login.mkagrowth.com/sign-up';
  process.env.OD_AUTH_COOKIE_SECRET = '0123456789abcdef0123456789abcdef';
  process.env.OD_AUTH_SESSION_TTL_SECONDS = '28800';
  process.env.OD_API_TOKEN = 'machine-token';
}

async function startAuthServer() {
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  server = started.server;
  shutdown = started.shutdown;
}

beforeEach(() => {
  for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
  clerkMocks.verifyToken.mockReset();
  clerkMocks.getOrganizationMembershipList.mockReset();
});

afterEach(async () => {
  if (shutdown) await Promise.resolve(shutdown());
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  shutdown = undefined;
  baseUrl = '';
  for (const key of ENV_KEYS) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

describe('Clerk auth config', () => {
  it('leaves auth disabled when OD_AUTH_ENABLED is not set', () => {
    expect(loadAuthConfigFromEnv({})).toEqual({ enabled: false });
  });

  it('fails fast when auth is enabled with missing required config', () => {
    expect(() => loadAuthConfigFromEnv({ OD_AUTH_ENABLED: '1' })).toThrow(/OD_PUBLIC_BASE_URL/);
  });

  it('returns public config without leaking secrets', async () => {
    setAuthEnv();
    await startAuthServer();

    const response = await fetch(`${baseUrl}/api/auth/config`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      enabled: true,
      provider: 'clerk',
      publishableKey: 'pk_test_public',
      appOrigin: 'https://design.mkagp.com',
      clerkDomain: 'mkagp.com',
      signInUrl: 'https://login.mkagrowth.com/sign-in',
      signUpUrl: 'https://login.mkagrowth.com/sign-up',
    });
    expect(JSON.stringify(body)).not.toContain('sk_test_secret');
    expect(JSON.stringify(body)).not.toContain('0123456789abcdef');
    expect(JSON.stringify(body)).not.toContain('org_test');
  });
});

describe('Clerk auth routes and middleware', () => {
  beforeEach(async () => {
    setAuthEnv();
    await startAuthServer();
  });

  it('rejects missing or invalid Clerk tokens when creating a daemon session', async () => {
    const missing = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST' });
    expect(missing.status).toBe(401);

    clerkMocks.verifyToken.mockRejectedValueOnce(new Error('bad token'));
    const invalid = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerkToken: 'bad' }),
    });
    expect(invalid.status).toBe(401);
  });

  it('rejects a valid Clerk user outside the configured org', async () => {
    clerkMocks.verifyToken.mockResolvedValueOnce({ sub: 'user_outside', exp: 4_102_444_800 });
    clerkMocks.getOrganizationMembershipList.mockResolvedValueOnce({ data: [], totalCount: 0 });

    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerkToken: 'valid' }),
    });

    expect(response.status).toBe(403);
  });

  it('sets a secure od_session cookie for a valid org member', async () => {
    clerkMocks.verifyToken.mockResolvedValueOnce({ sub: 'user_member', email: 'member@example.com', exp: 4_102_444_800 });
    clerkMocks.getOrganizationMembershipList.mockResolvedValueOnce({ data: [{ id: 'mem_1' }], totalCount: 1 });

    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerkToken: 'valid' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('od_session=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      userId: 'user_member',
      orgId: 'org_test',
      email: 'member@example.com',
    });
  });

  it('protects projects while allowing daemon sessions and machine tokens', async () => {
    const denied = await fetch(`${baseUrl}/api/projects`);
    expect(denied.status).toBe(401);

    const cookie = signSessionCookie(
      { userId: 'user_member', orgId: 'org_test', expiresAt: Math.floor(Date.now() / 1000) + 60 },
      process.env.OD_AUTH_COOKIE_SECRET!,
    );
    const cookieAllowed = await fetch(`${baseUrl}/api/projects`, {
      headers: { Cookie: `od_session=${cookie}` },
    });
    expect(cookieAllowed.status).toBe(200);

    const bearerAllowed = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer machine-token' },
    });
    expect(bearerAllowed.status).toBe(200);
  });

  it('keeps tool endpoints delegated to tool-token validation', async () => {
    const response = await fetch(`${baseUrl}/api/tools/design-systems/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'DESIGN.md' }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'TOOL_TOKEN_MISSING' },
    });
  });

  it('keeps public probes and auth config open', async () => {
    for (const path of ['/api/health', '/api/version', '/api/daemon/status', '/api/auth/config']) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
    }
  });
});
