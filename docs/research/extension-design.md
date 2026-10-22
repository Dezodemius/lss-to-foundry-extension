# Расширение «LSS ↔ Foundry»: исследование и черновик дизайна

Дата: 22.10.2026. Статус: исследование, код не написан. Контекст и ограничения: `F:\LongStoryShort\lss-to-foundry\docs\CONTEXT.md`.

Обозначения: «проверено» — есть источник (документация или исходный код конкретной версии). «не проверено» — вывод сделан по косвенным данным или не подтверждён, нужна проверка тестом или у владельца API.

---

## Резюме

1. **Связь страница ↔ расширение.** Проверенный паттерн: content script, который расширение регистрирует только для origin, подключённых пользователем (`scripting.registerContentScripts`, `persistAcrossSessions`). Модуль Foundry и мост обмениваются сообщениями через `window.postMessage`. Обязательны проверки `event.source === window` и `event.origin === location.origin`. Так устроен DDBI Utilities Extension (MIT), это лучший прецедент.
2. **Произвольный адрес Foundry.** `optional_host_permissions` (`http(s)://*/*`) плюс `permissions.request` по клику в popup, отдельно для каждого origin. В Chrome шаблон без порта матчит любой порт, поэтому `localhost:30000` покрывается. В Firefox порт в шаблоне не поддерживается, поведение на `localhost:30000` не проверено. `activeTab` для этой задачи не подходит: мост должен быть на странице до того, как пользователь что-то нажмёт.
3. **Авторизация в LSS (Dimension Door).** OAuth 2.0 Authorization Code + PKCE через `browser.identity.launchWebAuthFlow`. Authorize-страница на `longstoryshort.app`, обмен кода на `https://api.longstoryshort.app/oauth/token` с `client_id` `dimension-door` и scope `spells:read spells:write`. Access-токен (срок по `expiresIn`, по умолчанию 86400 с) лежит в `storage.local`, refresh-токена нет, пароль расширение не видит. В публичной документации LSS этого механизма нет. Нужна договорённость с LSS.
4. **Минус Dimension Door.** Bearer-токен LSS отправляется на сторонний хост `https://mana.pumpkin.quest/import`. Так делать нельзя. Исходник не публичен, лицензия «All Rights Reserved».
5. **Beyond20 и произвольные домены Foundry.** Постоянного скрипта на Foundry нет. Разрешение на origin запрашивается из popup (`optional_host_permissions: *://*/*`). На каждой загрузке вкладки, если origin разрешён или заголовок содержит «Foundry Virtual Tabletop», background через `scripting.executeScript` инжектит detection-скрипт. Он ищет в DOM `script[src*='foundry.js'|'foundry.mjs']` и только тогда подключает основной код. Связь со страницей идёт через `CustomEvent` (с `cloneInto` в Firefox) и page-script из `web_accessible_resources` с матчем `*://*/*`. Companion-модуль `FVTT-module/beyond20` по описанию в `module.json` нужен, чтобы броски видели другие игроки без расширения. Базовый канал работает через page-script (не проверено запуском). Лицензия GPL-3.0, код не копировать.
6. **Официальный путь LSS не подходит.** Встраивание листа через iframe и `postMessage` (`@longstoryshort/vtt-sdk`) работает только с доменов из белого списка LSS. `localhost` туда не добавляется, нужен CSP `frame-ancestors`. Foundry в таблице интеграций LSS помечен «Нет живой интеграции». Наш вариант LSS не встраивает, но ему нужен доступ к данным от LSS.
7. **Главный блокер.** LSS должен опубликовать (или санкционировать) доступ к списку персонажей, одному персонажу и гримуару для сторонних клиентов: OAuth-клиент, scopes, эндпоинты, контракт. По правилам проекта логиниться в LSS и обращаться к непубличным эндпоинтам нельзя. Запасной путь, который уже работает: ручной экспорт `.json` и импорт модулем.
8. **Безопасность.** Токен не покидает background. В страницу уходят только данные выбранных персонажей. `postMessage` виден всем скриптам страницы, включая чужие модули, это принимаем как допущение. Проверяем `sender.tab.url` по списку подключённых origin. Разрешения минимальные. Данные никуда, кроме Foundry-страницы пользователя и API LSS, не передаём.

---

## 0. Ограничения исследования и методика

