import { API_URL, COOKIE_NAME, LSS_URL, UserError, characterId, characterSummary, characterExport } from './core.mjs';

export function createLssClient(cookies, fetchFn = fetch) {
    async function token() {
        const cookie = await cookies.get({ url: LSS_URL, name: COOKIE_NAME });
        const value = cookie?.value?.replace(/^"|"$/g, '');
        if (!value || value === '0' || (cookie.expirationDate && cookie.expirationDate * 1000 <= Date.now())) {
            throw new UserError('AUTH_REQUIRED', 'Войди в аккаунт на сайте LSS.');
        }
        return value;
    }

    async function request(path) {
        const jwt = await token();
        let response;
        try {
            response = await fetchFn(`${API_URL}${path}`, {
                method: 'GET', headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
                credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
            });
        } catch {
            throw new UserError('NETWORK', 'LSS не отвечает. Проверь подключение и повтори попытку.');
        }
        if (response.status === 401) throw new UserError('AUTH_REQUIRED', 'Сессия LSS истекла. Войди снова.');
        if (response.status === 403) throw new UserError('FORBIDDEN', 'LSS не разрешил доступ к этим данным.');
        if (response.status === 429) throw new UserError('RATE_LIMIT', 'Слишком много запросов к LSS. Подожди немного.');
        if (!response.ok) throw new UserError('LSS_ERROR', 'Не удалось получить данные из LSS.');
        if (!response.headers.get('content-type')?.includes('application/json')) {
            throw new UserError('INVALID_RESPONSE', 'LSS вернул ответ, который расширение не умеет читать.');
        }
        const limit = 12 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > limit) throw new UserError('TOO_LARGE', 'Ответ LSS слишком большой.');
        // Stream with a byte limit: a missing Content-Length must not bypass the limit.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        let body = '';
        try {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.byteLength;
                if (size > limit) {
                    await reader.cancel();
                    throw new UserError('TOO_LARGE', 'Ответ LSS слишком большой.');
                }
                body += decoder.decode(part.value, { stream: true });
            }
            body += decoder.decode();
        } catch (error) {
            if (error instanceof UserError) throw error;
            throw new UserError('NETWORK', 'Загрузка данных LSS прервалась. Повтори попытку.');
        } finally { reader.releaseLock(); }
        try { return JSON.parse(body); }
        catch { throw new UserError('INVALID_RESPONSE', 'LSS вернул некорректный JSON.'); }
    }

    return {
        async list() {
            const records = await request('/character/list/');
            if (!Array.isArray(records) || records.length > 2000) {
                throw new UserError('INVALID_RESPONSE', 'Формат списка LSS изменился. Нужна проверка расширения.');
            }
            const characters = [];
            let skipped = 0;
            for (const record of records) {
                try { characters.push(characterSummary(record)); } catch { skipped++; }
            }
            return { characters, skipped };
        },
        async character(id) {
            const selectedId = characterId(id);
            const record = await request(`/character/${selectedId}/`);
            if (String(record?._id ?? record?.id) !== selectedId) {
                throw new UserError('INVALID_RESPONSE', 'LSS вернул другого персонажа. Импорт остановлен.');
            }
            return characterExport(record);
        },
    };
}
