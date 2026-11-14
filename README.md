# Control de Gastos (PWA)

App web progresiva para controlar gastos mensuales, cuentas bancarias y metas de ahorro en **Bolivianos (Bs)**.
Offline-first y 100% privada: todo se guarda en IndexedDB dentro de tu teléfono. No hay servidor, cuentas ni rastreo.

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
> Por eso el camino recomendado es la opción A. Tus datos siguen quedándose solo en el teléfono: el hosting solo entrega los archivos de la app.

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

Ábrela una vez con internet; desde ahí funciona sin conexión.

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
