import { COOKIE_NAME, LSS_URL, UserError, foundrySite, publicError } from './core.mjs';
import { createLssClient } from './lss-api.mjs';
import { executeFoundry, foundryTabs } from './foundry.mjs';

export function createController(chrome, fetchFn = fetch) {
    const client = createLssClient(chrome.cookies, fetchFn);
    let busy = false;

    async function site() { return (await chrome.storage.local.get('foundrySite')).foundrySite ?? null; }

    async function logout() {
        if (busy) throw new UserError('BUSY', 'Дождись завершения импорта.');
        const cookies = await chrome.cookies.getAll({ domain: 'longstoryshort.app', name: COOKIE_NAME });
        for (const cookie of cookies) {
            const domain = cookie.domain.replace(/^\./, '');
            if (domain !== 'longstoryshort.app' && domain !== 'api.longstoryshort.app') continue;
            const details = { url: `https://${domain}${cookie.path}`, name: COOKIE_NAME, storeId: cookie.storeId };
            if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
            const removed = await chrome.cookies.remove(details);
            if (!removed) throw new UserError('LOGOUT_FAILED', 'Не удалось завершить сессию LSS. Выйди через меню сайта.');
        }
        await chrome.storage.session.remove('operation');
        const tabs = await chrome.tabs.query({ url: 'https://longstoryshort.app/*' });
        let failed = 0;
        for (const tab of tabs) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    func: () => { localStorage.removeItem('lss-iframe-token'); },
                });
                await chrome.tabs.reload(tab.id);
            } catch { failed++; }
        }
        if (failed) throw new UserError('LOGOUT_PARTIAL', 'Кука удалена. Закрой или обнови остальные вкладки LSS, чтобы завершить выход.');
        return {};
    }

    return async function dispatch(message, sender) {
        if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) {
            return { ok: false, error: { code: 'FORBIDDEN', message: 'Недопустимый источник запроса.' } };
        }
        try {
            let result;
            switch (message?.type) {
                case 'session.list': result = await client.list(); break;
                case 'session.login': {
                    // The website handles passwords and identity-provider redirects.
                    const tabs = await chrome.tabs.query({ url: 'https://longstoryshort.app/characters/list/*' });
                    if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
                    else await chrome.tabs.create({ url: LSS_URL, active: true });
                    result = {};
                    break;
                }
                case 'session.logout': result = await logout(); break;
                case 'foundry.state': {
                    const connected = await site();
                    result = { site: connected, tabs: await foundryTabs(chrome, connected) };
                    break;
                }
                case 'operation.state': {
                    let operation = (await chrome.storage.session.get('operation')).operation ?? null;
                    if (operation?.state === 'running' && !busy) {
                        operation = { ...operation, state: 'unknown', message: 'Работа расширения прервалась. Проверь список актёров Foundry перед повторным импортом.' };
                        await chrome.storage.session.set({ operation });
                    }
                    result = { operation };
                    break;
                }
                case 'foundry.connect': {
                    const connected = foundrySite(message.url);
                    if (!await chrome.permissions.contains({ origins: [connected.pattern] })) {
                        throw new UserError('PERMISSION_REQUIRED', 'Разреши расширению доступ к выбранному адресу Foundry.');
                    }
                    await chrome.storage.local.set({ foundrySite: connected });
                    result = { site: connected, tabs: await foundryTabs(chrome, connected) };
                    break;
                }
                case 'character.import': {
                    if (busy) throw new UserError('BUSY', 'Другой импорт ещё выполняется.');
                    busy = true;
                    let startedWrite = false;
                    try {
                        await chrome.storage.session.set({ operation: { state: 'running', startedAt: Date.now() } });
                        const connected = await site();
                        await executeFoundry(chrome, message.tabId, connected, null, true);
                        const document = await client.character(message.id);
                        startedWrite = true;
                        result = await executeFoundry(chrome, message.tabId, connected, document);
                        await chrome.storage.session.set({ operation: { state: 'done', name: result.name, warningCount: result.warningCount, finishedAt: Date.now() } });
                    } catch (error) {
                        const problem = publicError(error);
                        await chrome.storage.session.set({ operation: { state: startedWrite ? 'unknown' : 'failed', message: startedWrite ? 'Импорт прервался. Проверь список актёров Foundry перед повторной попыткой.' : problem.message } });
                        throw error;
                    } finally { busy = false; }
                    break;
                }
                default: throw new UserError('BAD_REQUEST', 'Неизвестный запрос расширения.');
            }
            return { ok: true, ...result };
        } catch (error) { return { ok: false, error: publicError(error) }; }
    };
}

if (globalThis.chrome?.runtime?.id) {
    const controller = createController(chrome);
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        controller(message, sender).then(respond, () => respond({ ok: false, error: publicError(null) }));
        return true;
    });
}
