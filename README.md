# Hotel Ops

Операционная панель управления отелями для администраторов и дежурных менеджеров. Работает в браузере. Построена на Next.js 14 (App Router), Tailwind CSS, Prisma и PostgreSQL, деплой на Render.

## Features

- Авторизация по логину/паролю (админ) и PIN-коду (менеджер).
- Telegram-бот для уведомлений (необязательно).
- Role-aware entry router that sends admins to a desktop dashboard and managers to a mobile-first interface.
- Admin tooling to create hotels ("точки"), inspect occupancy, and observe current shift cash state.
- Manager console with shift open/close workflow, room board, stay check-in/check-out actions, and quick expense capture.
- Prisma data model covering users, hotels, assignments, rooms, stays, shifts, and ledger entries.
- Server actions/route handlers wired for hotels, manager state, shifts, room stays, expenses, and session management.

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (Render PostgreSQL works great)

### Installation

```bash
npm install
```

### Environment Variables

Create `.env` by copying `.env.example` and updating the secrets:

```
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>
TELEGRAM_BOT_TOKEN=123456:ABCDEF     # optional, for notifications
NEXT_PUBLIC_DEV_TELEGRAM_ID=100000000  # optional for local dev
NEXT_PUBLIC_DEV_ROLE=ADMIN             # optional for local dev
```

> The dev override IDs should never be configured in production.

### Database

Run migrations (or push the schema during early development):

```bash
# After configuring DATABASE_URL
npx prisma migrate dev --name init
# or
npm run prisma:push
```

Generate Prisma Client whenever the schema changes:

```bash
npm run prisma:generate
```

### Development

Start the Next.js dev server:

```bash
npm run dev
```

Open `http://localhost:3000` in a browser and test flows.

### Linting & Build

```bash
npm run lint
npm run build
```

## Render Deployment Notes

1. **Services**
   - Web Service: Deploy this Next.js app (Node 18 runtime). Set `NODE_VERSION=18`. Enable `npm run build` for build command and `npm start` for start.
   - PostgreSQL: Provision a managed PostgreSQL instance and supply its URL via `DATABASE_URL`.

2. **Environment Variables**
   - Add `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` (optional), and any other secrets in the Render dashboard.
   - Remove the local-only `NEXT_PUBLIC_DEV_*` variables in production.

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
| `npm start` | Start Next.js in production mode |
| `npm run lint` | ESLint checks |
| `npm run prisma:generate` | Re-generate Prisma client |
| `npm run prisma:push` | Push schema to the database |
| `npm run prisma:migrate` | Create development migration |
| `npm run prisma:studio` | Open Prisma Studio |

## Next Steps

- Implement remaining CRUD flows (room management, manager assignments, payouts).
- Harden validation and add audit logging on ledger entries and shift actions.
- Add automated tests (Playwright or Cypress) for the role-based flows.
