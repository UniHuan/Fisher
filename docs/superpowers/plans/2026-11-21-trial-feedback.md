# 体验反馈与钓点实拍征集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在体验版内收集问题、建议、内容问题和钓点实拍，后台私有处理，并用品牌占位图补齐无图钓点的视觉空缺。

**Architecture:** 新增独立的 `trial_feedback` 与 `feedback_image` 数据域，C 端提供反馈图片上传和提交接口，后台提供反馈列表与处理接口。小程序新增反馈页和三个入口，列表与详情在无封面时显示品牌占位块。所有图片存私有工作桶，经签名预览，90 天保留。

**Tech Stack:** Node 24, pnpm 10, NestJS 11, Prisma 6/PostgreSQL 18, native TypeScript mini program, Next.js 16/Ant Design 6, Jest/Supertest/Playwright, Aliyun OSS.

**Spec:** `docs/superpowers/specs/2026-11-21-trial-feedback-design.md`

## Global Constraints

- `features.feedback` 默认 `false`，staging 开启；关闭时 C 端入口隐藏、写接口返回 `FEATURE_DISABLED`，后台接口仍可用。
- 反馈分类只有 `bug`、`suggestion`、`content`、`photo`、`other`；状态只有 `open`、`reviewing`、`resolved`、`closed`。
- 正文 10 到 500 个 Unicode 字符；联系方式最多 80 字符；每条最多 3 张图；每人每天最多 5 条反馈、10 张图。
- 图片只存私有工作桶，key 为 `feedback/{userId}/{ulid}.webp`；不提供公开读取；后台预览签名 15 分钟。
- 不记录 openid 到反馈正文、审计 payload 或日志；device_info 只存机型、系统、微信版本、SDK 版本。
- `photo` 类型必须提示授权，运营审核后才能用于钓点页。
- 90 天保留，定时任务删除反馈和图片。
- 可见文案禁止 U+2014 和 U+2013；复用现有配色。
- 每个任务结束运行对应测试；涉及 API 时运行 `openapi:generate` 并提交生成物。
- 提交信息末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

- **反馈图片泄漏**：反馈图片不能通过公开图片路由访问，签名过期和篡改必须 404；`FeedbackImage` 不属于任何公开查询。
- **越权引用**：不能引用他人的图片 key，也不能重复使用已 `used` 的 key；`feedback.e2e-spec.ts` 覆盖。
- **开关关闭**：入口隐藏、写接口返回 `FEATURE_DISABLED`、后台仍可读；小程序和服务端都覆盖。
- **删除与保留**：90 天清理只删到期反馈和孤儿图片，不误删仍被反馈引用的对象；`feedback-purge.e2e-spec.ts` 覆盖。
- **上下文隐私**：device_info、contact 和 page 不进入公开响应，不出现在日志；后台响应只给授权角色。

---

## Task 1: Shared contract, schema, config, permissions

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/contract.test.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261121120000_trial_feedback/migration.sql`
- Modify: `apps/api/src/config/env.schema.ts` only if new env keys are needed
- Modify: `apps/api/src/modules/config/config.service.ts`
- Modify: `apps/api/src/modules/config/dto/client-config.dto.ts`
- Modify: `apps/api/src/modules/auth/permissions.ts`
- Modify: `apps/api/prisma/seed.ts`
- Test: `packages/shared/src/contract.test.ts`

**Interfaces:**
- Produces: `FEEDBACK_CATEGORY`, `FEEDBACK_STATUS`, `FEEDBACK_IMAGE_STATUS`; Prisma models `TrialFeedback`, `FeedbackImage`; `features.feedback` in client config; permissions `feedback:read`, `feedback:handle`.

- [ ] Write failing contract assertions for the three enums.
- [ ] Add the models and migration exactly as the spec section 3; add relations on `AppUser`, `Spot`, `AdminUser`.
- [ ] Add `features.feedback=false` seed and client config whitelist/DTO.
- [ ] Add `feedback:read` and `feedback:handle` to all three admin roles.
- [ ] Run shared tests, API typecheck, prisma generate; commit `feat: add trial feedback contract and schema`.

---

## Task 2: Feedback API and purge job

**Files:**
- Create: `apps/api/src/modules/feedback/feedback.module.ts`
- Create: `apps/api/src/modules/feedback/feedback.controller.ts`
- Create: `apps/api/src/modules/feedback/feedback.service.ts`
- Create: `apps/api/src/modules/feedback/feedback.repository.ts`
- Create: `apps/api/src/modules/feedback/feedback-image.service.ts`
- Create: `apps/api/src/modules/feedback/dto/create-feedback.dto.ts`
- Create: `apps/api/src/modules/feedback/dto/feedback-response.dto.ts`
- Create: `apps/api/src/modules/admin-feedback/admin-feedback.module.ts`
- Create: `apps/api/src/modules/admin-feedback/admin-feedback.controller.ts`
- Create: `apps/api/src/modules/admin-feedback/admin-feedback.service.ts`
- Create: `apps/api/src/modules/admin-feedback/admin-feedback.repository.ts`
- Create: `apps/api/src/modules/admin-feedback/dto/admin-feedback-list-query.dto.ts`
- Create: `apps/api/src/modules/admin-feedback/dto/admin-feedback-response.dto.ts`
- Create: `apps/api/src/modules/admin-feedback/dto/update-feedback.dto.ts`
- Create: `apps/api/src/jobs/purge-feedback.job.ts`
- Modify: `apps/api/src/modules/uploads/preview-signer.service.ts` (allow `feedback/` keys)
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/feedback.e2e-spec.ts`
- Test: `apps/api/test/feedback-purge.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/feedback/images` -> `{ key, width, height, size_bytes }`
  - `POST /api/v1/feedback` -> `{ feedback_id, status }`
  - `GET /api/v1/admin/feedback?status=&category=&cursor=&limit=`
  - `GET /api/v1/admin/feedback/:id`
  - `PATCH /api/v1/admin/feedback/:id` -> `{ feedback_id, status }`
