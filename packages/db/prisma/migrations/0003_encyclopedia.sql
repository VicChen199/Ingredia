-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('safety', 'function', 'controversy');

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "claim_type" "ClaimType" NOT NULL,
    "summary" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "published_on" DATE,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryStatus" (
    "id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "status_text" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,

    CONSTRAINT "RegulatoryStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Evidence_ingredient_id_idx" ON "Evidence"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryStatus_ingredient_id_jurisdiction_key" ON "RegulatoryStatus"("ingredient_id", "jurisdiction");

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryStatus" ADD CONSTRAINT "RegulatoryStatus_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Content rules. Not represented in schema.prisma.
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_summary_check" CHECK (btrim("summary") <> '');

ALTER TABLE "RegulatoryStatus" ADD CONSTRAINT "RegulatoryStatus_status_text_check" CHECK (btrim("status_text") <> '');

ALTER TABLE "RegulatoryStatus" ADD CONSTRAINT "RegulatoryStatus_jurisdiction_check" CHECK ("jurisdiction" ~ '^[A-Z]{2,8}$');
