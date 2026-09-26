-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AliasNameType" AS ENUM ('common', 'inci', 'iupac', 'cas', 'e_number', 'brand_trade');

-- CreateEnum
CREATE TYPE "OriginSummary" AS ENUM ('plant', 'synthetic', 'animal', 'mineral', 'mixed');

-- CreateEnum
CREATE TYPE "CaptureSource" AS ENUM ('camera', 'extension');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('uploaded', 'extracted', 'parsed', 'failed');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('matched', 'unknown', 'ambiguous');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceFlag" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category_scope" TEXT,

    CONSTRAINT "PreferenceFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "user_id" TEXT NOT NULL,
    "flag_id" TEXT NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("user_id","flag_id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientAlias" (
    "ingredient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_type" "AliasNameType" NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "IngredientAlias_pkey" PRIMARY KEY ("ingredient_id","normalized","name_type")
);

-- CreateTable
CREATE TABLE "IngredientProfile" (
    "ingredient_id" TEXT NOT NULL,
    "origin_summary" "OriginSummary" NOT NULL,
    "manufacturer_use" TEXT NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "IngredientProfile_pkey" PRIMARY KEY ("ingredient_id")
);

-- CreateTable
CREATE TABLE "IngredientFlag" (
    "ingredient_id" TEXT NOT NULL,
    "flag_id" TEXT NOT NULL,
    "product_category" TEXT,

    CONSTRAINT "IngredientFlag_pkey" PRIMARY KEY ("ingredient_id","flag_id")
);

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "CaptureSource" NOT NULL,
    "status" "CaptureStatus" NOT NULL,
    "blob_name" TEXT,
    "raw_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureItem" (
    "capture_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "raw_token" TEXT NOT NULL,
    "ingredient_id" TEXT,
    "match_status" "MatchStatus" NOT NULL,

    CONSTRAINT "CaptureItem_pkey" PRIMARY KEY ("capture_id","sort_order")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "user_id" TEXT NOT NULL,
    "capture_id" TEXT NOT NULL,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("user_id","capture_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceFlag_code_key" ON "PreferenceFlag"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_slug_key" ON "Ingredient"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_id_user_id_key" ON "Capture"("id", "user_id");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "PreferenceFlag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientAlias" ADD CONSTRAINT "IngredientAlias_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientProfile" ADD CONSTRAINT "IngredientProfile_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientFlag" ADD CONSTRAINT "IngredientFlag_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientFlag" ADD CONSTRAINT "IngredientFlag_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "PreferenceFlag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "Capture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_capture_id_user_id_fkey" FOREIGN KEY ("capture_id", "user_id") REFERENCES "Capture"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Typo tolerance on alias search. Not represented in schema.prisma.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "IngredientAlias_normalized_trgm_idx" ON "IngredientAlias" USING GIN ("normalized" gin_trgm_ops);

