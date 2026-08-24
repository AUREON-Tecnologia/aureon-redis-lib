import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';
import { CSRF_TOKEN_COOKIE_NAME, CSRF_TOKEN_HEADER_NAME } from './cookie.constants';

const buildContext = (opts: {
  method: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method: opts.method, cookies: opts.cookies, headers: opts.headers ?? {} }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('CsrfGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: CsrfGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as jest.Mocked<Reflector>;
    guard = new CsrfGuard(reflector);
  });

  it('allows GET regardless of csrf state', () => {
    expect(guard.canActivate(buildContext({ method: 'GET' }))).toBe(true);
  });

  it('allows HEAD and OPTIONS as safe methods', () => {
    expect(guard.canActivate(buildContext({ method: 'HEAD' }))).toBe(true);
    expect(guard.canActivate(buildContext({ method: 'OPTIONS' }))).toBe(true);
  });

  it('allows a POST with no csrf_token cookie (header-authenticated client, e.g. Postman)', () => {
    expect(guard.canActivate(buildContext({ method: 'POST' }))).toBe(true);
  });

  it('allows a POST when the header matches the csrf_token cookie', () => {
    const context = buildContext({
      method: 'POST',
      cookies: { [CSRF_TOKEN_COOKIE_NAME]: 'abc123' },
      headers: { [CSRF_TOKEN_HEADER_NAME]: 'abc123' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a POST when the header is missing but the csrf_token cookie is present', () => {
    const context = buildContext({ method: 'POST', cookies: { [CSRF_TOKEN_COOKIE_NAME]: 'abc123' } });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a POST when the header does not match the csrf_token cookie', () => {
    const context = buildContext({
      method: 'POST',
      cookies: { [CSRF_TOKEN_COOKIE_NAME]: 'abc123' },
      headers: { [CSRF_TOKEN_HEADER_NAME]: 'different' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a POST marked @SkipCsrf() even with a stale/mismatched csrf_token cookie and no header', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = buildContext({
      method: 'POST',
      cookies: { [CSRF_TOKEN_COOKIE_NAME]: 'stale-from-a-previous-session' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});
