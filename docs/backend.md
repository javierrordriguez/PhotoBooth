# Backend de Fase 2

## Instalación reproducible

Requisitos: proyecto Supabase, CLI oficial autenticada en tu terminal y Deno 2 para verificar las funciones. No enviar contraseñas ni tokens de administración al chat. La URL y clave `sb_publishable_` pertenecen a `.env.local`; las claves privilegiadas existen únicamente en el entorno de Edge Functions.

Desde la raíz del proyecto:

```sh
supabase login
supabase link --project-ref rcrxhynbmqmugbktfigg
supabase db push
supabase secrets set ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4173
supabase functions deploy device-api
```

La migración `202610140001_booth.sql` crea cinco tablas con RLS, RPC restringida al servidor y bucket privado `booth-photos`. En este proyecto ya se aplicó mediante SQL Editor: no ejecutarla otra vez. Antes del primer `db push` con CLI, revisar el esquema y registrar ese hecho con `supabase migration repair 202610140001 --status applied`. Para un proyecto nuevo, aplicar normalmente la migración.

Alternativa sin CLI: ejecutar la migración en SQL Editor y desplegar `supabase/dashboard/device-api.ts` como `index.ts` de la función `device-api`. Este archivo se genera con `node scripts/build-edge.mjs`; no editarlo manualmente. Agregar `ALLOWED_ORIGINS` en Edge Functions → Secrets. Configurar Verify JWT with legacy secret desactivado: la función exige Bearer y valida el JWT directamente mediante `Auth.getUser`, luego comprueba el dispositivo habilitado. No se acepta una clave pública como identidad de usuario. Esto permite JWT firmados con las claves asimétricas actuales.

Supabase suministra `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` al entorno de ejecución. No copiarlas al frontend. `ALLOWED_ORIGINS` contiene únicamente orígenes exactos separados por coma, sin barra final ni comodín. Agregar el origen HTTPS final cuando se autorice el hosting; CORS no reemplaza autenticación.

## Registro inicial de la cabina

1. En Authentication → Users → Add user, crear una cuenta de correo/contraseña exclusiva del dispositivo. El operador introduce la contraseña directamente en Supabase y la conserva en su gestor. No usar la cuenta administrativa ni compartir credenciales con invitados.
2. Obtener su UUID visible en Authentication. El evento Tami del 24/10/2026 ya está creado; obtener su UUID con `select id,name,event_date from public.events;`.
3. En SQL Editor, insertar el dispositivo usando esos UUID reales:

```sql
-- Reemplazar los marcadores; no ejecutarlos literalmente.
insert into public.devices(event_id,auth_user_id,name,enabled)
values ('UUID_EVENTO','UUID_USUARIO_AUTH','Cabina Tami',true);
```

4. Abrir la app en el origen que se usará durante el evento. Configuración → Dispositivo y sincronización → iniciar sesión con esa cuenta. No guardar la contraseña en código. El SDK conserva la sesión y renueva el access token con el refresh token.
5. Configurar también la fecha local 24/10/2026 antes de capturar: la composición usa una copia local de la configuración, no sustituye automáticamente los ajustes por los del servidor.
6. Capturar una sesión de prueba. Deben aparecer cinco archivos confirmados. En SQL: `select id,status from public.photo_sessions;`. Inspeccionar las cinco filas de `photos` y los objetos desde Storage con acceso de organizador.

No hay registro anónimo de dispositivos ni alta desde la aplicación. Un usuario Auth sin fila habilitada en `devices` no puede operar. Deshabilitar altas públicas de Auth desde el panel es una medida adicional recomendable si no se necesitan otras aplicaciones en este proyecto.

## Renovación y revocación

La renovación normal la realiza Supabase Auth. Si la sesión vence o se revoca, volver a iniciar sesión; los trabajos bloqueados se pueden reintentar. Para revocar la laptop, ejecutar `update public.devices set enabled=false where id='UUID_DISPOSITIVO';`. Cada operación verifica ese estado. Una escritura ya en curso puede terminar en Storage, pero la confirmación posterior vuelve a verificar permisos; no se publica la sesión.

Para reemplazar credenciales, el operador restablece la contraseña en Auth, revoca las sesiones desde Auth y vuelve a conectar la laptop. No asignar el mismo registro a otro evento si tiene sesiones pendientes: sus vínculos son inmutables. Crear un dispositivo distinto y respaldar los pendientes antes de migrar de equipo. Desconectar en la app elimina la sesión Auth local y la vinculación activa, no las fotos ni los trabajos.

## Respaldo y límites

Exportar ZIP local regularmente; abrirlo y copiarlo a otro medio. El ZIP no contiene contraseñas ni sesiones Auth. Respaldar PostgreSQL y descargar los objetos del bucket con herramientas administrativas: el respaldo de base de datos por sí solo no incluye los archivos Storage. Todavía no hay exportación administrativa automática; pertenece a Fase 4.

Límites por archivo: JPEG real, 12 MiB, 12 megapíxeles, dimensiones hasta 8192 px; tira 1200×3600. Cinco archivos por sesión. Límite por dispositivo: 120 comandos/minuto, 120 sesiones/hora y 1000 sesiones totales por defecto. Una operación HTTP puede consumir varios comandos. Reintentos exponenciales hasta cinco minutos; al recibir 429 se espera al menos un minuto. No se reduce ni modifica un original para superar límites: se conserva local y se informa el error.

El decodificador tiene además un presupuesto de 192 MiB: una imagen especialmente costosa puede rechazarse aun dentro del límite de píxeles; se conserva su original local. Se prueban la tira completa y originales 4K. La expiración de 30 días controla acceso/sincronización, no borra objetos automáticamente. Definir retención y eliminación con el organizador antes de producción. El bucket y las tablas no son accesibles directamente desde el navegador.

## Ensayo de aceptación remoto pendiente

Con cuenta habilitada: subir cinco archivos, cortar red durante una subida, recargar y comprobar que retoma sin duplicar; deshabilitar el dispositivo y comprobar rechazo; reactivar y reintentar; verificar que no puede consultar otra sesión. Los tests locales automatizados cubren estos contratos, pero no sustituyen el ensayo en el servicio desplegado y la laptop física.

Referencias: [autenticación de Edge Functions](https://supabase.com/docs/guides/functions/auth), [claves de firma](https://supabase.com/docs/guides/auth/signing-keys).
