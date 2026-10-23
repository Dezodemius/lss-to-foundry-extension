# Chrome Web Store — LSS to Foundry

Обновлено: 23.10.2026. Статус: материалы подготовлены локально, в магазин ничего не загружено. Пользователь сообщил, что установленное расширение работает; независимый полный прогон автором этих материалов не проводился.

## Store Listing

**Extension Name:** LSS to Foundry

**Short Description:** Импорт персонажей Long Story Short в подключённый мир Foundry VTT.

**Detailed Description:**

LSS to Foundry переносит выбранных персонажей из вашего аккаунта Long Story Short в открытый мир Foundry VTT с системой dnd5e.

Откройте список персонажей в расширении, найдите нужного по имени или классу и нажмите «Импорт». Для работы нужен установленный и включённый модуль LSS to Foundry в вашем мире Foundry.

Вход выполняется на официальном сайте Long Story Short. Если вы уже вошли в этом профиле Chrome, расширение использует текущую сессию. Кнопка «Выйти» завершает сессию LSS в этом профиле браузера и обновляет открытые вкладки LSS.

Для первого импорта укажите адрес вашей Foundry и разрешите расширению доступ к этому адресу. Затем выберите вкладку с открытым миром. Каждое нажатие «Импорт» создаёт нового актёра; обновление существующего персонажа пока не поддерживается. Свои заклинания из Гримуара нужно добавлять отдельно через импорт JSON в модуле Foundry.

Персонажи передаются в выбранную вами Foundry. Автор расширения не получает их через собственный сервер; рекламы и аналитики нет. Доступ к авторизации LSS нужен для чтения ваших персонажей, а разрешение на Foundry — для выбранного вами импорта.

Это неофициальная интеграция. Расширение не является продуктом команд Long Story Short или Foundry VTT.

Поддержка: https://github.com/Dezodemius/lss-to-foundry-extension/issues
Модуль Foundry: https://github.com/Dezodemius/lss-to-foundry

**Category:** предложено Fun; выбрать соответствующую актуальную категорию в кабинете.

**Single Purpose:** Перенос выбранного пользователем персонажа Long Story Short в его открытый мир Foundry VTT.

**Primary Language:** Russian.

## Graphics & Assets

| Материал | Размер | Статус |
|---|---|---|
| Иконка магазина | 128×128 PNG | Требуется создать; не использовать чужие логотипы без разрешения |
| Скриншот списка и импорта | 1280×800; 640×400 допустим по руководству изображений | Требуется снять с актуального интерфейса и тестовыми персонажами |
| Второй скриншот подключения Foundry | Те же размеры | Рекомендуется |
| Маленькая промоплитка | 440×280 | Подготовить, если запросит кабинет; основной справочник listing считает её необязательной |

В манифесте иконки пока не объявлены. После создания добавить реальные файлы нужных размеров и пересобрать ZIP. Нельзя просто указать путь к отсутствующему файлу. Скриншоты не должны показывать email, JWT, приватные адреса серверов и данные других игроков.

## Permissions Justification

Готовые объяснения для полей кабинета:

| Permission | Type | Justification |
|---|---|---|
| `cookies` | permissions | Reads the existing LSS authentication cookie to retrieve the signed-in user's characters from LSS. Removes that cookie only when the user explicitly confirms signing out. The cookie is sent only to the LSS API and is never sent to Foundry or the extension publisher. |
| `storage` | permissions | Stores the user-selected Foundry origin locally and keeps the last import status in session memory so reopening the popup does not cause a duplicate import. Does not store authentication tokens or full character documents. |
| `scripting` | permissions | Runs extension-bundled code in the user-selected Foundry tab to call the installed LSS to Foundry module and import the selected character. Also clears the LSS iframe authentication fallback in open LSS tabs during explicit sign-out. |
| `https://longstoryshort.app/*` | host_permissions | Reads the LSS sign-in cookie, finds the LSS tab for sign-in, and clears the local authentication fallback and refreshes LSS tabs when the user signs out. |
| `https://api.longstoryshort.app/*` | host_permissions | Makes authenticated read-only requests for the user's character list and the selected character. Authentication is sent only to this fixed HTTPS API origin. |
| `http://*/*`, `https://*/*` | optional_host_permissions | Foundry is self-hosted and can use a user-specific hostname and port. Access is requested only after the user enters their Foundry address and clicks Connect, for that host. The extension additionally checks the exact saved origin including its port before running an import. No other browsing content is read for unrelated purposes. |

