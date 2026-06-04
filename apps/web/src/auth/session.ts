import type { AuthSessionCreateRequest, AuthSessionResponse } from '@open-design/contracts';

export class AuthSessionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthSessionError';
    this.status = status;
  }
}

export async function createDaemonAuthSession(clerkToken: string): Promise<AuthSessionResponse> {
  const body: AuthSessionCreateRequest = { clerkToken };
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new AuthSessionError(response.status, `Auth session request failed (${response.status})`);
  }
  return (await response.json()) as AuthSessionResponse;
}
