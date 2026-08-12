-- Group check-ins historically relied on CashEntry's KGS default even when the
-- hotel operated in another currency. These entries came from a form that only
-- accepts the hotel's currency, and they did not persist original_amount.
UPDATE "CashEntry" AS entry
SET
    "original_currency" = hotel."currency",
    "original_amount" = entry."amount"
FROM "Hotel" AS hotel
WHERE entry."hotelId" = hotel."id"
  AND entry."original_currency" = 'KGS'
  AND entry."original_amount" IS NULL
  AND hotel."currency" <> 'KGS'
  AND entry."meta" ->> 'kind' IN ('group_checkin', 'group_booking_prepayment');
