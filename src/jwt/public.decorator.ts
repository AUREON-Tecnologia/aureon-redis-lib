import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Excluye un endpoint de JwtAuthGuard cuando este se registra como guard global (APP_GUARD). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
