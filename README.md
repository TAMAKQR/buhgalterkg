# Hotel Ops

Операционная панель управления отелями для администраторов и дежурных менеджеров. Работает в браузере. Построена на Next.js 15 и React 19 (App Router), Tailwind CSS, Prisma и PostgreSQL, деплой на Render.

## Features

- Авторизация по логину/паролю (админ) и PIN-коду (менеджер).
- Telegram-бот для уведомлений (необязательно, только уведомления и служебные команды).
- Role-aware entry router that sends admins to a desktop dashboard and managers to a mobile-first interface.
- Admin tooling to create hotels ("точки"), inspect occupancy, and observe current shift cash state.
- Manager console with shift open/close workflow, room board, stay check-in/check-out actions, and quick expense capture.
- Prisma data model covering users, hotels, assignments, rooms, stays, shifts, and ledger entries.
- Server actions/route handlers wired for hotels, manager state, shifts, room stays, expenses, and session management.

## Getting Started

### Prerequisites

- Node.js 20 LTS (поддерживаемый диапазон проекта: `>=20 <23`)
- PostgreSQL 16 локально или в Docker

### Installation

```bash
npm install
```

### Локальное окружение

Скопируйте шаблон в `.env.local`. Реальные пароли, токены и URL production-базы не должны попадать в Git:

```powershell
Copy-Item .env.example .env.local
```

Для локальной разработки укажите в `.env.local` только локальную PostgreSQL. Имя базы соответствует проекту — `buhgaler`:

```dotenv
DATABASE_URL="postgresql://buhgaler:local-only-password@127.0.0.1:5433/buhgaler"
PRISMA_LOG_QUERIES="false"
```

Если PostgreSQL запускается в Docker, создать контейнер достаточно один раз:

```powershell
docker run --name buhgaler-db -e POSTGRES_DB=buhgaler -e POSTGRES_USER=buhgaler -e POSTGRES_PASSWORD=local-only-password -p 5433:5432 -d postgres:16-alpine
```

При последующих запусках используйте `docker start buhgaler-db`.

`PRISMA_LOG_QUERIES` оставляйте равным `false`. Значение `true` предназначено только для короткой локальной диагностики: подробный SQL быстро увеличивает логи и может содержать служебные данные.

### Локальная база и Prisma

Все локальные команды Prisma запускайте только через npm-скрипты проекта. Обёртка `scripts/run_prisma_local.mjs` всегда загружает `.env.local` и разрешает подключение только к PostgreSQL на `localhost`. Это защищает production-базу от случайного изменения через локальную консоль.

```powershell
# Проверить схему и применить уже существующие миграции
npm run prisma:validate
npm run prisma:deploy:local

# Обновить Prisma Client
npm run prisma:generate

# Необязательно: заполнить локальную базу тестовыми данными
npm run prisma:seed
```

`npm run prisma:seed` полностью очищает только локальную базу и создаёт демонстрационные объекты, номера и менеджеров. Не запускайте его, если локальные рабочие данные нужно сохранить.

При изменении `prisma/schema.prisma` создавайте именованную миграцию так:

```powershell
npm run prisma:migrate -- --name describe_change
```

`npm run prisma:push` допустим только для временного локального прототипа: команда меняет схему без создания истории миграций. Не запускайте локально прямые команды `npx prisma ...`, потому что они не используют защитную обёртку проекта.

### Интеграции и секреты

Секреты задаются только в `.env.local` на компьютере разработчика и в переменных окружения хостинга для production:

```dotenv
# Необязательный AI-анализ
OPENAI_API_KEY="replace-locally"
OPENAI_MODEL="gpt-5.4-mini"

# Не короче 16 символов; используйте разные случайные значения
TELEGRAM_WEBHOOK_SECRET="<generate-a-unique-32-byte-secret>"
GUEST_TELEGRAM_WEBHOOK_SECRET="<generate-a-different-32-byte-secret>"
```

При регистрации каждого Telegram webhook передайте соответствующее значение как `secret_token`. Значение в Telegram и переменная окружения приложения должны совпадать; без него production webhook отклоняет запросы. Не публикуйте bot token, webhook secret или `DATABASE_URL` в README, задачах и логах.

### Development

Start the Next.js dev server:

```bash
npm run dev
```

Open `http://localhost:3000` in a browser and test flows.

### Telegram service commands

After adding the bot to a Telegram group, send `/id` or `/chatid` in that group. The bot replies with the current chat ID that can be copied into the hotel settings field "ID чата уборки".

### Linting & Build

```bash
npm run lint
npm run build
```

## Render Deployment Notes

1. **Services**
   - Web Service: Deploy this Next.js app on Node 20. Set `NODE_VERSION=20`. Use `npm run render:build` for build command and `npm start` for start.
   - PostgreSQL: Provision a managed PostgreSQL instance and supply its URL via `DATABASE_URL`.

2. **Environment Variables**
   - Add `DATABASE_URL`, authentication secrets and the tokens for enabled integrations in the Render dashboard.
   - For Telegram webhooks preferably set unique random 32+ byte values in `TELEGRAM_WEBHOOK_SECRET` and `GUEST_TELEGRAM_WEBHOOK_SECRET`; register the matching values as Telegram `secret_token`. If an explicit secret is omitted, the service can derive a stable fallback from the corresponding bot token, but Telegram must still be registered with that matching value.
   - For AI analysis set `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-5.4-mini`.
   - Keep `PRISMA_LOG_QUERIES=false` in production.

3. **Prisma Migrations**
   - Run `npx prisma migrate deploy` during deployment (Render build command) to apply schema changes.

## Project Structure Highlights

- `app/` – Next.js App Router pages and API route handlers.
- `components/` – UI primitives, providers, and role-specific modules.
- `lib/` – Prisma client, env validation, Telegram helpers, permissions, and shared utilities.
- `prisma/` – Prisma schema.
- `hooks/useApi.ts` – Client-side helper for authenticated API calls.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run render:build` | Apply production migrations, generate Prisma Client, and build for Render |
| `npm start` | Start Next.js in production mode |
| `npm run lint` | ESLint checks |
| `npm run typecheck` | TypeScript checks without emitting files |
| `npm run check` | TypeScript, ESLint and Prisma schema checks |
| `npm run prisma:validate` | Validate the schema against `.env.local` |
| `npm run prisma:generate` | Re-generate Prisma Client using `.env.local` |
| `npm run prisma:deploy:local` | Apply existing migrations to the local database |
| `npm run prisma:migrate -- --name <name>` | Create a local development migration |
| `npm run prisma:push` | Push schema directly to the local database (prototypes only) |
| `npm run prisma:studio` | Open Prisma Studio for the local database |
| `npm run prisma:seed` | Seed the local database |

## Next Steps

- Plan the eventual Next.js 16 upgrade after validating PWA and deployment compatibility.
- Add Playwright end-to-end coverage for administrator, manager, observer, and guest flows.
- Add centralized production error monitoring and alerting.
