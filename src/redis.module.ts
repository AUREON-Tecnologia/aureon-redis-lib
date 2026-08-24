import { DynamicModule, Logger, Module, Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_MODULE_OPTIONS } from './redis.constants';
import {
  RedisModuleAsyncOptions,
  RedisModuleOptions,
} from './interfaces/redis-module-options.interface';
import { RedisService } from './redis.service';
import { RedisShutdownService } from './redis-shutdown.service';
import { AccessTokenSessionWriterService } from './access-token-session/access-token-session-writer.service';
import { AccessTokenSessionReaderService } from './access-token-session/access-token-session-reader.service';

const CLIENT_PROVIDER: Provider = {
  provide: REDIS_CLIENT,
  inject: [REDIS_MODULE_OPTIONS],
  useFactory: (options: RedisModuleOptions) => {
    const logger = new Logger('RedisClient');
    if (!options.host) {
      // Sin host configurado: no se intenta conectar. RedisService recibe null y
      // se degrada a no-op, pero AccessTokenSession* (whitelist) reciben null y
      // FALLAN (RedisUnavailableError) — ver interfaces/redis-module-options.interface.ts.
      logger.warn('REDIS_HOST no configurado: Redis queda deshabilitado (modo no-op).');
      return null;
    }
    const client = new Redis({
      host: options.host,
      port: options.port ?? 6379,
      password: options.password,
      db: options.db ?? 0,
      tls: options.tls ? {} : undefined,
      // Falla rapido en vez de acumular comandos indefinidamente si Redis no responde:
      // los servicios lectores dependen de esto para poder degradar (fail-open) sin colgarse.
      maxRetriesPerRequest: 2,
      connectTimeout: 3_000,
      retryStrategy: (times: number) => Math.min(times * 200, 2_000),
    });
    // ioredis revienta el proceso si 'error' no tiene listener: solo lo logueamos.
    client.on('error', (error: Error) => {
      logger.warn(`Error de conexion a Redis: ${error.message}`);
    });
    return client;
  },
};

const SHARED_PROVIDERS: Provider[] = [
  CLIENT_PROVIDER,
  RedisService,
  RedisShutdownService,
  AccessTokenSessionWriterService,
  AccessTokenSessionReaderService,
];

const SHARED_EXPORTS = [
  REDIS_CLIENT,
  RedisService,
  AccessTokenSessionWriterService,
  AccessTokenSessionReaderService,
];

@Module({})
export class RedisModule {
  static forRoot(options: RedisModuleOptions): DynamicModule {
    return {
      module: RedisModule,
      global: options.isGlobal ?? false,
      providers: [{ provide: REDIS_MODULE_OPTIONS, useValue: options }, ...SHARED_PROVIDERS],
      exports: SHARED_EXPORTS,
    };
  }

  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    return {
      module: RedisModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers: [
        {
          provide: REDIS_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        ...SHARED_PROVIDERS,
      ],
      exports: SHARED_EXPORTS,
    };
  }
}
