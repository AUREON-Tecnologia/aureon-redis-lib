import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisShutdownService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Error cerrando la conexion a Redis: ${(error as Error).message}`);
    }
  }
}
