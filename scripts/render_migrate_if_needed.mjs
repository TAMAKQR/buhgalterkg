import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.env.RENDER !== 'true') {
    console.log('[database] Skipping production migrations outside Render');
    process.exit(0);
}

const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: false,
});

if (result.error) {
    console.error('[database] Failed to start Prisma migrate deploy:', result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 1);
