import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/server/session';
import { assertAdmin } from '@/lib/permissions';
import { handleApiError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const createProductSchema = z.object({
    hotelId: z.string().cuid(),
    categoryId: z.string().cuid().optional().nullable(),
    name: z.string().min(2).max(160),
    sku: z.string().max(64).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    costPrice: z.number().nonnegative(),
    sellPrice: z.number().nonnegative(),
    unit: z.string().max(32).optional().nullable(),
    reorderThreshold: z.number().int().nonnegative().optional().nullable(),
    isActive: z.boolean().optional()
});

const toMinor = (value?: number) => {
    if (value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.round(value * 100);
};

const parseDate = (value: string | null) => {
    if (!value) {
        return undefined;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('INVALID_DATE');
    }
    return parsed;
};

export async function GET(request: NextRequest) {
    try {
        const session = await getSessionUser(request);
        assertAdmin(session);

        const url = request.nextUrl;
        const hotelId = url.searchParams.get('hotelId');
        if (!hotelId) {
            return new NextResponse('hotelId обязателен', { status: 400 });
        }

        const includeSales = url.searchParams.get('includeSales') === 'true';
        let salesStart: Date | undefined;
        let salesEnd: Date | undefined;

        try {
            salesStart = parseDate(url.searchParams.get('salesStart'));
            salesEnd = parseDate(url.searchParams.get('salesEnd'));
        } catch (parseError) {
            if (parseError instanceof Error && parseError.message === 'INVALID_DATE') {
                return new NextResponse('Некорректная дата диапазона продаж', { status: 400 });
            }
            throw parseError;
        }

        const whereSaleDates: Prisma.ProductSaleWhereInput = {};
        if (salesStart || salesEnd) {
            whereSaleDates.createdAt = {
                ...(salesStart ? { gte: salesStart } : {}),
                ...(salesEnd ? { lte: salesEnd } : {})
            };
        }

        const [hotel, categories, products, sales] = await Promise.all([
            prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } }),
            prisma.productCategory.findMany({
                where: { hotelId },
                include: { _count: { select: { products: true } } },
                orderBy: { name: 'asc' }
            }),
            prisma.product.findMany({
                where: { hotelId },
                include: { category: { select: { id: true, name: true } } },
                orderBy: [{ isActive: 'desc' }, { name: 'asc' }]
            }),
            includeSales
                ? prisma.productSale.groupBy({
                    by: ['productId'],
                    where: { hotelId, ...whereSaleDates },
                    _sum: { quantity: true, totalAmount: true }
                })
                : Promise.resolve([])
        ]);

        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        const lowStockCount = products.filter(
            (product) =>
                product.reorderThreshold != null &&
                product.reorderThreshold > 0 &&
                product.stockOnHand <= product.reorderThreshold
        ).length;

        const stockValue = products.reduce((acc, product) => acc + product.costPrice * product.stockOnHand, 0);
        const potentialRevenue = products.reduce((acc, product) => acc + product.sellPrice * product.stockOnHand, 0);

        const salesMap = new Map<string, { quantity: number; revenue: number }>();
        let salesQuantityTotal = 0;
        let salesRevenueTotal = 0;
        for (const group of sales) {
            const quantity = group._sum.quantity ?? 0;
            const revenue = group._sum.totalAmount ?? 0;
            salesQuantityTotal += quantity;
            salesRevenueTotal += revenue;
            salesMap.set(group.productId, { quantity, revenue });
        }

        return NextResponse.json({
            hotelId,
            categories: categories.map((category) => ({
                id: category.id,
                name: category.name,
                description: category.description,
                productCount: category._count.products
            })),
            products: products.map((product) => ({
                id: product.id,
                hotelId: product.hotelId,
                category: product.category
                    ? { id: product.category.id, name: product.category.name }
                    : null,
                name: product.name,
                sku: product.sku,
                description: product.description,
                costPrice: product.costPrice,
                sellPrice: product.sellPrice,
                unit: product.unit,
                stockOnHand: product.stockOnHand,
                reorderThreshold: product.reorderThreshold,
                isActive: product.isActive,
                createdAt: product.createdAt,
                updatedAt: product.updatedAt,
                sales: salesMap.get(product.id) ?? null
            })),
            summary: {
                totalProducts: products.length,
                lowStock: lowStockCount,
                stockValue,
                potentialRevenue,
                sales: includeSales
                    ? {
                        range: {
                            start: salesStart ?? null,
                            end: salesEnd ?? null
                        },
                        totalQuantity: salesQuantityTotal,
                        totalRevenue: salesRevenueTotal
                    }
                    : null
            }
        });
    } catch (error) {
        return handleApiError(error, 'Failed to load products');
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { initData, devOverride, manualToken, ...rest } = body;
        const session = await getSessionUser(request, { initData, devOverride, manualToken });
        assertAdmin(session);

        const payload = createProductSchema.parse(rest);

        const hotel = await prisma.hotel.findUnique({ where: { id: payload.hotelId }, select: { id: true } });
        if (!hotel) {
            return new NextResponse('Hotel not found', { status: 404 });
        }

        if (payload.categoryId) {
            const category = await prisma.productCategory.findFirst({
                where: { id: payload.categoryId, hotelId: payload.hotelId },
                select: { id: true }
            });
            if (!category) {
                return new NextResponse('Категория не найдена в этом отеле', { status: 404 });
            }
        }

        const product = await prisma.product.create({
            data: {
                hotelId: payload.hotelId,
                categoryId: payload.categoryId ?? null,
                name: payload.name.trim(),
                sku: payload.sku?.trim() || null,
                description: payload.description?.trim() || null,
                costPrice: toMinor(payload.costPrice) ?? 0,
                sellPrice: toMinor(payload.sellPrice) ?? 0,
                unit: payload.unit?.trim() || null,
                reorderThreshold: payload.reorderThreshold ?? null,
                isActive: payload.isActive ?? true
            }
        });

        return NextResponse.json(product, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(error.message, { status: 400 });
        }
        return handleApiError(error, 'Failed to create product');
    }
}

