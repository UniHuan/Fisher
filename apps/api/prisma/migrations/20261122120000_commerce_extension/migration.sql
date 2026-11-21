-- CreateTable
CREATE TABLE "product" (
    "product_id" CHAR(26) NOT NULL,
    "brand" VARCHAR(32) NOT NULL DEFAULT 'unihuan',
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(120),
    "description" TEXT,
    "category" VARCHAR(32) NOT NULL,
    "image_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cover_image_key" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL,
    "sort_weight" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "product_channel" (
    "channel_id" CHAR(26) NOT NULL,
    "product_id" CHAR(26) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "external_product_id" VARCHAR(64),
    "purchase_action" VARCHAR(16) NOT NULL,
    "action_payload" JSONB NOT NULL,
    "price_display" VARCHAR(32),
    "status" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_channel_pkey" PRIMARY KEY ("channel_id")
);

-- CreateTable
CREATE TABLE "product_placement" (
    "placement_id" CHAR(26) NOT NULL,
    "product_id" CHAR(26) NOT NULL,
    "surface" VARCHAR(32) NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "target_id" CHAR(26),
    "fish_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "district" VARCHAR(32),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "status" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_placement_pkey" PRIMARY KEY ("placement_id")
);

-- CreateIndex
CREATE INDEX "product_status_sort_weight_idx" ON "product"("status", "sort_weight");

-- CreateIndex
CREATE INDEX "product_category_status_idx" ON "product"("category", "status");

-- CreateIndex
CREATE INDEX "product_updated_at_idx" ON "product"("updated_at");

-- CreateIndex
CREATE INDEX "product_channel_channel_status_idx" ON "product_channel"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_channel_product_id_channel_key" ON "product_channel"("product_id", "channel");

-- CreateIndex
CREATE INDEX "product_placement_surface_scope_target_id_status_sort_order_idx" ON "product_placement"("surface", "scope", "target_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "product_placement_product_id_idx" ON "product_placement"("product_id");

-- CreateIndex
CREATE INDEX "product_placement_fish_keys_idx" ON "product_placement" USING GIN ("fish_keys");

-- AddForeignKey
ALTER TABLE "product_channel" ADD CONSTRAINT "product_channel_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_placement" ADD CONSTRAINT "product_placement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;
