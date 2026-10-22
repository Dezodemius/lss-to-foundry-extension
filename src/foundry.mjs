import { UserError, sameOrigin } from './core.mjs';

// This function runs in the selected page's MAIN world. It must be self-contained.
export async function importInFoundry(document, expectedOrigin, dryRun = false) {
    if (location.origin !== expectedOrigin) return { ok: false, message: 'Адрес вкладки Foundry изменился.' };
    const world = globalThis.game;
    const module = world?.modules?.get('lss-to-foundry');
    const api = module?.api;
    if (!world?.ready || !module?.active || !api?.parseLssFile || !api?.importCharacters) {
        return { ok: false, message: 'Открой мир Foundry и включи модуль LSS to Foundry.' };
    }
    if (world.system?.id !== 'dnd5e' || !world.user?.can('ACTOR_CREATE')) {
        return { ok: false, message: 'Нужен мир dnd5e и право создавать персонажей.' };
    }
    if (dryRun) return { ok: true, world: world.world?.title || world.world?.id || 'Foundry' };
    // Page modules can see imported character data. Authentication never enters this function.
    try {
        const parsed = api.parseLssFile(document, 'LSS extension.json');
        if (parsed.errors?.length || parsed.characters?.length !== 1) {
            return { ok: false, message: 'Модуль не смог прочитать персонажа. Обнови модуль LSS to Foundry.' };
        }
        const report = await api.importCharacters(parsed.characters, []);
        const result = report?.results?.[0];
        if (!result?.ok) return { ok: false, message: 'Импорт в Foundry завершился ошибкой. Подробности в консоли Foundry.' };
        const warningCount = (result.warnings?.length ?? 0) + (report.warnings?.length ?? 0);
        globalThis.ui?.notifications?.info?.(`LSS: импортирован ${result.name || 'персонаж'}. Предупреждений: ${warningCount}.`);
        return { ok: true, warningCount, name: result.name || 'Персонаж', actorId: result.actorId };
    } catch {
        return { ok: false, message: 'Импорт прервался. Проверь список актёров перед повторной попыткой.' };
    }
}

export async function foundryTabs(chrome, site) {
    if (!site || !await chrome.permissions.contains({ origins: [site.pattern] })) return [];
    const tabs = await chrome.tabs.query({ url: site.pattern });
    return tabs.filter((tab) => Number.isInteger(tab.id) && sameOrigin(tab.url, site.origin))
        .map(({ id, title }) => ({ id, title: title || site.origin }));
}

export async function executeFoundry(chrome, tabId, site, document, dryRun = false) {
    if (!Number.isInteger(tabId) || !site) throw new UserError('NO_FOUNDRY', 'Выбери подключённую вкладку Foundry.');
    const tab = await chrome.tabs.get(tabId);
    if (!sameOrigin(tab.url, site.origin) || !await chrome.permissions.contains({ origins: [site.pattern] })) {
        throw new UserError('NO_FOUNDRY', 'Вкладка больше не соответствует подключённому адресу Foundry.');
    }
    let frames;
    try {
        frames = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] }, world: 'MAIN',
            func: importInFoundry, args: [document ?? null, site.origin, dryRun],
        });
    } catch {
        // Do not retry a write: the actor may already exist after a navigation or lost response.
        throw new UserError('IMPORT_INTERRUPTED', 'Связь с Foundry прервалась. Проверь список актёров перед повторным импортом.');
    }
    const result = frames?.[0]?.result;
    if (!result?.ok) throw new UserError('FOUNDRY_ERROR', result?.message || 'Foundry не ответил. Проверь мир перед повторным импортом.');
    return result;
}
