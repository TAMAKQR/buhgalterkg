'use client';

import { AdminHotelDetail } from '@/components/modules/admin-hotel-detail';

export default function HotelDetailPage({ params }: { params: { hotelId: string } }) {
    return <AdminHotelDetail hotelId={params.hotelId} />;
}
