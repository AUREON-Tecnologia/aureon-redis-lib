/**
 * Namespace fijo, compartido por todos los servicios AUREON, independiente
 * del `keyPrefix` que cada uno configure para su propio RedisService. Identity
 * es el unico que escribe aqui (AccessTokenSessionWriterService); el resto
 * solo lee (AccessTokenSessionReaderService).
 */
export const ACCESS_TOKEN_SESSION_NAMESPACE = 'identity:access-token';

export function accessTokenSessionKey(jti: string): string {
  return `${ACCESS_TOKEN_SESSION_NAMESPACE}:${jti}`;
}
