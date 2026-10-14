# Ejecución y despliegue

## Ejecución local

Instalar Node.js 24 LTS y pnpm 11, ejecutar `pnpm install --frozen-lockfile`, `pnpm build` y `pnpm preview`. Abrir el localhost informado; mantener la terminal en funcionamiento. Se eligió `--configLoader native` para cargar la configuración TypeScript con Node 24 sin el empaquetador intermedio de configuración.

La configuración pública de Supabase se coloca en `.env.local` según `.env.example`. Sin ella funciona el modo local. El proyecto remoto existe; el frontend aún no se publicó. `pnpm dev` ofrece desarrollo con recarga; `pnpm preview` sirve el bundle validado. Los E2E utilizan preview en el puerto 5173 y Chrome instalado.

En este entorno de Codex, el optimizador de dependencias del servidor de desarrollo encontró una restricción de lectura de una carpeta antecesora. El bundle y preview permiten validar la aplicación sin ampliar permisos. En una terminal normal usar los comandos del README; si el dev server encuentra esa misma limitación, usar build + preview.

## Origen y cámara

MediaDevices requiere HTTPS o localhost. Un teléfono no puede acceder a la cámara mediante una IP HTTP de la laptop. IndexedDB está separado por origen, incluido el puerto: usar el mismo origen durante todo el evento. No copiar el HTML a file://.

No hay service worker. Con el servidor local activo, la aplicación no necesita Internet. Para el arranque se necesitan los archivos compilados y el servidor; una instalación offline completa debe prepararse previamente.

## Futuro hosting

El proveedor deberá servir `dist`, devolver `index.html` para rutas SPA, usar HTTPS y agregar `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, una política de permisos de cámara limitada al origen y CSP compatible. Respuestas de galería y URLs privadas sin caché; no confundir assets públicos del frontend con fotografías privadas.

Las migraciones, Storage, despliegue de Edge Functions y registro/renovación/revocación del dispositivo se documentan en [backend.md](backend.md). Mantener el mismo origen/puerto durante el evento, también al cambiar entre dev y preview.

## Respaldo

En bienvenida, abrir **Sesiones locales y respaldo → Exportar todas en ZIP**. Cada carpeta UUID contiene `sesion.json`, originales disponibles y tira si está confirmada. Los borradores también se incluyen. Abrir el ZIP y comprobar una muestra; copiarlo a otro dispositivo. La exportación no elimina los datos locales.

Para grandes cantidades, exportar sesiones individuales periódicamente y conservar múltiples respaldos. La exportación total mantiene datos en memoria. No se incluye importación/restauración automática: los JPEG pueden utilizarse directamente y los manifiestos preservan contexto.
