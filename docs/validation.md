# Verificación de Fases 1 y 2

Entorno: Windows, Node 24.19.0, pnpm 11.25.0 y Chrome instalado. Fecha: 2026-10-14.

- TypeScript estricto: sin errores.
- ESLint: sin errores.
- Vitest: 34 pruebas en 6 archivos. Estados/configuración, composición, aislamiento, idempotencia, recuperación de IndexedDB, migración real v1→v2, rollback ante cuota, sincronización tras respuesta perdida, rechazos por dispositivo/evento, reintentos y validación de JPEG. Se verifican tira 1200×3600 y original 4K dentro del presupuesto de memoria del decodificador. PostgreSQL real mediante PGlite ejecuta la migración y comprueba transiciones, roles, RLS, límites y revocación. Auth y Storage se simulan en las pruebas de la Edge Function.
- Deno 2: check correcto del entrypoint modular y de la variante generada para el dashboard.
- Build Vite: bundle de producción generado.
- Playwright: flujo completo con repetición, captura sin red, confirmación, ZIP, recuperación, separación de sesiones; recuperación de borrador y retorno automático; permiso denegado, adaptación móvil y rutas informativas.
- Revisión visual de capturas de escritorio y móvil: sin desbordamiento horizontal en 390 px y tira completa visible en escritorio.

## Incidencias del entorno

La instalación inicial requirió permiso de red. El sandbox de Windows impidió la resolución de rutas antecesoras por esbuild al cargar configuración y al preoptimizar dependencias de desarrollo. Se utiliza carga nativa de configuración y preview del bundle para validar, sin ampliar acceso al sistema.

El dispositivo falso nativo de Chrome funcionó en corridas individuales, pero presentó un fallo de arranque del navegador y errores intermitentes `NotFoundError` al reabrir cámara. Los E2E reproducibles simulan el origen de MediaDevices con un MediaStream real de Canvas de 1920 × 1080. Esto no certifica compatibilidad con la webcam física.

## Pendientes de verificación manual

Webcam real y cambio entre dispositivos físicos; pantalla completa y pantalla táctil real; cuota real del equipo y carga de cientos de sesiones; apertura y copia de ZIP en otro dispositivo; impresión física. El funcionamiento local sin red se prueba una vez cargada la app, no una instalación PWA offline.

## Supabase remoto, 14/10/2026

Proyecto `rcrxhynbmqmugbktfigg`: migración aplicada mediante SQL Editor, cinco tablas con RLS y bucket `booth-photos` con public=false verificados. Evento Tami, fecha 24/10/2026. Función `device-api` desplegada y ALLOWED_ORIGINS limitado a 127.0.0.1:5173 y :4173. La función valida JWT vía Auth.getUser; el filtro legacy del gateway está apagado.

`node scripts/check-remote.mjs`: pasó. Comprueba 401 sin credenciales, con token inválido y con clave pública como Bearer; preflight autorizado 204; origen ajeno 403 sin cabecera CORS; no-store; denegación de acceso anónimo a las cinco tablas. No crea usuarios ni sube fotos.

Cuenta de cabina creada por el operador y dispositivo Cabina Tami habilitado con su autorización. Pendiente: iniciar sesión desde la app y probar subida real de cinco archivos, interrupción y recuperación contra Supabase. No se da por completada la aceptación remota hasta ese ensayo. Tokens de invitados y autorización administrativa positiva se implementarán y probarán en sus fases.
