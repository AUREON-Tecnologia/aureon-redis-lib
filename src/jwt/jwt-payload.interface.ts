/**
 * Contrato canonico entre Identity (emisor, aureon-auth-back) y el resto de
 * microservicios AUREON (lectores). Cualquier cambio aqui es un cambio de
 * contrato entre servicios — coordinar antes de tocarlo.
 */
export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
  /** Codes of the modules active for `tenantId` (Module.code) — lets a consumer know which features are enabled without an admin-only call to Identity. */
  activeModules: string[];
  jti?: string;
  iat?: number;
  exp?: number;
}
