# CLAUDE.md

Contexto de diseño de `@aureon/redis-lib` para quien lo mantenga o lo integre en un microservicio AUREON nuevo (Scheduling, Inventory & Catalog, Assistant, Notification — ninguno existe todavía como repo real en este workspace). El **uso** (API, ejemplo de `forRootAsync`) está en `README.md`; este archivo es el **por qué** de las decisiones, no lo repitas ahí.

**Nombre (decisión 2026-08-23):** el paquete se llamó `@aureon/redis-client` hasta que se le dio repo propio en GitHub (`AUREON-Tecnologia/aureon-redis-lib`) — se renombró a `@aureon/redis-lib` porque "client" podía confundirse con el módulo de negocio `clientes`, cuando en realidad esta librería es transversal a todos los microservicios (auth, permisos, sesiones — nada específico de un dominio). `aureon-auth-back` sigue vendorizando una versión anterior bajo el nombre viejo (`file:vendor/aureon-redis-client-0.8.0.tgz`) — no se migró en la misma ronda, ver "Consumidores actuales" abajo.

## Idioma en el código — TODO en inglés (decisión 2026-08-15)

Identificadores y comentarios de código van siempre en inglés, incluso cuando el término de negocio/dominio venga en español — se traduce al escribir el código. Ya es el estado de este paquete (`RolesGuard`, `JwtAuthGuard`, etc.). Fuera de esta regla, en general: valores de datos de cara al usuario/API (`mensaje`, `codigo`) y la documentación Markdown.

**Excepción (2026-08-15):** el valor de `mensaje` en `JwtAuthGuard` y `CsrfGuard` está en **inglés**, no español — son errores de infraestructura de sesión (token inválido, CSRF), alcanzables desde `/auth/*` de `aureon-auth-back`, que ya no expone nada en español (ver su `CLAUDE.md`). `RolesGuard`/`PermissionsGuard` (locales a auth-back, no exportados desde este paquete para lo específico de RBAC) siguen en español porque solo los alcanzan endpoints de `rbac.yaml`/`clientes.yaml`, todavía no traducidos. Efecto secundario a tener en cuenta: como `JwtAuthGuard`/`CsrfGuard` son compartidos, un `401`/`403` de sesión en `workshop-clients-back` (`clientes.yaml`, español) también sale en inglés — es una inconsistencia real y conocida, aceptada porque separar el idioma del mensaje por servicio consumidor requeriría hacer el guard configurable, lo cual no se justificaba solo para esto.

## Decisión de arquitectura (dada, no se reabre)

Redis es infraestructura compartida, no un microservicio intermedio: cada servicio AUREON se conecta directo via `ioredis` a la misma instancia/cluster. Esta librería existe solo para no duplicar la conexión + el contrato de sesiones de access token en cada repo — no agrega una capa de red.

## Whitelist, no blacklist (decisión reabierta a partir de v0.3.0)

**Historial:** hasta la v0.2.x esta librería usaba un patrón blacklist — el JWT era la fuente de verdad primaria (firma/expiración validadas localmente) y Redis solo detectaba revocaciones anticipadas por logout, con fail-open ante caída de Redis (sin Redis, los tokens seguían funcionando hasta su expiración natural). Esa sección decía explícitamente "dada, no se reabre".

**Se reabrió a pedido explícito del usuario.** Prioridad: invalidación determinística e inmediata de sesiones (logout, respuesta a incidentes de seguridad) por encima de la disponibilidad que daba el fail-open. Desde v0.3.0 el patrón es **whitelist**: Identity escribe el access token completo en Redis al emitirlo (`AccessTokenSessionWriterService.saveSession`, TTL = su expiración) y todos los servicios (incluido Identity) confirman la sesión contra Redis en cada request (`AccessTokenSessionReaderService.getSession`). Si la key no está —nunca existió, expiró por TTL, o se borró en logout— el token es inválido; no se distingue el motivo.

**Trade-off aceptado, no un descuido:** Redis pasa a ser parte del camino crítico de *toda* autenticación del ecosistema. Si Redis cae, cae la autenticación de todos los microservicios simultáneamente — es la consecuencia directa de que sea la fuente de verdad. Por eso el fail-open se invirtió a **fail-closed**: `AccessTokenSessionReaderService.getSession` y `AccessTokenSessionWriterService.saveSession` **lanzan** `RedisUnavailableError` ante un error de conexión (o Redis no configurado) en vez de tragárselo — nunca se interpreta silenciosamente "no se pudo consultar" como "sesión válida" ni como "sesión no encontrada". `JwtAuthGuard` atrapa ese error específico y responde `503` (`AUTH_BACKEND_UNAVAILABLE`), distinto del `401` de un token realmente inválido, para que una caída de Redis sea visible como incidente de infraestructura y no se confunda con credenciales inválidas en logs/monitoreo.