`tabs` не запрашивается: разрешения соответствующего хоста дают доступ к URL и заголовку нужных вкладок. В установленном навыке есть чрезмерно общее утверждение об обязательности `tabs`; действующая [документация Chrome](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions) прямо допускает host permissions. Не расширять разрешения без необходимости.

## Privacy & Data Use

Расширение **обрабатывает пользовательские данные**, даже без сервера разработчика. Не выбирать «никакие данные не обрабатываются» только на основании отсутствия аналитики.

| Тип данных | Обработка | Передача и назначение |
|---|---|---|
| Authentication information | Да: cookie/JWT текущей сессии LSS | Только LSS API по HTTPS для чтения персонажей. Автору расширения и Foundry не передаётся |
| Website content / user-generated content | Да: документы персонажей, включая заметки и игровые характеристики | Выбранный документ передаётся выбранному миру Foundry; его сервер и модули обрабатывают его как обычный импорт |
| Personally identifiable information | Может присутствовать в документе, например имя игрока или заметки | Не выделяется в отдельную базу; входит в импортируемый пользователем документ. Учесть этот тип в форме disclosure |
| Web history / browsing information | Ограниченно: URL и заголовки LSS и разрешённых вкладок Foundry; сохранённый origin | Используются для входа и выбора целевой вкладки. Общая история посещений не собирается |
| User activity | Состояние последнего импорта, имя созданного персонажа, число предупреждений и время | В `storage.session`, до завершения сессии расширения или выхода; не используется для аналитики |
| Реальные медицинские или финансовые данные, сообщения, местоположение | Целенаправленно не запрашиваются | HP персонажа — игровые данные, а не медицинская информация пользователя. Пользовательские заметки могут содержать произвольный текст |

При заполнении кабинета сопоставить актуальные названия категорий с этой таблицей; декларировать обработку, включая локальную. Не заявлять, что все данные всегда остаются на устройстве: выбранная Foundry может работать на удалённом сервере.

### Data Use Certification

- [x] Данные не продаются третьим лицам.
- [x] Данные используются только для заявленного импорта и управления его авторизацией.
- [x] Данные не используются для кредитоспособности или кредитования.

### Remote Code

Выбрать «No, I am not using remote code». Все скрипты расширения находятся в ZIP. Из LSS загружается JSON, а не исполняемый код. Вкладка Foundry вызывает свой установленный модуль; расширение не скачивает его скрипты для исполнения в собственном контексте.

## Privacy Policy

Текст подготовлен в `PRIVACY.md`. Публичный URL ещё не опубликован. Разместить на GitHub Pages либо на другом управляемом издателем HTTPS-сайте, затем открыть ссылку без входа и указать её в кабинете.

Канал связи по приватности: https://github.com/Dezodemius/lss-to-foundry-extension/issues. Публичный контактный email издатель должен добавить перед подачей; значение не предоставлено и не выдумывается.

## Distribution

Рекомендация для первой подачи: **Unlisted**, чтобы сначала распространять ссылку среди небольшой группы. После проверки можно выбрать Public. Это рекомендация, а не сохранённая настройка кабинета. Unlisted тоже проходит модерацию; любой знающий ссылку сможет установить расширение.

Регионы определяет издатель в кабинете; автоматически ничего не выбиралось.

## Developer Info

**Publisher Name:** предлагается Dezodemius; подтвердить в кабинете.

**Contact Email:** требуется указать и подтвердить в кабинете; адрес пользователя неизвестен.

**Support URL:** https://github.com/Dezodemius/lss-to-foundry-extension/issues

**Homepage URL:** https://github.com/Dezodemius/lss-to-foundry-extension

## Version History

