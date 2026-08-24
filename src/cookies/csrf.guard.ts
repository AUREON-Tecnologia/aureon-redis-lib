import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CSRF_TOKEN_COOKIE_NAME, CSRF_TOKEN_HEADER_NAME } from './cookie.constants';
import { CSRF_EXEMPT_KEY } from './skip-csrf.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type RequestWithCookies = Request & { cookies?: Record<string, string | undefined> };

/**
 * Double-submit cookie: if the request carries the `csrf_token` cookie
 * (session authenticated by cookie, browser flow), the `X-CSRF-Token`
 * header must match it. A malicious site can get the browser to send
 * cookies automatically, but it cannot read `csrf_token` (not httpOnly,
 * but a different origin) to build the header.
 *
 * Does not apply if there is no `csrf_token` cookie on the request — that
 * means the client is not in the cookie-session flow (e.g. a consumer
 * authenticating directly with `Authorization: Bearer`, like Postman or a
 * script), where CSRF is not a relevant risk: a third-party site cannot set
 * that header on a cross-site request.
 *
 * Also does not apply to endpoints marked `@SkipCsrf()` (login/register):
 * those establish a session, they don't use one, so a stale/unrelated
 * `csrf_token` cookie left over from a previous session must never be able
 * to block them.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isExempt = this.reflector.getAllAndOverride<boolean>(CSRF_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExempt) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithCookies>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const csrfCookie = request.cookies?.[CSRF_TOKEN_COOKIE_NAME];
    if (!csrfCookie) {
      return true;
    }

    const csrfHeader = request.headers[CSRF_TOKEN_HEADER_NAME];
    if (csrfHeader !== csrfCookie) {
      throw new ForbiddenException({
        codigo: 'CSRF_TOKEN_INVALID',
        mensaje: 'The X-CSRF-Token header is missing or does not match the session',
      });
    }

    return true;
  }
}