- В LSS не логинился, LSS API и непубличные эндпоинты не вызывал. Эндпоинты из чужого кода (`/oauth/authorize/`, `/oauth/token`, `/spells/import`, `/character/:id`) описаны только как механизмы.
- Foundry не запускал, в каталоги Foundry ничего не писал, в репозиториях `lss-to-foundry` и `lss-to-foundry-extension` файлов, кроме этого документа, не создавал, не коммитил.
- Скачал `dimension_door-0.5.2.xpi` с AMO (542 256 байт, SHA-256 `53664673641859c5452438309290ffae9a4b9e020cb6dd8ff11eeeb1baacdd59` совпал с хешем в API AMO). Распаковал в `C:\Users\gladk\AppData\Local\Temp\claude\F--\95661564-12af-4309-96e1-17d00d964db2\scratchpad\dimension-door\src-xpi\`. Не запускал.
- Клонировал с `--depth 1` в scratchpad (не запускал, зависимости не ставил): `kakaroto/Beyond20` (commit `5edd6af`, 17.09.2026), `MrPrimate/ddb-importer` (commit `44bb451`, 19.10.2026), `MrPrimate/ddbi-utilities-extension` (commit `40c7f29`, 11.10.2026).
- Документация Chrome и MDN, а также политики Chrome Web Store и AMO, читались через WebFetch. Это пересказ модели, не дословный текст. Цитаты короткие, в основном формулировки пересказаны.
- Страница Dimension Door в Chrome Web Store не открылась (редирект на `consent.google.com`). Разрешения и «privacy practices» CWS не получены, не проверено.

---

## 1. Связь страницы Foundry и расширения

### 1.1 Изолированный мир

- Chrome: content script работает в isolated world, переменные не видны странице и другим расширениям. Общий у них только DOM. Источник: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts (проверено).
- Firefox: вместо isolated world описан Xray vision. Объекты, созданные страницей, content script не видит напрямую. Чтобы передать объект в страницу (например, в `detail` у `CustomEvent`), нужен `cloneInto`. Источники: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts (проверено), https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts/cloneInto (проверено по выдаче).
- Beyond20 делает так: `sendCustomEvent` в `src/common/utils.js` (строки 105–110) вызывает `cloneInto(data, window)` при `getBrowser() === "Firefox"`.

### 1.2 Канал «страница ↔ content script»

Рекомендованный канал — `window.postMessage`. Проверки на стороне получателя, которые делает DDBI:

```js
// ddbi-utilities-extension/src/foundry-bridge.js, проверено
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== "object" || data.source !== PAGE_SOURCE) return;
  // ...
});
```

Модуль (`src/lib/UtilitiesExtension.ts` в ddb-importer) делает то же зеркально и отправляет с `targetOrigin = window.location.origin`, а не `"*"`.

Ограничения канала:

- `postMessage` доставляется всем слушателям окна. Любой скрипт страницы, включая чужие модули Foundry, видит все сообщения, которые мы шлём и получаем. Это вывод из описания канала, а не прямая формулировка документации (не проверено по тексту, но следует из модели DOM). Поэтому токены LSS в канал не попадают никогда. Персонажи в канал попадают только по запросу, после выбора пользователя.
- `CustomEvent` на `document` (как в Beyond20) имеет то же свойство. Для нашего случая не предпочтительнее `postMessage`.
- Документация Chrome прямо рекомендует для связи с веб-страницей `window.postMessage` с проверкой `event.source`, и предупреждает, что работа с недоверенным содержимым страницы опасна (`eval` и т.п.). Источник: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts (проверено по выдаче), https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts (проверено по выдаче).

### 1.3 Как модуль узнаёт, что расширение установлено

Из страницы напрямую не узнать, установлено ли расширение на другом origin:

- `externally_connectable` (страница → `runtime.sendMessage(extensionId)`) в Chrome работает, но только со статическими `matches` в манифесте. Это не получится сделать для произвольного адреса Foundry. Firefox описывает `externally_connectable` так: «In Firefox, neither API is supported». Источники: https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable (проверено по выдаче), https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/externally_connectable (проверено по выдаче). Вывод: в Chrome и Firefox идём через content script.
- Опрос через `web_accessible_resources` (страница пытается загрузить ресурс расширения) позволяет любому сайту определить, что расширение стоит. Так делает Beyond20 (`web_accessible_resources` с `*://*/*`). Не рекомендуем.

Рабочая схема, как у DDBI (`ddbi-hello` → `ddbi-ready`):

1. Мост регистрируется для подключённого origin и при загрузке сам посылает `ready`.
2. Модуль при `ready` Foundry (и при неудаче ещё несколько раз через 1–2 с) посылает `hello`.
3. Ответ `ready` содержит версию расширения, поддерживаемые версии протокола и признак, вошёл ли пользователь в LSS.
4. Если ответа нет, модуль показывает «Подключите этот сайт в расширении LSS to Foundry».

### 1.4 Content script ↔ background

- `runtime.sendMessage` для одноразовых запросов с ответом. Асинхронный ответ требует `return true` из обработчика (Chrome). Источник: https://developer.chrome.com/docs/extensions/develop/concepts/messaging (проверено по выдаче). Есть ограничение размера сообщения 64 MiB (там же).
- `runtime.connect` (порт) удобен для долгих операций (несколько персонажей, гримуар) и для онлайн-статуса. Ограничения service worker те же, см. ниже.
- Проверка отправителя в background (как у DDBI): `sender.id === chrome.runtime.id`, `sender.tab` существует, `sender.tab.url` попадает в список подключённых origin (`src/background.js` DDBI, функция `senderIsConnected`). Поле `frameId` в `MessageSender` в этом исследовании не сверено по справочнику runtime. Проверить.
- Chrome service worker: глобальное состояние ненадёжно, `setTimeout` и `setInterval` обрываются при остановке, состояние хранится в `storage`, отложенная работа через `alarms`. Источник: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers (проверено по выдаче). В той же статье: `fetch` дольше пяти минут и вычисления дольше 30 секунд прерываются.
- Firefox MV3 не поддерживает `background.service_worker` (bug 1573659). Фон работает как event page через `background.scripts`, состояние в `storage`, отложенная работа через `alarms`. Источник: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background (проверено по выдаче).

---

## 2. Произвольный адрес Foundry (localhost, IP, свой домен)

### 2.1 Механизм «подключить сайт», как у DDBI (рекомендуем)

Проверено по `ddbi-utilities-extension/src/popup/connect.js`, `src/foundry-sites.js`, `manifest.json`:

1. В `manifest.json`: `"optional_host_permissions": ["http://*/*", "https://*/*"]`. Фиксированных хостов Foundry нет.
2. Пользователь открывает popup на вкладке Foundry и жмёт «Подключить». Именно клик вызывает `chrome.permissions.request({ origins: [pattern] })`. Документация Chrome: запрос разрешений должен выполняться внутри пользовательского жеста, например обработчика клика по кнопке. Источник: https://developer.chrome.com/docs/extensions/reference/api/permissions (проверено по выдаче).
3. Регистрируется content script на этот шаблон:

```js
await chrome.scripting.registerContentScripts([{
  id: `lss-bridge:${pattern}`,        // не начинается с "_"
  matches: [pattern],                 // например "http://localhost/*"
  js: ["src/bridge.js"],
  runAt: "document_idle",
  allFrames: false,
  persistAcrossSessions: true,        // по умолчанию true (Chrome)
}]);
await chrome.scripting.executeScript({ target: { tabId }, files: ["src/bridge.js"] }); // без перезагрузки
```

   Источники: https://developer.chrome.com/docs/extensions/reference/api/scripting (проверено по выдаче: `persistAcrossSessions` по умолчанию true, `allFrames` по умолчанию false, `registerContentScripts` с Chrome 96, `world` с Chrome 102). Firefox: `scripting` в MV3 с Firefox 101, для регистрации нужны разрешение `scripting` и доступ к странице через `host_permissions` или `activeTab`. Источник: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/registerContentScripts (проверено по выдаче).
