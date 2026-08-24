import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

/**
 * Fine-grained permission code (e.g. `clientes:eliminar`), checked against
 * the already-decoded `JwtPayload.permissions` claim — no database call.
 * Complementary to `@Roles(...)`, not a replacement: use both together when
 * a route needs both a coarse role check and a fine permission check.
 */
export const RequirePermission = (permissionCode: string) => SetMetadata(PERMISSION_KEY, permissionCode);
