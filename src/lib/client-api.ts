/**
 * React hook: returns a fetch wrapper that attaches the Privy identity token.
 * Falls back gracefully to plain fetch if the token can't be fetched (dev w/o privy configured).
 */
import { useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function useApiFetch() {
  const { getIdentityToken } = usePrivy();

  return useCallback(
    async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      headers.set('Content-Type', 'application/json');
      try {
        const token = await getIdentityToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
      } catch {
        // No token — server will respond 401; UI should handle.
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
    [getIdentityToken],
  );
}
