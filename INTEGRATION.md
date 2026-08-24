# Guía de integración de `@aureon/redis-lib` en un microservicio AUREON nuevo

Este archivo está escrito para que un agente de IA (o una persona) que nunca vio este
repo pueda implementar sesión, roles y permisos en un microservicio NestJS nuevo **sin
tener que adivinar nada ni leer el código fuente de la librería**. Es la guía operativa
paso a paso; el *por qué* de cada decisión de diseño está en `CLAUDE.md` si hace falta
más contexto, pero no es necesario leerlo para integrar correctamente.

Si en algún punto una instrucción de aquí choca con lo que ya existe en el
microservicio que estás integrando, prioriza no romper nada que ya funcione y pregunta
antes de improvisar — esto es infraestructura de autenticación compartida entre
servicios, un error aquí no se queda aislado en un solo repo.

## 0. Lo primero que hay que entender: esto es un contrato, no una librería aislada

`aureon-auth-back` (apodado **Identity** en el resto de este documento) es el **único**
servicio de todo el ecosistema AUREON que:
- valida credenciales y emite el JWT,
- escribe la sesión de ese JWT en Redis,
- setea/limpia las cookies de sesión.

Tu microservicio nuevo es, casi siempre, un **lector puro**: solo verifica que un JWT
que ya trae el request sea válido y tenga una sesión vigente. Nunca emite tokens,
nunca escribe en Redis con el "writer", nunca setea las cookies de sesión. Si en algún
momento crees que tu microservicio necesita hacer alguna de esas tres cosas, para —
eso es responsabilidad de Identity, no tuya.

Por ser un contrato compartido, **tres valores deben ser idénticos, byte a byte, entre
tu microservicio e Identity**:
1. `JWT_SECRET` — si no coincide, todo token se rechaza como firma inválida.
2. El host/puerto/credenciales de Redis — debe ser la **misma instancia**, no una
   instancia propia de tu microservicio. Redis aquí es infraestructura compartida.
3. Los nombres de las 3 cookies de sesión (`access_token`, `refresh_token`,
   `csrf_token`) — ya vienen fijos en la librería, no los inventes ni los cambies.

## 1. Instalación

```json
// package.json de tu microservicio
"dependencies": {
  "@aureon/redis-lib": "github:AUREON-Tecnologia/aureon-redis-lib#v0.8.0",
  "cookie-parser": "^1.4.7"
}
```

```json
"devDependencies": {
  "@types/cookie-parser": "^1.4.7"
}
```

Corre `npm install` (o `pnpm install` si tu microservicio usa pnpm). npm clona el tag
`v0.8.0` exacto y corre `prepare` (`npm run build`) automáticamente — no hay que
compilar nada a mano ni copiar tarballs.

**Nunca instales sin fijar un tag** (`#v0.8.0`) — sin eso, `npm install` te trae lo
último de `master`, que puede tener cambios sin anunciar. Si en el futuro alguien
publica una versión nueva de esta librería y quieres actualizar, es un cambio
deliberado: cambia el tag en el `package.json`, no lo dejes flotando.

## 2. Variables de entorno

Copiar los valores reales de Identity para las primeras tres filas — no inventarlos.

| Variable | Quién la define | Ejemplo / nota |
|---|---|---|
| `JWT_SECRET` | **Debe ser idéntica** a la de Identity | El mismo string, literal |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | **Debe apuntar a la misma instancia** que usa Identity | No levantes tu propio Redis aislado |
| `REDIS_KEY_PREFIX` | Propio de tu microservicio | Ej. `scheduling`, `inventory` — evita colisión de tus propias keys de cache con las de otros servicios. **No afecta** el namespace de sesión, que es fijo (`identity:access-token:<jti>`) sin importar este valor |
| `COOKIE_DOMAIN` | Debe coincidir con el dominio raíz compartido, si existe | Vacío mientras cada servicio viva en un dominio Railway suelto sin relación con los demás |
| `FRONTEND_ORIGIN` | El origin exacto del frontend que va a llamar a tu microservicio | Sin wildcard — `credentials: true` en CORS lo prohíbe |

## 3. `main.ts`

```ts
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // OBLIGATORIO y en este orden: cookie-parser antes que cualquier guard, si no
  // JwtAuthGuard/CsrfGuard nunca ven request.cookies y el fallback a cookie
  // simplemente no funciona (sin error visible — solo deja de funcionar).
  app.use(cookieParser());

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true, // obligatorio para que el navegador mande las cookies de sesión
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

## 4. Módulo de infraestructura de auth (patrón recomendado)

No mezcles esto con tu `AppModule` directamente — crea un módulo dedicado, así:

```ts
// src/shared/infrastructure/auth/auth-infrastructure.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  RedisModule,
  JwtAuthGuard,
  RolesGuard,
  PermissionsGuard,
  CsrfGuard,
} from '@aureon/redis-lib';

