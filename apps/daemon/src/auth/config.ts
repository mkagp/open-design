export type ClerkAuthConfig =
  | { enabled: false }
  | {
      enabled: true;
      provider: 'clerk';
      publishableKey: string;
      secretKey: string;
      orgId: string;
      appOrigin: string;
      clerkDomain: string;
      signInUrl: string;
      signUpUrl: string;
      cookieSecret: string;
      sessionTtlSeconds: number;
      jwtKey?: string;
    };

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

function clean(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = clean(env[name]);
  if (!value) throw new Error(`OD_AUTH_ENABLED=1 requires ${name} to be set`);
  return value;
}

function parseHttpsUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use https://`);
  }
  return parsed;
}

function parseTtl(value: string | undefined): number {
  const cleaned = clean(value);
  if (!cleaned) return DEFAULT_SESSION_TTL_SECONDS;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('OD_AUTH_SESSION_TTL_SECONDS must be a positive number');
  }
  return Math.floor(parsed);
}

export function loadAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClerkAuthConfig {
  if (clean(env.OD_AUTH_ENABLED) !== '1') return { enabled: false };

  const publicBaseUrl = parseHttpsUrl(requireEnv(env, 'OD_PUBLIC_BASE_URL'), 'OD_PUBLIC_BASE_URL');
  const signInUrl = parseHttpsUrl(
    requireEnv(env, 'OD_AUTH_PRIMARY_SIGN_IN_URL'),
    'OD_AUTH_PRIMARY_SIGN_IN_URL',
  );
  const signUpUrl = parseHttpsUrl(
    requireEnv(env, 'OD_AUTH_PRIMARY_SIGN_UP_URL'),
    'OD_AUTH_PRIMARY_SIGN_UP_URL',
  );
  const cookieSecret = requireEnv(env, 'OD_AUTH_COOKIE_SECRET');
  if (cookieSecret.length < 32) {
    throw new Error('OD_AUTH_COOKIE_SECRET must be at least 32 characters');
  }

  return {
    enabled: true,
    provider: 'clerk',
    publishableKey: requireEnv(env, 'CLERK_PUBLISHABLE_KEY'),
    secretKey: requireEnv(env, 'CLERK_SECRET_KEY'),
    orgId: requireEnv(env, 'OD_AUTH_CLERK_ORG_ID'),
    appOrigin: publicBaseUrl.origin,
    clerkDomain: publicBaseUrl.host,
    signInUrl: signInUrl.toString(),
    signUpUrl: signUpUrl.toString(),
    cookieSecret,
    sessionTtlSeconds: parseTtl(env.OD_AUTH_SESSION_TTL_SECONDS),
    ...(clean(env.CLERK_JWT_KEY) ? { jwtKey: clean(env.CLERK_JWT_KEY) } : {}),
  };
}
