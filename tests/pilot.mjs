import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';

const who = {
  owner: '324f8ec0-8612-4dfd-9603-784f6e7c1580',
  invited: '9ea03530-37d2-4e80-b271-00f998d93f38',
  outsider: 'f072d6fe-d015-46dc-9a64-1b48a42068de',
};

const fixture = {
  app: 'control-gastos', version: 1,
  data: {
    accounts: [{ id: 'acc-banco', name: 'Mi cuenta de prueba', kind: 'bank', initialBalance: 100, color: '#60a5fa', order: 0 }],
    categories: [{ id: 'cat-otros', name: 'Otros', kind: 'expense', color: '#94a3b8', order: 0 }],
    transactions: [{ id: 'original', type: 'expense', amount: 12.5, accountId: 'acc-banco', categoryId: 'cat-otros',
      note: 'Gasto del respaldo', date: '2026-11-25', month: '2026-11', createdAt: 1795621500000 }],
    fixedExpenses: [],
    goals: [{ id: 'goal', name: 'Mi meta de prueba', target: 250, color: '#34d399', emoji: '🎯', order: 0 }],
    contributions: [{ id: 'aporte', goalId: 'goal', accountId: 'acc-banco', amount: 5,
      date: '2026-11-25', month: '2026-11', createdAt: 1795621500000 }],
    settings: [{ key: 'monthlyIncome', value: 95 }, { key: 'theme', value: 'light' }],
  },
};

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

