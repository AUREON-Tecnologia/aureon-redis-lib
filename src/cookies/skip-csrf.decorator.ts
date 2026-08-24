import { SetMetadata } from '@nestjs/common';

export const CSRF_EXEMPT_KEY = 'csrfExempt';

/**
 * Excludes an endpoint from CsrfGuard regardless of its cookie state — for
 * endpoints that establish a new session (login/register), not ones that use
 * an existing one. A stale, still-unexpired csrf_token cookie from a prior
 * session must never be able to block a fresh login/register attempt.
 */
export const SkipCsrf = () => SetMetadata(CSRF_EXEMPT_KEY, true);
