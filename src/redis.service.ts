import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_MODULE_OPTIONS } from './redis.constants';
import { RedisModuleOptions } from './interfaces/redis-module-options.interface';

/**
 * Helper generico para las keys propias de cada servicio (namespaced por
 * `keyPrefix`). No es el mecanismo de sesiones de access token: para eso usar
 * AccessTokenSessionWriterService/AccessTokenSessionReaderService, que usan
 * un namespace fijo compartido independiente del prefijo de cada servicio.
 */
@Injectable()
export class RedisService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis | null,
    @Inject(REDIS_MODULE_OPTIONS) private readonly options: RedisModuleOptions,
  ) {}

  private namespaced(key: string): string {
    return `${this.options.keyPrefix}:${key}`;
  }

  /** Sin Redis configurado (host vacio): siempre "no existe". */
  async get(key: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    return this.client.get(this.namespaced(key));
  }

  /** Sin Redis configurado (host vacio): no-op. */
  async set(key: string, value: string, ttlSegundos?: number): Promise<void> {
    if (!this.client) {
      return;
    }
    if (ttlSegundos && ttlSegundos > 0) {
      await this.client.set(this.namespaced(key), value, 'EX', ttlSegundos);
    } else {
      await this.client.set(this.namespaced(key), value);
    }
  }

  /** Sin Redis configurado (host vacio): no-op. */
  async del(key: string): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.del(this.namespaced(key));
  }

  /** Sin Redis configurado (host vacio): siempre false. */
  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    return (await this.client.exists(this.namespaced(key))) === 1;
  }

  /** Acceso al cliente ioredis crudo para casos que no encajen en get/set/del/exists. null si Redis no esta configurado. */
  getClient(): Redis | null {
    return this.client;
  }
}
