import { AdminHotelDetail } from '@/components/modules/admin-hotel-detail';

export default async function HotelDetailPage({ params }: { params: Promise<{ hotelId: string }> }) {
    const { hotelId } = await params;
    return <AdminHotelDetail hotelId={hotelId} />;
}
