# Photo Booth Tami · Fase 2

Cabina fotográfica con guardado local y sincronización con Supabase. React + TypeScript + Vite, Tailwind, React Router, Dexie, Canvas y MediaDevices. La galería/QR y el panel administrativo corresponden a las fases 3 y 4 y todavía no están implementados.

## Ejecutar

En esta laptop, con las dependencias ya instaladas, se puede abrir **`iniciar.cmd`** y visitar `http://127.0.0.1:4173/booth`. Mantener esa ventana abierta. El lanzador compila antes de iniciar y utiliza Node instalado o el runtime local de Codex disponible en este equipo. El puerto de este lanzador es 4173; las sesiones creadas en la vista de pruebas del puerto 5173 pertenecen a otro origen.

Requisitos: Node.js 24 LTS, pnpm 11 y Chrome o Edge actualizado. Chrome debe estar instalado para los E2E incluidos. Las versiones exactas resueltas están en `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abrir la dirección localhost que informa Vite, ruta `/booth`, y permitir la cámara. Para probar el bundle de producción:

```sh
pnpm build
pnpm preview
```

No abrir `index.html` mediante doble clic. Copiar `.env.example` a `.env.local` y configurar URL y clave pública para habilitar Supabase; sin ellas funciona el modo local. Nunca colocar claves secretas en variables VITE. `.npmrc` sitúa la caché de paquetes en `../../work/pnpm-store`; puede quitarse esa opción en otra ubicación antes de instalar.

La instalación remota y el registro de la laptop se explican en [docs/backend.md](docs/backend.md). En **Configuración → Dispositivo y sincronización**, conectar la cuenta exclusiva de la cabina. Las sesiones nuevas quedan vinculadas al evento; las anteriores solo se suben al pulsar **Vincular y subir sesiones locales**. El estado `synced` confirma los cinco archivos remotos; nunca se borran las copias locales automáticamente.

## Uso y verificación manual

1. En **Configuración**, introducir la fecha real, nombre, marco, intervalo y retorno automático; guardar. La fecha se deja vacía por defecto.
2. Solicitar almacenamiento persistente. Si el navegador lo rechaza, conservar igualmente respaldos externos frecuentes.
3. Seleccionar cámara. La vista previa es espejo; las imágenes guardadas no se invierten.
4. Comenzar: se toman cuatro fotos, cada una después de tres segundos. La pausa configurada se suma entre fotos.
5. Revisar y repetir la sesión completa, o confirmar. Repetir descarta explícitamente ese borrador; exportarlo antes si se desea conservarlo.
6. Descargar originales, tira de 1200 × 3600 o ZIP completo. Confirmar que cada original conserva las dimensiones reales entregadas por la cámara y que la tira contiene las cuatro fotos.
7. Iniciar otra sesión: no debe quedar ninguna foto anterior en pantalla. Comprobar también el retorno automático.
8. Recargar durante la revisión y abrir **Sesiones locales y respaldo**: recuperar el borrador, confirmar o exportar sus capturas. Las sesiones incompletas pueden respaldarse y repetirse, no completarse con fotos de otra sesión.
9. Una vez cargada, desconectar Internet y repetir el flujo. Para recargar sin Internet mantener el servidor local activo; no se incluye service worker ni instalación PWA.
10. Exportar todas las sesiones, abrir el ZIP fuera de la aplicación y comprobar los archivos.

## Validar

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Los E2E prueban el bundle de `dist` con Chrome y una cámara simulada mediante `Canvas.captureStream`. La reproducción, captura JPEG, composición, IndexedDB y descarga son reales; no requieren ni fotografían a una persona. Ejecutar `build` antes de ellos. El script `validate` agrupa tipos, lint, unitarios y build; los E2E se ejecutan por separado.

## Archivos principales

- `src/features/booth/Booth.tsx`: coordinación e interfaz.
- `src/camera/camera.ts`: apertura, captura completa, temporización y liberación.
- `src/composition/strip.ts`: encuadre no destructivo y tira.
- `src/sessions/model.ts`: tipos, estados y validación.
- `src/persistence/db.ts`: esquema IndexedDB v2, migración y transacciones.
- `src/sync`: autenticación limitada de dispositivo, cola durable y reintentos.
- `supabase/migrations`, `supabase/functions`: esquema, autorización y validación del servidor.
- `src/shared/download.ts`: descargas y ZIP con manifiesto por sesión.
- `tests/unit`, `tests/e2e`: pruebas automatizadas.
- `docs/architecture.md`, `docs/security.md`, `docs/deployment.md`, `docs/event-checklist.md`: decisiones y operación.

## Límites de esta entrega

Las fotos se conservan en el perfil y origen del navegador, y se respaldan en Supabase cuando el dispositivo está conectado y habilitado. IndexedDB no está cifrado por la app. No borrar datos del navegador, usar incógnito ni cambiar de puerto durante el evento. El panel local del operador es accesible sin contraseña; `/admin` y `/s/:token` son pantallas informativas, no funciones de seguridad simuladas.

La tira permite compartir y preparar una impresión, pero el tamaño de papel, sangrado y perfil de color deben definirse y probarse antes de imprimir. Los originales se codifican en JPEG a calidad 0.95, sin recorte ni reducción adicional; no son archivos RAW.

No hay limpieza automática. Los ZIP de muchas sesiones requieren memoria: exportar periódicamente; un evento de gran volumen necesitará exportación por lotes/streaming en una fase posterior. El ZIP es un respaldo de archivos con manifiestos, no hay importador en esta fase.

Galería privada, tokens de invitados, QR, URLs firmadas y administración quedan para las fases 3–5. La aceptación de Fase 2 requiere verificar una sesión real con una cuenta de cabina habilitada; consultar el estado en `docs/validation.md`.
