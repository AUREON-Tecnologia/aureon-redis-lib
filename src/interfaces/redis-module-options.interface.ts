import { ModuleMetadata } from '@nestjs/common';

export interface RedisModuleOptions {
  /** Si se omite/queda vacio, el modulo NO conecta a Redis: REDIS_CLIENT resuelve a null. RedisService se degrada a no-op, pero AccessTokenSessionWriterService/ReaderService (whitelist) lanzan RedisUnavailableError — no hay modo "opcional" para la validacion de sesiones (ver README). */
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
  /** Prefijo de namespace propio del servicio (ej. "identity", "customer") para RedisService.*, evita colisiones de keys entre microservicios. */
  keyPrefix: string;
  /** Registra el modulo como global (@Global) para no reimportarlo en cada feature module. */
  isGlobal?: boolean;
}

export interface RedisModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  isGlobal?: boolean;
  useFactory: (
    ...args: any[]
  ) => Promise<Omit<RedisModuleOptions, 'isGlobal'>> | Omit<RedisModuleOptions, 'isGlobal'>;
}
