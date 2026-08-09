import { deriveIntegrationToken, validateIntegrationToken } from '@/lib/server/integration-credentials';

const TOKEN_NAMESPACE = 'hotel-ops:exely-webhook:v1';

export const exelyWebhookPath = (connectionId: string) => {
    const token = deriveIntegrationToken(TOKEN_NAMESPACE, connectionId);
    return `/api/integrations/exely/webhook/${encodeURIComponent(connectionId)}/${encodeURIComponent(token)}`;
};

export const validateExelyWebhookToken = (connectionId: string, token: string) => (
    validateIntegrationToken(TOKEN_NAMESPACE, connectionId, token)
);