`AccessTokenSessionWriterService.saveSession` también falla duro (nunca se degrada): un login/refresh cuyo token no se pudo registrar en Redis no debe devolver `200` con un access token que ningún consumidor podrá validar después. `deleteSession` (logout) es la única operación que sigue siendo best-effort/no lanza — el refresh token ya se invalidó en Postgres antes de llegar ahí, así que el cierre de sesión no depende de Redis, y si Redis está caído en ese momento tampoco puede validar nadie de todas formas.

**Fuera de este cambio:** el refresh token opaco de cada microservicio (ej. `user_sessions.refresh_token_hash` en `aureon-auth-back`) no se tocó — sigue viviendo donde vivía. Esta librería solo gestiona el access token JWT de vida corta.

## Por qué el namespace de la sesión es fijo y no usa el `keyPrefix` de cada servicio

`RedisModule.forRoot({ keyPrefix })` existe para que cada servicio tenga su propio espacio de keys (`RedisService.get/set/del`) sin colisionar entre sí — pensado para cache/datos propios de cada uno, no para las sesiones de access token. Las sesiones son un **contrato entre servicios** (Identity escribe, todos leen la misma key), así que usan el namespace fijo `identity:access-token:<jti>` (`access-token-session.constants.ts`), sin importar qué `keyPrefix` configuró el lector. Si en el futuro cada tenant o cada tipo de token necesitara su propio namespace, ese es un cambio de contrato que hay que coordinar con todos los lectores, no algo configurable en silencio.

## Por qué el paquete no está publicado (mitigado, no resuelto)

Los microservicios AUREON viven en repos separados (no es un monorepo Nx/Turborepo). Publicar esto a un registro real (Azure Artifacts u otro) requiere decidir feed/scope de la organización — decisión pendiente. Dos mitigaciones conviven hoy, no una sola:

- `aureon-auth-back` (consumidor de antes de este repo) vendoriza un tarball compilado (`npm pack`) dentro de su propio repo (`vendor/aureon-redis-client-<version>.tgz`, todavía bajo el nombre viejo del paquete — ver `vendor/README.md` de ese repo) en vez de depender de `file:../aureon-redis-client` (carpeta hermana que no existe fuera de esta máquina y rompía builds aislados en Railway/CI).
- Consumidores nuevos (desde que este repo existe en GitHub) instalan directo como dependencia de git apuntando a un tag (`github:AUREON-Tecnologia/aureon-redis-lib#v0.8.0`) — sin `.tgz`, sin copiar nada a mano: `npm install` clona el tag y corre `prepare`/`build` solo. Ver `README.md`, sección "Estado".

Cuando se decida el registro: publicar con `npm publish` y cambiar la dependencia de `file:`/`github:` a la versión publicada en cada repo consumidor — no hay otro cambio de código necesario.

## Escritura vs lectura no está forzada en tiempo de ejecución

`AccessTokenSessionWriterService` y `AccessTokenSessionReaderService` son clases separadas (el reader no tiene `.saveSession()`) para que sea obvio en un code review si un servicio que no es Identity intenta escribir, pero nada a nivel de código impide que otro servicio importe el writer si quisiera — es una convención de código, no un control de acceso real. Si eso se vuelve un problema, la opción es mover `AccessTokenSessionWriterService` a un paquete separado que solo `aureon-auth-back` instale.

## RolesGuard / @Roles() (desde v0.4.0)

Hasta v0.3.0 esta libreria solo cubria autenticacion (JWT + sesion Redis); la
autorizacion por `x-roles` vivia duplicada a mano en cada repo consumidor
(`aureon-auth-back` tenia su propia copia en `src/common/{guards,decorators}`;
`workshop-clients-back` no tenia ninguna implementacion — brecha real, ver
`ANALISIS-matriz-permisos-auth.md` en el repo de contratos). `RolesGuard`
lee `request.user.roles` (poblado por `JwtAuthGuard`) contra los codigos
declarados en `@Roles(...)` — sin llamada a red ni a BD, igual de stateless
que la verificacion de firma del JWT. Los codigos son `string` libres, no un
enum cerrado: un tenant puede definir roles propios via el modulo `rbac` de
Identity, y ese codigo debe poder pasarse a `@Roles(...)` igual que los 5
roles legacy sembrados por tenant.