4. Список подключённых сайтов хранится как сами зарегистрированные скрипты (`getRegisteredContentScripts`), как у DDBI. Альтернатива: своя копия в `storage.local`. Рекомендуем свою копию как источник истины: в MDN сказано, что при обновлении расширения content scripts очищаются и их надо восстановить в `runtime.onInstalled` с `reason: "update"`. Источник: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/RegisteredContentScript (проверено по выдаче).
5. Отключение: `unregisterContentScripts` и `permissions.remove` (как у DDBI).

### 2.2 Шаблоны и порты

- Chrome: «Match patterns match all ports unless an explicit port is specified». Значит, `http://localhost/*` матчит `http://localhost:30000/`. Явный порт тоже поддерживается: `http://localhost:30000/*`. Источник: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns (проверено по выдаче). Явный порт сужает доступ и рекомендуется для Chrome.
- Firefox: порт в хосте не поддерживается (ссылки на баги 1362809 и 1468162). Совпадение `http://localhost/*` с `localhost:30000` на странице MDN не подтверждено, нужна проверка. Источник: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns (проверено по выдаче).
- Beyond20 учитывает это явно: в `src/extension/popup.js` (строки 486–488) и `background.js` origin строится без порта, с комментарием про Firefox. DDBI тоже строит шаблон без порта (`sitePattern` в `foundry-sites.js`), с пометкой, что так покрывается любой порт хоста, «что нужно Foundry на localhost».
- Пути в шаблоне обязательны: `https://host/*`. Фрагменты игнорируются.
- Wildcard в хосте: `*.example.com` допустим, `google.*` (TLD) не поддерживается. Источник: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns (проверено по выдаче).
- IP-адреса: страница Chrome упоминает `127.0.0.1`. Для LAN-адресов вида `192.168.x.x` прямого подтверждения не нашли. По коду DDBI `sitePattern` принимает любой hostname, включая IP. Это предположение, не проверено. Также не проверено, как Chrome Local Network Access влияет на доступ расширения к локальным адресам.

### 2.3 activeTab как альтернатива

`activeTab` даёт временный доступ к вкладке в момент клика. Так работает Dimension Door: `scripting.executeScript` на выбранной вкладке по клику, без постоянной регистрации. Источник: https://developer.chrome.com/docs/extensions/reference/api/scripting (проверено по выдаче: доступ через `host_permissions` или `activeTab`). Для нашего сценария это не годится: мост должен отвечать модулю, который спрашивает сам по себе, без клика по иконке.

### 2.4 Beyond20: как работает с произвольными доменами

Проверено по `kakaroto/Beyond20`, commit `5edd6af`:

- Манифест: `host_permissions` только для D&D Beyond, Roll20, `*://*.forge-vtt.com/game`; `optional_host_permissions: ["*://*/*"]`; content_scripts для Foundry нет.
- Пользовательские домены хранятся в настройке `custom-domains` (`src/common/settings.js`, строка 69; функция `isCustomDomainUrl` в `src/common/utils.js`). Foundry отделён от этой настройки (`isFVTT` идёт раньше).
- Определение Foundry: заголовок вкладки содержит «Foundry Virtual Tabletop» (`isFVTT` в `utils.js`), или origin в списке разрешённых.
- `background.js`, `onTabsUpdated` (строки ~396–440): на `status: complete` для подходящей вкладки, если origin есть в `currentPermissions.origins`, вызывается `executeScripts([tab], ["dist/fvtt_test.js"])`. Это `src/fvtt/check-tab.js`, он ищет `script[src*='foundry.js'], script[src*='foundry.mjs']` и посылает `activate-icon`.
- Обработчик `activate-icon` (строки ~297–306) для Foundry вызывает `injectFVTTScripts`: `libs/alertify.min.js`, `libs/jquery-3.4.1.min.js`, `dist/fvtt.js` (`src/fvtt/content-script.js`). Дальше page-script `dist/fvtt_script.js` загружается в страницу через `<script src=chrome-extension://…>` (`src/fvtt/content-script.js`, `injectPageScript`). Для этого ресурс объявлен в `web_accessible_resources` с `*://*/*`.
- Связь content → page: `document.dispatchEvent(new CustomEvent("Beyond20_" + name, { detail }))`.
- Поток «подключения» для произвольного origin: `src/extension/popup.js`, строки ~484–501. Пользователь нажимает кнопку, `permissions.request({ origins: [protocol//hostname/*] })`. Затем вкладка обрабатывается обычным путём.
- Модуль `FVTT-module/beyond20` (`module.json`, версия 1.5.5, совместим с Foundry 13): описан как companion, нужный, чтобы броски правильно показывались в основном окне Foundry и другим игрокам без расширения. Из этого следует, что базовый канал «расширение → Foundry» работает без модуля через page-script. Не проверено запуском.

Итог по Beyond20: постоянного скрипта на Foundry нет. Доступ выдаётся на origin через popup. Инъекция идёт динамически при каждой загрузке вкладки, в которой нужна работа. Страница получает код через page-script, загружаемый из расширения.

---

## 3. Chrome и Firefox MV3: различия, которые влияют на дизайн

