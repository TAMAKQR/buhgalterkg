# Telegram Hotel Ops WebApp

Operational control panel for hotel administrators and on-duty managers running inside Telegram WebApp. Built with Next.js 14 (App Router), Tailwind CSS, Prisma, and PostgreSQL, targeting deployment on Render.

## Features

- Telegram ID-based authentication with signature validation and optional local dev override.
- Role-aware entry router that sends admins to a desktop dashboard and managers to a mobile-first interface.
- Admin tooling to create hotels ("точки"), inspect occupancy, and observe current shift cash state.
- Manager console with shift open/close workflow, room board, stay check-in/check-out actions, and quick expense capture.
- Prisma data model covering users, hotels, assignments, rooms, stays, shifts, and ledger entries.
- Server actions/route handlers wired for hotels, manager state, shifts, room stays, expenses, and Telegram session bootstrapping.

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (Render PostgreSQL works great)
- Telegram bot token (from BotFather)

### Installation

```bash
npm install
```

### Environment Variables

Create `.env` by copying `.env.example` and updating the secrets:

```
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>
TELEGRAM_BOT_TOKEN=123456:ABCDEF
TELEGRAM_WEBAPP_URL=https://your-app.onrender.com
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

Open your Telegram bot, configure the WebApp URL to `http://localhost:3000` (or use the provided dev override) and test flows.

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
   - Add `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBAPP_URL`, and any other secrets in the Render dashboard.
   - Remove the local-only `NEXT_PUBLIC_DEV_*` variables in production unless you need a sandbox bot user.

3. **Telegram Bot**
   - Use BotFather `/setdomain` or `/setmenubutton` to configure your Render domain as the WebApp URL.
   - Inside bot commands, launch the WebApp using `web_app` keyboard buttons so Telegram injects `initData` automatically.

4. **Prisma Migrations**
   - Run `npx prisma migrate deploy` during deployment (Render build command) to apply schema changes.

## Project Structure Highlights

- `app/` – Next.js App Router pages and API route handlers.
- `components/` – UI primitives, providers, and role-specific modules.
- `lib/` – Prisma client, env validation, Telegram helpers, permissions, and shared utilities.
- `prisma/` – Prisma schema.
- `hooks/useApi.ts` – Client-side helper that injects Telegram auth payload into every request.

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

- Connect Telegram bot commands/keyboards to open the WebApp.
- Implement remaining CRUD flows (room management, manager assignments, payouts).
- Harden validation and add audit logging on ledger entries and shift actions.
- Add automated tests (Playwright or Cypress) for the role-based flows.
