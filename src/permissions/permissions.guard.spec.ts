import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSION_KEY } from './require-permission.decorator';

const buildContext = (user?: { permissions: string[] }): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new PermissionsGuard(reflector);
  });

  it('allows access if the endpoint does not declare @RequirePermission(...)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext({ permissions: ['clientes:listar'] }))).toBe(true);
  });

  it('allows access if the user has the required permission', () => {
    reflector.getAllAndOverride.mockReturnValue('clientes:eliminar');
    expect(guard.canActivate(buildContext({ permissions: ['clientes:eliminar'] }))).toBe(true);
  });

  it('throws ForbiddenException if the user does not have the required permission', () => {
    reflector.getAllAndOverride.mockReturnValue('clientes:eliminar');
    expect(() => guard.canActivate(buildContext({ permissions: ['clientes:listar'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws UnauthorizedException if there is no user in the request (guard misordered)', () => {
    reflector.getAllAndOverride.mockReturnValue('clientes:eliminar');
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(UnauthorizedException);
  });

  it('does not make any network or database call — pure claims check', () => {
    reflector.getAllAndOverride.mockReturnValue('clientes:listar');
    const context = buildContext({ permissions: ['clientes:listar'] });
    expect(() => guard.canActivate(context)).not.toThrow();
  });
});

describe('PERMISSION_KEY', () => {
  it('is a stable metadata key', () => {
    expect(PERMISSION_KEY).toBe('permission');
  });
});