| Аспект | Chrome (MV3) | Firefox (MV3) | Источник |
|---|---|---|---|
| Фоновый код | `background.service_worker`. Ключ `scripts` в MV3 игнорируется начиная с Chrome 121 | `background.scripts` как event page. `service_worker` не поддерживается (bug 1573659) | MDN background; developer.chrome.com service-workers migration |
| Состояние фона | Только `storage`, таймеры через `alarms` | То же (event page выгружается) | Chrome to-service-workers; MDN background |
| Регистрация скриптов | `registerContentScripts`, Chrome 96+; `persistAcrossSessions` по умолчанию `true` | MV3 с Firefox 101. Поля `world` и `persistAcrossSessions` на странице MDN не подтверждены. После обновления расширения скрипты очищаются | developer.chrome.com scripting; MDN scripting; MDN RegisteredContentScript |
| Порт в match-шаблоне | Поддерживается. Без порта матчится любой порт | Не поддерживается | developer.chrome.com match-patterns; MDN Match_patterns |
| Страница → расширение напрямую | `externally_connectable`, только статические `matches` | Не поддерживается | developer.chrome.com; MDN externally_connectable |
| Изоляция | isolated world | Xray vision, `cloneInto` для объектов в страницу | developer.chrome.com content-scripts; MDN Content_scripts |
| OAuth-редирект | `https://<app-id>.chromiumapp.org/*`, `launchWebAuthFlow` с Chrome 106+ | `browser.identity.getRedirectURL()` в рантайме, не хардкодить. Домен не проверен | developer.chrome.com identity; MDN identity |
| Пространство имён | `chrome.*`. Стандартизированный `browser.*` в баннере Chrome отмечен с Chrome 148 | `browser.*` | developer.chrome.com |
| Разрешения и данные | CWS: Limited Use, privacy policy | AMO: `browser_specific_settings.gecko.data_collection_permissions` в манифесте, встроенное согласие с Firefox 140+ | CWS limited-use; extensionworkshop.com add-on policies |
| Предлагаемая минимальная версия | Chrome 111 (как у DDBI) | Firefox 128 (как у DDBI) | manifest и README `ddbi-utilities-extension` |

Рекомендация: в `manifest` держать оба ключа фона. Так советует MDN в примере: `"background": { "scripts": [...], "service_worker": ... }`. Источник: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background (проверено по выдаче).

Для кода, который работает в обоих браузерах: `webextension-polyfill` (MIT) даёт `browser.*` с промисами в Chrome. Рекомендация, не проверено по репозиторию polyfill в этом исследовании. DDBI обходится без него, отдельной сборкой Firefox с заменой фона.

---

## 4. Получение данных LSS от имени пользователя без пароля

### 4.1 Варианты

**A. OAuth 2.0 Authorization Code + PKCE через `identity.launchWebAuthFlow` (рекомендуем, если LSS даст доступ).**
Так делает Dimension Door (см. 5.1). Шаги по коду Dimension Door (`background.js`, функция `re`):

1. `verifier` — 32 случайных байта, base64url. `challenge` — SHA-256 от `verifier`, base64url. `state` — 16 случайных байт.
2. `redirect_uri = identity.getRedirectURL()`.
3. Открывается окно `launchWebAuthFlow({ url: "https://longstoryshort.app/oauth/authorize/?response_type=code&client_id=dimension-door&scope=spells:read spells:write&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…", interactive: true })`.
4. Ответ проверяется: `error`, `state`, наличие `code`.
5. POST `https://api.longstoryshort.app/oauth/token` с JSON `{grant_type: "authorization_code", code, redirect_uri, code_verifier, client_id}`. Ответ: `{accessToken, expiresIn}`.
6. Токен и время истечения сохраняются в `storage.local` (ключи `authToken`, `authTokenExp`). Срок: из `expiresIn` (число или строка вида `24h`), по умолчанию 86400 с. Токен считается истёкшим за 60 с до срока. При ответе 401 токен удаляется.
7. Refresh-токена в коде нет. После истечения срока пользователь входит заново.

Проверено по коду Dimension Door (распакованный xpi, не запускался). Публичной документации LSS по этому OAuth в `Guildhall/docs` не нашлось (поиск по `oauth`, `client_id`, `bearer`, `scope`).

Chrome: `launchWebAuthFlow` требует разрешения `identity`, окно закрывается, когда провайдер редиректит на `*.chromiumapp.org/*`. `interactive: true` нужен, если пользователь должен действовать в окне. Источник: https://developer.chrome.com/docs/extensions/reference/api/identity (проверено по выдаче). Firefox: `interactive: true` стоит ставить только при действии пользователя, без него поток может завершиться с ошибкой. Источник: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/launchWebAuthFlow (проверено по выдаче).

Плюсы: пароль не виден расширению; токен со scope; вход работает любым способом, который LSS поддерживает (LSS-доки описывают Google, Яндекс и почту с паролем). Минусы: нужен OAuth-клиент и scope от LSS; срок токена и отсутствие refresh-токена (по коду Dimension Door) означают повторный вход раз в сутки; редиректы привязаны к ID расширения (Chrome) и к UUID (Firefox), их придётся регистрировать у LSS (не проверено, как Firefox формирует домен).

Важно про вход через Google: в `Guildhall/docs/user-guides/social-login.mdx` сказано, что вход через Google для пользователей из России может быть недоступен или ограничен. Для OAuth-потока это значит, что у таких пользователей вход должен идти через Яндекс или почту с паролем.

**B. Cookie-based (как DDBI с `CobaltSession`).**
DDBI читает cookie через `chrome.cookies.get` (host permission на `dndbeyond.com`) и отдаёт странице только по запросу подключённого сайта. Механика проверена по `src/background.js` DDBI. Для LSS:
- Из `Guildhall/docs/developers/embedding/sdk-guide.mdx` видно, что лист LSS живёт на `longstoryshort.app` и читает куку авторизации своего origin. Значит, сессия LSS основана на cookie.
- Chrome описывает, что запросы из расширения к сайту с host permission считаются same-site, и SameSite=Strict может уходить. Источник: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies (проверено по выдаче). Для service worker поведение не проверено.
- Использование cookie для запросов к LSS означает обращение к непубличным эндпоинтам. Это запрещено правилами проекта. Не рекомендуем, даже если технически работает.

**C. Content script на вкладке `longstoryshort.app`.**
Вариант через официальный лист (iframe) не подходит: событий со списком персонажей в протоколе листа нет. Перечень: `lss:roll`, `lss:manifest`, `dnd:health` и зарезервированные команды. Источник: `Guildhall/docs/developers/embedding/index.mdx`. Не рекомендуем.

**D. Ручной экспорт (уже есть).**
Пользователь скачивает персонажа из LSS (кнопка «Скачать .json») и кладёт в модуль. Заклинания из гримуара тоже экспортом (`Guildhall/docs/developers/characters.mdx`: заклинание не из SRD найдётся, только если оно в гримуаре того, кто импортирует, и файл заклинаний нужно отдать вместе с персонажем). Это запасной путь, который не требует расширения.

### 4.2 Что расширение не должно делать

