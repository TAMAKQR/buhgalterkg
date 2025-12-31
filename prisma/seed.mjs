import pkg from '@prisma/client';

const {
    PrismaClient,
    RoomStatus,
    StayStatus,
    PaymentMethod,
    LedgerEntryType,
    ProductSaleType,
    ProductInventoryAdjustmentType
} = pkg;

const prisma = new PrismaClient();

const minor = (kgs) => Math.round(kgs * 100);

const checkoutDate = (dateString) => new Date(dateString);

async function resetData() {
    await prisma.$transaction([
        prisma.productSale.deleteMany(),
        prisma.productInventoryEntry.deleteMany(),
        prisma.product.deleteMany(),
        prisma.productCategory.deleteMany(),
        prisma.cashEntry.deleteMany(),
        prisma.roomStay.deleteMany(),
        prisma.shift.deleteMany(),
        prisma.room.deleteMany(),
        prisma.hotelAssignment.deleteMany(),
        prisma.hotel.deleteMany(),
        prisma.user.deleteMany()
    ]);
}

async function createRooms(hotelId, rooms) {
    const map = new Map();
    for (const room of rooms) {
        const record = await prisma.room.create({
            data: {
                hotelId,
                label: room.label,
                floor: room.floor ?? null,
                status: room.status ?? RoomStatus.AVAILABLE,
                notes: room.notes ?? null
            }
        });
        map.set(room.label, record);
    }
    return map;
}

async function createStay({ room, shift, guestName, cashPaid = 0, cardPaid = 0, checkIn, checkOut, note }) {
    const stay = await prisma.roomStay.create({
        data: {
            roomId: room.id,
            hotelId: room.hotelId,
            shiftId: shift?.id ?? null,
            guestName,
            scheduledCheckIn: checkIn,
            scheduledCheckOut: checkOut,
            actualCheckIn: checkIn,
            status: StayStatus.CHECKED_IN,
            cashPaid,
            cardPaid,
            amountPaid: cashPaid + cardPaid,
            paymentMethod:
                cashPaid && cardPaid
                    ? null
                    : cashPaid
                        ? PaymentMethod.CASH
                        : cardPaid
                            ? PaymentMethod.CARD
                            : null,
            notes: note ?? null
        }
    });

    await prisma.room.update({
        where: { id: room.id },
        data: {
            currentStayId: stay.id,
            status: RoomStatus.OCCUPIED
        }
    });

    return stay;
}

