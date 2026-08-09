import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AAD = Buffer.from('hotel-ops:integration-credential:v1', 'utf8');

const getEncryptionKey = () => {
    const secret = (
        process.env.INTEGRATION_CREDENTIALS_KEY
        ?? process.env.ADMIN_SESSION_SECRET
        ?? ''
    ).trim();

    if (Buffer.byteLength(secret, 'utf8') < 32) {
        throw new Error('Не настроен ключ шифрования интеграций');
    }

    return createHash('sha256').update(secret, 'utf8').digest();
};

export const encryptIntegrationCredential = (value: string) => {
    const normalized = value.trim();
    if (!normalized) throw new Error('Секрет интеграции не может быть пустым');

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    cipher.setAAD(AAD);
    const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
};

export const decryptIntegrationCredential = (sealedValue: string) => {
    const [version, ivValue, tagValue, encryptedValue] = sealedValue.split('.');
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
        throw new Error('Сохранённый секрет интеграции повреждён');
    }

    try {
        const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
        decipher.setAAD(AAD);
        decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(encryptedValue, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
    } catch {
        throw new Error('Не удалось расшифровать секрет интеграции');
    }
};
