/**
 * Shared API helpers: JSON responses and consistent error mapping.
 */
import type { APIRoute } from 'astro';
import { HttpError } from './db';
import { requirePrivyUser } from './privy';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Wraps an APIRoute handler with Privy auth + error mapping. */
export function apiRoute(
  handler: (ctx: { request: Request; params: Record<string, string>; userId: string }) => Promise<Response>,
): APIRoute {
  return async (context) => {
    try {
      const { userId } = await requirePrivyUser(context.request);
      const params = (context.params ?? {}) as Record<string, string>;
      return await handler({ request: context.request, params, userId });
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('[api] unexpected error:', err);
      return json({ error: 'Something went wrong on our side.' }, 500);
    }
  };
}