- Не отдавать токен или cookie странице Foundry ни при каких условиях.
- Не отправлять токен и данные на сторонние серверы (см. 5.1 и 5.3, как этого избегают).
- Не хранить копии персонажей в расширении: список и данные идут сразу в модуль, модуль хранит их в мире Foundry.

---

## 5. Прецеденты

### 5.1 Dimension Door (расширение для LSS, PumpkinQuest)

Проверено по странице `https://pumpkin.quest/lss/dimension-door/`, листингу AMO (https://addons.mozilla.org/api/v5/addons/addon/dimension-door/) и распакованному xpi (листинг на AMO создан 28.09.2026, текущая версия 0.5.2 от 02.10.2026).

- Назначение: сохраняет описание заклинания со страниц dnd.su и dndvault.ru в гримуар LSS одним кликом. Описание на AMO: `activeTab`-доступ только в момент клика, «неофициальный фанатский инструмент».
- Разрешения (manifest): `activeTab`, `scripting`, `storage`, `identity`. `host_permissions`: `https://api.longstoryshort.app/*` и `https://mana.pumpkin.quest/*`. `data_collection_permissions` (Firefox): `authenticationInfo`, `browsingActivity`, `websiteContent`. Минимальная версия Firefox 109.
- Авторизация: см. 4.1-A. Вход выполняется через OAuth с PKCE, как написано в описании на AMO («защищённым OAuth»).
- Запросы к API (из background и popup):
  - `GET https://api.longstoryshort.app/spells/import?source&entityType&sourceId` с Bearer. Проверка, есть ли заклинание в гримуаре (`owned`).
  - `POST https://mana.pumpkin.quest/import` с Bearer и JSON заклинания. Коды ответа: 401 (сессия истекла), 429 (лимит), 422 (не распознано), 502. Ответ: статус `owned`, `cached` или `created`. Не проверено, что `mana` делает с токеном на своей стороне, сервер не доступен.
  - `GET https://mana.pumpkin.quest/dimension-door/config.json` и `supported-sites.json`, с `credentials: "omit"`. Это удалённые правила (CSS-селекторы для сайтов), данные, не код. Кэш в `storage.local`.
- Захват страницы: `chrome.scripting.executeScript` на активной вкладке с функцией, которая по селекторам читает блок заклинания.
- Лицензия в AMO: «All Rights Reserved». Публичного репозитория не нашли. В манифесте `background` задан через `scripts` (сборка для Firefox).
- Политика конфиденциальности: в ответе AMO API поля `privacy_policy` нет (проверено по выдаче API), ссылка на поддержку только по email.
- Что брать из этого: сам факт, что OAuth LSS существует и доступен сторонним клиентам с `client_id` и scopes. Чего не делать: отправлять токен на сторонний хост, писать без политики конфиденциальности, писать многоцелевой код без разделения обязанностей.

### 5.2 Beyond20 (D&D Beyond → Roll20/Foundry)

Проверено по исходникам `kakaroto/Beyond20`, версия 2.21.0, commit `5edd6af`. Детали см. раздел 2.4.

- Foundry-часть через динамические инъекции и `CustomEvent`. Постоянных скриптов на Foundry нет.
- Модуль `FVTT-module/beyond20` (версия 1.5.5, совместим с Foundry 13). Companion для видимости бросков другим игрокам.
- Лицензия GPL-3.0 (файл `LICENSE` в репозитории). Код в нашем расширении не использовать, брать идеи.

### 5.3 DDBI Utilities Extension и ddb-importer (MrPrimate)

Проверено по `ddbi-utilities-extension` (MIT), commit `40c7f29`, и `ddb-importer` (MIT), commit `44bb451`.

Это самый близкий прецедент: расширение, которое отдаёт модулю Foundry данные пользователя из другого сайта.

- Подключение сайта: popup, `permissions.request` по клику, `registerContentScripts` с `persistAcrossSessions: true`, затем `executeScript` в текущую вкладку (`src/popup/connect.js`).
- Мост на странице (`src/foundry-bridge.js`): проверки `source`/`origin`, ответ `ddbi-ready` на `ddbi-hello`, relay запросов от background в страницу и обратно, таймаут подтверждения (3 с) и таймаут результата (10 мин).
- Модуль (`src/lib/UtilitiesExtension.ts`): `requestId`, таймаут 5 с, подтверждение пользователя через `foundry.applications.api.DialogV2.confirm` перед первым использованием, настройка `ask/always/never`.
- Background (`src/background.js`): cookie отдаётся только при `senderIsConnected`. Всем остальным страницам ответ `{cobalt: null}`. Изменение логина на dndbeyond.com уведомляет подключённые вкладки без cookie.
- Политика конфиденциальности (`PRIVACY.md`, 11.10.2026): сервера нет, ничего не уходит по сети самим расширением, cookie только подключённым сайтам. Хороший образец для нашего `PRIVACY.md`.
- Версия Chrome: `minimum_chrome_version: 111`. Firefox 128+ (README).

ddb-importer (сам модуль) получает cookie через ручную вставку или через расширение, а вызовы к D&D Beyond проксируются (`ddb-proxy`). По README прокси вызывает D&D Beyond с учётными данными пользователя. Автор пишет, что cookie на сервере не хранится, это не проверено. Урок: не отправлять сессию на сторонний прокси. Для нас это антипаттерн, который мы не повторяем.

### 5.4 Официальный путь LSS (iframe SDK, мосты для VTT)

Проверено по `Guildhall/docs/developers/`:

- Лист можно встроить в iframe (`https://longstoryshort.app/iframe/characters/list/`) и общаться через `postMessage`. Для этого нужен `SHEET_IFRAME_SANDBOX` с `allow-same-origin` и `allowedOrigins: ['https://longstoryshort.app']`.
- Встроенное приложение открывается только с доменов из белого списка. `localhost` туда не добавляется, нужен рабочий домен. Для регистрации домена LSS добавляет его в CSP `frame-ancestors`. Источники: `embedding/index.mdx`, `embedding/groups.mdx`.
- В `contribute.mdx` Foundry VTT отмечен как «Нет живой интеграции». Там же написано, что для Foundry принципиальных ограничений нет, и LSS готов обсуждать мост. Контакт: @shakusky (Telegram), `shakusky.lss` (Discord), сообщество VK.
- Вывод: официальный iframe-путь не подходит для адресов `localhost` и LAN. Но проект LSS открыт к интеграции с Foundry, это аргумент в переговорах о OAuth-клиенте.

---

## 6. Безопасность и публикация

### 6.1 Минимальные разрешения (предложение)

| Что | Зачем | Почему достаточно |
|---|---|---|
| `identity` | OAuth-вход | Без него нет `launchWebAuthFlow` |
| `storage` | Токен, список подключённых сайтов | `storage.local`; `storage.session` рассмотреть (см. 9) |
| `scripting` | Регистрация моста на подключённый origin | `registerContentScripts`, `executeScript` |
| `activeTab` | Немедленная инъекция моста в текущую вкладку после подключения | Временный доступ по клику |
| `host_permissions`: только хост API LSS | Запросы из background | Хост уточнить |
| `optional_host_permissions`: `http(s)://*/*` | Подключение Foundry по адресу пользователя | Выдаётся по клику на один origin |

Без `cookies`, без `tabs` (нужное берём из `sender`), без `<all_urls>`. Для store-листинга обоснование каждого разрешения.

### 6.2 Границы доверия

| Участник | Доверяем | Что проверяем |
|---|---|---|
| Foundry-страница (подключённый origin) | Только как пользователя, который сам подключил сайт | Схема сообщения, типы, длины строк, максимум 50 id в запросе. Ответ без токенов |
| Content script (мост) | Только как релей | Отправитель `event.source` и `origin`. Токен не хранит и не получает |
| Background | Держит токен и знает, какие origin подключены | `sender.id`, `sender.tab.url` в списке подключённых, `frameId` (проверить), версия протокола |
| Popup | Единственное место для входа, подключения и отключения | `sender.url` начинается с `chrome-extension://<id>/`. Вход только по клику |
| Чужие скрипты на Foundry (модули) | Не доверяем | Видят все `postMessage`. Поэтому токен не передаём, данные персонажей отдаём только по запросу |

### 6.3 Угрозы и меры

- **Другие модули Foundry или XSS на странице** могут вызвать мост и получить список и данные выбранных персонажей. Мера: в канале нет токенов, список отдаёт только сводку (id, имя, класс, уровень), полные данные только по выбранным id. Это допущение: данные персонажей не секрет, а Foundry и так доверенная среда.
- **Чужой сайт на том же хосте** (другое приложение на `localhost` с другим портом) получит мост, если шаблон без порта. Мера: в Chrome подключать с явным портом. В Firefox порт не поддерживается, остаётся риск, его надо описать пользователю.
- **Подключение не того origin.** Мера: показывать в popup точный origin и кнопку отключения.
- **Утечка токена.** Токен лежит в `storage.local` (доступен только расширению и пользователю браузера). Мера: не логировать, не отдавать в страницу, очищать при 401.
- **Долгие операции в service worker** (Chrome останавливает его при простое; `fetch` дольше 5 мин и вычисления дольше 30 с прерываются). Мера: запрашивать персонажей по одному, порт `runtime.connect` для длинных операций, таймаут на стороне модуля.
- **Сбой регистрации после обновления** (Firefox очищает скрипты). Мера: источник истины в `storage.local`, восстановление в `runtime.onInstalled`.

### 6.4 Требования магазинов

- **Chrome Web Store, Limited Use** (версия страницы 2022-11-01). Данные используются только для заявленной функции. Передача третьим лицам допустима только для основной функции (или по закону). Продажа и передача рекламным брокерам запрещены. Нужна privacy policy со ссылкой с листинга и заявлением о соответствии Limited Use. Источник: https://developer.chrome.com/docs/webstore/program-policies/limited-use (проверено по выдаче). Для cookie и auth-данных отдельных правил на странице нет.
- **AMO (add-on policies).** Передача данных ограничена необходимым для функции. Передача локальных или пользовательских данных сайтам и приложениям запрещена (раздел 6.3, п. 1). Для Firefox 140+ тип данных нужно точно описать в манифесте (`data_collection_permissions`, см. Dimension Door). Удалённый код запрещён, конфигурация как данные допустима. Обфускация запрещена, минификация разрешена. Исходный код до сборки и инструкции по сборке нужны для ревью. Источник: https://extensionworkshop.com/documentation/publish/add-on-policies/ (проверено по выдаче).
- Передача токена или персонажей на сторонний сервер (как у Dimension Door или ddb-importer) по политикам AMO и CWS проблемная. Мы не делаем этого: данные идут только в Foundry-страницу, которую выбрал пользователь, и в API LSS.
- Название «Long Story Short» и логотипы: указать, что расширение неофициальное, если LSS не даст иное. Согласовать с LSS.

---

## 7. Черновик протокола «модуль ↔ расширение»

Два канала:

- **A. Модуль Foundry ↔ мост** (`window.postMessage`, `targetOrigin = location.origin`).
- **B. Мост ↔ background** (`runtime.sendMessage` или порт). Popup ↔ background тоже `runtime.sendMessage`.

### 7.1 Конверт (канал A)

Модуль → расширение:

```json
{ "source": "lss-to-foundry", "v": 1, "id": "7b2c…", "type": "characters.list", "payload": {} }
```

Расширение → модуль (ответ):

```json
{ "source": "lss-extension", "v": 1, "id": "7b2c…", "ok": true, "payload": { } }
{ "source": "lss-extension", "v": 1, "id": "7b2c…", "ok": false, "error": { "code": "AUTH_REQUIRED", "message": "…" } }
```

Служебное событие без запроса: `ext.ready` (мост посылает сам при загрузке и в ответ на `ext.hello`).

### 7.2 Типы сообщений (канал A)

| type | Направление | payload (запрос) | payload (ответ) | Заметки |
|---|---|---|---|---|
| `ext.hello` | модуль → мост | `{ moduleVersion, protocols: [1] }` | — | Повтор через 1 с, до 5 раз |
| `ext.ready` | мост → модуль | — | `{ extVersion, protocols: [1], capabilities: ["characters.list","characters.get","grimoire.get"], loggedIn, session }` | `session` — случайная строка на загрузку моста. Нужна, чтобы заметить перезагрузку моста, а не защита от других скриптов |
| `auth.status` | модуль → мост | `{}` | `{ loggedIn, expiresAt }` | Токен не отдаётся |
| `characters.list` | модуль → мост | `{}` | `{ characters: [{ id, name, className, level, raceName, updatedAt }] }` | Только сводка |
| `characters.get` | модуль → мост | `{ ids: [string] }`, максимум 50 | `{ characters: [файл персонажа LSS] }` | Объекты того же формата, что файл экспорта (`jsonType`, `version`, `edition`, `spells`, `data`) |
| `grimoire.get` | модуль → мост | `{ spellIds?: [string], all?: boolean }` | `{ spells: [объекты заклинаний] }` | Дедупликация по id делает модуль. Формат заклинаний уточнить у LSS |

Вход модуль не запускает: если `loggedIn: false`, модуль просит пользователя нажать иконку расширения. Так OAuth-окно открывается только по действию в popup.

### 7.3 Ошибки (`error.code`)

- `AUTH_REQUIRED`: пользователь не вошёл в LSS.
- `AUTH_EXPIRED`: токен истёк, нужен повторный вход.
- `LSS_UNAVAILABLE`, `LSS_RATE_LIMITED`, `LSS_NOT_FOUND`: ошибки API LSS.
- `PROTOCOL_UNSUPPORTED`: версия протокола модуля не поддерживается мостом.
- `BAD_REQUEST`: неверная схема или типы в запросе.
- `INTERNAL`: прочее.

На стороне модуля (не из моста): `NO_BRIDGE` (ответа на `hello` нет, подключите сайт), `TIMEOUT`.

### 7.4 Версии и таймауты

- `v` — целое число. Расширение объявляет список поддерживаемых версий в `ext.ready`. Модуль отказывается работать с мостом без своей версии.
- Добавление полей и типов — без смены версии. Ломающие изменения — `v: 2`, с переходным периодом.
- Таймауты: `ext.hello` 1 с (повторы), `auth.status` 3 с, `characters.list` 15 с, `characters.get` 60 с (по персонажу, если пакетно нельзя).
- Валидация с обеих сторон: тип значения, длина строк (например, до 256), размер массивов (`ids` до 50), неизвестные `type` молча игнорируются.

### 7.5 Внутренний протокол (канал B)

- Мост → background: `{ kind: "bridge", op: "characters.list", reqId, payload }`. Background проверяет `sender.id`, `sender.tab`, `sender.tab.url` в списке подключённых origin, версию протокола.
- Popup → background: `{ kind: "popup", op: "login" | "logout" | "connect" | "disconnect" | "list-sites" }`. Проверка `sender.url` (префикс `chrome-extension://<id>/`).
- Все ответы background — `sendResponse` после `return true`.

### 7.6 Последовательность

1. Пользователь на вкладке Foundry открывает popup, жмёт «Подключить этот сайт». `permissions.request` → `registerContentScripts` → `executeScript(bridge)`.
2. Модуль: `ext.hello` → `ext.ready` (`loggedIn: false`). Модуль показывает «Войдите в LSS через иконку расширения».
3. Пользователь входит через popup (`launchWebAuthFlow`), токен сохраняется.
4. Нажата «Импорт из LSS»: `characters.list` → диалог с чекбоксами (в Foundry v13 через `DialogV2`, как в DDBI) → выбор → `characters.get` и при необходимости `grimoire.get` → импорт через существующий парсер модуля, но из объектов, а не из файла.

---

## 8. Архитектура расширения (черновик)

### 8.1 Файлы

```
lss-to-foundry-extension/
  manifest.base.json          общие поля
  tools/build.mjs             сборка dist/chrome и dist/firefox (как у DDBI)
  src/background.js           фон: OAuth, клиент LSS, роутинг, проверки отправителя
  src/auth.js                 PKCE, launchWebAuthFlow, хранение токена
  src/lss-client.js           запросы к LSS (заглушка, пока нет контракта API)
  src/bridge.js               content script на подключённом origin, postMessage <-> runtime
  src/sites.js                sitePattern, scriptId, connectedSites (по образцу DDBI, MIT, с указанием авторства)
  src/protocol.js             константы типов, коды ошибок, валидаторы (общие для моста и background)
  src/popup/popup.html|js|css вход, выход, подключить сайт, список и отключение
  test/                       node:test: sites.js, protocol.js
  PRIVACY.md                  политика с заявлением Limited Use
  README.md                   текст для листинга
  LICENSE                     MIT (решить; GPL-код не использовать)
```

Код для модуля Foundry (отдельный репозиторий `lss-to-foundry`, не этот): `src/lss-bridge.js` (hello, таймауты, очереди запросов) и UI «Импорт из LSS» с выбором персонажей.

### 8.2 Manifest, Chrome (фрагмент, черновик)

```json
{
  "manifest_version": 3,
  "name": "LSS to Foundry",
  "version": "0.1.0",
  "minimum_chrome_version": "111",
  "permissions": ["identity", "storage", "scripting", "activeTab"],
  "host_permissions": ["https://<ХОСТ-API-LSS>/*"],
  "optional_host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup/popup.html" }
}
```

### 8.3 Manifest, Firefox (отличия)

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "lss-to-foundry@<домен>",
      "strict_min_version": "128.0",
      "data_collection_permissions": { "required": ["authenticationInfo", "websiteContent"] }
    }
  },
  "background": { "scripts": ["background.js"], "service_worker": "background.js" }
}
```

Пояснения:
- Ключ `service_worker` оставлен для совместимости, Firefox его не использует. Источник: MDN background (пример с двумя ключами).
- Для Chrome собирается без `browser_specific_settings`. Чтобы не тянуть в Chrome лишнее, сборка через `tools/build.mjs` (как у DDBI) убирает ключ `scripts`, если нужно.
- Категории `data_collection_permissions`: `authenticationInfo` (токен), `websiteContent` (персонажи). Таксономия по документации AMO не проверена, сверить.
- Для Firefox `strict_min_version` 128 (как у DDBI). Можно понизить до 109 (как у Dimension Door), если нужно.

### 8.4 Регистрация моста (черновик)

Шаблон: `${protocol}//${hostname}${port ? ":" + port : ""}/*` в Chrome (с портом, точнее). В Firefox порт не поддерживается, шаблон без порта, с пометкой о риске.

