# @aureon/redis-client

Libreria interna compartida: cada microservicio AUREON se conecta directo a
Redis via `ioredis` (sin un microservicio intermedio). Expone:

- `RedisModule.forRoot(options)` / `forRootAsync(...)` — conexion + `RedisService`
  namespaced por `keyPrefix` (evita colisiones de keys propias entre servicios).
- `AccessTokenSessionWriterService` — **solo Identity (auth-back)** la usa: al
  emitir un access token (login/register/refresh) guarda su sesion en Redis
  con TTL = su expiracion.
- `AccessTokenSessionReaderService` — el resto de servicios (y el propio
  Identity en sus endpoints protegidos) la usan para confirmar que un access
  token tiene una sesion vigente en Redis. Whitelist: si la sesion no esta,
  el token es invalido (nunca existio, expiro, o se cerro sesion), sin
  importar lo que diga la firma/expiracion del JWT.
- `JwtAuthGuard` — valida firma/expiracion del JWT localmente y despues
  `getSession`. Fail-closed: si Redis no responde, la request se rechaza con
  503 (`AUTH_BACKEND_UNAVAILABLE`), no se deja pasar el token. Lee el token
  del header `Authorization: Bearer` si esta presente; si no, cae a la
  cookie `access_token` (requiere `cookie-parser` u otro middleware que
  popule `request.cookies` corriendo antes del guard en el consumidor).
- `CsrfGuard` — double-submit cookie: si la request trae la cookie
  `csrf_token`, exige que el header `X-CSRF-Token` coincida con ella en
  metodos no-`GET`. No aplica si no hay `csrf_token` en la request (cliente
  autenticado por header, no por cookie — ahi CSRF no es un riesgo real).
- `RolesGuard` / `@Roles(...codes)` — autorizacion por `x-roles` del contrato
  OpenAPI. Se usa junto a `JwtAuthGuard` (lee `request.user.roles`, ya
  decodificado del JWT); no hace ninguna llamada a red ni a base de datos.
- `PermissionsGuard` / `@RequirePermission(codigo)` — autorizacion granular
  via el claim `permissions` del JWT (Identity lo calcula una vez al emitir
  el token, con su propio catalogo RBAC). Igual de stateless que `RolesGuard`
  — sin llamada a red ni a base de datos por request. Complementa a
  `RolesGuard`, no lo reemplaza.

Namespace de sesion fijo (`identity:access-token:<jti>`), independiente
del `keyPrefix` que cada servicio configure para sus propias keys.

**Redis es requerido, no opcional, para que la autenticacion funcione.** A
diferencia del `RedisService` generico (que se degrada a no-op sin `REDIS_HOST`),
`AccessTokenSessionWriterService`/`ReaderService` lanzan `RedisUnavailableError`
si Redis no esta configurado o no responde — ver `CLAUDE.md` para el porque.

## Estado: vendorizado, no publicado

Este paquete todavia no se publica a ningun registro (Azure Artifacts u otro).
`aureon-auth-back` lo consume vendorizando un tarball compilado dentro de su
propio repo (`vendor/aureon-redis-client-<version>.tgz`, ver `vendor/README.md`
de ese repo) para que los builds aislados (Railway, CI) no dependan de una
carpeta hermana que no existe fuera de esta maquina. Cuando se decida el feed
de Azure Artifacts, publicar con `npm publish` y cambiar la dependencia de
`file:` a la version publicada.

## Uso

```ts
// app.module.ts de cada servicio
RedisModule.forRootAsync({
  isGlobal: true,
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    host: config.get('redis.host'),
    port: config.get('redis.port'),
    password: config.get('redis.password'),
    db: config.get('redis.db'),
    keyPrefix: config.get('redis.keyPrefix'), // ej. 'identity', 'customer'
  }),
})
```

```ts
// Identity (auth-back), al emitir un access token:
await this.accessTokenSession.saveSession(jti, payload, ttlSegundos);

// Identity, al hacer logout:
await this.accessTokenSession.deleteSession(jti);

// Cualquier otro microservicio: JwtAuthGuard ya hace esto por vos.
// Uso manual si hiciera falta:
const session = await this.accessTokenSession.getSession(jti); // null = invalido
```

```ts
// main.ts de cada servicio que acepte cookies: cookie-parser DEBE correr antes de que
// los guards se ejecuten, si no JwtAuthGuard/CsrfGuard nunca ven request.cookies.
app.use(cookieParser());
```

```ts
// app.module.ts de cada servicio: JwtAuthGuard global + RolesGuard global
// (+ PermissionsGuard si el servicio usa permisos finos, + CsrfGuard si acepta cookies)
// El orden importa: cada guard necesita que el anterior ya haya poblado/validado request.user
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: RolesGuard },
{ provide: APP_GUARD, useClass: PermissionsGuard },
{ provide: APP_GUARD, useClass: CsrfGuard },
```

```ts
// controller: los codigos de @Roles deben copiarse 1:1 del x-roles del contrato de esa operacion.
// @RequirePermission complementa a @Roles (AND, no reemplazo) cuando el codigo de permiso existe
// en el catalogo de Identity — si no existe, la request nunca pasaria el chequeo.
@Roles('administrador')
@RequirePermission('clientes:eliminar')
@Delete(':id')
eliminar(@Param('id') id: string) { ... }
```
