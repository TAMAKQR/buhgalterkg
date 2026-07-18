export class RequestBodyTooLargeError extends Error {
    constructor() {
        super('Request body is too large');
        this.name = 'RequestBodyTooLargeError';
    }
}

export const readJsonBody = async <T = unknown>(request: Request, maxBytes = 16 * 1024): Promise<T> => {
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new RequestBodyTooLargeError();
    }

    if (!request.body) {
        return JSON.parse('') as T;
    }

    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let receivedBytes = 0;
    let text = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes += value.byteLength;
            if (receivedBytes > maxBytes) {
                await reader.cancel();
                throw new RequestBodyTooLargeError();
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return JSON.parse(text) as T;
    } finally {
        reader.releaseLock();
    }
};
