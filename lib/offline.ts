'use client';

type StoredRequestOptions = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
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

export type ManagerOfflineScope = {
    userId: string;
    hotelId: string;
};

export type RejectedOfflineOperation = {
    id: string;
    label: string;
    status: number;
    error: string;
};

const legacyQueueKey = 'keremet:manager-offline-queue:v1';
const legacyStatePrefix = 'keremet:manager-state:v1:';
const queueChangeEvent = 'hotel-ops-manager-offline-queue-change';
const maxOfflineQueueOperations = 100;
const maxOfflineQueueBytes = 512 * 1024;
const maxManagerStateCacheBytes = 2 * 1024 * 1024;
const maxManagerStateCacheAgeMs = 12 * 60 * 60 * 1000;
const maxOfflineReplayBatch = 20;

const scopeKey = ({ userId, hotelId }: ManagerOfflineScope) =>
    `${encodeURIComponent(userId)}:${encodeURIComponent(hotelId)}`;

const managerQueueKey = (scope: ManagerOfflineScope) =>
    `hotel-ops:manager-offline-queue:v2:${scopeKey(scope)}`;

const managerStateKey = (scope: ManagerOfflineScope) =>
    `hotel-ops:manager-state:v2:${scopeKey(scope)}`;

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const createManagerOperationId = () => {
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

const serializedByteLength = (value: string) => {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(value).byteLength;
    }

    return value.length * 2;
};

const writeSerialized = (key: string, value: string) => {
    if (!isBrowser()) return;
    window.localStorage.setItem(key, value);
};

const emitQueueChange = () => {
    if (!isBrowser()) return;
    window.dispatchEvent(new Event(queueChangeEvent));
};

export const getManagerQueueChangeEvent = () => queueChangeEvent;

export const readManagerOfflineQueue = (scope: ManagerOfflineScope) => {
    const queue = readJson<unknown>(managerQueueKey(scope), []);
    return Array.isArray(queue) ? queue as OfflineOperation[] : [];
};

const writeManagerOfflineQueue = (scope: ManagerOfflineScope, queue: OfflineOperation[]) => {
    try {
        writeSerialized(managerQueueKey(scope), JSON.stringify(queue));
    } catch {
        throw new Error('Не удалось сохранить офлайн-очередь. Освободите место в браузере и повторите попытку.');
    }
    emitQueueChange();
};

export const enqueueManagerOfflineOperation = ({
    scope,
    operationId,
    path,
    options,
    label,
}: {
    scope: ManagerOfflineScope;
    operationId?: string;
    path: string;
    options?: StoredRequestOptions;
    label: string;
}) => {
    const operation: OfflineOperation = {
        id: operationId ?? createManagerOperationId(),
        path,
        options: {
            method: options?.method,
            body: options?.body,
            headers: options?.headers,
        },
        label,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastError: null,
    };

    const currentQueue = readManagerOfflineQueue(scope);
    const existingOperation = currentQueue.find((queuedOperation) => queuedOperation.id === operation.id);
    if (existingOperation) {
        return existingOperation;
    }

    if (currentQueue.length >= maxOfflineQueueOperations) {
        throw new Error('Офлайн-очередь заполнена. Подключите интернет и синхронизируйте операции перед продолжением.');
    }

    const nextQueue = [...currentQueue, operation];
    const serializedQueue = JSON.stringify(nextQueue);
    if (serializedByteLength(serializedQueue) > maxOfflineQueueBytes) {
        throw new Error('Операция слишком большая для безопасного офлайн-хранения. Подключите интернет и повторите её.');
    }

    try {
        writeSerialized(managerQueueKey(scope), serializedQueue);
    } catch {
        throw new Error('Недостаточно места для офлайн-операции. Подключите интернет и синхронизируйте очередь.');
    }
    emitQueueChange();
    return operation;
};

export const cacheManagerState = <T,>(scope: ManagerOfflineScope, state: T) => {
    const serializedState = JSON.stringify({
        cachedAt: new Date().toISOString(),
        state,
    });

    if (serializedByteLength(serializedState) > maxManagerStateCacheBytes) {
        return false;
    }

    try {
        writeSerialized(managerStateKey(scope), serializedState);
        return true;
    } catch {
        return false;
    }
};

export const readCachedManagerState = <T,>(scope: ManagerOfflineScope) => {
    const cacheKey = managerStateKey(scope);
    const cached = readJson<{ cachedAt?: unknown; state?: T } | null>(cacheKey, null);
    if (!cached || typeof cached.cachedAt !== 'string' || !('state' in cached)) {
        return null;
    }

    const cachedAtMs = new Date(cached.cachedAt).getTime();
    if (!Number.isFinite(cachedAtMs) || Date.now() - cachedAtMs > maxManagerStateCacheAgeMs) {
        if (isBrowser()) {
            window.localStorage.removeItem(cacheKey);
        }
        return null;
    }

    return cached as { cachedAt: string; state: T };
};

export const clearCachedManagerState = (scope: ManagerOfflineScope) => {
    if (!isBrowser()) return;
    window.localStorage.removeItem(managerStateKey(scope));
};

export const clearLegacyManagerOfflineData = () => {
    if (!isBrowser()) return;
    window.localStorage.removeItem(legacyQueueKey);
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(legacyStatePrefix)) {
            window.localStorage.removeItem(key);
        }
    }
};

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

const getHttpErrorStatus = (error: unknown) => {
    if (!error || typeof error !== 'object' || !('status' in error)) {
        return null;
    }

    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' && Number.isInteger(status) ? status : null;
};

const isFinalClientError = (error: unknown) => {
    const status = getHttpErrorStatus(error);
    return status !== null && status >= 400 && status < 500 && ![408, 425, 429].includes(status);
};

export const flushManagerOfflineQueue = async (
    scope: ManagerOfflineScope,
    sender: (operation: OfflineOperation) => Promise<unknown>
) => {
    const queue = readManagerOfflineQueue(scope);
    const replayBatch = queue.slice(0, maxOfflineReplayBatch);
    let synced = 0;
    const remaining: OfflineOperation[] = [];
    const rejected: RejectedOfflineOperation[] = [];
    let stoppedOnError = false;

    for (let index = 0; index < replayBatch.length; index += 1) {
        const operation = replayBatch[index];
        try {
            await sender(operation);
            synced += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Не удалось синхронизировать операцию';
            const status = getHttpErrorStatus(error);
            if (isFinalClientError(error) && status !== null) {
                rejected.push({
                    id: operation.id,
                    label: operation.label,
                    status,
                    error: message,
                });
                continue;
            }

            remaining.push({
                ...operation,
                attempts: operation.attempts + 1,
                lastError: message,
            });
            remaining.push(...queue.slice(index + 1));
            stoppedOnError = true;
            break;
        }
    }

    if (remaining.length === 0 && replayBatch.length < queue.length) {
        remaining.push(...queue.slice(replayBatch.length));
    }

    writeManagerOfflineQueue(scope, remaining);

    return {
        synced,
        rejected,
        remaining: remaining.length,
        deferred: stoppedOnError ? 0 : remaining.length,
        firstError: stoppedOnError ? remaining[0]?.lastError ?? null : null,
    };
};
