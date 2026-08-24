import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AccessTokenSessionReaderService } from '../access-token-session/access-token-session-reader.service';
import { RedisUnavailableError } from '../access-token-session/redis-unavailable.error';
import { JwtPayload } from './jwt-payload.interface';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ACCESS_TOKEN_COOKIE_NAME } from '../cookies/cookie.constants';

type RequestWithCookies = Request & { user?: JwtPayload; cookies?: Record<string, string | undefined> };

/**
 * Verifica firma/expiracion del JWT localmente (stateless) usando el
 * `JwtService` que el repo consumidor ya debe tener registrado via
 * `@nestjs/jwt` (esta libreria no lo registra por el — solo necesita que el
 * secret configurado ahi sea el mismo que usa Identity para firmar). Si la
 * firma es valida, consulta AccessTokenSessionReaderService para confirmar
 * que la sesion sigue vigente en Redis (whitelist: Redis es la fuente de
 * verdad, no un chequeo adicional de revocacion). Fail-closed: si Redis no
 * responde, se rechaza la request con 503 en vez de dejar pasar el token.
 *
 * The token is read from the `Authorization: Bearer <token>` header if
 * present (non-browser consumers: Postman, scripts, mobile); if not, it
 * falls back to the `access_token` cookie (browser flow). The consumer must
 * have `cookie-parser` (or other middleware that populates
 * `request.cookies`) running before this guard for the fallback to work.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly accessTokenSession: AccessTokenSessionReaderService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithCookies>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException({
        codigo: 'UNAUTHORIZED',
        mensaje: 'Missing Authorization header, invalid format, or no session cookie',
      });
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({ codigo: 'UNAUTHORIZED', mensaje: 'Invalid or expired token' });
    }

    let session: JwtPayload | null;
    try {
      session = await this.accessTokenSession.getSession(payload.jti);
    } catch (error) {
      if (error instanceof RedisUnavailableError) {
        throw new ServiceUnavailableException({
          codigo: 'AUTH_BACKEND_UNAVAILABLE',
          mensaje: 'Could not validate the session: Redis unavailable',
        });
      }
      throw error;
    }

    if (!session) {
      throw new UnauthorizedException({ codigo: 'UNAUTHORIZED', mensaje: 'Invalid, expired, or revoked token' });
    }

    request.user = payload;
    return true;
  }

  private extractToken(request: RequestWithCookies): string | undefined {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return request.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  }
}