Идентификатор регистрации: `lss-bridge:<шаблон>`. Список подключённых хранить в `storage.local` (см. 2.1, п. 4). В `runtime.onInstalled` и при старте восстанавливать регистрации из списка.

---

## 9. Открытые вопросы

### 9.1 Для LSS (через @shakusky, Telegram или Discord; контакта пока не было)

1. Есть ли публичный способ доступа к персонажам и гримуару для сторонних приложений (OAuth-клиент, scopes вроде `characters:read` и `spells:read`, или ключ API)? Сейчас известен только `dimension-door` со scopes `spells:read spells:write` (по коду Dimension Door).
2. Какие эндпоинты отдают список персонажей пользователя, один персонаж и гримуар, и какие из них публичны и стабильны? В доке упомянут `GET /character/:id` без описания статуса публичности.
3. Совпадает ли ответ API с форматом файла экспорта (`jsonType`, `version: "2"`, `edition`, `spells` со слагами и `pending`, `data` строкой)? Учитывать changelog 18.10.2026 (`spells.pending`, слаги).
4. Как регистрировать redirect URI: `https://<app-id>.chromiumapp.org/` для Chrome и домен Firefox (стабилен ли между установками).
5. Срок жизни access-токена, наличие refresh-токена, отзыв токена (эндпоинт или кнопка «Выйти»).
6. Лимиты запросов, условия использования для расширений, допустимость массового экспорта, нужна ли метка «неофициальное».
7. Как OAuth работает для пользователей, которым Google недоступен (вход через Яндекс или почту с паролем).
8. Позиция LSS по интеграции с Foundry: готовы ли они к OAuth-клиенту для расширения и к официальному пути (белый список для iframe) в будущем.
9. Допустимость хранения токена в `storage.local` (или хотят короткий срок и `storage.session`).

