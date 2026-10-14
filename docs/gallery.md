# Galería privada · Fase 3

## Uso

Confirmar una sesión en la cabina conectada. El worker crea la sesión remota, registra el hash del enlace y sube los cinco archivos. El QR aparece al registrar el enlace; la galería indica preparación hasta que el servidor confirma todos los objetos. Si se pierde Internet, las imágenes y la credencial del QR se conservan localmente y los reintentos reutilizan el mismo enlace.

Para una sesión anterior sincronizada, abrir Sesiones locales y respaldo y visualizar su resultado. Se registra un enlace al abrirla si todavía no tiene uno. Las sesiones locales sin vinculación requieren primero la adopción explícita desde Configuración. Ningún invitado puede listar sesiones desde la galería.

La página `/s/:token` muestra cuatro originales y una tira, permite descargar cada JPEG y un ZIP con los cinco. Renueva la autorización antes de descargar y cada 90 segundos mientras está abierta. Los enlaces Storage duran 120 segundos. El ZIP se genera en el teléfono; puede consumir hasta unos 120 MiB de memoria en sesiones cercanas al límite de tamaño. No hay analítica, fuentes ni scripts externos propios de la aplicación.

## Tokens y límites

Tokens de 256 bits generados mediante crypto.getRandomValues. Solo SHA-256 se transmite para registro y se guarda en PostgreSQL. El token original se conserva exclusivamente como credencial local en IndexedDB `guestLinks`, separado de las fotos y excluido de los ZIP de respaldo. Es necesario para recuperar el mismo QR tras reiniciar. El acceso al perfil de la laptop permite leer esta credencial, igual que las fotos locales; proteger el equipo. No se cifra IndexedDB.

La Edge Function recibe el token en el cuerpo POST, nunca en su URL, valida formato, calcula su hash y consulta una RPC exclusiva del servidor. Se aplican 600 consultas/minuto globales y 30/minuto por sesión. Las respuestas de error también consumen el límite global si el formato es válido, sin crear filas por token inválido. No es una defensa completa contra DDoS o consumo de invocaciones; monitorear cuotas. Dos consultas por galería lista comprueban revocación antes y después de firmar.

El enlace es una credencial de posesión, no autenticación personal. Reenviarlo permite acceso. Revocar impide nuevas URLs; una URL ya emitida puede funcionar durante sus 120 segundos. No se recuperan archivos descargados ni se pueden borrar imágenes que alguien ya vio. La ruta `/s/:token` queda en el historial del visitante y puede llegar al registro de solicitudes del hosting; limitar acceso y retención de esos registros y no agregar analítica que capture rutas. El código no registra tokens y usa no-referrer, no-store y noindex. No prometer anonimato frente al proveedor de alojamiento.

## Despliegue

Aplicar `202610140002_guest_gallery.sql` después de la primera migración. Desplegar `device-api` y `guest-gallery` con `supabase functions deploy`. Ambas usan la configuración versionada: device-api exige JWT validado mediante Auth.getUser; guest-gallery exige el token privado y no exige registro. Las RPC no son ejecutables por anon/authenticated.

Si se usa el dashboard, `node scripts/build-edge.mjs` genera ambos entrypoints en `supabase/dashboard`. Configurar Verify JWT with legacy secret desactivado en guest-gallery, ya que su credencial es el token de galería. Agregar el origen HTTPS de Sites a ALLOWED_ORIGINS y mantener los orígenes locales requeridos. Configurar `VITE_GALLERY_ORIGIN` al compilar la cabina. Nunca poner tokens de invitado ni claves privilegiadas en variables VITE.

El sitio debe admitir visitantes sin cuenta de ChatGPT; solo sirve la interfaz, las fotos siguen en Supabase privado. El acceso a cada sesión lo controla guest-gallery. Verificar `/s/un-token-invalido` desde otro navegador y escanear un QR real con el teléfono.

## Revocación operativa (hasta Fase 4)

El organizador puede ejecutar en SQL Editor, con el UUID real:

```sql
update public.photo_sessions set revoked_at=now() where id='UUID_SESION';
```

No se puede reemplazar el hash mediante una petición del dispositivo. Si se pierde la credencial local, el enlace no es recuperable desde su hash. La reemisión administrativa se implementará en una fase posterior. Mantener copias locales según la decisión del organizador; esta fase no elimina fotografías.

## Pruebas

Unitarios de entropía/formato/hash, reintentos del registro, estados de acceso, aislamiento, revocación durante firma y duración de URLs. PostgreSQL real en PGlite verifica permisos y transiciones. Playwright simula el backend para probar espera, galería móvil, descargas individuales/ZIP, enlaces revocados/vencidos y errores de red. La aceptación remota incluye comprobar los endpoints desplegados y abrir un QR desde otra sesión de navegador.