| Версия | Дата | Изменения | Статус |
|---|---|---|---|
| 0.1.0 | 22.10.2026 | Список и поиск персонажей, импорт, текущая сессия LSS и полный локальный выход | Draft — первая подача ещё не выполнена |

В Chrome Web Store каждое обновление требует возрастающей версии в `manifest.json`. Workflow этого репозитория `.github/workflows/release.yml` подставляет числовую версию из тега в манифест пакета. Он публикует в GitHub Release `lss-to-foundry-extension-chrome.zip`, `manifest.json` и `SHA256SUMS.txt`, но не отправляет пакет в магазин. Для загрузки используйте ZIP из нужного релиза, а не исходный manifest ветки `main`. Автоматизация модуля Foundry относится к другому репозиторию.

Поддержка пакета заявлена для Chrome 120+. Opera и Яндекс Браузер не проверены; Firefox требует отдельного варианта manifest, Safari — адаптации и упаковки для Apple. Само наличие общей логики WebExtensions не считается подтверждением совместимости.

## Review Notes

Для проверки нужны отдельный тестовый аккаунт LSS с демонстрационным персонажем и открытый тестовый мир Foundry с системой dnd5e и модулем LSS to Foundry. Личный аккаунт издателя для проверяющих не использовать. При необходимости указать отдельные тестовые данные во вкладке Test instructions; не добавлять пароли в Git.

Проверка: войти в LSS; открыть расширение; увидеть персонажа; подключить тестовый адрес Foundry; выбрать вкладку; импортировать; проверить нового актёра; выполнить полный выход. Если ревьюеру нельзя предоставить тестовый мир, подготовить подробную видеодемонстрацию и инструкции, но не считать видео гарантированной заменой доступа.

### Known Issues / Limitations

- Нет иконки и скриншотов магазина, живого privacy URL и контактного email. Пакет пока не следует считать готовым к отправке на модерацию.
- Код сейчас допускает произвольный HTTP-адрес Foundry. Для публичного релиза нужно проверить требования безопасной передачи данных; удалённые серверы следует подключать по HTTPS, HTTP оставлять только для обоснованного локального сценария. Это ещё не ограничено кодом.
- Используется текущий внутренний API LSS. Публичная стабильность этого контракта не подтверждена; изменение LSS может потребовать обновления расширения.
- Полный выход относится к текущему браузерному профилю и не отзывает JWT на сервере. Импортированные документы остаются в Foundry до удаления пользователем.
- Каждый импорт создаёт нового актёра. Гримуар не импортируется расширением автоматически. Firefox и Opera не тестировались.
- Независимый аудит через Claude сейчас недоступен из-за истёкшей OAuth-сессии; это не мешает чтению официальных источников и подготовке материалов.

### Проверено при подготовке

- Manifest V3, описание короче 132 символов, локальные скрипты без eval и внешних CDN.
- Разрешения и обработки данных сверены с `src/background.mjs`, `src/lss-api.mjs`, `src/foundry.mjs` и `src/popup.mjs`.
- Код и manifest на этом шаге не менялись. Подтверждение работы пользователем учтено отдельно от автоматических проверок.

## Порядок подачи

1. Зарегистрировать аккаунт в Chrome Developer Dashboard, принять условия и оплатить разовый взнос. Эти действия выполняет издатель самостоятельно.
2. Заполнить имя издателя и подтвердить контактный email.
3. Подготовить графику и разместить публичную политику конфиденциальности.
4. Создать New item, загрузить чистый ZIP с `manifest.json` в корне.
5. Заполнить Store listing, Privacy, Distribution и Test instructions из этого документа.
6. Проверить требования безопасной передачи для удалённой Foundry и протестировать подготовленный пакет.
7. Submit for review. При желании отключить автоматическую публикацию после одобрения и опубликовать вручную.

Источники: [регистрация](https://developer.chrome.com/docs/webstore/register), [подготовка пакета](https://developer.chrome.com/docs/webstore/prepare), [карточка](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [раскрытие локальной обработки данных](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [подача](https://developer.chrome.com/docs/webstore/publish), [видимость](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