`aureon-auth-back` migro su copia local a este guard compartido en la misma
ronda que se agrego aqui, para no mantener dos implementaciones del mismo
comportamiento — ver su `CLAUDE.md`.

## PermissionsGuard / @RequirePermission() (desde v0.5.0) — permisos finos sin llamada a BD por request

`JwtPayload` gano un campo obligatorio `permissions: string[]` — Identity lo calcula una vez en
`emitirSesion()` (login/register/refresh, ya calculaba esto para el body de `LoginResponse`; ahora
tambien lo firma dentro del JWT) y lo embebe en el token. `PermissionsGuard` lee ese array ya
decodificado, sin tocar red ni base de datos — misma naturaleza stateless que `RolesGuard`.

**Por que no un endpoint/gRPC "check permission" ni una cache Redis de permisos con invalidacion
activa:** ninguno de los dos existe hoy, ambos agregarian una dependencia de red o infraestructura
nueva por request, y el sistema ya acepta una ventana de staleness equivalente para `roles` (un
cambio de rol solo se refleja en el proximo refresh del access token, no hay push de invalidacion
de sesion activa). Extender esa misma ventana a `permissions` es consistente con el diseño
existente — ver el analisis en `ANALISIS-matriz-permisos-auth.md` (repo de contratos), seccion
"Diseño recomendado" del plan de implementacion, para el razonamiento completo.

**Relacion con `RolesGuard`:** son complementarios, no alternativos. `RolesGuard` sigue siendo el
mecanismo de compatibilidad con `x-roles` de los contratos (los 5 roles legacy). `PermissionsGuard`
es la unica via que sigue funcionando cuando un tenant define un rol propio via el modulo `rbac` de
Identity — ese rol no lo reconoce `x-roles`, pero los permisos que tenga asignados si viajan en el
JWT igual que para cualquier otro rol.

**Precaucion para quien decore un controller:** `@RequirePermission('codigo')` solo tiene efecto si
ese codigo existe en el catalogo de permisos de Identity y esta otorgado al rol/usuario en cuestion
— si el codigo no existe en ningun lado, la request nunca pasara el chequeo (siempre `403`), no hay
fallback silencioso. `aureon-auth-back` encontro exactamente este problema al activar su propio
`PermissionsGuard` local en la Fase 3 del plan (los codigos `rbac-core` no estaban sembrados) — ver
su `CLAUDE.md`, seccion "Permisos granulares en /rbac/*".

## `activeModules` en JwtPayload (desde v0.7.0) — que modulos ve un usuario sin ser admin

Antes de esto, la unica forma de saber que modulos estaban activos (licenciados) para un tenant era
`GET /rbac/modulos-tenant` en Identity, protegido con `@Roles('administrador')` — un usuario comun
no tenia forma de saberlo, y el frontend no podia decidir que menus/rutas mostrar sin asumir. Ahora
`JwtPayload.activeModules: string[]` (codigos de `Module.code`) viaja igual que `permissions` — lo
calcula Identity una vez en `emitirSesion()` y lo firma dentro del JWT, mismo mecanismo, mismo
trade-off de staleness (se actualiza en el proximo login/refresh).

De paso se cerro un hueco real: el calculo de `permissions` (`permisosEfectivos()` en
`aureon-auth-back`) no verificaba si el modulo dueño de un permiso estaba activo para el tenant —
un permiso via rol seguia siendo efectivo aunque el tenant hubiera desactivado su modulo. Ahora
ambos calculos (`permissions` y `activeModules`) son consistentes entre si: un permiso solo aparece
en `permissions` si su modulo tambien aparece en `activeModules`. Ver el `CLAUDE.md` de
`aureon-auth-back`, seccion "Modelo de tokens", para el detalle de la query.

Esta libreria **no calcula nada** de esto — solo transporta el campo en `JwtPayload`; ningun guard
de este paquete lo usa todavia (a diferencia de `permissions`/`RolesGuard`), es informativo para que
el consumidor (frontend, u otro microservicio) decida que mostrar/habilitar.

## Autenticación por cookie + CSRF (desde v0.6.0)

