# Arquitectura y decisiones

## Fases 1 y 2

Una SPA con tres rutas. `/booth` contiene captura local y sincronización; `/admin` y `/s/:token` son informativas hasta sus fases. El formulario de configuración y la biblioteca son herramientas locales del operador, no el panel administrativo autenticado de Fase 4.

React presenta y coordina. `camera` administra streams y captura a las dimensiones nativas del video; `composition` recorta únicamente al dibujar la tira; `persistence` encapsula las transacciones Dexie; `sessions` valida datos y transiciones; `shared/download` exporta. No se agregaron gestor de estado, servidor, librería de iconos ni servicios abstractos. fflate implementa el requisito ZIP.

## Estados

Interfaz: `welcome → countdown → capturing`, repetido cuatro veces, luego `review → saving → done → welcome`. Cancelar vuelve a revisión si hay fotos o a bienvenida si no hay ninguna. Un error de guardado al confirmar vuelve a revisión y conserva las imágenes en memoria. Las transiciones inválidas fallan explícitamente.

Estado local: `draft → pending`; `pending` significa confirmada localmente, nunca subida. La cola usa `pending → syncing → synced`, con `retry` para errores temporales y `blocked` para errores que requieren intervención. Un reinicio recupera trabajos `syncing`. Estado remoto: `pending → uploading → ready`; `pending/uploading → failed → uploading`. Un trigger SQL prohíbe otras transiciones y exige cinco archivos confirmados para llegar a ready. Revocación y vencimiento son atributos independientes.

## IndexedDB, versión 2

- `sessions`: UUID, fecha ISO UTC, estado y copia de la configuración del evento usada para esa captura.
- `photos`: clave compuesta `[sessionId+position]`, Blob JPEG, tipo y dimensiones. Originales 1–4; tira 0.
- `settings`: configuración local con id `event`.
- `syncJobs`: identificador de sesión, vínculo inmutable proyecto/evento/dispositivo, manifiesto SHA-256, intentos, progreso y próximo reintento.
- `connection`: vínculo activo del dispositivo. Las fotos previas no se adoptan automáticamente.

La versión 2 agrega tablas sin borrar las de versión 1. Una prueba abre una base v1 real y verifica la conservación de los blobs al migrarla.

Cada original se guarda antes de continuar. Confirmar valida cuatro originales de la misma sesión y guarda tira + estado en una transacción. Confirmar de nuevo no duplica archivos. Repetir solo elimina el borrador seleccionado. Reiniciar no borra nada. Un fallo de cuota conserva en memoria la última captura y los originales ya persistidos quedan en IndexedDB; cerrar la pestaña antes de respaldar una captura no guardada puede perderla.

UUID y posiciones son las claves de idempotencia. La cabina usa Supabase Auth y un registro `devices` habilitado. No se generan tokens de invitados en Fase 2.

## Sincronización y servidor

`src/sync` separa transporte, cola y presentación. Web Locks impide dos workers simultáneos en pestañas del mismo origen. Cada trabajo conserva su vínculo y manifiesto; rechaza un proyecto, evento o dispositivo diferente. Los reintentos reutilizan UUID y rutas deterministas, sin sobrescribir objetos. Una respuesta de subida perdida se resuelve comprobando el hash del objeto persistido. Finalizar descarga y verifica los cinco objetos antes de marcar ready. Nunca se borran copias locales como parte del flujo.

Una única Edge Function `device-api` recibe context/init/upload/status/finalize. `Auth.getUser` valida el JWT; una RPC exclusiva de service_role aplica autorización, cuotas y transiciones bajo bloqueo de la fila del dispositivo. RLS y revocación de permisos impiden el acceso directo de anon/authenticated. El dispositivo solo recibe progreso de sus sesiones, nunca URLs ni rutas de fotografías. El servidor decodifica JPEG y verifica tamaño, dimensiones y hash. PostgreSQL y Storage no comparten transacción: el protocolo de confirmación y los reintentos cubren esa separación; objetos huérfanos pueden requerir mantenimiento administrativo.

## Composición

1200 × 3600 px, cuatro ventanas de 1048 × 676, encuadre centrado tipo cover. Los originales no se transforman. Paletas lavanda, rosa y noche dorada; nombre y fecha configurables, tipografía del sistema y decoración Canvas. Recursos locales, sin CDN ni fuentes externas. Fecha vacía hasta que el operador la configure.

## Decisiones operativas

Vista previa espejada; archivos sin invertir. Se solicita resolución ideal 3840 × 2160, pero se conservan las dimensiones que negocie el hardware. Cámara detenida al revisar, finalizar o salir del componente. Timers cancelados al desmontar. URLs de imagen y bitmaps liberados. Intervalo 0–15 s, retorno 15–300 s.

## Próximas fases (no implementadas)

3. Tokens aleatorios, hash en PostgreSQL, Edge Function de validación, QR, descargas firmadas y ZIP.
4. Auth, roles administrativos comprobados por servidor, listado, exportación y revocación.
5. Pruebas integradas de aislamiento/autorización/sincronización, despliegue y ensayo general.

Cada fase requiere autorización. El esquema reserva token_hash nullable: NULL jamás concede acceso. event_admins prepara la relación futura pero no habilita endpoints administrativos en esta fase.
