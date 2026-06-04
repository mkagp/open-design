// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGate } from '../../src/auth/AuthGate';
import { EntryNavRail } from '../../src/components/EntryNavRail';

const clerkMock = vi.hoisted(() => ({
  authState: {
    isLoaded: true,
    isSignedIn: true,
    getToken: vi.fn(),
  },
  redirectToSignIn: vi.fn(),
  clerk: null as null | { redirectToSignIn: ReturnType<typeof vi.fn> },
}));

vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: (props: Record<string, unknown>) => (
    <div data-testid="clerk-provider">{props.children as React.ReactNode}</div>
  ),
  UserButton: () => <button type="button" data-testid="clerk-user-button">Profile</button>,
  useAuth: () => clerkMock.authState,
  useClerk: () => clerkMock.clerk,
}));

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderRailInAuthGate() {
  render(
    <AuthGate>
      <EntryNavRail
        view="home"
        onViewChange={() => undefined}
        onNewProject={() => undefined}
      />
    </AuthGate>,
  );
}

describe('EntryNavRail auth profile affordance', () => {
  beforeEach(() => {
    clerkMock.authState.isLoaded = true;
    clerkMock.authState.isSignedIn = true;
    clerkMock.authState.getToken.mockReset();
    clerkMock.authState.getToken.mockResolvedValue('clerk-token');
    clerkMock.redirectToSignIn.mockReset();
    clerkMock.clerk = { redirectToSignIn: clerkMock.redirectToSignIn };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the help button when hosted auth is disabled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ enabled: false, provider: null }));

    renderRailInAuthGate();

    expect(await screen.findByTestId('entry-help-trigger')).toBeTruthy();
    expect(screen.queryByTestId('entry-profile-button')).toBeNull();
    expect(screen.queryByTestId('clerk-user-button')).toBeNull();
  });

  it('replaces the help button with the Clerk user button when hosted auth is enabled', async () => {
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
      .mockResolvedValueOnce(mockJsonResponse({ authenticated: true, userId: 'user_1' }));

    renderRailInAuthGate();

    expect(await screen.findByTestId('entry-profile-button')).toBeTruthy();
    expect(screen.getByTestId('clerk-user-button')).toBeTruthy();
    expect(screen.queryByTestId('entry-help-trigger')).toBeNull();
  });
});
