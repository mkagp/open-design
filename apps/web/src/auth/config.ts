import type { AuthConfigResponse } from '@open-design/contracts';

export async function fetchAuthConfig(): Promise<AuthConfigResponse> {
  const response = await fetch('/api/auth/config');
  if (!response.ok) {
    throw new Error(`Auth config request failed (${response.status})`);
  }
  return (await response.json()) as AuthConfigResponse;
}
