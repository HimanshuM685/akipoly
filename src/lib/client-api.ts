/**
 * React hook: returns a fetch wrapper that attaches the Privy identity token.
 */
import { useCallback } from 'react';
import { getIdentityToken } from '@privy-io/react-auth';

export function useApiFetch() {
  return useCallback(
    async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      headers.set('Content-Type', 'application/json');
      try {
        const token = await getIdentityToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        else console.warn('[useApiFetch] no identity token available — server will respond 401');
      } catch (err) {
        console.error('[useApiFetch] failed to get identity token:', err);
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
    [],
  );
}
