-- CreateTable
CREATE TABLE "spot" (
    "spot_id" CHAR(26) NOT NULL,
    "spot_name" VARCHAR(60) NOT NULL,
    "city_code" VARCHAR(6) NOT NULL DEFAULT '440300',
    "district" VARCHAR(32),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "nav_latitude" DECIMAL(9,6),
    "nav_longitude" DECIMAL(9,6),
    "parking_latitude" DECIMAL(9,6),
    "parking_longitude" DECIMAL(9,6),
    "address" VARCHAR(120),
    "fish_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fee_status" VARCHAR(32),
    "fee_unit" VARCHAR(32),
    "fee_detail" VARCHAR(200),
    "water_type" VARCHAR(32),
    "venue_type" VARCHAR(32),
    "fishing_method" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "open_status" VARCHAR(32),
    "ban_note" VARCHAR(200),
    "open_hours" VARCHAR(100),
    "spot_score" DECIMAL(2,1),
    "description" TEXT,
    "tips" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cover_image_key" VARCHAR(255),
    "sort_weight" INTEGER NOT NULL DEFAULT 0,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "source" VARCHAR(32),
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "spot_pkey" PRIMARY KEY ("spot_id")
);

-- CreateTable
CREATE TABLE "poi" (
    "poi_id" CHAR(26) NOT NULL,
    "external_poi_id" VARCHAR(64),
    "poi_name" VARCHAR(80) NOT NULL,
    "poi_type" VARCHAR(32) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "address" VARCHAR(120),
    "rating" DECIMAL(2,1),
    "open_time" VARCHAR(100),
    "source" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "poi_pkey" PRIMARY KEY ("poi_id")
);

-- CreateTable
CREATE TABLE "spot_poi" (
    "spot_id" CHAR(26) NOT NULL,
    "poi_id" CHAR(26) NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "poi_type_override" VARCHAR(32),
    "sort_order" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spot_poi_pkey" PRIMARY KEY ("spot_id","poi_id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "user_id" CHAR(26) NOT NULL,
    "nickname" VARCHAR(40),
    "avatar_url" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_identity" (
    "identity_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_uid" VARCHAR(128) NOT NULL,
    "unionid" VARCHAR(64),
    "phone_encrypted" VARCHAR(255),
    "phone_hmac" VARCHAR(64),
    "meta_json" JSONB,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_identity_pkey" PRIMARY KEY ("identity_id")
);