### 9.2 Для нас (проверить тестом, до или во время реализации)

a. Firefox: `http://localhost/*` с `registerContentScripts` и `persistAcrossSessions` на `localhost:30000`. Работает ли совпадение с портом.
b. Firefox: сохраняются ли регистрации после перезапуска браузера и обновления расширения, и восстанавливаются ли в `runtime.onInstalled`.
c. Chrome: поведение `launchWebAuthFlow`, если запрос идёт из обработчика сообщения (не из клика в popup). Решение: вход только из popup.
d. Chrome: LAN-адрес вида `http://192.168.x.x` и Local Network Access. Работает ли `registerContentScripts`.
e. Firefox: формат и стабильность `identity.getRedirectURL()` (вызвать и посмотреть значение).
f. Размер ответа и время работы service worker на 10–20 персонажах (остановка при простое, лимиты `fetch` и вычислений из раздела 1.4).
g. `frameId` и прочие поля `MessageSender` (проверить по справочнику `runtime`, не открывалось в этом исследовании).
h. Формат `data_collection_permissions` и таксономия AMO (сверить с документацией встроенного согласия Firefox, не открывалась).
i. Лицензия: DDBI и ddbi-utilities-extension MIT, Beyond20 GPL-3.0, Dimension Door без лицензии. Брать из MIT-проектов только с указанием авторства, код Beyond20 и Dimension Door не использовать.