test('piloto PWA: migración, datos privados, trabajo offline, reintentos y conflictos', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'control-gastos-pilot-'));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const content = await readFile(join(directory, path));
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', directory, '--emptyOutDir'], {
      env: { ...process.env, VITE_SUPABASE_URL: origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_pilot_test' },
    });
    browser = await chromium.launch();
    const copies = new Map();
    const writes = [];
    const attempts = [];
    let lostOperation;
    let loseNextResponse = false;

    async function device(user, { activate = true } = {}) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, timezoneId: 'America/La_Paz' });
      await context.addInitScript(({ name, id }) => {
        if (localStorage.getItem('pilot-auth-fixture')) return;
        const expires_at = Math.floor(Date.now() / 1000) + 21600;
        const payload = btoa(JSON.stringify({ sub: id, exp: expires_at, role: 'authenticated' })).replace(/=+$/, '');
        localStorage.setItem('control-gastos-auth', JSON.stringify({
          access_token: `pilot.${payload}.fixture`, refresh_token: 'pilot', token_type: 'bearer', expires_at,
          user: { id, email: `${name}@example.test`, app_metadata: { provider: 'google' }, user_metadata: {}, aud: 'authenticated' },
        }));
        localStorage.setItem('pilot-auth-fixture', 'seeded');
      }, { name: user, id: who[user] });
      await context.route('**/rest/v1/rpc/*', async (route) => {
        const request = route.request();
        const { sub } = JSON.parse(Buffer.from(request.headers().authorization.split('.')[1], 'base64').toString());
        if (sub === who.outsider) return route.fulfill({ status: 403, json: {} });

        const args = request.postDataJSON();
        const copy = copies.get(sub);
        if (request.url().endsWith('pull_snapshot')) {
          if (!copy) return route.fulfill({ json: { status: 'empty', revision: 0 } });
          const result = copy.revision === args.p_known_revision ? { status: 'unchanged', revision: copy.revision } : copy;
          return route.fulfill({ json: result });
        }

        attempts.push(args.p_operation_id);
        const receipt = writes.find((write) => write.user === sub && write.id === args.p_operation_id);
        if (receipt) return route.fulfill({ json: { status: 'saved', revision: receipt.revision } });
        if ((copy?.revision ?? 0) !== args.p_base_revision) return route.fulfill({ json: copy });
        const revision = args.p_base_revision + 1;
        copies.set(sub, { status: 'snapshot', revision, data: args.p_data, updatedAt: new Date().toISOString() });
        writes.push({ user: sub, id: args.p_operation_id, revision });
        if (loseNextResponse) {
          loseNextResponse = false;
          lostOperation = args.p_operation_id;
          return route.abort();
        }
        return route.fulfill({ json: { status: 'saved', revision } });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror', (error) => console.error(error));
      await page.goto(origin);
      if (activate) await page.getByRole('button', { name: 'Activar en este dispositivo' }).click();
      return { context, page };
    }

    function cloudButton(page, name) {
      return page.getByRole('button', { name, exact: true });
    }
    async function addExpense(page, note) {
      await page.getByRole('button', { name: 'Registrar movimiento' }).click();
      await page.getByRole('button', { name: '7', exact: true }).click();
      await page.getByRole('textbox', { name: 'Nota' }).fill(note);
      const save = page.getByRole('button', { name: 'Guardar', exact: true });
      await save.click();
      await save.waitFor({ state: 'hidden' });
    }

    const first = await device('owner');
    await first.page.getByLabel('Importar respaldo JSON').setInputFiles({
      name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await cloudButton(first.page, 'Sincronizado').waitFor().catch(async (error) => {
      const header = await first.page.locator('header').innerText().catch(() => '');
      const review = first.page.getByRole('button', { name: 'Revisar nube' });
      if (await review.isVisible()) await review.click();
      const problem = await first.page.getByRole('alert').allTextContents();
      throw new Error(JSON.stringify({ header, problem, writes }), { cause: error });
    });
    assert.deepEqual(copies.get(who.owner).data, fixture.data);
    await first.page.getByRole('button', { name: 'Cuentas', exact: true }).click();
    await first.page.getByText('Mi cuenta de prueba').waitFor();
    await first.page.getByText(/87,5/).first().waitFor();

    const second = await device('owner');
    await cloudButton(second.page, 'Sincronizado').waitFor();
    const guest = await device('invited');
    await guest.page.getByRole('button', { name: 'Empezar de cero' }).click();
    await cloudButton(guest.page, 'Sincronizado').waitFor();
    assert.equal(copies.get(who.invited).data.transactions.length, 0);
    assert.equal(copies.get(who.invited).data.goals.length, 0);
    const outsider = await device('outsider');
    await outsider.page.getByText('Esta cuenta ya no tiene acceso al piloto.').waitFor();

    await first.page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await first.context.setOffline(true);
    await addExpense(first.page, 'Gasto offline A');
    await first.page.close();
    first.page = await first.context.newPage();
    await first.page.goto(origin);
    await cloudButton(first.page, 'Sin conexión').waitFor();
    await first.page.getByRole('button', { name: 'Movimientos', exact: true }).click();
    await first.page.getByText('Gasto offline A').waitFor();

    await addExpense(second.page, 'Cambio remoto B');
    await cloudButton(second.page, 'Sincronizado').waitFor();
    await first.context.setOffline(false);
    await cloudButton(first.page, 'Conflicto').click();
    const cloudDownload = first.page.waitForEvent('download');
    await first.page.getByRole('button', { name: 'Exportar copia de la nube' }).click();
    assert.match((await cloudDownload).suggestedFilename(), /copia-nube/);
    await addExpense(second.page, 'Cambio remoto posterior');
    await cloudButton(second.page, 'Sincronizado').waitFor();

    const keepLocal = first.page.getByRole('button', { name: 'Conservar esta copia' });
    await keepLocal.click();
    await first.page.getByText('Nube · versión 3').waitFor();
    loseNextResponse = true;
    await keepLocal.click();
    await first.page.getByRole('button', { name: 'Sincronizar ahora' }).click();
    await first.page.getByRole('dialog').getByText('Sincronizado', { exact: true }).waitFor();
    assert.equal(writes.filter((write) => write.user === who.owner).length, 4);
    assert.ok(lostOperation);
    assert.ok(attempts.filter((attempt) => attempt === lostOperation).length > 1);
    assert.deepEqual(copies.get(who.owner).data.transactions.map((item) => item.note).sort(), ['Gasto del respaldo', 'Gasto offline A']);

    await cloudButton(second.page, 'Sincronizado').click();
    await second.page.getByRole('button', { name: 'Sincronizar ahora' }).click();
    await second.page.getByRole('dialog').getByText('Sincronizado', { exact: true }).waitFor();
    await second.page.getByRole('button', { name: 'Cerrar panel' }).click();
    await second.page.getByRole('button', { name: 'Movimientos', exact: true }).click();
    await second.page.getByText('Gasto offline A').waitFor();

    await first.page.getByRole('button', { name: 'Cerrar panel' }).click();
    await second.context.setOffline(true);
    await addExpense(second.page, 'Cambio local que se descarta');
    await addExpense(first.page, 'Cambio de nube que se conserva');
    await cloudButton(first.page, 'Sincronizado').waitFor();
    await second.context.setOffline(false);
    await cloudButton(second.page, 'Conflicto').click();
    await second.page.getByRole('button', { name: 'Conservar la copia de la nube' }).click();
    await second.page.getByRole('dialog').getByText('Sincronizado', { exact: true }).waitFor();
    await second.page.getByRole('button', { name: 'Cerrar panel' }).click();
    await second.page.getByText('Cambio de nube que se conserva').waitFor();
    assert.equal(await second.page.getByText('Cambio local que se descarta').count(), 0);

    await guest.context.setOffline(true);
    await guest.page.getByRole('button', { name: 'Cuentas', exact: true }).click();
    await guest.page.getByRole('button', { name: 'Nueva cuenta' }).click();
    const accountEditor = guest.page.getByRole('dialog', { name: 'Nueva cuenta' });
    const saveAccount = accountEditor.getByRole('button', { name: 'Guardar', exact: true });
    await saveAccount.click();
    await accountEditor.getByText('Ponle un nombre a la cuenta.').waitFor();
    assert.equal(await saveAccount.isEnabled(), true);
    await accountEditor.getByLabel('Nombre').fill('Banco sin conexión');
    await accountEditor.getByLabel('Saldo inicial').fill('50');

    // Keep an earlier transaction open so the local write is visibly pending.
    const releaseAccountLock = await guest.page.evaluateHandle((uid) => new Promise((resolve, reject) => {
      const request = indexedDB.open(`control-gastos:${uid}`);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('accounts', 'readwrite');
        const store = transaction.objectStore('accounts');
        let release = false;
        transaction.oncomplete = () => database.close();
        const keepOpen = () => {
          store.get('acc-banco').onsuccess = () => { if (!release) keepOpen(); };
        };
        store.get('acc-banco').onsuccess = () => {
          keepOpen();
          resolve(() => { release = true; });
        };
      };
    }), who.invited);
    try {
      await saveAccount.click();
      const saving = accountEditor.getByRole('button', { name: 'Guardando…', exact: true });
      await saving.waitFor();
      assert.equal(await saving.isDisabled(), true);
      await accountEditor.locator('form').evaluate((form) => form.requestSubmit());
    } finally {
      await releaseAccountLock.evaluate((release) => release());
      await releaseAccountLock.dispose();
    }
    await accountEditor.waitFor({ state: 'hidden' });
    await guest.page.getByRole('button', { name: 'Editar Banco sin conexión', exact: true }).waitFor();
    assert.equal(await guest.page.getByRole('button', { name: 'Editar Banco sin conexión', exact: true }).count(), 1);
    assert.equal(copies.get(who.invited).data.accounts.some((account) => account.name === 'Banco sin conexión'), false);

    await guest.page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    const guestCopy = structuredClone(fixture);
    guestCopy.data.transactions[0].note = 'Respaldo independiente';
    await guest.page.locator('input[accept="application/json,.json"]').setInputFiles({
      name: 'guest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(guestCopy)),
    });
    await guest.page.getByText('Respaldo restaurado (1 movimientos)').waitFor();
    assert.equal(copies.get(who.invited).data.transactions.length, 0);
    await guest.context.setOffline(false);
    await cloudButton(guest.page, 'Sincronizado').waitFor();
    assert.deepEqual(copies.get(who.invited).data, guestCopy.data);
    assert.equal(copies.get(who.owner).data.transactions.some((item) => item.note === 'Respaldo independiente'), false);

    await first.context.setOffline(true);
    await addExpense(first.page, 'Pendiente antes de cerrar');
    await cloudButton(first.page, 'Sin conexión').click();
    await first.page.getByRole('button', { name: 'Cerrar sesión' }).click();
    const close = first.page.getByRole('button', { name: 'Confirmar cierre' });
    assert.equal(await close.isDisabled(), true);
    const backup = first.page.waitForEvent('download');
    await first.page.getByRole('button', { name: 'Descargar respaldo', exact: true }).click();
    const downloaded = await backup;
    const saved = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
    assert.equal(saved.data.transactions.some((item) => item.note === 'Pendiente antes de cerrar'), true);
    await close.click();
    await first.page.getByRole('heading', { name: 'Inicia sesión con Google' }).waitFor();
    assert.equal(await first.page.evaluate(async (uid) => {
      const databases = await indexedDB.databases();
      return databases.some((db) => db.name === `control-gastos:${uid}`);
    }, who.owner), false);
  } finally {
    await browser?.close();
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
