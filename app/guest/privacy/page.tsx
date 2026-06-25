import Link from 'next/link';

const sections = [
    {
        title: 'Какие данные собираются',
        body: 'Имя и фамилия, телефон, номер документа, Telegram ID при открытии через бота, выбранный объект, QR-код, история заселений и отметки проверки документа.'
    },
    {
        title: 'Зачем это нужно',
        body: 'Чтобы гость мог один раз создать профиль, а менеджер быстро заселял его по QR без повторного ручного ввода и без отправки фото документа в чат.'
    },
    {
        title: 'Кто видит данные',
        body: 'Менеджеры видят данные только по своим объектам. Администратор видит данные для управления объектами и контроля. Наблюдателям паспортные данные не предназначены.'
    },
    {
        title: 'Как проверяется документ',
        body: 'Менеджер сверяет документ глазами на стойке и нажимает кнопку подтверждения. Фото документа не требуется хранить или отправлять в Telegram-группы.'
    },
    {
        title: 'Как исправить или удалить данные',
        body: 'Гость может попросить менеджера исправить данные профиля. Для удаления профиля или спорных вопросов нужно обратиться к администратору объекта.'
    }
];

export default function GuestPrivacyPage() {
    return (
        <main className="min-h-screen bg-[#f3f6fb] px-4 py-5 text-slate-950">
            <div className="mx-auto w-full max-w-2xl">
                <Link href="/guest" className="text-sm font-semibold text-slate-500 hover:text-slate-900">
                    Назад в GuestPass
                </Link>

                <section className="mt-4 rounded-[28px] bg-slate-950 p-5 text-white shadow-[0_24px_70px_-36px_rgba(15,23,42,0.7)]">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-sky-100/70">GuestPass</p>
                    <h1 className="mt-2 text-2xl font-semibold tracking-tight">Политика конфиденциальности</h1>
                    <p className="mt-3 text-sm leading-6 text-slate-200/80">
                        Коротко о том, как данные гостя используются для QR-заселения и проверки документа.
                    </p>
                </section>

                <div className="mt-4 space-y-3">
                    {sections.map((section) => (
                        <section key={section.title} className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.45)]">
                            <h2 className="text-base font-semibold">{section.title}</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{section.body}</p>
                        </section>
                    ))}
                </div>

                <p className="mt-4 rounded-3xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                    Это рабочая политика продукта, а не юридическая консультация. Для финального публичного текста администратору стоит сверить сроки хранения и формулировки с локальными требованиями страны, где работает объект.
                </p>
            </div>
        </main>
    );
}
