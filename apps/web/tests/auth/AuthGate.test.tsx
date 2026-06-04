// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGate } from '../../src/auth/AuthGate';

const clerkMock = vi.hoisted(() => ({
  authState: {
    isLoaded: true,
    isSignedIn: false,
    getToken: vi.fn(),
  },
  redirectToSignIn: vi.fn(),
  clerk: null as null | { redirectToSignIn: ReturnType<typeof vi.fn> },
  providerProps: [] as unknown[],
}));

vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: (props: Record<string, unknown>) => {
    clerkMock.providerProps.push(props);
    return <div data-testid="clerk-provider">{props.children as React.ReactNode}</div>;
  },
  useAuth: () => clerkMock.authState,
  useClerk: () => clerkMock.clerk,
}));

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AuthGate', () => {
  beforeEach(() => {
    clerkMock.authState.isLoaded = true;
    clerkMock.authState.isSignedIn = false;
    clerkMock.authState.getToken.mockReset();
    clerkMock.redirectToSignIn.mockReset();
    clerkMock.clerk = { redirectToSignIn: clerkMock.redirectToSignIn };
    clerkMock.providerProps.length = 0;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the app when auth is disabled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ enabled: false, provider: null }));

    render(
      <AuthGate>
        <div>Open Design App</div>
      </AuthGate>,
    );

    expect(await screen.findByText('Open Design App')).toBeTruthy();
  });

  it('redirects signed-out users to Clerk sign-in', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockJsonResponse({
        enabled: true,
        provider: 'clerk',
        publishableKey: 'pk_test_public',
        clerkDomain: 'mkagp.com',
        signInUrl: 'https://login.mkagrowth.com/sign-in',
        signUpUrl: 'https://login.mkagrowth.com/sign-up',
      }),
    );

    render(
      <AuthGate>
        <div>Open Design App</div>
      </AuthGate>,
    );

    await waitFor(() => expect(clerkMock.redirectToSignIn).toHaveBeenCalled());
    expect(clerkMock.redirectToSignIn).toHaveBeenCalledWith({ redirectUrl: window.location.href });
    expect(clerkMock.providerProps[0]).toMatchObject({
      publishableKey: 'pk_test_public',
      isSatellite: true,
      domain: 'mkagp.com',
      signInUrl: 'https://login.mkagrowth.com/sign-in',
      signUpUrl: 'https://login.mkagrowth.com/sign-up',
    });
  });

  it('posts the Clerk token and renders the app after daemon session succeeds', async () => {
    clerkMock.authState.isSignedIn = true;
    clerkMock.authState.getToken.mockResolvedValueOnce('clerk-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockJsonResponse({
          enabled: true,
          provider: 'clerk',
          publishableKey: 'pk_test_public',
          clerkDomain: 'mkagp.com',
          signInUrl: 'https://login.mkagrowth.com/sign-in',
          signUpUrl: 'https://login.mkagrowth.com/sign-up',
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ authenticated: true, userId: 'user_1', orgId: 'org_1' }));

    render(
      <AuthGate>
        <div>Open Design App</div>
      </AuthGate>,
    );

    expect(await screen.findByText('Open Design App')).toBeTruthy();
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerkToken: 'clerk-token' }),
    });
  });

  it('renders access denied when the daemon rejects org membership', async () => {
    clerkMock.authState.isSignedIn = true;
    clerkMock.authState.getToken.mockResolvedValueOnce('clerk-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockJsonResponse({
          enabled: true,
          provider: 'clerk',
          publishableKey: 'pk_test_public',
          clerkDomain: 'mkagp.com',
          signInUrl: 'https://login.mkagrowth.com/sign-in',
          signUpUrl: 'https://login.mkagrowth.com/sign-up',
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ error: { code: 'ORG_MEMBERSHIP_REQUIRED' } }, 403));

    render(
      <AuthGate>
        <div>Open Design App</div>
      </AuthGate>,
    );

    expect(await screen.findByText('Access denied')).toBeTruthy();
  });

  it('shows a retryable error when auth bootstrap fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network unavailable'));

    render(
      <AuthGate>
        <div>Open Design App</div>
      </AuthGate>,
    );

    expect(await screen.findByText('Authentication unavailable')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
