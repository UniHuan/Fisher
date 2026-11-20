-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "restricted_until" TIMESTAMPTZ(6),
ADD COLUMN     "terms_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "terms_version" VARCHAR(16);

-- CreateTable
CREATE TABLE "user_session" (
    "session_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "rotated_from" CHAR(26),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "report" (
    "report_id" CHAR(26) NOT NULL,
    "spot_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "content_type" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fish_key" VARCHAR(64),
    "catch_weight_kg" DECIMAL(5,2),
    "report_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "moderation_status" VARCHAR(32) NOT NULL DEFAULT 'machine_pending',
    "machine_result" JSONB,
    "auditor_id" CHAR(26),
    "audit_time" TIMESTAMPTZ(6),
    "reject_reason" VARCHAR(200),
    "adopted_at" TIMESTAMPTZ(6),
    "adopted_by" CHAR(26),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "report_like" (
    "report_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_like_pkey" PRIMARY KEY ("report_id","user_id")
);

-- CreateTable
CREATE TABLE "report_abuse" (
    "abuse_id" CHAR(26) NOT NULL,
    "report_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "handled_by" CHAR(26),
    "handled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_abuse_pkey" PRIMARY KEY ("abuse_id")
);

-- CreateTable
CREATE TABLE "report_media_check" (
    "trace_id" VARCHAR(64) NOT NULL,
    "report_id" CHAR(26) NOT NULL,
    "image_key" VARCHAR(255) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_media_check_pkey" PRIMARY KEY ("trace_id")
);

-- CreateTable
CREATE TABLE "ugc_upload" (
    "upload_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "object_key" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "ugc_upload_pkey" PRIMARY KEY ("upload_id")
);

-- CreateTable
CREATE TABLE "rate_limit_counter" (
    "counter_key" VARCHAR(160) NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limit_counter_pkey" PRIMARY KEY ("counter_key","window_start")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_session_refresh_token_hash_key" ON "user_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_session_user_id_revoked_at_idx" ON "user_session"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_session_expires_at_idx" ON "user_session"("expires_at");

-- CreateIndex
CREATE INDEX "report_spot_id_moderation_status_created_at_idx" ON "report"("spot_id", "moderation_status", "created_at");

-- CreateIndex
CREATE INDEX "report_user_id_created_at_idx" ON "report"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "report_moderation_status_created_at_idx" ON "report"("moderation_status", "created_at");

-- CreateIndex
CREATE INDEX "report_content_type_created_at_idx" ON "report"("content_type", "created_at");

-- CreateIndex
CREATE INDEX "report_like_user_id_created_at_idx" ON "report_like"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "report_abuse_status_created_at_idx" ON "report_abuse"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_abuse_report_id_user_id_key" ON "report_abuse"("report_id", "user_id");

-- CreateIndex
CREATE INDEX "report_media_check_report_id_status_idx" ON "report_media_check"("report_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ugc_upload_object_key_key" ON "ugc_upload"("object_key");

-- CreateIndex
CREATE INDEX "ugc_upload_user_id_created_at_idx" ON "ugc_upload"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ugc_upload_status_created_at_idx" ON "ugc_upload"("status", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_counter_expires_at_idx" ON "rate_limit_counter"("expires_at");

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "spot"("spot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_auditor_id_fkey" FOREIGN KEY ("auditor_id") REFERENCES "admin_user"("admin_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_adopted_by_fkey" FOREIGN KEY ("adopted_by") REFERENCES "admin_user"("admin_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_like" ADD CONSTRAINT "report_like_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_like" ADD CONSTRAINT "report_like_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_abuse" ADD CONSTRAINT "report_abuse_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_abuse" ADD CONSTRAINT "report_abuse_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_media_check" ADD CONSTRAINT "report_media_check_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ugc_upload" ADD CONSTRAINT "ugc_upload_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
