-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_categoryId_fkey";
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_hotelId_fkey";
ALTER TABLE "ProductCategory" DROP CONSTRAINT IF EXISTS "ProductCategory_hotelId_fkey";
ALTER TABLE "ProductInventoryEntry" DROP CONSTRAINT IF EXISTS "ProductInventoryEntry_productId_fkey";
ALTER TABLE "ProductInventoryEntry" DROP CONSTRAINT IF EXISTS "ProductInventoryEntry_shiftId_fkey";
ALTER TABLE "ProductInventoryEntry" DROP CONSTRAINT IF EXISTS "ProductInventoryEntry_userId_fkey";
ALTER TABLE "ProductSale" DROP CONSTRAINT IF EXISTS "ProductSale_hotelId_fkey";
ALTER TABLE "ProductSale" DROP CONSTRAINT IF EXISTS "ProductSale_productId_fkey";
ALTER TABLE "ProductSale" DROP CONSTRAINT IF EXISTS "ProductSale_roomStayId_fkey";
ALTER TABLE "ProductSale" DROP CONSTRAINT IF EXISTS "ProductSale_shiftId_fkey";
ALTER TABLE "ProductSale" DROP CONSTRAINT IF EXISTS "ProductSale_soldById_fkey";

-- DropTable
DROP TABLE IF EXISTS "ProductSale";
DROP TABLE IF EXISTS "ProductInventoryEntry";
DROP TABLE IF EXISTS "Product";
DROP TABLE IF EXISTS "ProductCategory";
