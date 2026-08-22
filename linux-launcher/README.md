# steambooster-linux

Linux-лаунчер для [`@steambalance/booster-framework`](https://github.com/STEAMBALANCE/booster-framework). Заменяет `steambooster.exe` для локального использования на Linux: запускает Steam с включённым Chrome DevTools Protocol и инжектирует фреймворк в главное окно клиента.

> ⚠️ Это MVP для личного использования. Нативные операции (`configs`, `keys`, `net`, `steam` API) пока только логируются в консоль Steam — полноценный хост-бридж ещё не реализован.

## Сборка

```bash
cd linux-launcher
npm install
npm run build
```

Фреймворк должен быть уже собран в `../out/booster-framework.js`:

```bash
cd ..
bun install
bun run build.ts
```

## Запуск

```bash
node dist/index.js
```

С тестовым плагином:

```bash
node dist/index.js -d test-plugin/plugin.js
```

### Опции

- `-s, --steam-path <path>` — путь к Steam (по умолчанию автоопределение)
- `-p, --cdp-port <number>` — порт CDP (по умолчанию 9222)
- `-f, --framework <path>` — путь к IIFE-бандлу фреймворка
- `-d, --dev-plugin <path>` — dev-плагин, можно указывать несколько раз
- `-w, --wait-for-steam` — не запускать Steam, а подключиться к уже запущенному

Переменные окружения: `SB_STEAM_PATH`, `SB_CDP_PORT`, `SB_FRAMEWORK_PATH`.

## Как это работает

1. Запускает Steam с `-cef-enable-debugging -devtools-port=<port>`.
2. Ждёт, пока `http://127.0.0.1:<port>/json/version` станет доступен.
3. Получает список CDP-targets и выбирает главное окно Steam.
4. Выполняет `Runtime.evaluate` с префиксом:
   - устанавливает `__SB_PLUGINS_MANIFEST__`;
   - устанавливает `__sb_native` и `__sb_resolve`;
5. Выполняет `Runtime.evaluate` с IIFE-бандлом `booster-framework.js`.
6. Инжектирует dev-плагины отдельными `Runtime.evaluate`.

## Ограничения

- Нет реализации нативных хендлеров (`host.*`). UI-операции (`addHeaderButton` и т.п.) вернут промисы, которые зарезолвятся только если хост ответит через `__sb_resolve`; в текущей версии ответы не приходят.
- Нет подписи манифеста и проверки sha256 (dev-only).
- Нет автообновления, rollback'ов и self-update.
- Работает только с главным окном (`ContextKind.Main`). SharedJSContext / relay не покрыты.