- Consumes: `AppAuthGuard`, `AdminAuthGuard`, `RolesGuard`, `RateLimitService`, `StorageService`, `ImageProcessorService`, `PreviewSignerService`, `ClientConfigService`, `withAdvisoryLock`.

- [ ] Write failing e2e tests: create with text, image upload, ownership rejection, feature flag off, admin list/detail/update, purge.
- [ ] Implement upload (5 MB, magic bytes, 10/day, private key), create (10-500 chars, 5/day, image ownership in transaction), admin list/detail/update (signed images, permissions), purge job (24h orphan, 90d retention, advisory lock).
- [ ] Regenerate OpenAPI and run tests; commit `feat(api): add trial feedback endpoints`.

---

## Task 3: Mini program feedback page, entries, and placeholders

**Files:**
- Create: `apps/miniprogram/src/pages/feedback/index.ts`
- Create: `apps/miniprogram/src/pages/feedback/index.wxml`
- Create: `apps/miniprogram/src/pages/feedback/index.wxss`
- Create: `apps/miniprogram/src/pages/feedback/index.json`
- Create: `apps/miniprogram/src/feedback-form.ts`
- Modify: `apps/miniprogram/src/api.ts`
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/profile/index.wxml`
- Modify: `apps/miniprogram/src/pages/profile/index.ts`
- Modify: `apps/miniprogram/src/pages/detail/detail.ts`
- Modify: `apps/miniprogram/src/pages/detail/detail.wxml`
- Modify: `apps/miniprogram/src/pages/index/index.wxml`
- Modify: `apps/miniprogram/src/pages/index/index.wxss`
- Test: `apps/miniprogram/src/feedback-form.test.ts`

**Interfaces:**
- Produces: `api.uploadFeedbackImage(filePath)`, `api.createFeedback(input)`, `validateFeedbackDraft(draft)`; page `/pages/feedback/index`; profile and detail entries; brand placeholder on index/detail when no cover.

- [ ] Write failing validation tests: required category, 10-500 code points, max 3 images, contact length, photo consent.
- [ ] Implement the feedback page, image picker/upload, three entries, success/error states, feature flag gating, and analytics `feedback_open`/`feedback_submit`/`feedback_result`.
- [ ] Add the brand placeholder block with copy 「实景图待补充」 on index and detail when no cover.
- [ ] Run mini program tests, typecheck, lint; commit `feat(miniprogram): add trial feedback and spot placeholders`.

---

## Task 4: Admin feedback workspace

**Files:**
- Create: `apps/admin/src/admin/FeedbackDrawer.tsx`
- Modify: `apps/admin/src/admin/api.ts`
- Modify: `apps/admin/src/admin/SpotsWorkspace.tsx`
- Modify: `apps/admin/src/app/globals.css`
- Create: `apps/api/test/playwright/trial-feedback.spec.ts`

**Interfaces:**
- Produces: `api.listFeedback`, `api.getFeedback`, `api.updateFeedback`; header button 「体验反馈」 with open badge; drawer list/detail/status actions.

- [ ] Write failing Playwright test: seed feedback, open drawer, filter, view images, set reviewing/resolved, reviewer can access.
- [ ] Implement the API client methods and drawer with list, detail, signed images, contact/device context, status update and note.
- [ ] Run Playwright, admin build, typecheck, lint; commit `feat(admin): add trial feedback workspace`.

---

## Task 5: Docs, staging configuration, and acceptance

**Files:**
- Modify: `.env.example` only if needed
- Modify: `docs/ops/deployment.md`
- Modify: `docs/ops/staging-checklist.md`
- Create: `docs/qa/v1.1-trial-feedback-acceptance.md`
- Modify: `docs/qa/v1.1-trial-feedback-template.md`

**Interfaces:**
- Produces: staging `features.feedback=true`, purge cron, acceptance record, trial feedback handling routine.

- [ ] Document the new flag, permissions, cron and retention.
- [ ] Set `features.feedback=true` on staging, run the purge job once, verify the mini program entry and admin list.
- [ ] Record acceptance results, including a real feedback submission and screenshot review.
- [ ] Commit `docs: add trial feedback acceptance`.

---

## Self-Review

- Spec coverage: enums/schema/config/permissions (Task 1), C-end and admin APIs plus purge (Task 2), mini program page/entries/placeholders (Task 3), admin workspace (Task 4), staging/acceptance (Task 5).
- Review Focus maps to `feedback.e2e-spec.ts`, `feedback-purge.e2e-spec.ts`, mini program tests, and the Playwright spec.
- No new abstractions beyond the feedback domain; images reuse the existing processor and signer.
