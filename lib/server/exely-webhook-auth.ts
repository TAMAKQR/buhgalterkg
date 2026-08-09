import { createHash, createHmac, timingSafeEqual } from 'crypto';

const TOKEN_NAMESPACE = 'hotel-ops:exely-webhook:v1';

const deriveToken = (connectionId: string, encryptedCredential: string) => {
    const signingKey = createHash('sha256').update(encryptedCredential, 'utf8').digest();
    return createHmac('sha256', signingKey)
        .update(`${TOKEN_NAMESPACE}:${connectionId}`, 'utf8')
        .digest('base64url');
};

export const exelyWebhookPath = (connectionId: string, encryptedCredential: string) => {
    const token = deriveToken(connectionId, encryptedCredential);
    return `/api/integrations/exely/webhook/${encodeURIComponent(connectionId)}/${encodeURIComponent(token)}`;
};

export const validateExelyWebhookToken = (connectionId: string, encryptedCredential: string, token: string) => {
    const expected = Buffer.from(deriveToken(connectionId, encryptedCredential), 'utf8');
    const provided = Buffer.from(token, 'utf8');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
};