@Module({
  imports: [
    RedisModule.forRootAsync({
      isGlobal: true,
      useFactory: () => ({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined,
        db: Number(process.env.REDIS_DB ?? 0),
        keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'tu-servicio',
      }),
    }),
  ],
  providers: [
    // El ORDEN importa: cada guard asume que el anterior ya corrió y ya pobló
    // request.user. No los reordenes ni los intercales con otros APP_GUARD.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AuthInfrastructureModule {}
```

```ts
// app.module.ts
@Module({
  imports: [AuthInfrastructureModule, /* ...tus módulos de negocio */],
})
export class AppModule {}
```

Con esto, **todas** las rutas de tu servicio quedan protegidas por defecto — no hace
falta poner `@UseGuards(...)` en cada controller. Un endpoint que sí deba ser público
(un health check, por ejemplo) se excluye explícitamente:

```ts
import { Public } from '@aureon/redis-lib';

@Public()
@Get()
health() {
  return { status: 'ok' };
}
```

`@Public()` solo excluye de `JwtAuthGuard` (y por lo tanto de los guards que dependen
de él). Si tu servicio no usa `PermissionsGuard`, simplemente no lo agregues a la lista
de `providers` — no rompe nada quitarlo si no vas a usar `@RequirePermission(...)` en
ningún controller.

## 5. Qué trae el JWT ya decodificado (`JwtPayload`)

```ts
interface JwtPayload {
  sub: string;             // id del usuario (UUID)
  tenantId: string;        // tenant activo de ESTA sesión — todo lo que hagas debe scopearse a este id
  email: string;
  roles: string[];         // códigos de rol del usuario en este tenant (normalmente uno solo)
  permissions: string[];   // códigos "recurso:accion" ya efectivos (rol + overrides directos)
  activeModules: string[]; // códigos de los módulos licenciados/activos para este tenant
  jti?: string;
  iat?: number;
  exp?: number;
}
```

Se obtiene en un controller así:

```ts
import { CurrentUser, JwtPayload } from '@aureon/redis-lib';

@Get()
listar(@CurrentUser() user: JwtPayload) {
  return this.service.listar(user.tenantId); // SIEMPRE scopeado a tenantId, nunca a un parámetro de la URL
}
```

**Regla de aislamiento multi-tenant, no negociable**: cualquier query a tu base de
datos debe filtrar por `user.tenantId` (o el tenant que resuelvas de otra forma
explícita y auditada) — nunca confíes en un `tenantId` que venga en el body/query de la
request en vez del JWT, eso permitiría que un usuario de un tenant lea/edite datos de
otro con solo cambiar un parámetro.

## 6. Decoradores disponibles — cuándo usar cada uno

| Decorador | Para qué | Dónde se copian los valores |
|---|---|---|
| `@Roles('administrador', 'tecnico')` | Autorización por rol de negocio | Copiar 1:1 el `x-roles` de la operación en **tu propio** contrato OpenAPI |
| `@RequirePermission('modulo:accion')` | Autorización fina, complementaria a `@Roles` (AND, no reemplazo) | El código debe existir YA en el catálogo de permisos de Identity y estar otorgado al rol/usuario — si no existe en ningún lado, la ruta siempre da `403`, sin aviso. Ver sección 9 |
| `@Public()` | Excluir un endpoint de todos los guards de auth | Health checks, endpoints explícitamente públicos del contrato (`x-roles: [publico]`) |
| `@CurrentUser()` | Inyectar el `JwtPayload` ya decodificado en el handler | — |
| `@SkipCsrf()` | Excluir un endpoint de `CsrfGuard` | **Casi nunca lo necesitas** — es para endpoints que abren una sesión nueva (login/register), y esos viven en Identity, no en tu microservicio. No lo copies "por si acaso" |

Ejemplo combinando rol + permiso, igual que en los microservicios ya existentes:

```ts
@Roles('administrador', 'administrativo')
@RequirePermission('scheduling:create')
@Post()
crear(@Body() dto: CrearCitaDto, @CurrentUser() user: JwtPayload) { ... }
```

## 7. Qué pasa en cada request, paso a paso

1. **`JwtAuthGuard`**: busca el token en el header `Authorization: Bearer <token>`; si
   no está, cae a la cookie `access_token`. Verifica firma/expiración localmente
   (`JWT_SECRET`) y después confirma contra Redis que la sesión de ese `jti` sigue
   vigente (**whitelist**: si la key no está en Redis —nunca existió, expiró, o se
   cerró sesión con logout— el token es inválido, sin importar que la firma sea
   correcta). Puebla `request.user` con el `JwtPayload` si todo pasa.
2. **`RolesGuard`**: lee `request.user.roles` y lo compara contra los códigos de
   `@Roles(...)` del handler. Sin llamada a red ni a base de datos.
3. **`PermissionsGuard`** (si lo registraste): lee `request.user.permissions` y lo
   compara contra el código de `@RequirePermission(...)`. Tampoco llama a red/BD — el
   cálculo ya lo hizo Identity al emitir el token.
4. **`CsrfGuard`**: si el request trae la cookie `csrf_token`, exige que el header
   `X-CSRF-Token` (el frontend lo lee de esa misma cookie, que no es httpOnly a
   propósito) coincida, en cualquier método no-`GET`. Si el cliente se autentica por
   header en vez de por cookie (Postman, otro microservicio), esta cookie nunca está
   presente y el guard no aplica.

Si un endpoint no tiene `@Roles`/`@RequirePermission`, solo pasa por `JwtAuthGuard` (y
`CsrfGuard` si aplica) — queda protegido por sesión válida, pero abierto a cualquier
rol autenticado. Decide esto a propósito, no por omisión.

## 8. Códigos de error que vas a ver (no son bugs)

| Código | Cuándo | Qué significa |
|---|---|---|
| `401` | Sin token, token con firma inválida, token expirado, o sesión no encontrada en Redis (revocada/expirada/nunca existió) | Credencial inválida. `JwtAuthGuard` no distingue el motivo exacto por diseño (no filtrar por qué exactamente falló). |
| `403` | Rol o permiso insuficiente, o `CsrfGuard` con header/cookie que no coinciden | Autenticado, pero sin autorización para esta operación puntual |
| `503` (`AUTH_BACKEND_UNAVAILABLE`) | Redis no responde o no está configurado | **No es un token inválido** — es una caída de infraestructura. Si ves esto en tus logs, el problema es la conexión a Redis, no tu lógica de negocio |

`503` viene de que `AccessTokenSessionReaderService`/`getSession` lanza
`RedisUnavailableError` cuando Redis no responde, y `JwtAuthGuard` la atrapa
específicamente para no confundir "no pude verificar" con "session inválida". Si tu
microservicio necesita usar el reader manualmente en algún punto (raro, normalmente
`JwtAuthGuard` ya hace esto por vos), tenés que manejar ese mismo error tú mismo — no
lo trague silenciosamente.

## 9. Permisos: qué puedes hacer tú y qué requiere coordinación con Identity

`@RequirePermission('scheduling:create')` **no crea nada** — solo verifica un código
que ya debe existir en el catálogo global de Identity (`Module`/`Permission`) y estar
otorgado al rol correspondiente en el tenant. Si tu microservicio necesita un permiso
nuevo:

1. Coordina con quien mantenga Identity para que el código se agregue al catálogo
   semilla y se otorgue al rol que corresponda.
2. Recién ahí agrega el `@RequirePermission(...)` correspondiente en tu controller.

Agregar el decorador antes de que el código exista en Identity no rompe nada de forma
visible en desarrollo si nunca se llama esa ruta con ese rol, pero en producción esa
ruta devolverá `403` siempre, para cualquier usuario, sin excepción — es un error
silencioso fácil de no notar hasta que alguien reporta que "no puede hacer nada" en esa
pantalla.

## 10. Lo que tu microservicio NUNCA debe hacer

- **No emitir ni limpiar las cookies de sesión** (`access_token`/`refresh_token`/
  `csrf_token`) — eso es exclusivo de Identity. Tu servicio solo las lee.
- **No importar `AccessTokenSessionWriterService`** — el reader (`getSession`, usado
  internamente por `JwtAuthGuard`) es lo único que necesitas; el writer es
  exclusivo de Identity al emitir/revocar tokens.
- **No levantar tu propia instancia de Redis aislada** para la sesión — tiene que ser
  la misma que usa Identity, porque la sesión es un contrato entre servicios, no un
  cache propio de cada uno.
- **No confiar en un `tenantId` que venga del body/query en vez del JWT** para scopear
  tus queries (ver sección 5).
- **No inventar código de permiso nuevo sin coordinarlo con Identity primero** (ver
  sección 9).

## 11. Checklist de verificación end-to-end

Antes de dar por integrado el flujo de auth, verifica estos 7 casos contra tu servicio
corriendo de verdad (con Redis real, no mockeado) — arma JWTs a mano firmados con el
mismo `JWT_SECRET` para los casos que lo requieran:

1. Sin token → `401`.
2. Token expirado → `401`.
3. Token con firma inválida (`JWT_SECRET` distinto) → `401`.
4. Token válido pero sin sesión en Redis (nunca se escribió, o se borró por logout) →
   `401`.
5. Token válido + sesión válida, pero rol incorrecto en una ruta con `@Roles(...)` →
   `403`.
6. Token válido + sesión válida + rol/permiso correcto → `200`/`201`, con
   `@CurrentUser()` poblado correctamente.
7. Si tu servicio acepta cookies: request con cookie `csrf_token` presente pero sin
   header `X-CSRF-Token` (o con uno que no coincide) en un método no-`GET` → `403`;
   con el header correcto → pasa.

Si los 7 casos dan el resultado esperado, la integración de sesión/autorización está
correcta.
