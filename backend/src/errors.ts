import type { ErrorCode } from './shared/protocol.js';

/** Expected failure that is safe to show the user. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (m: string) => new AppError('BAD_REQUEST', m);
export const notFound = (m: string) => new AppError('NOT_FOUND', m);
export const forbidden = (m: string) => new AppError('FORBIDDEN', m);
export const conflict = (m: string) => new AppError('CONFLICT', m);
