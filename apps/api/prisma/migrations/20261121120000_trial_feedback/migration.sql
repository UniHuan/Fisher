-- CreateTable
CREATE TABLE "trial_feedback" (
    "feedback_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "contact" VARCHAR(80),
    "page" VARCHAR(255),
    "spot_id" CHAR(26),
    "app_version" VARCHAR(32),
    "device_info" JSONB,
    "image_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "handler_id" CHAR(26),
    "handled_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trial_feedback_pkey" PRIMARY KEY ("feedback_id")
);

-- CreateTable
CREATE TABLE "feedback_image" (
    "image_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "object_key" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "feedback_image_pkey" PRIMARY KEY ("image_id")
);

-- CreateIndex
CREATE INDEX "trial_feedback_status_created_at_idx" ON "trial_feedback"("status", "created_at");

-- CreateIndex
CREATE INDEX "trial_feedback_user_id_created_at_idx" ON "trial_feedback"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "trial_feedback_category_created_at_idx" ON "trial_feedback"("category", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_image_object_key_key" ON "feedback_image"("object_key");

-- CreateIndex
CREATE INDEX "feedback_image_user_id_created_at_idx" ON "feedback_image"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_image_status_created_at_idx" ON "feedback_image"("status", "created_at");

-- AddForeignKey
ALTER TABLE "trial_feedback" ADD CONSTRAINT "trial_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_feedback" ADD CONSTRAINT "trial_feedback_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "spot"("spot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_feedback" ADD CONSTRAINT "trial_feedback_handler_id_fkey" FOREIGN KEY ("handler_id") REFERENCES "admin_user"("admin_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_image" ADD CONSTRAINT "feedback_image_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
