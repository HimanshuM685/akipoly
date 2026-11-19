/**
 * React hook: returns a fetch wrapper that attaches the Privy identity token.
 * Falls back to the access token if the identity token is missing.
 */
import { useCallback } from 'react';
import { usePrivy, useIdentityToken } from '@privy-io/react-auth';

export function useApiFetch() {
  const { getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();

  return useCallback(
    async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      headers.set('Content-Type', 'application/json');
      try {
        const token = identityToken ?? (await getAccessToken());
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        } else {
          console.warn('[useApiFetch] no token available; server will 401');
        }
      } catch (err) {
        console.error('[useApiFetch] failed to get token:', err);
      }
      const res = await fetch(path, { ...options, headers });
      if (!res.ok) {
        let message = `request failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (typeof data?.error === 'string') message = data.error;
        } catch {
          /* non-json */
        }
        throw new Error(message);
      }
      return res.json() as Promise<T>;
    },
    [getAccessToken, identityToken],
  );
}
