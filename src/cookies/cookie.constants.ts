/**
 * Cookie names shared between Identity (sole issuer) and the rest of the
 * AUREON microservices (readers only). Changing any of these is a contract
 * change between services — coordinate before touching it.
 */
export const ACCESS_TOKEN_COOKIE_NAME = 'access_token';
export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
export const CSRF_TOKEN_COOKIE_NAME = 'csrf_token';
export const CSRF_TOKEN_HEADER_NAME = 'x-csrf-token';
