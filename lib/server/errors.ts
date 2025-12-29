import { NextResponse } from 'next/server';

export class SessionError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 401) {
        super(message);
        this.name = 'SessionError';
        this.statusCode = statusCode;
    }
}

export const handleApiError = (error: unknown, fallbackMessage: string, fallbackStatus = 500) => {
    if (error instanceof SessionError) {
        return new NextResponse(error.message, { status: error.statusCode });
    }

    console.error(error);
    return new NextResponse(fallbackMessage, { status: fallbackStatus });
};
