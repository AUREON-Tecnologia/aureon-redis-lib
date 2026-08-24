/**
 * Whitelist, no blacklist: Redis es la fuente de verdad de si un access token
 * sigue vigente, asi que un error de conexion no puede tratarse como "sesion
 * no encontrada" (eso es un 401 legitimo). El guard atrapa este error
 * especificamente para responder 503 en vez de 401, y asi una caida de Redis
 * se vea como incidente de infraestructura, no como token invalido.
 */
export class RedisUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'RedisUnavailableError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