---

## 10. Источники

Документация:
- Chrome, content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome, messaging: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome, storage и cookies: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- Chrome, match patterns: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
- Chrome, миграция на service worker: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
- Chrome, scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome, permissions API: https://developer.chrome.com/docs/extensions/reference/api/permissions
- Chrome, identity API: https://developer.chrome.com/docs/extensions/reference/api/identity
- Chrome, externally_connectable: https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable
- MDN, content scripts: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
- MDN, cloneInto: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts/cloneInto
- MDN, match patterns: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns
- MDN, background (manifest): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- MDN, externally_connectable: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/externally_connectable
- MDN, scripting.registerContentScripts: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/registerContentScripts
- MDN, RegisteredContentScript: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/RegisteredContentScript
- MDN, identity.launchWebAuthFlow: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/launchWebAuthFlow
- Chrome Web Store, Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- AMO, add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/

Проекты и исходники:
- Dimension Door: страница https://pumpkin.quest/lss/dimension-door/ ; AMO https://addons.mozilla.org/firefox/addon/dimension-door/ ; API листинга https://addons.mozilla.org/api/v5/addons/addon/dimension-door/ ; файл 0.5.2 https://addons.mozilla.org/firefox/downloads/file/5078604/dimension_door-0.5.2.xpi (SHA-256 `53664673…59`). Распакован локально в scratchpad.
- Beyond20, commit `5edd6af6`: https://github.com/kakaroto/Beyond20 (`manifest.json`, `src/extension/background.js`, `src/extension/popup.js`, `src/fvtt/check-tab.js`, `src/fvtt/content-script.js`, `src/common/utils.js`, `FVTT-module/beyond20/module.json`, `LICENSE`).
- ddb-importer, commit `44bb451`: https://github.com/MrPrimate/ddb-importer (`README.md`, `lang/en.json`, `src/lib/UtilitiesExtension.ts`).
- DDBI Utilities Extension, commit `40c7f29`: https://github.com/MrPrimate/ddbi-utilities-extension (`manifest.json`, `src/background.js`, `src/foundry-bridge.js`, `src/foundry-sites.js`, `src/popup/connect.js`, `PRIVACY.md`, `README.md`).

LSS (публичная документация, Guildhall, локально `F:\LongStoryShort\Guildhall\docs\`):
- `developers/index.mdx`, `developers/contribute.mdx`, `developers/characters.mdx`, `developers/changelog.mdx`
- `developers/embedding/index.mdx`, `embedding/sdk-guide.mdx`, `embedding/bridge.mdx`, `embedding/bridge-guide.mdx`, `embedding/groups.mdx`
- `user-guides/social-login.mdx`, `user-guides/account-migration.mdx`
- `integration/owlbear.mdx`, `misc/links.mdx`
