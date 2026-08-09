import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const localEnvPath = resolve(process.cwd(), '.env.local');
if (!existsSync(localEnvPath)) {
    console.error('Не найден .env.local. Локальный сервер не запущен, чтобы не подключиться к production по ошибке.');
    process.exit(1);
}

const localEnv = {};
for (const line of readFileSync(localEnvPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 1) continue;
    localEnv[trimmed.slice(0, separatorIndex).trim()] = trimmed
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
}

if (!localEnv.DATABASE_URL) {
    console.error('В .env.local не задан DATABASE_URL. Локальный сервер не запущен.');
    process.exit(1);
}

let localDatabaseUrl;
try {
    localDatabaseUrl = new URL(localEnv.DATABASE_URL);
} catch {
    console.error('DATABASE_URL в .env.local имеет неверный формат. Локальный сервер не запущен.');
    process.exit(1);
}

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
if (
    !['postgres:', 'postgresql:'].includes(localDatabaseUrl.protocol)
    || !localHosts.has(localDatabaseUrl.hostname)
) {
    console.error('Локальный сервер разрешено запускать только с PostgreSQL на localhost.');
    process.exit(1);
}

const nextCliPath = resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextCliPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, ...localEnv },
    stdio: 'inherit',
});

child.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
