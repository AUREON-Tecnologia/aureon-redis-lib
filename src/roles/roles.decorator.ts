import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Free-form codes (not a closed enum): a tenant can define its own roles via
 * Identity's `rbac` module, and this decorator must be able to list those
 * just like the 5 legacy roles seeded per tenant (`administrador`,
 * `tecnico`, `administrativo`, `cliente`, `sistema`).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
