'use client';

import { ClerkProvider, useAuth, useClerk } from '@clerk/clerk-react';
import type { AuthConfigResponse } from '@open-design/contracts';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { fetchAuthConfig } from './config';
import { AuthSessionError, createDaemonAuthSession } from './session';

type AuthGateProps = {
  children: ReactNode;
};

type EnabledPublicAuthConfig = AuthConfigResponse & {
  publishableKey: string;
  clerkDomain: string;
  signInUrl: string;
  signUpUrl: string;
};

type ConfigState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'enabled'; config: EnabledPublicAuthConfig }
  | { status: 'error'; message: string };

function LoadingShell() {
  return <div className="od-loading-shell">Loading Open Design...</div>;
}

function AuthErrorScreen({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ maxWidth: 420, width: '100%', color: '#111827', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24, lineHeight: 1.2 }}>{title}</h1>
        <p style={{ margin: '0 0 18px', color: '#4b5563', lineHeight: 1.5 }}>{message}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              border: '1px solid #111827',
              background: '#111827',
              color: '#fff',
              borderRadius: 6,
              padding: '9px 14px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        ) : null}
      </section>
    </main>
  );
}

function isEnabledConfig(config: AuthConfigResponse): config is EnabledPublicAuthConfig {
  return Boolean(config.enabled && config.publishableKey && config.clerkDomain && config.signInUrl && config.signUpUrl);
}

function ClerkSessionBootstrap({ children }: AuthGateProps) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const [status, setStatus] = useState<'pending' | 'ready' | 'denied' | 'error'>('pending');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      void clerk.redirectToSignIn({ redirectUrl: window.location.href });
      return;
    }

    let cancelled = false;
    setStatus('pending');
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Clerk did not return a session token');
        const session = await createDaemonAuthSession(token);
        if (!cancelled) setStatus(session.authenticated ? 'ready' : 'error');
      } catch (error) {
        if (cancelled) return;
        setStatus(error instanceof AuthSessionError && error.status === 403 ? 'denied' : 'error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, clerk, getToken, isLoaded, isSignedIn]);

  if (!isLoaded || status === 'pending') return <LoadingShell />;
  if (status === 'denied') {
    return (
      <AuthErrorScreen
        title="Access denied"
        message="You are signed in with Clerk, but your account is not a member of the configured Open Design organization."
      />
    );
  }
  if (status === 'error') {
    return (
      <AuthErrorScreen
        title="Authentication failed"
        message="Open Design could not finish creating a daemon session."
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }

  return <>{children}</>;
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<ConfigState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthConfig()
      .then((config) => {
        if (cancelled) return;
        if (!config.enabled) {
          setState({ status: 'disabled' });
        } else if (isEnabledConfig(config)) {
          setState({ status: 'enabled', config });
        } else {
          setState({ status: 'error', message: 'Authentication is enabled but public Clerk configuration is incomplete.' });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.status === 'loading') return <LoadingShell />;
  if (state.status === 'disabled') return <>{children}</>;
  if (state.status === 'error') {
    return (
      <AuthErrorScreen
        title="Authentication unavailable"
        message={state.message}
        onRetry={() => {
          setState({ status: 'loading' });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  return (
    <ClerkProvider
      publishableKey={state.config.publishableKey}
      isSatellite
      domain={state.config.clerkDomain}
      signInUrl={state.config.signInUrl}
      signUpUrl={state.config.signUpUrl}
    >
      <ClerkSessionBootstrap>{children}</ClerkSessionBootstrap>
    </ClerkProvider>
  );
}