-- CreateTable
CREATE TABLE "user_device" (
    "device_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "push_token" VARCHAR(255),
    "app_version" VARCHAR(32),
    "last_active_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_device_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "admin_user" (
    "admin_id" CHAR(26) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "refresh_token_hash" CHAR(64),
    "refresh_token_issued_at" TIMESTAMPTZ(6),
    "session_started_at" TIMESTAMPTZ(6),
    "last_active_at" TIMESTAMPTZ(6),
    "totp_secret_encrypted" VARCHAR(512),
    "totp_enabled_at" TIMESTAMPTZ(6),
    "recovery_codes_hash" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("admin_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "log_id" CHAR(26) NOT NULL,
    "admin_id" CHAR(26) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "before_json" JSONB,
    "after_json" JSONB,
    "ip" VARCHAR(45),
    "request_id" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "job_id" CHAR(26) NOT NULL,
    "admin_id" CHAR(26) NOT NULL,
    "file_key" VARCHAR(255) NOT NULL,
    "file_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "success_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "error_file_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "config" (
    "config_key" VARCHAR(128) NOT NULL,
    "config_value" TEXT NOT NULL,
    "description" VARCHAR(255),
    "updated_by" CHAR(26),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "config_pkey" PRIMARY KEY ("config_key")
);

-- CreateTable
CREATE TABLE "dictionary" (
    "dict_type" VARCHAR(32) NOT NULL,
    "dict_key" VARCHAR(64) NOT NULL,
    "dict_label" VARCHAR(128) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "parent_key" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dictionary_pkey" PRIMARY KEY ("dict_type","dict_key")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "actor_type" VARCHAR(32) NOT NULL,
    "actor_id" CHAR(26) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_json" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("actor_type","actor_id","key")
);

-- CreateTable
CREATE TABLE "analytics_event" (
    "event_id" CHAR(26) NOT NULL,
    "event_name" VARCHAR(64) NOT NULL,
    "client_type" VARCHAR(16) NOT NULL,
    "platform" VARCHAR(16),
    "app_version" VARCHAR(32),
    "user_id" CHAR(26),
    "session_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "properties" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "poi_sync_run" (
    "sync_id" CHAR(26) NOT NULL,
    "spot_id" CHAR(26) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "poi_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "quota_used" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "poi_sync_run_pkey" PRIMARY KEY ("sync_id")
);

-- CreateIndex
CREATE INDEX "spot_status_district_idx" ON "spot"("status", "district") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "spot_status_is_core_verified_at_idx" ON "spot"("status", "is_core", "verified_at") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "spot_status_sort_weight_verified_at_idx" ON "spot"("status", "sort_weight", "verified_at") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "spot_latitude_longitude_idx" ON "spot"("latitude", "longitude") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "spot_updated_at_idx" ON "spot"("updated_at") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "poi_poi_type_status_idx" ON "poi"("poi_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "poi_source_external_poi_id_key" ON "poi"("source", "external_poi_id");

-- CreateIndex
CREATE INDEX "spot_poi_spot_id_poi_type_override_distance_m_idx" ON "spot_poi"("spot_id", "poi_type_override", "distance_m");

-- CreateIndex
CREATE INDEX "spot_poi_poi_id_idx" ON "spot_poi"("poi_id");

-- CreateIndex
CREATE INDEX "app_user_status_created_at_idx" ON "app_user"("status", "created_at");

-- CreateIndex
CREATE INDEX "user_identity_user_id_idx" ON "user_identity"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identity_provider_provider_uid_key" ON "user_identity"("provider", "provider_uid");

-- CreateIndex
CREATE UNIQUE INDEX "user_identity_phone_hmac_key" ON "user_identity"("phone_hmac");

-- CreateIndex
CREATE INDEX "user_device_user_id_last_active_at_idx" ON "user_device"("user_id", "last_active_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_device_platform_push_token_key" ON "user_device"("platform", "push_token");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_username_key" ON "admin_user"("username");

-- CreateIndex
CREATE INDEX "audit_log_admin_id_created_at_idx" ON "audit_log"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");

-- CreateIndex
CREATE INDEX "import_job_status_created_at_idx" ON "import_job"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_admin_id_file_hash_key" ON "import_job"("admin_id", "file_hash");

-- CreateIndex
CREATE INDEX "dictionary_dict_type_enabled_sort_order_idx" ON "dictionary"("dict_type", "enabled", "sort_order");

-- CreateIndex
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key"("expires_at");

-- CreateIndex
CREATE INDEX "analytics_event_event_name_occurred_at_idx" ON "analytics_event"("event_name", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_event_client_type_occurred_at_idx" ON "analytics_event"("client_type", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_event_user_id_occurred_at_idx" ON "analytics_event"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "poi_sync_run_spot_id_started_at_idx" ON "poi_sync_run"("spot_id", "started_at");

-- AddForeignKey
ALTER TABLE "spot_poi" ADD CONSTRAINT "spot_poi_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "spot"("spot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spot_poi" ADD CONSTRAINT "spot_poi_poi_id_fkey" FOREIGN KEY ("poi_id") REFERENCES "poi"("poi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identity" ADD CONSTRAINT "user_identity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_device" ADD CONSTRAINT "user_device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("admin_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("admin_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poi_sync_run" ADD CONSTRAINT "poi_sync_run_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "spot"("spot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraints
ALTER TABLE "spot" ADD CONSTRAINT "spot_status_check" CHECK ("status" IN ('draft', 'published', 'offline'));
ALTER TABLE "spot" ADD CONSTRAINT "spot_open_status_check" CHECK ("open_status" IS NULL OR "open_status" IN ('open', 'paused', 'banned'));
ALTER TABLE "spot" ADD CONSTRAINT "spot_fee_status_check" CHECK ("fee_status" IS NULL OR "fee_status" IN ('free', 'paid', 'member'));
ALTER TABLE "spot" ADD CONSTRAINT "spot_district_check" CHECK ("district" IS NULL OR "district" IN ('福田区', '罗湖区', '南山区', '盐田区', '宝安区', '龙岗区', '龙华区', '坪山区', '光明区', '大鹏新区'));
ALTER TABLE "spot" ADD CONSTRAINT "spot_source_check" CHECK ("source" IS NULL OR "source" IN ('official', 'operation', 'user_report', 'third_party'));
ALTER TABLE "spot" ADD CONSTRAINT "spot_latitude_check" CHECK ("latitude" IS NULL OR ("latitude" BETWEEN 22.3 AND 22.9));
ALTER TABLE "spot" ADD CONSTRAINT "spot_longitude_check" CHECK ("longitude" IS NULL OR ("longitude" BETWEEN 113.7 AND 114.7));
ALTER TABLE "spot" ADD CONSTRAINT "spot_nav_latitude_check" CHECK ("nav_latitude" IS NULL OR ("nav_latitude" BETWEEN 22.3 AND 22.9));
ALTER TABLE "spot" ADD CONSTRAINT "spot_nav_longitude_check" CHECK ("nav_longitude" IS NULL OR ("nav_longitude" BETWEEN 113.7 AND 114.7));
ALTER TABLE "spot" ADD CONSTRAINT "spot_parking_latitude_check" CHECK ("parking_latitude" IS NULL OR ("parking_latitude" BETWEEN 22.3 AND 22.9));
ALTER TABLE "spot" ADD CONSTRAINT "spot_parking_longitude_check" CHECK ("parking_longitude" IS NULL OR ("parking_longitude" BETWEEN 113.7 AND 114.7));
ALTER TABLE "poi" ADD CONSTRAINT "poi_status_check" CHECK ("status" IN ('active', 'hidden'));
ALTER TABLE "poi" ADD CONSTRAINT "poi_source_check" CHECK ("source" IN ('tencent', 'amap', 'manual'));
ALTER TABLE "poi" ADD CONSTRAINT "poi_latitude_check" CHECK ("latitude" BETWEEN 22.3 AND 22.9);
ALTER TABLE "poi" ADD CONSTRAINT "poi_longitude_check" CHECK ("longitude" BETWEEN 113.7 AND 114.7);
ALTER TABLE "admin_user" ADD CONSTRAINT "admin_user_role_check" CHECK ("role" IN ('super_admin', 'operator', 'reviewer'));
ALTER TABLE "admin_user" ADD CONSTRAINT "admin_user_status_check" CHECK ("status" IN ('active', 'disabled'));
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_status_check" CHECK ("status" IN ('active', 'banned', 'deleted'));
ALTER TABLE "user_identity" ADD CONSTRAINT "user_identity_provider_check" CHECK ("provider" IN ('wechat_mini', 'apple', 'phone'));
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_status_check" CHECK ("status" IN ('pending', 'processing', 'completed', 'failed'));
ALTER TABLE "poi_sync_run" ADD CONSTRAINT "poi_sync_run_status_check" CHECK ("status" IN ('success', 'failed'));
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_client_type_check" CHECK ("client_type" IN ('miniprogram', 'ios', 'admin'));
