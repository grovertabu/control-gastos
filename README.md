# Control de Gastos (PWA)

App web progresiva para controlar gastos mensuales, cuentas bancarias y metas de ahorro en **Bolivianos (Bs)**.
App local con IndexedDB (Dexie). La versión con cuenta de Google mantiene una copia por usuario en el dispositivo y sincroniza respaldos privados con Supabase.

El piloto ya está publicado y el traspaso reúne la configuración para continuar el proyecto. [Abrir Control Gastos](https://control-gastos-2r6.pages.dev/) · [Traspaso para Claude Code](CLAUDE.md)

## Configurar el piloto con Google

1. Crea un proyecto **Supabase Free**. Ejecuta la [migración SQL](supabase/migrations/20261126020652_cloud_snapshots.sql) desde el SQL Editor o aplícala con `supabase db push` desde un proyecto enlazado.
2. Configura **Authentication → Auth Hooks → Before User Created** con la función `private.check_pilot_signup`. Autoriza los correos en el SQL Editor. Habilita únicamente el proveedor Google y desactiva Email en el piloto.

   ```sql
   insert into private.pilot_invites (email) values ('correo@example.com') on conflict do nothing;
   ```

   Quitar el correo de `private.pilot_invites` revoca la sincronización en las sesiones existentes. Cada dispositivo guarda su copia hasta que el usuario cierre sesión.
3. En Google Auth Platform, configura una aplicación **External**, con un cliente OAuth **Web application**. Usa los permisos `openid`, `email` y `profile`. En Google, añade el callback de Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`). En Supabase, habilita Google y guarda allí el ID y el secreto del cliente. En **Authentication → URL Configuration**, registra la URL pública de la app como **Site URL** y `http://localhost:5173/` como redirección permitida durante desarrollo.
4. Copia `.env.example` a `.env.local` y completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con la URL y la **publishable key** del proyecto. La compilación incluye esos dos valores públicos. Guarda el secreto de Google y las claves de administración dentro de sus servicios.
5. Publica la rama del piloto en **Cloudflare Pages Free**. Usa `npm run build` como comando, `dist` como salida y añade las dos variables `VITE_` al entorno de compilación. Para subir a mano, compila con las variables configuradas y despliega `dist/` en un proyecto existente con `npx wrangler pages deploy dist --project-name <proyecto>`. Añade el dominio HTTPS resultante a los orígenes autorizados del cliente Google y a las redirecciones de Supabase.

Con las variables vacías, `npm run dev` abre el modo local de siempre. La primera sesión con Google necesita internet. Una vez activado el dispositivo, los cambios se guardan en Dexie incluso sin conexión. Al abrir la app o recuperar conexión, el indicador del encabezado muestra el estado de la nube. Si hay dos versiones, puedes descargar las dos antes de elegir.

### Migrar y comprobar tus datos

1. Desde la app anterior, abre **Ajustes → Exportar respaldo completo (JSON)**. Guarda el archivo, por ejemplo en Google Drive.
2. En la URL HTTPS del piloto, entra con tu Google, activa el dispositivo e importa el JSON durante la preparación. Comprueba los movimientos, saldos, apartados y ajustes en bolivianos. Una cuenta nueva también puede empezar de cero.
3. Abre el piloto en otro dispositivo con la misma cuenta. Comprueba que reciba el respaldo. Haz cambios en modo avión, vuelve a abrir la PWA y comprueba que siguen ahí. Reconecta y verifica el estado **Sincronizado**.
4. Prueba dos invitados y un correo ajeno. Para probar conflictos, edita en dos dispositivos con la misma cuenta mientras ambos están sin conexión y reconéctalos de uno en uno. Descarga los dos JSON desde el panel de sincronización y comprueba la versión elegida.

### Pruebas reproducibles

- `npx playwright install chromium` y `npm run test:pilot` prueban la PWA compilada con cuentas y respuestas simuladas, incluyendo modo avión, reapertura y reintentos.
- `psql -v ON_ERROR_STOP=1 -d <base-de-pruebas-vacía> -f tests/snapshots.sql` comprueba la migración, el aislamiento y las revisiones en PostgreSQL. Usa una base vacía de pruebas con un rol capaz de crear roles.

Cada envío sincronizado guarda un JSON completo y un identificador de operación, que permite reintentos tras una interrupción. Las consultas con la revisión actual devuelven solo el estado. Durante el piloto, revisa el tamaño de los JSON exportados y la transferencia de Supabase en su panel de uso.

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Dexie (IndexedDB) + vite-plugin-pwa (Workbox).

## Empezar

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. El comando también muestra una dirección `Network: http://192.168.x.x:5173` para abrirla desde el celular en la misma Wi-Fi.

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo, visible en la red local |
| `npm run build` | Revisa tipos y genera la versión final en `dist/` |
| `npm run preview` | Sirve `dist/` (con Service Worker) en el puerto 4173 |

## Instalarla en el celular

> **Importante:** los navegadores solo permiten instalar una PWA y usarla sin conexión desde **HTTPS** (o `localhost`).
> Por Wi-Fi con `http://192.168.x.x` la app funciona y guarda datos, pero no se instala ni trabaja offline.
> La opción A publica los archivos de la app. La sincronización con Supabase se habilita con la configuración del piloto.

### Opción A — Desplegar gratis (recomendada, 2 minutos)

Primero genera la app:

```bash
npm run build
```

Luego elige uno:

- **Netlify (sin cuenta de Git):** entra a <https://app.netlify.com/drop> y arrastra la carpeta `dist/`. Te da una URL HTTPS al instante.
- **Cloudflare Pages:** `npx wrangler pages deploy dist`
- **Vercel:** `npx vercel --prod` (framework: Vite, carpeta de salida: `dist`)

Si conectas un repositorio de Git en cualquiera de los tres: comando de build `npm run build`, carpeta de salida `dist`.

Después, en el celular:

- **Android (Chrome):** abre la URL → menú ⋮ → **Agregar a pantalla de inicio / Instalar app**.
- **iPhone (Safari):** abre la URL → botón Compartir → **Agregar a inicio**.

Ábrela una vez con internet. Si usas Google, activa el dispositivo y prepara tu copia de datos antes de irte sin conexión.

### Opción B — Android por cable USB, sin subir nada

Con la depuración USB activada y `adb` instalado:

```bash
npm run build
```

```bash
npm run preview
```

```bash
adb reverse tcp:4173 tcp:4173
```

En Chrome del teléfono abre `http://localhost:4173` e instálala. Al ser `localhost`, el navegador la trata como origen seguro.
Ojo: la app instalada así solo se actualiza cuando vuelves a conectar el cable y levantar el servidor.

### Opción C — Solo probarla por Wi-Fi

```bash
npm run dev
```

Abre en el celular la dirección `Network` que aparece en la terminal (misma red Wi-Fi). Sirve para probar, no para instalar.

> Cada dirección (dominio) tiene su propia base de datos. Si empiezas en una y luego cambias a otra, usa
> **Ajustes → Exportar respaldo (JSON)** en la primera e **Importar** en la segunda.

## Primeros pasos dentro de la app

1. **Cuentas:** toca cada cuenta y pon su **saldo actual** real.
2. **Ajustes:** revisa tu ingreso base (4.333 Bs), el límite de "Gasto sin culpa" (1.300 Bs por defecto) y tus gastos fijos.
3. **Metas:** ajusta los montos objetivo de los tres bolsillos de ejemplo.
4. Usa el botón **+** para registrar gastos, ingresos y transferencias.

## Cómo calcula las cosas

- **Saldo de una cuenta** = saldo inicial + ingresos − gastos ± transferencias. No se guarda: se deriva de los movimientos, así nunca se descuadra al editar o borrar.
- **Disponible real del mes** = ingreso base + ingresos extra − gastos fijos (pagados y pendientes) − gastos variables.
- **Sueldo:** registrar un ingreso con categoría *Sueldo* suma al saldo de la cuenta, pero no al presupuesto (ya está contado como ingreso base). Los demás ingresos sí suman como "extra".
- **Gasto sin culpa:** gastos variables del mes contra tu límite. Verde hasta 80 %, ámbar hasta 100 %, rojo ("Desvío") si te pasas.
- **Gastos fijos:** marcarlos con un toque crea el gasto en la cuenta elegida; desmarcarlos lo borra.
- **Metas:** apartar dinero no lo mueve de cuenta, lo *reserva*. En Cuentas verás "Apartado en metas" y "Libre" por separado, y un aviso si gastas dinero reservado.

## Respaldo

En **Ajustes → Respaldo de datos**:

- **JSON:** respaldo completo (cuentas, movimientos, metas, ajustes). Importarlo **reemplaza todo**.
- **CSV:** solo movimientos, se abre en Excel / Google Sheets. Importarlo **agrega** filas. Columnas:
  `fecha,tipo,monto,cuenta,cuenta_destino,categoria,nota` (tipo: `gasto`, `ingreso` o `transferencia`; fecha `AAAA-MM-DD`).

## Estructura

```
├── index.html                 Shell HTML, metadatos PWA, tema sin parpadeo
├── vite.config.ts             Vite + Tailwind + manifest y Service Worker
├── public/
│   ├── favicon.svg
│   └── icons/                 Iconos 192, 512, maskable y apple-touch
├── scripts/make-icons.py      Regenera los iconos (opcional, requiere Pillow)
└── src/
    ├── main.tsx               Arranque y registro del Service Worker
    ├── App.tsx                Layout, navegación inferior, botón +
    ├── index.css              Tailwind y tokens de color (oscuro / claro)
    ├── db/
    │   ├── db.ts              Esquema Dexie, tipos y datos iniciales
    │   ├── actions.ts         Todas las escrituras a la base
    │   └── backup.ts          Exportar / importar JSON y CSV
    ├── lib/
    │   ├── format.ts          Moneda, fechas y meses
    │   ├── stats.ts           Saldos, resumen del mes, comparativa
    │   └── store.tsx          Datos reactivos, estado de UI, avisos
    ├── components/
    │   ├── ui.tsx             Hoja inferior, barra, selector de mes, toast
    │   ├── EditSheet.tsx      Formulario genérico (cuentas, metas, etc.)
    │   ├── TxSheet.tsx        Registro rápido con teclado numérico
    │   └── Donut.tsx          Gráfico de dona en SVG
    └── pages/
        ├── Resumen.tsx        Disponible, gasto sin culpa, fijos, gráfico, comparativa
        ├── Movimientos.tsx    Historial con búsqueda y filtros
        ├── Cuentas.tsx        Saldos, transferencias, alta y edición
        ├── Metas.tsx          Bolsillos de ahorro
        └── Ajustes.tsx        Presupuesto, tema, fijos, categorías, respaldo
```