async function main() {
    await resetData();

    const janara = await prisma.user.create({
        data: {
            telegramId: 'tg-janara',
            displayName: 'Жанара',
            username: 'janara.manager',
            role: 'MANAGER'
        }
    });

    const bermet = await prisma.user.create({
        data: {
            telegramId: 'tg-bermet',
            displayName: 'Бермет',
            username: 'bermet.manager',
            role: 'MANAGER'
        }
    });

    const aidana = await prisma.user.create({
        data: {
            telegramId: 'tg-aidana',
            displayName: 'Айдана',
            username: 'aidana.manager',
            role: 'MANAGER'
        }
    });

    const timur = await prisma.user.create({
        data: {
            telegramId: 'tg-timur',
            displayName: 'Тимур',
            username: 'timur.manager',
            role: 'MANAGER'
        }
    });

    const castleHotel = await prisma.hotel.create({
        data: {
            name: 'Тихий Замок (Политех)',
            address: 'ул. Токтоналиева, 8Б',
            managerSharePct: 15,
            cleaningChatId: '-1001938745612',
            notes: 'Основная точка рядом с Политехом'
        }
    });

    const skyHotel = await prisma.hotel.create({
        data: {
            name: 'Sky Garden (ЦУМ)',
            address: 'пр. Чуй, 155',
            managerSharePct: 12,
            cleaningChatId: '-1001938745999',
            notes: 'Панорамные номера и лаундж'
        }
    });

    await prisma.hotelAssignment.createMany({
        data: [
            {
                hotelId: castleHotel.id,
                userId: janara.id,
                role: 'MANAGER',
                pinCode: '123456',
                shiftPayAmount: minor(2000),
                revenueSharePct: 5
            },
            {
                hotelId: castleHotel.id,
                userId: bermet.id,
                role: 'MANAGER',
                pinCode: '654321',
                shiftPayAmount: minor(1800),
                revenueSharePct: 4
            },
            {
                hotelId: skyHotel.id,
                userId: aidana.id,
                role: 'MANAGER',
                pinCode: '111222',
                shiftPayAmount: minor(1700),
                revenueSharePct: 6
            },
            {
                hotelId: skyHotel.id,
                userId: timur.id,
                role: 'MANAGER',
                pinCode: '333444',
                shiftPayAmount: minor(1600),
                revenueSharePct: 5
            }
        ]
    });

    const castleRooms = await createRooms(castleHotel.id, Array.from({ length: 14 }, (_, index) => {
        const label = String(index + 1);
        const occupied = ['1', '2', '3', '4', '5', '6', '7', '10', '14'].includes(label);
        return {
            label,
            floor: index < 7 ? '2' : '3',
            status: occupied ? RoomStatus.OCCUPIED : RoomStatus.DIRTY
        };
    }));

    const skyRooms = await createRooms(skyHotel.id, [
        { label: 'Deluxe 1', floor: '5', status: RoomStatus.AVAILABLE },
        { label: 'Deluxe 2', floor: '5', status: RoomStatus.AVAILABLE },
        { label: 'Loft 1', floor: '6', status: RoomStatus.OCCUPIED },
        { label: 'Loft 2', floor: '6', status: RoomStatus.DIRTY },
        { label: 'Suite 1', floor: '7', status: RoomStatus.AVAILABLE },
        { label: 'Suite 2', floor: '7', status: RoomStatus.OCCUPIED },
        { label: 'Panorama', floor: '8', status: RoomStatus.AVAILABLE },
        { label: 'Studio', floor: '4', status: RoomStatus.DIRTY }
    ]);

    const castleClosedShift = await prisma.shift.create({
        data: {
            hotelId: castleHotel.id,
            managerId: bermet.id,
            status: 'CLOSED',
            openedAt: checkoutDate('2025-12-29T00:55:00+06:00'),
            closedAt: checkoutDate('2025-12-29T08:20:00+06:00'),
            openingCash: minor(0),
            closingCash: minor(90),
            handoverCash: minor(90),
            number: 1
        }
    });

    const castleOpenShift = await prisma.shift.create({
        data: {
            hotelId: castleHotel.id,
            managerId: janara.id,
            status: 'OPEN',
            openedAt: checkoutDate('2025-12-29T22:46:00+06:00'),
            openingCash: minor(0),
            number: 2
        }
    });

    const skyShift = await prisma.shift.create({
        data: {
            hotelId: skyHotel.id,
            managerId: aidana.id,
            status: 'OPEN',
            openedAt: checkoutDate('2025-12-29T18:30:00+06:00'),
            openingCash: minor(120),
            number: 1
        }
    });

    const stayWindow = {
        checkIn: checkoutDate('2025-12-29T23:00:00+06:00'),
        checkOut: checkoutDate('2025-12-30T12:00:00+06:00')
    };

    const activeStays = [];
    const staySeeds = [
        { label: '1', guest: 'Асан уулу Тимур', cash: minor(550), card: 0 },
        { label: '2', guest: 'Элина', cash: minor(70), card: 0 },
        { label: '3', guest: 'Семён', cash: minor(45), card: 0 },
        { label: '4', guest: 'Диана', cash: 0, card: 0 },
        { label: '5', guest: 'Нурбек', cash: minor(20), card: 0 },
        { label: '6', guest: 'Анвар', cash: 0, card: 0 },
        { label: '7', guest: 'Сабина', cash: 0, card: 0 },
        { label: '10', guest: 'Михаил', cash: minor(120), card: 0 },
        { label: '14', guest: 'Омар', cash: 0, card: minor(180) }
    ];

    for (const staySeed of staySeeds) {
        const room = castleRooms.get(staySeed.label);
        const stay = await createStay({
            room,
            shift: castleOpenShift,
            guestName: staySeed.guest,
            cashPaid: staySeed.cash,
            cardPaid: staySeed.card,
            checkIn: stayWindow.checkIn,
            checkOut: stayWindow.checkOut
        });
        activeStays.push(stay);
    }

    const skyStay = await createStay({
        room: skyRooms.get('Loft 1'),
        shift: skyShift,
        guestName: 'Канат',
        cashPaid: minor(95),
        cardPaid: minor(45),
        checkIn: checkoutDate('2025-12-29T19:00:00+06:00'),
        checkOut: checkoutDate('2025-12-30T11:00:00+06:00'),
        note: 'Гость с ребёнком'
    });

    await createStay({
        room: skyRooms.get('Suite 2'),
        shift: skyShift,
        guestName: 'Гузель',
        cashPaid: minor(130),
        cardPaid: 0,
        checkIn: checkoutDate('2025-12-29T18:45:00+06:00'),
        checkOut: checkoutDate('2025-12-30T10:00:00+06:00')
    });

    const paymentEntries = [
        { amount: minor(550), method: PaymentMethod.CASH, note: 'Оплата номера 1' },
        { amount: minor(70), method: PaymentMethod.CASH, note: 'Оплата номера 2' },
        { amount: minor(120), method: PaymentMethod.CASH, note: 'Оплата номера 10' },
        { amount: minor(180), method: PaymentMethod.CARD, note: 'Оплата номера 14' },
        { amount: minor(150), method: PaymentMethod.CASH, note: 'Продажа минибара' }
    ];

    for (const entry of paymentEntries) {
        await prisma.cashEntry.create({
            data: {
                hotelId: castleHotel.id,
                shiftId: castleOpenShift.id,
                managerId: janara.id,
                entryType: LedgerEntryType.CASH_IN,
                method: entry.method,
                amount: entry.amount,
                note: entry.note
            }
        });
    }

    await prisma.cashEntry.create({
        data: {
            hotelId: castleHotel.id,
            shiftId: castleOpenShift.id,
            managerId: janara.id,
            entryType: LedgerEntryType.CASH_OUT,
            method: PaymentMethod.CASH,
            amount: minor(1890),
            note: 'Закупка чистящих средств'
        }
    });

    await prisma.cashEntry.create({
        data: {
            hotelId: skyHotel.id,
            shiftId: skyShift.id,
            managerId: aidana.id,
            entryType: LedgerEntryType.CASH_IN,
            method: PaymentMethod.CARD,
            amount: minor(240),
            note: 'Предоплата Sky Lounge'
        }
    });

    const minibarCategory = await prisma.productCategory.create({
        data: {
            hotelId: castleHotel.id,
            name: 'Минибар',
            description: 'Напитки и снеки в номерах'
        }
    });

    const barCategory = await prisma.productCategory.create({
        data: {
            hotelId: skyHotel.id,
            name: 'Room Service',
            description: 'Доставка в номер'
        }
    });

    const waterProduct = await prisma.product.create({
        data: {
            hotelId: castleHotel.id,
            categoryId: minibarCategory.id,
            name: 'Вода 0.5л',
            sku: 'TZ-WATER-05',
            description: 'Питьевая вода без газа',
            costPrice: minor(12),
            sellPrice: minor(30),
            unit: 'бут',
            stockOnHand: 0,
            reorderThreshold: 10
        }
    });

    const snackProduct = await prisma.product.create({
        data: {
            hotelId: castleHotel.id,
            categoryId: minibarCategory.id,
            name: 'Орехи 50г',
            sku: 'TZ-NUTS-50',
            description: 'Ассорти орехов',
            costPrice: minor(25),
            sellPrice: minor(55),
            unit: 'пак',
            stockOnHand: 0,
            reorderThreshold: 8
        }
    });

    const latteProduct = await prisma.product.create({
        data: {
            hotelId: skyHotel.id,
            categoryId: barCategory.id,
            name: 'Латте 300 мл',
            sku: 'SG-LATTE-300',
            description: 'Кофе для доставки',
            costPrice: minor(70),
            sellPrice: minor(150),
            unit: 'стакан',
            stockOnHand: 0,
            reorderThreshold: 15
        }
    });

    await prisma.productInventoryEntry.create({
        data: {
            productId: waterProduct.id,
            adjustmentType: ProductInventoryAdjustmentType.RESTOCK,
            quantity: 40,
            costTotal: minor(480),
            note: 'Поставка FreshSpring'
        }
    });
    await prisma.product.update({ where: { id: waterProduct.id }, data: { stockOnHand: { increment: 40 } } });

    await prisma.productInventoryEntry.create({
        data: {
            productId: snackProduct.id,
            adjustmentType: ProductInventoryAdjustmentType.RESTOCK,
            quantity: 25,
            costTotal: minor(625),
            note: 'Склад орехов'
        }
    });
    await prisma.product.update({ where: { id: snackProduct.id }, data: { stockOnHand: { increment: 25 } } });

    await prisma.productInventoryEntry.create({
        data: {
            productId: latteProduct.id,
            adjustmentType: ProductInventoryAdjustmentType.RESTOCK,
            quantity: 60,
            costTotal: minor(4200),
            note: 'Поставка кофейных зерен'
        }
    });
    await prisma.product.update({ where: { id: latteProduct.id }, data: { stockOnHand: { increment: 60 } } });

    const minibarSale = await prisma.productSale.create({
        data: {
            productId: waterProduct.id,
            hotelId: castleHotel.id,
            shiftId: castleOpenShift.id,
            roomStayId: activeStays[0]?.id ?? null,
            soldById: janara.id,
            saleType: ProductSaleType.ROOM,
            quantity: 5,
            unitPrice: minor(30),
            totalAmount: minor(150),
            paymentMethod: PaymentMethod.CASH,
            note: 'Минибар: вода для номера 1'
        }
    });

    await prisma.product.update({ where: { id: waterProduct.id }, data: { stockOnHand: { decrement: minibarSale.quantity } } });

    await prisma.productSale.create({
        data: {
            productId: latteProduct.id,
            hotelId: skyHotel.id,
            shiftId: skyShift.id,
            roomStayId: skyStay.id,
            soldById: aidana.id,
            saleType: ProductSaleType.ROOM,
            quantity: 2,
            unitPrice: minor(150),
            totalAmount: minor(300),
            paymentMethod: PaymentMethod.CARD,
            note: 'Room service кофе'
        }
    });
    await prisma.product.update({ where: { id: latteProduct.id }, data: { stockOnHand: { decrement: 2 } } });

    console.info('Demo data generated successfully.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
