'use client';

type StoredRequestOptions = {
    method?: string;
    body?: unknown;
};

export type OfflineOperation = {
    id: string;
    path: string;
    options: StoredRequestOptions;
    label: string;
    createdAt: string;
    attempts: number;
    lastError?: string | null;
};

const managerQueueKey = 'keremet:manager-offline-queue:v1';
const managerStatePrefix = 'keremet:manager-state:v1:';
const queueChangeEvent = 'keremet-manager-offline-queue-change';

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const makeId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readJson = <T,>(key: string, fallback: T): T => {
    if (!isBrowser()) return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
};

const writeJson = (key: string, value: unknown) => {
    if (!isBrowser()) return;
    window.localStorage.setItem(key, JSON.stringify(value));
};

const emitQueueChange = () => {
    if (!isBrowser()) return;
    window.dispatchEvent(new Event(queueChangeEvent));
};

export const getManagerQueueChangeEvent = () => queueChangeEvent;

export const readManagerOfflineQueue = () => readJson<OfflineOperation[]>(managerQueueKey, []);

const writeManagerOfflineQueue = (queue: OfflineOperation[]) => {
    writeJson(managerQueueKey, queue);
    emitQueueChange();
};

export const enqueueManagerOfflineOperation = ({
    path,
    options,
    label,
}: {
    path: string;
    options?: StoredRequestOptions;
    label: string;
}) => {
    const operation: OfflineOperation = {
        id: makeId(),
        path,
        options: {
            method: options?.method,
            body: options?.body,
        },
        label,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastError: null,
    };

    writeManagerOfflineQueue([...readManagerOfflineQueue(), operation]);
    return operation;
};

export const cacheManagerState = <T,>(hotelId: string, state: T) => {
    writeJson(`${managerStatePrefix}${hotelId}`, {
        cachedAt: new Date().toISOString(),
        state,
    });
};

export const readCachedManagerState = <T,>(hotelId: string) =>
    readJson<{ cachedAt: string; state: T } | null>(`${managerStatePrefix}${hotelId}`, null);

export const isLikelyOfflineError = (error: unknown) => {
    if (isBrowser() && window.navigator && window.navigator.onLine === false) {
        return true;
    }

    if (error instanceof TypeError) {
        return true;
    }

    const message = error instanceof Error ? error.message.toLocaleLowerCase('ru-RU') : '';
    return message.includes('failed to fetch') || message.includes('network') || message.includes('load failed');
};

export const flushManagerOfflineQueue = async (
    sender: (operation: OfflineOperation) => Promise<unknown>
) => {
    const queue = readManagerOfflineQueue();
    let synced = 0;
    const remaining: OfflineOperation[] = [];

    for (let index = 0; index < queue.length; index += 1) {
        const operation = queue[index];
        try {
            await sender(operation);
            synced += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Не удалось синхронизировать операцию';
            remaining.push({
                ...operation,
                attempts: operation.attempts + 1,
                lastError: message,
            });
            remaining.push(...queue.slice(index + 1));
            break;
        }
    }

    writeManagerOfflineQueue(remaining);

    return {
        synced,
        remaining: remaining.length,
        firstError: remaining[0]?.lastError ?? null,
    };
};
