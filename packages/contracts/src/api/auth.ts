export type AuthConfigResponse = {
  enabled: boolean;
  provider: 'clerk' | null;
  publishableKey?: string;
  appOrigin?: string;
  clerkDomain?: string;
  signInUrl?: string;
  signUpUrl?: string;
};

export type AuthSessionResponse = {
  authenticated: boolean;
  userId?: string;
  orgId?: string;
  email?: string;
  expiresAt?: number;
};

export type AuthSessionCreateRequest = {
  clerkToken: string;
};
