import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../jwt/jwt-payload.interface';
import { ROLES_KEY } from './roles.decorator';

/**
 * Authorization by the OpenAPI contract's `x-roles`. Must be used together
 * with `JwtAuthGuard` (which populates `request.user` from the already
 * verified JWT) — this guard never touches the network or the database, it
 * only compares against the already-decoded `JwtPayload.roles`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException({ codigo: 'UNAUTHORIZED', mensaje: 'No autenticado' });
    }

    const authorized = requiredRoles.some((role) => user.roles.includes(role));
    if (!authorized) {
      throw new ForbiddenException({
        codigo: 'FORBIDDEN',
        mensaje: 'No tiene permisos suficientes para esta operacion',
      });
    }

    return true;
  }
}
