import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../jwt/jwt-payload.interface';
import { PERMISSION_KEY } from './require-permission.decorator';

/**
 * Fine-grained authorization via the `permissions` claim already embedded
 * in the JWT at issuance (Identity computes it once at login/refresh from
 * its RBAC tables). Must be used together with `JwtAuthGuard`. Stateless by
 * design — no database round trip per request — which means a permission
 * granted or revoked after a token was issued only takes effect on the
 * user's next login/refresh, same staleness window already accepted for
 * `roles`. Complementary to `RolesGuard`, not a replacement.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException({ codigo: 'UNAUTHORIZED', mensaje: 'No autenticado' });
    }

    const authorized = user.permissions.includes(requiredPermission);
    if (!authorized) {
      throw new ForbiddenException({
        codigo: 'FORBIDDEN',
        mensaje: 'No tiene permisos suficientes para esta operacion',
      });
    }

    return true;
  }
}
