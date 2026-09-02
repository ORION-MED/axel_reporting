# AXEL — платформа анализа данных и управленческой отчётности

> Этот репозиторий фиксирует состояние проекта **после разработки модуля Reporting** и итогового технического рефакторинга. Он включает исходное аналитическое ядро AXEL и новый контур региональной управленческой отчётности.

Состояние проекта до Reporting сохранено отдельно в репозитории [axel_old](https://gitlab.com/amadeus5074918/axel_old).

## Назначение этапа

Версия развивает базовую платформу подготовки медицинских данных до системы сбора, проверки, расчёта и визуализации региональных показателей. Reporting работает в общей архитектуре AXEL, использует единый контур авторизации, PostgreSQL и S3/MinIO, но выделен в самостоятельный предметный модуль frontend и backend.

## Возможности базового контура

- загрузка и профилирование CSV/XLSX;
- подготовка CSV/Parquet-артефактов в S3/MinIO;
- фильтрация и обработка больших таблиц;
- заполнение пропусков, масштабирование, кодирование и обработка выбросов;
- статистический анализ и преобразования временных рядов;
- пользовательские дашборды и публикации;
- работа с eICU, MIMIC-IV и PICDB;
- авторизация, профили пользователей и обращения в поддержку.

## Что добавлено на этапе Reporting

- отчётные периоды и справочник показателей;
- справочник медицинских организаций и их атрибутов;
- плановые, фактические и расчётные значения по организациям и региону;
- импорт РЭМД, ТПГГ, целевых планов, матрицы применимости и справочных файлов;
- журнал импортов, предварительная проверка файлов и отмена незавершённых загрузок;
- правила применимости видов СЭМД и ручные переопределения требований;
- расчёт показателей, долей, статусов и детализаций по организациям;
- месячная динамика, прогноз достижимости и управленческие выводы;
- диагностические находки, причины отклонений и перечни исключений;
- региональная hex-карта, диаграммы связей и сводный dashboard;
- детализация по организациям, видам СЭМД, подразделениям и источникам данных.

## Итоговый рефакторинг

- три дублированных интерфейса eICU/MIMIC-IV/PICDB объединены в один конфигурируемый экран;
- удалён неиспользуемый код в core и Reporting;
- чистые расчёты Reporting вынесены из UI и покрыты тестами;
- исправлены зависимости React-хуков и повреждённые русские сообщения;
- зафиксированы единые соглашения по неймингу;
- ESLint и строгие TypeScript-проверки проходят без замечаний;
- полный регрессионный набор: 620 успешных тестов.

Подробности находятся в [отчёте о рефакторинге](docs/refactoring-report.md), соглашения — в [правилах нейминга](docs/naming-conventions.md).

## Архитектура

```text
React + Vite
      │ HTTP / REST
      ▼
NestJS Backend ─────────────── PostgreSQL
      │                         core + Reporting
      ├──────── S3 / MinIO
      │          исходники импортов и снимки
      └──────── RabbitMQ ───── Python Worker
                                профилирование и преобразования

Reporting frontend ────────── Reporting API ────────── расчёт показателей
                                                         │
                                                         ├─ периоды и справочники
                                                         ├─ импорты и история
                                                         └─ dashboard и диагностика
```

| Компонент | Технологии | Назначение |
|---|---|---|
| Frontend | React 18, TypeScript, Vite, MUI, Recharts | аналитический UI и Reporting |
| Backend | NestJS, TypeScript, PostgreSQL | REST API, импорты и расчёт показателей |
| Worker | Python 3.12, Polars, PyArrow, SciPy | профилирование и преобразования данных |
| Object Storage | MinIO / S3 | файлы, артефакты, снимки и источники импортов |
| Queue | RabbitMQ | доставка фоновых заданий |

## Быстрый запуск через Docker

### Требования

- Docker Desktop с Docker Compose v2;
- не менее 6 ГБ свободной оперативной памяти;
- свободные порты `3000`, `3001`, `5433–5436`, `5672`, `9000`, `9001` и `15672`.

### 1. Клонирование

```bash
git clone https://gitlab.com/amadeus5074918/axel_reporting.git
cd axel_reporting
```

### 2. Подготовка окружения

Linux/macOS:

```bash
cp .env.docker.example .env.docker
```

Windows PowerShell:

```powershell
Copy-Item .env.docker.example .env.docker
```

Перед запуском откройте `.env.docker` и как минимум замените:

- `JWT_SECRET` — ключ подписи токенов;
- `SEED_ADMIN_PASSWORD` — пароль первоначального администратора;
- пароли PostgreSQL и MinIO, если стенд доступен извне.

Файл `.env.docker` содержит секреты и не должен добавляться в Git.

### 3. Запуск

```bash
docker compose --env-file .env.docker up --build -d
docker compose ps
```

При первом старте backend автоматически применит миграции core и Reporting. Состояние запуска можно посмотреть командой:

```bash
docker compose logs -f backend frontend python-worker
```

### 4. Вход

- приложение: <http://localhost:3000>;
- модуль Reporting: <http://localhost:3000/reporting>;
- логин первоначального администратора: `admin`;
- пароль: значение `SEED_ADMIN_PASSWORD` из `.env.docker`;
- Backend API: <http://localhost:3001/api>;
- MinIO Console: <http://localhost:9001>;
- RabbitMQ Console: <http://localhost:15672>.

Репозиторий не содержит реальные медицинские данные и рабочие региональные выгрузки. Их необходимо подключать отдельно с соблюдением требований к доступу и защите информации.

## Управление стендом

```bash
# Остановить, сохранив данные
docker compose down

# Пересобрать и запустить после изменения исходников
docker compose --env-file .env.docker up --build -d

# Посмотреть логи всех сервисов
docker compose logs -f
```

Команда ниже безвозвратно удаляет локальные Docker-тома, включая базу Reporting:

```bash
docker compose down -v
```

## Локальная разработка без полной сборки Docker

Для локального режима нужны Node.js 20+, Python 3.12+, PostgreSQL 16, RabbitMQ и S3-совместимое хранилище. Параметры каждого сервиса берутся из соответствующего `.env.example`.

Backend:

```bash
cd backend
npm ci
npm run migrate
npm run start:dev
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

Python worker:

```bash
cd python-worker
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

## Проверки

```bash
cd backend
npm test
npm run build

cd ../frontend
npm run lint
npm test
npm run build

cd ../python-worker
python -m pytest
```

Проверенный результат текущего этапа:

- backend: 432 теста;
- frontend: 147 тестов;
- python-worker: 41 тест;
- всего: 620 успешных тестов.

## Структура репозитория

```text
backend/
  src/reporting/  API, импорты, расчёты и предметные правила Reporting
frontend/
  src/pages/reporting/  страницы, диалоги, dashboard и чистая логика Reporting
python-worker/     фоновые задания профилирования и обработки
docker/            инфраструктура PostgreSQL и RabbitMQ
deploy/            материалы развёртывания
docs/              документация, отчёт о рефакторинге и правила нейминга
```
