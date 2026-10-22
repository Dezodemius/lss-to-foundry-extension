export const LSS_URL = 'https://longstoryshort.app/characters/list/';
export const COOKIE_NAME = 'lss-jwt';
export const API_URL = 'https://api.longstoryshort.app';

export class UserError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export function characterId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
        throw new UserError('BAD_REQUEST', 'Неверный идентификатор персонажа.');
    }
    return value;
}

export function foundrySite(input) {
    let url;
    try { url = new URL(input); } catch { throw new UserError('BAD_URL', 'Укажи полный адрес Foundry, включая http:// или https://.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new UserError('BAD_URL', 'Нужен адрес Foundry без логина и пароля в ссылке.');
    }
    if (url.hostname === 'longstoryshort.app' || url.hostname.endsWith('.longstoryshort.app')) {
        throw new UserError('BAD_URL', 'Укажи адрес Foundry, а не LSS.');
    }
    // Chrome host permissions cover all ports. Keep the exact origin separately.
    return { origin: url.origin, pattern: `${url.protocol}//${url.hostname}/*` };
}

export function sameOrigin(url, origin) {
    try { return new URL(url).origin === origin; } catch { return false; }
}

export function characterData(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new UserError('INVALID_RESPONSE', 'LSS вернул неожиданный формат персонажа.');
    }
    let data;
    try { data = typeof record.data === 'string' ? JSON.parse(record.data) : record.data; }
    catch { throw new UserError('INVALID_RESPONSE', 'Данные персонажа в LSS повреждены.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.name || !data.info) {
        throw new UserError('INVALID_RESPONSE', 'Не удалось прочитать лист персонажа LSS.');
    }
    return data;
}

function text(value) {
    const raw = value && typeof value === 'object' ? value.value : value;
    return typeof raw === 'string' || typeof raw === 'number' ? String(raw).slice(0, 250) : '';
}

export function characterSummary(record) {
    const data = characterData(record);
    return {
        id: characterId(record._id ?? record.id),
        name: text(data.name) || 'Безымянный персонаж',
        className: text(data.info.charClass),
        level: text(data.info.level),
        edition: text(record.edition),
    };
}

export function characterExport(record) {
    characterData(record);
    // Explicit allowlist: account metadata, permissions and session details stay out of Foundry.
    return {
        jsonType: 'character', version: '2', edition: record.edition,
        sheetEdition: record.sheetEdition, spells: record.spells,
        disabledBlocks: record.disabledBlocks, data: record.data,
    };
}

export function publicError(error) {
    return error instanceof UserError
        ? { code: error.code, message: error.message }
        : { code: 'INTERNAL', message: 'Операция не завершилась. Обнови список и попробуй снова.' };
}
