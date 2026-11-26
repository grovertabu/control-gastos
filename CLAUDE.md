# Control Gastos

Control Gastos es una PWA en español para presupuestos en bolivianos. Permite registrar gastos, ingresos y transferencias, administrar cuentas bancarias y seguir metas de ahorro. El piloto usa Google para el acceso por invitación y permite trabajar sin señal después de activar el dispositivo. [Abrir la app publicada](https://control-gastos-2r6.pages.dev/)

## Entorno del piloto

- **Cloudflare Pages** sirve el proyecto `control-gastos` desde la rama de producción `main`. La publicación se hace mediante subida directa con Wrangler. El último despliegue comprobado incluye el indicador **Guardando…** del formulario de cuentas. [Panel de Pages](https://dash.cloudflare.com/dd447bfc1c8a1bd713223caca0868c55/pages/view/control-gastos)
- **Supabase** guarda las copias privadas en el proyecto `omufqrkamsratuqjpkmq`, en São Paulo. La migración `20261126020652_cloud_snapshots.sql` ya está aplicada en ese proyecto. [Panel de Supabase](https://supabase.com/dashboard/project/omufqrkamsratuqjpkmq)
- **Google OAuth** usa un cliente web con callback `https://omufqrkamsratuqjpkmq.supabase.co/auth/v1/callback`. En Supabase, la URL de Pages es el destino de regreso. El filtro **Before User Created** llama a `private.check_pilot_signup` y consulta `private.pilot_invites`. La app ofrece entrada con Google. El proveedor Email de Supabase sigue habilitado en el panel y las funciones de sincronización requieren una identidad Google autorizada. [Configuración de redirecciones](https://supabase.com/dashboard/project/omufqrkamsratuqjpkmq/auth/url-configuration)

## Desarrollo local

Usa Node.js 24 para reproducir la versión probada. Desde la raíz del repositorio ejecuta los siguientes comandos.

```bash
npm ci
npm run dev
```

La app abre en [localhost:5173](http://localhost:5173/). Con las variables vacías, usa la base local de Dexie. Para probar el piloto con Google, copia `.env.example` a `.env.local` y completa `VITE_SUPABASE_URL` con la URL del proyecto y `VITE_SUPABASE_PUBLISHABLE_KEY` con su **Publishable key**. Para el modo instalable usa `npm run build` y `npm run preview`. Si pruebas OAuth con el servidor de vista previa, usa un puerto autorizado en Supabase, por ejemplo `npm run preview -- --port 5173 --strictPort` con el servidor de desarrollo detenido.

Las variables `VITE_` llegan al navegador. Usa la clave pública de Supabase en el cliente y guarda el secreto de Google y las claves de administración en sus servicios. Los archivos `.env.local` y los respaldos personales se gestionan fuera del historial de Git.

## Guardado y sincronización

- **Guardado local.** `src/db/db.ts` crea una base Dexie por usuario. `src/db/actions.ts` guarda los cambios y marca el respaldo pendiente en la misma transacción de IndexedDB. `src/lib/store.tsx` actualiza las pantallas a partir de Dexie. En `src/components/EditSheet.tsx`, el indicador **Guardando…** cubre esa escritura local y el formulario evita envíos repetidos.
- **Copia en la nube.** `src/cloud/sync.ts` guarda una copia completa por usuario en Supabase, con un número de revisión y un identificador por envío. El identificador permite repetir un envío interrumpido sin duplicarlo. La sincronización se ejecuta en segundo plano al guardar, recuperar conexión o volver a la app. `pull_snapshot` y `push_snapshot` toman el usuario de la sesión y comprueban su invitación.
- **Conflictos.** Si la revisión en la nube cambió, `src/cloud/SyncPanel.tsx` permite exportar las dos copias y elegir cuál conservar. Las decisiones vuelven a comprobar la revisión antes de reemplazar datos.
- **Respaldos.** `src/db/backup.ts` conserva el JSON de la versión anterior. Importar un JSON reemplaza los datos del perfil abierto. Importar un CSV agrega movimientos. El JSON permite trasladar una copia local entre dominios y restaurarla desde **Ajustes**. Google Drive sirve para guardar o compartir el archivo de respaldo.

## Pruebas y publicación

Comprueba el build y la prueba de navegador al cambiar la experiencia de guardado, acceso o sincronización.

```bash
npm run build
npx playwright install chromium --only-shell
npm run test:pilot
```

Playwright simula las cuentas y las respuestas de Supabase. Cubre la importación de respaldos, el aislamiento por usuario, la reapertura y el guardado sin conexión, los envíos duplicados, los conflictos y el cierre de sesión. Para comprobar permisos y revisiones en PostgreSQL, usa una base vacía de pruebas con un usuario capaz de crear roles.

```bash
psql -v ON_ERROR_STOP=1 "$TEST_DATABASE_URL" -f tests/snapshots.sql
```

Para una actualización pública, compila con las variables del piloto y sube `dist/` al proyecto existente. Si Wrangler requiere autorización, inicia sesión con los permisos de Pages.

```bash
npx --yes wrangler login --scopes account:read user:read pages:write
npm run build
npx --yes wrangler pages deploy dist --project-name control-gastos --branch main
```

Después de publicar, abre la URL pública y comprueba que responde `sw.js`. Para probar cambios de OAuth, entra con una cuenta invitada y verifica que se abre el resumen y que aparece **Sincronizado**. Si cambias el dominio público, registra el nuevo origen en Google Auth Platform y las direcciones de retorno en Supabase. [Configuración inicial y migración de datos](README.md)
