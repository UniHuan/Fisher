ALTER TABLE "report"
  ADD COLUMN "condition_open_status" VARCHAR(16),
  ADD COLUMN "condition_fee_status" VARCHAR(16),
  ADD COLUMN "condition_crowd_level" VARCHAR(16),
  ADD COLUMN "condition_facilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "observed_at" TIMESTAMPTZ(6);

CREATE INDEX "report_spot_id_content_type_moderation_status_observed_at_idx"
  ON "report"("spot_id", "content_type", "moderation_status", "observed_at" DESC);
