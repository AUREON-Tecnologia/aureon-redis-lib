import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis.constants';
import { JwtPayload } from '../jwt/jwt-payload.interface';
import { accessTokenSessionKey } from './access-token-session.constants';
import { RedisUnavailableError } from './redis-unavailable.error';

/**
 * Usado por todos los microservicios (incluido Identity para sus propios
 * endpoints protegidos) para confirmar que un access token tiene una sesion
 * vigente en Redis.
 *
 * Patron whitelist: Redis es la fuente de verdad de si el token sigue siendo
 * valido — la firma/expiracion del JWT se sigue validando localmente primero
 * (barato, rechaza tokens manipulados sin ir a Redis) pero la vigencia real
 * la decide esta consulta. `null` es un solo significado ("no hay sesion":
 * nunca existio, expiro por TTL, o se borro en logout) — no se puede ni hace
 * falta distinguir el motivo. Fail-closed ante caida de Redis: a diferencia
 * del blacklist anterior, un error real de Redis NO se traga — se relanza
 * como RedisUnavailableError para que el guard responda 503, no 401.
 */
@Injectable()
export class AccessTokenSessionReaderService {
  private readonly logger = new Logger(AccessTokenSessionReaderService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async getSession(jti: string | undefined): Promise<JwtPayload | null> {
    if (!jti) {
      return null;
    }
    if (!this.redis) {
      throw new RedisUnavailableError('Redis no esta configurado (REDIS_HOST vacio)');
    }
    let value: string | null;
    try {
      value = await this.redis.get(accessTokenSessionKey(jti));
    } catch (error) {
      this.logger.error(`No se pudo consultar la sesion del access token ${jti} en Redis: ${(error as Error).message}`);
      throw new RedisUnavailableError('No se pudo consultar la sesion del access token en Redis', { cause: error });
    }
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(value) as JwtPayload;
    } catch (error) {
      this.logger.error(`Sesion corrupta en Redis para jti ${jti}: ${(error as Error).message}`);
      return null;
    }
  }
}
