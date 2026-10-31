# Локальный REST API v1

Основной префикс /api/v1; прежний /api — совместимый alias. Тела/ответы JSON UTF-8, Cache-Control: no-store. UUID для задач, SHA-256 исходного текста для игры, раунд с 1, позиция с 0. Точный счётчик — десятичная строка. Запрос импорта: {text,name?}, текст передаётся неизменным. Имя до 255 символов, без управляющих символов; не используется как путь.

| Метод и маршрут | Ответ |
|---|---|
| GET /health | 200 {status:"ok", storage:"sqlite", version} после проверки БД |
| POST /import | 200 {id,fileName,createdAt,...gameSummary,completedRounds}; дедупликация точного текста |
| POST /example | {name:"demo"} либо имя локального примера; та же карточка игры |
| GET /games?limit=20&cursor=... | {games:[карточки],nextCursor}; limit 1–100, стабильный порядок createdAt DESC/id DESC |
| GET /games/:id | Карточка игры, 404 при неизвестном id |
| GET /games/:id/source | Исходный JSON с Content-Disposition attachment |
| GET /games/:id/analyses | {analyses:[полные текущие результаты раундов]}; только готовые, без запуска worker |
| POST /analyze | {gameId,round}; 202 running-job либо 200 done-job с cached:true |
| POST /branch | {gameId,round,position,moves,example?}; прежняя проверка пути, 202/200 job |
| POST /lesson | {id,mirror?}; 202/200 job |
| GET /jobs/:id | {id,status,stats,error,cached,interrupted?,result?}; result только при done |
| DELETE /jobs/:id | Отмена текущего running-job; повтор идемпотентен |
| GET /examples | {files} |
| GET /lessons | {lessons} |

Карточка игры сохраняет существующий gameSummary (teams,players,fishVariant,scoreLimit,result,rounds) и добавляет fileName, createdAt, completedRounds (массив номеров готовых раундов текущей версии).

Результат round/branch/lesson сохраняет текущую структуру analyzeRound/analyzeBranch/analyzeLesson. БД не меняет округление, числовые строки и правила итогов. Фронтенд использует тот же payload после чтения из БД, что и после свежего вычисления.

Ошибки совместимы: {error:"понятное сообщение"}. 400 — неверное тело/JSON/игровая проверка/раунд/путь; 403 — Host или Origin; 404 — ресурс; 409 — занят worker другим запросом; 413 — превышен размер HTTP-тела; 503 — недоступен backend через proxy; 500 — ошибка хранения без стека. Неверный limit/cursor — 400. Import text до 5 МиБ, управляющее HTTP-тело до 11 МиБ с учётом двойного JSON-экранирования. Повторные ключи игрового text проверяет существующий parseGame.

Задание после прерывания: status:error, interrupted:true, error с объяснением повтора. Никакой готовности или частичного результата не выдумывается. POST /analyze после перезапуска использует готовый кеш или запускает новый расчёт.

CORS: OPTIONS допускается только для разрешённого Origin; фактические методы GET/POST/DELETE, Content-Type. Сам Origin не является авторизацией: поставка ограничена локальным компьютером, backend-порт не опубликован. Runtime apiBaseUrl по умолчанию /api/v1. Для публичного размещения этот локальный контракт безопасности недостаточен.
