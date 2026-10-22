import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterSummary, characterExport, foundrySite, sameOrigin, publicError } from '../src/core.mjs';
import { createLssClient } from '../src/lss-api.mjs';
import { createController } from '../src/background.mjs';
import { executeFoundry, foundryTabs, importInFoundry } from '../src/foundry.mjs';

const ID = '6ab70486e8ac8e090a79b2a4';
const record = () => ({
    _id: ID, playerId: 'private-owner', version: '2', edition: '2024', sheetEdition: '2024',
    spells: { prepared: ['cure-wounds'] }, disabledBlocks: {}, access: 'owner', linkAccess: 'none',
    data: JSON.stringify({ name: { value: 'Тестовый воин' }, info: { charClass: { value: 'Воин' }, level: { value: 3 } } }),
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const cookies = { get: async () => ({ value: 'test-jwt' }) };
const sender = { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' };

function fakeChrome() {
    const data = {};
    const calls = [];
    return {
        calls,
        runtime: { id: 'extension-id', getURL: (path) => `chrome-extension://extension-id/${path}` },
        cookies: { ...cookies, getAll: async () => [], remove: async (details) => { calls.push(['remove', details]); return details; } },
        storage: {
            local: { get: async () => data, set: async (values) => Object.assign(data, values) },
            session: { get: async () => data, set: async (values) => Object.assign(data, values), remove: async (key) => { delete data[key]; } },
        },
        permissions: { contains: async () => true },
        tabs: {
            query: async () => [], get: async () => ({ id: 7, url: 'http://localhost:30000/game' }),
            create: async (details) => calls.push(['create', details]),
            update: async (...args) => calls.push(['update', ...args]),
            reload: async (id) => calls.push(['reload', id]),
        },
        scripting: { executeScript: async (details) => { calls.push(['execute', details]); return [{ result: { ok: true, name: 'Воин' } }]; } },
    };
}

test('summaries contain only display metadata and keep names as text', () => {
    const raw = record();
    raw.data = JSON.parse(raw.data);
    raw.data.name.value = '<img src=x onerror=alert(1)>';
    assert.deepEqual(characterSummary(raw), { id: ID, name: raw.data.name.value, className: 'Воин', level: '3', edition: '2024' });
});

test('the Foundry export uses an allowlist and preserves envelope fields', () => {
    const raw = { ...record(), JWT: 'never-transfer', permissions: [{ userId: 'private' }] };
    const exported = characterExport(raw);
    assert.equal(exported.jsonType, 'character');
    assert.deepEqual(exported.spells, raw.spells);
    assert.equal(exported.edition, '2024');
    for (const key of ['JWT', 'playerId', '_id', 'permissions', 'access', 'linkAccess']) assert.equal(key in exported, false);
});

test('invalid embedded character JSON is reported without its contents', () => {
    assert.throws(() => characterSummary({ ...record(), data: '{private-data' }), /повреждены/);
    assert.throws(() => characterSummary({ ...record(), _id: '../../auth' }));
});

test('Foundry permissions exclude the port but the selected origin includes it', () => {
    assert.deepEqual(foundrySite('http://localhost:30000/game'), { origin: 'http://localhost:30000', pattern: 'http://localhost/*' });
    assert.equal(sameOrigin('http://localhost:30001/game', 'http://localhost:30000'), false);
    assert.equal(sameOrigin('http://localhost:30000.evil.test', 'http://localhost:30000'), false);
    for (const url of ['javascript:alert(1)', 'file:///x', 'https://user:pass@host.test', 'https://longstoryshort.app/']) assert.throws(() => foundrySite(url));
});

test('missing cookies do not produce network requests', async () => {
    let requests = 0;
    const client = createLssClient({ get: async () => null }, async () => { requests++; });
    await assert.rejects(client.list(), { code: 'AUTH_REQUIRED' });
    assert.equal(requests, 0);
});

test('expired and logged-out cookie values do not produce network requests', async () => {
    for (const cookie of [{ value: '0' }, { value: 'x', expirationDate: 1 }]) {
        const client = createLssClient({ get: async () => cookie }, () => { throw new Error('must not fetch'); });
        await assert.rejects(client.list(), { code: 'AUTH_REQUIRED' });
    }
});

test('the website cookie is read by name and is sent only as a bearer to the API', async () => {
    let cookieDetails;
    let requestDetails;
    const client = createLssClient({ get: async (details) => { cookieDetails = details; return { value: '"test-jwt"' }; } }, async (url, options) => {
        requestDetails = { url, options };
        return response([record()]);
    });
    const result = await client.list();
    assert.equal(cookieDetails.name, 'lss-jwt');
    assert.equal(requestDetails.url, 'https://api.longstoryshort.app/character/list/');
    assert.equal(requestDetails.options.headers.Authorization, 'Bearer test-jwt');
    assert.equal(requestDetails.options.credentials, 'omit');
    assert.equal(requestDetails.options.redirect, 'error');
    assert.equal(JSON.stringify(result).includes('jwt'), false);
    assert.equal(result.characters.length, 1);
});

for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN'], [429, 'RATE_LIMIT'], [500, 'LSS_ERROR']]) {
    test(`HTTP ${status} is distinguished without disclosing the response`, async () => {
        const client = createLssClient(cookies, async () => response({ message: 'private response' }, status));
        await assert.rejects(client.list(), (error) => error.code === code && !error.message.includes('private'));
    });
}

test('network failures do not masquerade as logged-out sessions', async () => {
    const client = createLssClient(cookies, async () => { throw new Error('internal request details'); });
    await assert.rejects(client.list(), { code: 'NETWORK' });
});

test('HTML, malformed JSON and changed list contracts fail explicitly', async () => {
    for (const reply of [new Response('<html>', { headers: { 'content-type': 'text/html' } }), new Response('{', { headers: { 'content-type': 'application/json' } }), response({ characters: [] })]) {
        await assert.rejects(createLssClient(cookies, async () => reply).list(), { code: 'INVALID_RESPONSE' });
    }
});

test('one malformed record does not hide the rest of the list', async () => {
    const result = await createLssClient(cookies, async () => response([record(), { data: '{}' }])).list();
    assert.equal(result.characters.length, 1);
    assert.equal(result.skipped, 1);
});

test('oversized responses are bounded even without Content-Length', async () => {
    const huge = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024 + 1)); controller.close(); } });
    const client = createLssClient(cookies, async () => new Response(huge, { headers: { 'content-type': 'application/json' } }));
    await assert.rejects(client.list(), { code: 'TOO_LARGE' });
});

