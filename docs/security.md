# Seguridad y privacidad

## Garantías y límites locales

Las fotografías permanecen en IndexedDB y se sincronizan con Supabase cuando la cabina está habilitada. Cualquier persona con acceso al perfil de navegador puede acceder a los datos locales y a la sesión Auth del dispositivo. El selector de sesiones local no es una frontera de autorización. Proteger físicamente la laptop, su cuenta y los respaldos.

Se usa React para presentar textos, sin HTML arbitrario. No hay recursos externos, analítica ni telemetría de la aplicación. El HTML establece `Referrer-Policy: no-referrer` mediante meta; el servidor de desarrollo también envía esa cabecera. No se incluyen datos privados en URLs. El frontend no publica una API de sesiones.

IndexedDB usa UUIDs y claves por sesión; las operaciones de confirmación validan pertenencia, tipos y posiciones. Esto evita mezclas accidentales, no protege frente a alguien que controle el navegador. La aplicación no cifra datos locales. Los backups contienen fotografías privadas: transferirlos a medios controlados y verificar antes de borrar cualquier copia.

Persistencia del navegador no garantiza supervivencia frente a borrado manual, averías, perfiles temporales o almacenamiento lleno. Confirmar escritura local no equivale a respaldo externo. No se elimina ninguna sesión confirmada automáticamente.

## Controles del backend de Fase 2

Bucket privado y política restrictiva adicional, cinco tablas con RLS y permisos revocados a anon/authenticated, RPC solo para service_role. Validación real JPEG mediante decodificación, hash SHA-256, límites de bytes/píxeles y cinco posiciones inmutables. Rate limits por dispositivo en PostgreSQL, CORS de orígenes exactos y respuestas no-store/no-referrer. El frontend solo contiene URL y clave pública. La clave privilegiada está en el entorno de Edge, no se envía al navegador ni se registra en logs.

Dispositivo: cuenta Auth exclusiva y revocable, vinculada a un evento; solo crea/sube sus sesiones y consulta su progreso. No recibe imágenes remotas, rutas ni listado general. `Auth.getUser` verifica cada JWT contra el servidor; cada RPC comprueba que el dispositivo siga habilitado y sea propietario. El filtro de JWT legacy del gateway queda desactivado por compatibilidad con claves asimétricas; no reemplaza ni elimina la validación en la función. Registro, renovación y revocación: `backend.md`.

Los límites de aplicación requieren identidad válida. Las solicitudes inválidas pueden consumir invocaciones/Auth antes del rechazo; no son una protección global contra DDoS. Monitorear cuotas del proveedor. Una escritura en curso al revocar puede persistir un objeto, pero no confirmar ready. Los hashes prueban integridad e idempotencia, no autenticidad del contenido: una cabina comprometida puede subir JPEG arbitrarios dentro de sus límites.

## Requisitos de fases posteriores

Invitados: token criptográfico con al menos 128 bits de entropía; solo hash en PostgreSQL. Validación en Edge Function antes de emitir URLs firmadas breves. Evitar registrar tokens en servidor, proxy y analítica. No enumerar sesiones públicamente.

El QR es una credencial de posesión: un enlace reenviado concede el mismo acceso. Revocar impide nuevas autorizaciones; una URL firmada ya emitida puede seguir siendo válida hasta su expiración. Ninguna revocación recupera archivos ya descargados. No representa autenticación personal.

Administración (Fase 4): Supabase Auth y comprobación de rol en cada operación sensible. No confiar en rutas, controles visuales ni metadatos modificables por el cliente. Actualmente todos los usuarios del navegador, incluso un futuro administrador, tienen denegado el acceso directo a tablas/RPC. Los tests comprueban esa denegación y el aislamiento de dispositivos; el flujo administrativo positivo se probará al implementarlo.
