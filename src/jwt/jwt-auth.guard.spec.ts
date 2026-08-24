import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AccessTokenSessionReaderService } from '../access-token-session/access-token-session-reader.service';
import { RedisUnavailableError } from '../access-token-session/redis-unavailable.error';
import { JwtPayload } from './jwt-payload.interface';

const PAYLOAD: JwtPayload = {
  sub: 'usr-1',
  tenantId: 'tenant-1',
  email: 'user@test.com',
  roles: ['administrador'],
  permissions: ['clientes:listar'],
  activeModules: ['clientes'],
  jti: 'jti-1',
};

const buildContext = (opts: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}): { context: ExecutionContext; request: Record<string, unknown> } => {
  const request: Record<string, unknown> = { headers: opts.headers ?? {}, cookies: opts.cookies };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
};

describe('JwtAuthGuard', () => {
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let accessTokenSession: jest.Mocked<Pick<AccessTokenSessionReaderService, 'getSession'>>;
  let reflector: jest.Mocked<Reflector>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    accessTokenSession = { getSession: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as jest.Mocked<Reflector>;
    guard = new JwtAuthGuard(
      jwtService as unknown as JwtService,
      accessTokenSession as unknown as AccessTokenSessionReaderService,
      reflector,
    );
  });

  it('allows access if the route is @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = buildContext({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException if there is no Authorization header and no access_token cookie', async () => {
    const { context } = buildContext({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reads the token from the Authorization header when present', async () => {
    jwtService.verifyAsync.mockResolvedValue(PAYLOAD);
    accessTokenSession.getSession.mockResolvedValue(PAYLOAD);
    const { context, request } = buildContext({ headers: { authorization: 'Bearer header-token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-token');
    expect(request.user).toEqual(PAYLOAD);
  });

  it('falls back to the access_token cookie when there is no Authorization header', async () => {
    jwtService.verifyAsync.mockResolvedValue(PAYLOAD);
    accessTokenSession.getSession.mockResolvedValue(PAYLOAD);
    const { context, request } = buildContext({ cookies: { access_token: 'cookie-token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('cookie-token');
    expect(request.user).toEqual(PAYLOAD);
  });

  it('prefers the Authorization header over the cookie when both are present', async () => {
    jwtService.verifyAsync.mockResolvedValue(PAYLOAD);
    accessTokenSession.getSession.mockResolvedValue(PAYLOAD);
    const { context } = buildContext({
      headers: { authorization: 'Bearer header-token' },
      cookies: { access_token: 'cookie-token' },
    });

    await guard.canActivate(context);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-token');
  });

  it('throws UnauthorizedException if the token signature/expiration is invalid', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
    const { context } = buildContext({ cookies: { access_token: 'bad-token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException if there is no whitelisted session for the jti', async () => {
    jwtService.verifyAsync.mockResolvedValue(PAYLOAD);
    accessTokenSession.getSession.mockResolvedValue(null);
    const { context } = buildContext({ cookies: { access_token: 'cookie-token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws ServiceUnavailableException if Redis is unreachable', async () => {
    jwtService.verifyAsync.mockResolvedValue(PAYLOAD);
    accessTokenSession.getSession.mockRejectedValue(new RedisUnavailableError('down'));
    const { context } = buildContext({ cookies: { access_token: 'cookie-token' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