Motivación: el frontend dejó de poder guardar el JWT en JS (localStorage). El diseño asume que
`aureon-auth-back`, `workshop-clients-back`, el futuro monolito `taller`, y el frontend viven bajo
subdominios de un mismo dominio raíz (ej. `auth.aureon.app`, `clientes.aureon.app`,
`app.aureon.app`) — **no** en dominios Railway sueltos sin relación entre sí (los dominios actuales
de Railway son transitorios). Bajo un dominio compartido, una cookie con `Domain=.aureon.app` que
pone Identity es visible automáticamente en los otros subdominios — no hace falta ningún componente
intermediario (BFF/gateway); cada servicio la valida de forma independiente, igual que ya validan
el JWT de forma independiente hoy (secreto compartido). El valor del dominio es configurable por
env var en cada consumidor, no hardcodeado en esta librería.

- **`JwtAuthGuard`** (extendido, no un guard nuevo): si no hay header `Authorization`, cae a leer
  la cookie `access_token` (`ACCESS_TOKEN_COOKIE_NAME`, exportada desde `cookies/cookie.constants.ts`).
  El header sigue teniendo precedencia — consumidores no-browser (Postman, scripts) no se ven
  afectados. Requiere `cookie-parser` (u otro middleware que popule `request.cookies`) corriendo
  antes del guard; si el consumidor no lo tiene, el fallback simplemente nunca encuentra nada y el
  comportamiento es igual al de antes de v0.6.0.
- **`CsrfGuard`** (nuevo): double-submit cookie contra `csrf_token` (no-httpOnly, para que el
  frontend la pueda leer) y el header `X-CSRF-Token`, solo en métodos no-`GET`, solo si la cookie
  `csrf_token` está presente en la request (si no está, el cliente no está en el flujo de sesión por
  cookie, y ahí CSRF no es un riesgo real). Necesario porque mover la autenticación de header a
  cookie le quita al sistema la inmunidad a CSRF que tenía gratis con `Authorization: Bearer`
  (un sitio de terceros no puede setear ese header en una request cross-site, pero el navegador sí
  manda cookies automáticamente).
  - **`@SkipCsrf()`** (nuevo, >=0.8.0, `cookies/skip-csrf.decorator.ts`): excluye un endpoint del
    chequeo sin importar el estado de sus cookies — mismo patrón que `@Public()`/`JwtAuthGuard`
    (`Reflector.getAllAndOverride` sobre `CSRF_EXEMPT_KEY`), pero deliberadamente un decorator
    aparte, no una reutilización de `@Public()`: "sin autenticación" y "exento de CSRF" son
    conceptos distintos, y conflarlos podría morder a futuro a un endpoint público que sí necesite
    CSRF. Usado en `aureon-auth-back` en `POST /auth/login` y `POST /auth/register` — hallazgo
    2026-08-16: una `csrf_token` vieja (no-httpOnly, ~30 min de vida, sobrevive a que el usuario
    cierre la sesión sin hacer logout) que el cliente reenvía automáticamente bloqueaba con `403`
    un login/register legítimo aunque esos endpoints sean públicos, porque `CsrfGuard` solo miraba
    "¿hay cookie `csrf_token`?", nunca "¿este endpoint la necesita?". `login`/`register` **abren**
    una sesión, no usan una existente, así que el estado de cookies previo no debe poder
    bloquearlos nunca — `refresh`/`logout` sí deben seguir exigiendo CSRF cuando hay sesión por
    cookie, no llevan este decorator.
- Esta librería **no emite** las cookies — solo las lee/valida. Identity (`aureon-auth-back`) es el
  único que las setea (login/register/refresh) y las limpia (logout), usando los mismos nombres de
  `cookie.constants.ts` como fuente de verdad compartida. Ver su `CLAUDE.md` para el detalle de
  atributos (`Secure`, `SameSite=Lax`, `Domain`/`Path` por cookie) y el flujo completo.

## Consumidores actuales

- `aureon-auth-back` (Identity): único escritor de sesión Redis (whitelist, >=v0.3.0) y único emisor de cookies (>=v0.6.0). Ver su `CLAUDE.md`, secciones "Modelo de tokens" y "Autenticación por cookie".
- `workshop-clients-back`: solo lector, guards globales (`JwtAuthGuard` + `RolesGuard` + `PermissionsGuard` + `CsrfGuard`, >=v0.6.0). Migrado desde el stub local `libs/redis-client-stub` (blacklist v0.2.x, fail-open) — ahora depende de Redis para servir cualquier endpoint protegido (whitelist, fail-closed). Ver su `CLAUDE.md`, sección "Autenticación + autorización".
