import { foundrySite } from './core.mjs';

const el = (id) => document.getElementById(id);
let characters = [];
let importing = false;
let generation = 0;
let operationTimer;

function status(message, kind = '') {
    el('status').textContent = message;
    el('status').dataset.kind = kind;
}

async function send(type, payload = {}) {
    let result;
    try { result = await chrome.runtime.sendMessage({ type, ...payload }); }
    catch { throw new Error('Расширение обновилось или потеряло связь. Открой его заново.'); }
    if (!result?.ok) {
        const error = new Error(result?.error?.message || 'Нет ответа от расширения.');
        error.code = result?.error?.code;
        throw error;
    }
    return result;
}

function render() {
    el('count').textContent = `(${characters.length})`;
    el('characters').replaceChildren();
    const query = el('search').value.trim().toLocaleLowerCase('ru');
    for (const character of characters.filter((item) => `${item.name} ${item.className}`.toLocaleLowerCase('ru').includes(query))) {
        const row = document.createElement('div');
        row.className = 'character';
        const info = document.createElement('div');
        info.className = 'character-info';
        const name = document.createElement('div');
        name.className = 'character-name';
        name.textContent = character.name;
        const meta = document.createElement('div');
        meta.className = 'character-meta';
        meta.textContent = [character.className, character.level && `ур. ${character.level}`, character.edition].filter(Boolean).join(' · ');
        const button = document.createElement('button');
        button.textContent = 'Импорт';
        button.disabled = importing;
        button.setAttribute('aria-label', `Импорт: ${character.name}`);
        button.addEventListener('click', () => importCharacter(character));
        info.append(name, meta);
        row.append(info, button);
        el('characters').append(row);
    }
    if (!el('characters').childElementCount) {
        const empty = document.createElement('p');
        empty.textContent = query ? 'По этому запросу персонажей нет.' : 'В аккаунте пока нет персонажей.';
        el('characters').append(empty);
    }
}

async function refresh() {
    const current = ++generation;
    el('refresh').disabled = true;
    status('Проверяем сессию и загружаем персонажей…');
    try {
        const result = await send('session.list');
        if (current !== generation) return;
        characters = result.characters;
        el('signin').hidden = true;
        el('account').hidden = false;
        el('logout').hidden = false;
        render();
        status(result.skipped ? `Загружено ${characters.length}. Не удалось прочитать: ${result.skipped}.` : `Персонажей: ${characters.length}. Выбери, кого перенести.`);
    } catch (error) {
        if (current !== generation) return;
        characters = [];
        el('characters').replaceChildren();
        el('account').hidden = true;
        el('logout').hidden = error.code === 'AUTH_REQUIRED';
        el('signin').hidden = error.code !== 'AUTH_REQUIRED';
        status(error.message, error.code === 'AUTH_REQUIRED' ? '' : 'error');
    } finally { el('refresh').disabled = false; }
}

async function connection() {
    const previous = el('foundry-tab').value;
    const result = await send('foundry.state');
    if (result.site) el('foundry-url').value = result.site.origin;
    el('foundry-tab').replaceChildren(new Option('Выбери открытый мир', ''));
    for (const tab of result.tabs) el('foundry-tab').add(new Option(tab.title, String(tab.id)));
    if (result.tabs.some((tab) => String(tab.id) === previous)) el('foundry-tab').value = previous;
    else if (result.tabs.length === 1) el('foundry-tab').value = String(result.tabs[0].id);
    el('connection-status').textContent = result.tabs.length
        ? 'Выбери вкладку с открытым миром dnd5e.'
        : 'Открой мир Foundry в этом браузере и обнови список.';
    if (!result.site) el('connection').open = true;
}

async function importCharacter(character) {
    if (importing) return;
    const selectedTab = el('foundry-tab').value;
    if (!selectedTab) {
        el('connection').open = true;
        status('Сначала подключи Foundry и выбери вкладку мира.', 'error');
        return;
    }
    importing = true;
    el('logout').disabled = true;
    status(`Импортируем: ${character.name}. Дождись результата…`);
    render();
    try {
        const result = await send('character.import', { id: character.id, tabId: Number(selectedTab) });
        status(`${result.name}: импорт завершён.${result.warningCount ? ` Предупреждений: ${result.warningCount}; проверь лист в Foundry.` : ''}`, 'success');
    } catch (error) { status(error.message, 'error'); }
    finally { importing = false; el('logout').disabled = false; render(); }
}

async function restoreOperation() {
    const { operation } = await send('operation.state');
    if (!operation) return;
    const wasImporting = importing;
    importing = operation.state === 'running';
    el('logout').disabled = importing;
    render();
    if (importing) {
        status('Импорт ещё выполняется. Можно закрыть окно расширения и открыть его снова.');
        clearTimeout(operationTimer);
        operationTimer = setTimeout(() => restoreOperation().catch((error) => status(error.message, 'error')), 1500);
    } else if (operation.state === 'done') {
        status(`Последний импорт: ${operation.name}. Предупреждений: ${operation.warningCount ?? 0}.`, 'success');
    } else {
        status(operation.message, 'error');
    }
    if (wasImporting && !importing) await connection();
}

el('search').addEventListener('input', render);
el('refresh').addEventListener('click', () => { refresh(); connection().catch((error) => status(error.message, 'error')); });
el('login').addEventListener('click', () => send('session.login').catch((error) => status(error.message, 'error')));
el('logout').addEventListener('click', async () => {
    if (!confirm('Выйти из LSS в этом профиле браузера? Открытые вкладки LSS будут обновлены.')) return;
    ++generation;
    characters = [];
    el('characters').replaceChildren();
    el('logout').disabled = true;
    try { await send('session.logout'); await refresh(); }
    catch (error) { await refresh(); status(error.message, 'error'); }
    finally { el('logout').disabled = false; }
});
el('connect').addEventListener('click', async () => {
    try {
        const site = foundrySite(el('foundry-url').value.trim());
        // Request directly from the click handler to preserve the user gesture.
        const granted = await chrome.permissions.request({ origins: [site.pattern] });
        if (!granted) { status('Доступ к Foundry не разрешён.', 'error'); return; }
        await send('foundry.connect', { url: site.origin });
        await connection();
        status('Адрес Foundry подключён. Выбери вкладку мира.');
    } catch (error) { status(error.message, 'error'); }
});

Promise.allSettled([refresh(), connection()]).then(async (results) => {
    for (const result of results) if (result.status === 'rejected') status(result.reason.message, 'error');
    if (!el('account').hidden) await restoreOperation();
}).catch((error) => status(error.message, 'error'));