test('the selected character ID must match the API response', async () => {
    const client = createLssClient(cookies, async () => response(record()));
    await assert.rejects(client.character('different-id'), { code: 'INVALID_RESPONSE' });
    await assert.rejects(client.character('../auth'), { code: 'BAD_REQUEST' });
    assert.equal((await client.character(ID)).data, record().data);
});

test('page and content-script messages cannot access LSS credentials or data', async () => {
    let requests = 0;
    const controller = createController(fakeChrome(), async () => { requests++; return response([]); });
    for (const origin of [{ ...sender, id: 'other-id' }, { ...sender, tab: { id: 7 } }, { ...sender, url: 'https://example.test' }]) {
        assert.equal((await controller({ type: 'session.list' }, origin)).error.code, 'FORBIDDEN');
    }
    assert.equal(requests, 0);
    assert.deepEqual(publicError(new Error('test-jwt')), { code: 'INTERNAL', message: 'Операция не завершилась. Обнови список и попробуй снова.' });
});

test('connecting a site requires an actual host permission', async () => {
    const chrome = fakeChrome();
    chrome.permissions.contains = async () => false;
    const result = await createController(chrome)({ type: 'foundry.connect', url: 'http://localhost:30000' }, sender);
    assert.equal(result.error.code, 'PERMISSION_REQUIRED');
});

test('Foundry discovery filters other ports despite broader browser permissions', async () => {
    const chrome = fakeChrome();
    chrome.tabs.query = async () => [{ id: 7, title: 'world', url: 'http://localhost:30000/game' }, { id: 8, url: 'http://localhost:30001/game' }];
    assert.deepEqual(await foundryTabs(chrome, foundrySite('http://localhost:30000')), [{ id: 7, title: 'world' }]);
});

