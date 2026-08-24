import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis.constants';
import { JwtPayload } from '../jwt/jwt-payload.interface';
import { accessTokenSessionKey } from './access-token-session.constants';
import { RedisUnavailableError } from './redis-unavailable.error';

/**
 * Solo Identity (auth-back) debe instanciar/usar este servicio: es el unico
 * punto de escritura de sesiones de access token en Redis. El resto de
 * microservicios deben depender solo de AccessTokenSessionReaderService.
 */
@Injectable()
export class AccessTokenSessionWriterService {
  private readonly logger = new Logger(AccessTokenSessionWriterService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  /**
   * Registra la sesion del access token reciem emitido (login/register/
   * refresh) con TTL = su expiracion. Whitelist: si esto falla, ningun
   * microservicio podra validar despues ese token (getSession siempre daria
   * "no encontrado"), asi que a diferencia del blacklist viejo esto SI lanza
   * — el llamador (AuthCommandService) debe tratarlo como fallo de emision
   * de sesion, no devolver 200 con un token invalidable por nadie.
   */
  async saveSession(jti: string | undefined, payload: JwtPayload, ttlSegundos: number): Promise<void> {
    if (!jti || ttlSegundos <= 0) {
      throw new RedisUnavailableError('jti o ttlSegundos invalidos para registrar la sesion del access token');
    }
    if (!this.redis) {
      throw new RedisUnavailableError('Redis no esta configurado (REDIS_HOST vacio)');
    }
    try {
      await this.redis.set(accessTokenSessionKey(jti), JSON.stringify(payload), 'EX', ttlSegundos);
    } catch (error) {
      this.logger.error(`No se pudo registrar la sesion del access token ${jti} en Redis: ${(error as Error).message}`);
      throw new RedisUnavailableError('No se pudo registrar la sesion del access token en Redis', { cause: error });
    }
  }

  /**
   * Borra la sesion en logout (invalidacion inmediata, no hay que esperar el
   * TTL). Best-effort a proposito: el refresh token ya se invalido en
   * Postgres antes de llegar aca, asi que el cierre de sesion no depende de
   * esto — y si Redis esta caido en este momento, tampoco nadie puede validar
   * el access token de todas formas (fail-closed en el reader), asi que
   * bloquear la respuesta de logout no gana nada.
   */
  async deleteSession(jti: string | undefined): Promise<void> {
    if (!this.redis || !jti) {
      return;
    }
    try {
      await this.redis.del(accessTokenSessionKey(jti));
    } catch (error) {
      this.logger.warn(`No se pudo borrar la sesion del access token ${jti} en Redis (se degrada): ${(error as Error).message}`);
    }
  }
}
