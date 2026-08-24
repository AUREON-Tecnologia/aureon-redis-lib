import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

const buildContext = (user?: { roles: string[] }): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('allows access if the endpoint does not declare @Roles(...)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext({ roles: ['cliente'] }))).toBe(true);
  });

  it('allows access if the user has one of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['administrador']);
    expect(guard.canActivate(buildContext({ roles: ['administrador'] }))).toBe(true);
  });

  it('throws ForbiddenException if the user has none of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['administrador']);
    expect(() => guard.canActivate(buildContext({ roles: ['tecnico'] }))).toThrow(ForbiddenException);
  });

  it('throws UnauthorizedException if there is no user in the request (guard misordered)', () => {
    reflector.getAllAndOverride.mockReturnValue(['administrador']);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(UnauthorizedException);
  });

  it('allows access if the user has at least one of several allowed roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['administrador', 'sistema']);
    expect(guard.canActivate(buildContext({ roles: ['sistema'] }))).toBe(true);
  });

  it('allows a custom tenant role code that is not in the 5-role legacy catalog', () => {
    reflector.getAllAndOverride.mockReturnValue(['gerente-sucursal']);
    expect(guard.canActivate(buildContext({ roles: ['gerente-sucursal'] }))).toBe(true);
  });
});

describe('ROLES_KEY', () => {
  it('is a stable metadata key', () => {
    expect(ROLES_KEY).toBe('roles');
  });
});