test('a navigated Foundry tab is refused before script injection', async () => {
    const chrome = fakeChrome();
    chrome.tabs.get = async () => ({ url: 'https://other-site.test/' });
    await assert.rejects(executeFoundry(chrome, 7, foundrySite('http://localhost:30000'), record()), { code: 'NO_FOUNDRY' });
    assert.equal(chrome.calls.length, 0);
});

test('Foundry is checked before fetching a full character, and cookies never reach the page', async () => {
    const chrome = fakeChrome();
    const controller = createController(chrome, async () => response(record()));
    await controller({ type: 'foundry.connect', url: 'http://localhost:30000' }, sender);
    assert.equal((await controller({ type: 'character.import', tabId: 7, id: ID }, sender)).ok, true);
    const injections = chrome.calls.filter(([kind]) => kind === 'execute').map(([, details]) => details);
    assert.equal(injections.length, 2);
    assert.equal(injections[0].args[2], true);
    assert.equal(injections[1].world, 'MAIN');
    assert.equal(JSON.stringify(injections).includes('jwt'), false);
    assert.equal(injections[1].args[0].jsonType, 'character');
});

test('concurrent imports are refused, and the write is never automatically retried', async () => {
    const chrome = fakeChrome();
    let release;
    const controller = createController(chrome, async () => { await new Promise((resolve) => { release = resolve; }); return response(record()); });
    await controller({ type: 'foundry.connect', url: 'http://localhost:30000' }, sender);
    const first = controller({ type: 'character.import', tabId: 7, id: ID }, sender);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await controller({ type: 'character.import', tabId: 7, id: ID }, sender)).error.code, 'BUSY');
    release();
    await first;
    assert.equal((await controller({ type: 'operation.state' }, sender)).operation.state, 'done');
});

test('a restarted worker preserves an uncertain result instead of silently retrying', async () => {
    const chrome = fakeChrome();
    await chrome.storage.session.set({ operation: { state: 'running' } });
    const result = await createController(chrome)({ type: 'operation.state' }, sender);
    assert.equal(result.operation.state, 'unknown');
    assert.equal(chrome.calls.length, 0);
});

test('logout clears only LSS auth cookies and iframe fallback, then reloads LSS', async () => {
    const chrome = fakeChrome();
    chrome.cookies.getAll = async () => [{ name: 'lss-jwt', domain: '.longstoryshort.app', path: '/', storeId: '0' }];
    chrome.tabs.query = async () => [{ id: 11 }];
    assert.equal((await createController(chrome)({ type: 'session.logout' }, sender)).ok, true);
    assert.equal(chrome.calls[0][0], 'remove');
    assert.equal(chrome.calls[0][1].url, 'https://longstoryshort.app/');
    assert.equal(chrome.calls.at(-1)[0], 'reload');
    assert.equal(chrome.calls.at(-1)[1], 11);
});

test('the injected function respects world readiness, permissions and import results', async () => {
    globalThis.location = { origin: 'http://localhost:30000' };
    const calls = [];
    const api = { parseLssFile: () => ({ characters: [{}], errors: [] }), importCharacters: async (...args) => { calls.push(args); return { results: [{ ok: true, name: 'Воин', actorId: 'actor-1', warnings: ['notice'] }], warnings: [] }; } };
    globalThis.game = { ready: true, modules: new Map([['lss-to-foundry', { active: true, api }]]), user: { can: () => true }, system: { id: 'dnd5e' } };
    try {
        assert.equal((await importInFoundry(record(), 'https://other.test')).ok, false);
        assert.equal((await importInFoundry(null, location.origin, true)).ok, true);
        assert.equal(calls.length, 0);
        assert.equal((await importInFoundry(record(), location.origin)).warningCount, 1);
        assert.equal(calls.length, 1);
        game.user.can = () => false;
        assert.equal((await importInFoundry(record(), location.origin)).ok, false);
        assert.equal(calls.length, 1);
    } finally { delete globalThis.game; delete globalThis.location; }
});
