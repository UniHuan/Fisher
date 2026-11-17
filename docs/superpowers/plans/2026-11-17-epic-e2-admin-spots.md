# Epic E2 后台钓点编辑与发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the M0 admin spot write path: list, detail, draft create/update, duplicate warnings, verified marking, publish/offline/delete state transitions, audit, idempotency and a generated OpenAPI/client contract.

**Architecture:** Add a focused `admin-spots` API module on top of the existing Prisma `spot` table, admin cookie/CSRF guard, RBAC guard, audit service and dictionary repository. Controllers stay thin; a repository owns Prisma, a service owns publish rules, duplicate detection, state transitions, audit and idempotency. No database migration is required.

**Tech Stack:** NestJS 11, Prisma 6.19.3, PostgreSQL 15, class-validator, Jest 30, supertest, OpenAPI 3.0.3, `openapi-typescript`.

**Spec:** `docs/PRD_v1.4.md` sections 3.2, 3.10, 8.1, 8.3, 8.7, 8.8, 10.4, 10.6 and 10.7.
**Master plan:** `docs/superpowers/plans/2026-11-13-v1.0-master.md`, Epic E2.

## Global Constraints

- Node 24 LTS, pnpm 10, TypeScript strict, shared `tsconfig.base.json`.
- API base `/api/v1`; admin routes `/api/v1/admin`; snake_case wire fields.
- Every response uses `{code, message, data, request_id}`; errors never leak stack, SQL or internal paths.
- Business codes: `0`, `40001`, `40101`, `40102`, `40301`, `40401`, `40901`, `40902`, `41301`, `42201`, `42901`, `50001`, `50301`.
- IDs are 26-character ULID; time is ISO 8601/`timestamptz`; coordinates are GCJ-02 `decimal(9,6)` serialized as strings with exactly six fractional digits (`toFixed(6)`); `spot_score` serializes with one fractional digit (`toFixed(1)`); values outside latitude 22.3-22.9 or longitude 113.7-114.7 are rejected.
- Admin cookies are `__Host-fish_access` / `__Host-fish_refresh`; every admin write requires CSRF and Origin handling from the existing guard. Login/refresh/TOTP rules stay unchanged.
- RBAC is server-side. Super admin and operator may create, edit, publish, offline and verify spots; only super admin may delete (`spot:delete` is not granted to operator); reviewer is read-only; unauthenticated requests return 401 and wrong roles 403.
- Audit every spot create, update, publish, offline, delete and verify. Audit failure must not fail the business operation. Do not store tokens, passwords or phone numbers in before/after JSON.
- Draft only requires `spot_name`. Publish requires the PRD 3.10 fields: spot_name, district, coordinates, nav coordinates, address, at least one fish type, fee_status, water_type, venue_type, open_status, verified_at and source. `verified_at` is written only by the verify endpoint; publish does not set it. A banned spot requires `ban_note`. A core spot requires at least one image.
- `cover_image_key` must belong to `images`; if unset and images exist, use the first image. Images are existing storage keys; upload is E3, import is E4, POI binding is E5.
- Duplicate detection warns, never blocks: same district, similar name and distance under 200 metres.
- Publish and offline accept an optional `Idempotency-Key` scoped by admin. Same key and same request hash returns the first result; same key with a different request hash returns `40902`. A successful operation writes audit once.
- Admin list pagination max 100; public list rules belong to E1.
- OpenAPI 3.0.3 is generated from decorators; generated YAML and client types are committed and checked by `pnpm openapi:check`.
- No new database migration, no microservice, no Redis in this Epic.

## Non-goals

- Image upload, EXIF processing, OSS signing and CDN URLs: Epic E3.
- Excel import/export and error reports: Epic E4.
- POI CRUD, binding/unbinding and sync: Epic E5.
- Admin pages and forms: Plan B.
- Public spot list/map/detail/POI APIs: Epic E1.
- Account management, password reset, high-risk re-authentication: later.
- Public cache invalidation: E1 will add the cache; this Epic writes the events/audit only.

## Review Focus

1. **Draft vs publish nullability.** A draft created with only `spot_name` must save; a publish with any required field missing must return `42201` with field-level details; a published edit must not clear a required field. Tests: Task 2 minimal draft, Task 3 published update, Task 4 publish validation.
2. **State machine.** Publish only from draft/offline, offline only from published, delete only draft/offline; repeated or wrong transitions return `40901`, deleted rows return `40401`. Tests: Task 4 and Task 5.
3. **Duplicate warnings never block.** Same district, similar name and under 200 metres returns warnings while the create/update succeeds. Tests: Task 2 and Task 3.
4. **Idempotent publish/offline.** Same key and request hash replays the first result without a second state change or audit row; the same key with a different request hash returns `40902`. Tests: Task 4.
5. **Reviewer is read-only, delete is super-only.** Reviewer may GET list/detail but cannot create, update, publish, offline, delete or verify; operator and super admin can create/update/publish/offline/verify, but only super admin may delete. Tests: Task 1, Task 2, Task 4, Task 5.
6. **Image and banned invariants.** A core spot with no images cannot publish; a cover key outside images is rejected; a banned spot without `ban_note` cannot publish. Tests: Task 2 and Task 4.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/src/modules/admin-spots/admin-spots.module.ts` | Wire repository, service, controller, idempotency and audit/dictionary imports |
| `apps/api/src/modules/admin-spots/admin-spots.controller.ts` | Routes, roles, CSRF, OpenAPI decorators, request meta |
| `apps/api/src/modules/admin-spots/admin-spots.service.ts` | Validation, duplicate detection, state transitions, audit and idempotency orchestration |
| `apps/api/src/modules/admin-spots/admin-spots.repository.ts` | All Prisma queries and row mapping |
| `apps/api/src/modules/admin-spots/admin-spot.types.ts` | `AdminSpotDetail`, `AdminSpotListItem`, `DuplicateWarning`, `AdminSpotWriteResult` |
| `apps/api/src/modules/admin-spots/dto/admin-spot-list-query.dto.ts` | List filters and pagination |
| `apps/api/src/modules/admin-spots/dto/create-spot.dto.ts` | Draft create body |
| `apps/api/src/modules/admin-spots/dto/update-spot.dto.ts` | Draft/published update body |
| `apps/api/src/modules/admin-spots/dto/verify-spot.dto.ts` | Verify method/note |
| `apps/api/src/modules/admin-spots/dto/admin-spot-response.dto.ts` | OpenAPI response DTOs |
| `apps/api/src/modules/admin-spots/idempotency.service.ts` | Admin-scoped idempotency key lifecycle |
| `apps/api/test/admin-spots.e2e-spec.ts` | E2 e2e coverage |
| `apps/api/test/admin-spots.helpers.ts` | Test spot builders and cleanup |
| `apps/api/src/app.module.ts` | Import `AdminSpotsModule` |
| `apps/api/src/modules/dictionaries/dictionaries.module.ts` | Export `DictionariesRepository` for validated spot dictionaries |
| `openapi/openapi.yaml` | Regenerated contract |
| `packages/api-client/src/schema.d.ts` | Regenerated client types |

**Response DTOs** (`dto/admin-spot-response.dto.ts`, imported by controller and OpenAPI):
`AdminSpotListItemDto`, `AdminSpotPageDto` (`items`, `page`, `page_size`, `total`, `has_more`), `AdminSpotDetailDto`, `DuplicateWarningDto` (`spot_id`, `spot_name`, `distance_m`), `AdminSpotWriteResponseDto` (`spot`, `warnings`), `AdminSpotDeleteResponseDto` (`deleted: true`).

**Test helpers** (`apps/api/test/admin-spots.helpers.ts`):
- `seedSpot(overrides: Partial<Prisma.SpotUncheckedCreateInput> & { spot_name: string }): Promise<Spot>` generates a ULID when `spot_id` is absent and tracks the id for cleanup.
- `createDraft(session: AuthSession, overrides?: Record<string, unknown>): Promise<AdminSpotDetail>` posts to `/api/v1/admin/spots` with `clientHeaders()`, the session cookie and `session.csrf`, expects 201, tracks `data.spot.spot_id` for cleanup and returns `data.spot`.
- `createCompleteDraft(session, overrides?)` fills district `"南山区"`, latitude `"22.517600"`, longitude `"113.952300"`, nav pair, address `"测试地址"`, `fish_types: ["luofei"]`, `fee_status: "free"`, `water_type: "sea"`, `venue_type: "wild"`, `open_status: "open"`; returns the draft detail.
- `markVerifiedInDb(spotId: string): Promise<void>` updates `verified_at` through Prisma for publish tests that are not testing the verify endpoint.
- `createVerifiedCompleteDraft(session, overrides?)` = `createCompleteDraft` then `markVerifiedInDb`.
- `createPublishedSpot(session, overrides?)` inserts a complete `status: "published"` row directly through `seedSpot`, with `verified_at` and `source: "operation"`; it is a fixture for update/delete tests, not a publish test.
- `cleanupAdminSpotTestData(): Promise<void>` deletes every tracked spot id. The suite uses `const prisma = getAuthTestPrisma()` in `beforeAll`, and `afterAll` calls `cleanupAdminSpotTestData()`, then `cleanupAuthTestData()` (which removes audit and idempotency rows for test admins), then `app.close()`.

## Task 1: Read-only admin spot API

**Files:**
- Create: `apps/api/src/modules/admin-spots/admin-spot.types.ts`
- Create: `apps/api/src/modules/admin-spots/admin-spots.repository.ts`
- Create: `apps/api/src/modules/admin-spots/admin-spots.service.ts`
- Create: `apps/api/src/modules/admin-spots/admin-spots.controller.ts`
- Create: `apps/api/src/modules/admin-spots/admin-spots.module.ts`
- Create: `apps/api/src/modules/admin-spots/dto/admin-spot-list-query.dto.ts`
- Create: `apps/api/src/modules/admin-spots/dto/admin-spot-response.dto.ts`
- Create: `apps/api/test/admin-spots.e2e-spec.ts`
- Create: `apps/api/test/admin-spots.helpers.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/admin-spots.e2e-spec.ts`

**Interfaces:**
- Consumes: `AdminAuthGuard` global, `RolesGuard`, `@Roles`, `@CurrentAdmin`, `PrismaService`, `ResponseInterceptor`, `Paginated<T>` and `SPOT_STATUS`.
- Produces `AdminSpotListItem`, `AdminSpotDetail`, `AdminSpotListQueryDto`, `AdminSpotsService.list(query)`, `AdminSpotsService.getById(spotId)`, `AdminSpotsRepository.findPage(filters)`, `AdminSpotsRepository.findById(spotId)`.
- Produces `GET /api/v1/admin/spots` and `GET /api/v1/admin/spots/:id`.

- [ ] **Step 1: Write the failing read tests**

```ts
beforeAll(async () => {
  await seedSpot({
    spot_id: DRAFT_ID,
    spot_name: "深圳湾草稿钓点",
    district: "南山区",
    latitude: "22.517600",
    longitude: "113.952300",
    status: "draft",
  });
  await seedSpot({ spot_id: PUBLISHED_ID, spot_name: "已发布钓点", status: "published" });
  await seedSpot({ spot_id: OFFLINE_ID, spot_name: "已下线钓点", status: "offline" });
  await seedSpot({ spot_id: DELETED_ID, spot_name: "已删除钓点", status: "draft", deleted_at: new Date() });
});

it("lists drafts, published and offline spots for admin readers", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const res = await request(server)
    .get("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .expect(200);

  expect(res.body.data.items.map((item: { spot_id: string }) => item.spot_id)).toEqual(
    expect.arrayContaining([DRAFT_ID, PUBLISHED_ID, OFFLINE_ID]),
  );
  expect(res.body.data.items.some((item: { spot_id: string }) => item.spot_id === DELETED_ID)).toBe(false);
});

it("filters by status, district, normalized name and updated window", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const res = await request(server)
    .get("/api/v1/admin/spots")
    .query({ status: "draft", district: "南山区", keyword: "  深圳湾  ", page: 1, page_size: 10 })
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .expect(200);
  expect(res.body.data.items.every((item: { status: string }) => item.status === "draft")).toBe(true);
  expect(res.body.data.page).toBe(1);
  expect(res.body.data.page_size).toBe(10);
});

it("returns detail for draft and rejects deleted or missing ids", async () => {
  const session = await loginAs(app, ADMIN_ROLE.REVIEWER);
  const detail = await request(server)
    .get(`/api/v1/admin/spots/${DRAFT_ID}`)
    .set(clientHeaders())
    .set("Cookie", session.cookie)
    .expect(200);
  expect(detail.body.data.spot_id).toBe(DRAFT_ID);
  expect(detail.body.data.latitude).toBe("22.517600");

  await request(server)
    .get(`/api/v1/admin/spots/${DELETED_ID}`)
    .set(clientHeaders())
    .set("Cookie", session.cookie)
    .expect(404);
});

it("requires authentication and allows reviewer reads only", async () => {
  await request(server).get("/api/v1/admin/spots").set(clientHeaders()).expect(401);
  const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
  await request(server)
    .get("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", reviewer.cookie)
    .expect(200);
});
```

- [ ] **Step 2: Run the red test**

Run: `pnpm --filter @szfisher/api test:e2e -- admin-spots.e2e-spec.ts`
Expected: FAIL with 404 for `/api/v1/admin/spots`.

- [ ] **Step 3: Implement list and detail**

Create `AdminSpotListItem` with `spot_id`, `spot_name`, `district`, `status`, `open_status`, `is_core`, `address`, `cover_image_key`, `verified_at`, `updated_at`. Create `AdminSpotDetail` with every PRD 3.2 field, decimal values as strings and dates as ISO strings. The list excludes `deleted_at`, filters status/district/normalized keyword/updated window, orders `updated_at desc, spot_id desc`, caps `page_size` at 100 and returns `Paginated`. The detail returns any non-deleted status and throws `AppError(ERROR_CODES.NOT_FOUND, 404, "Spot not found")` otherwise. Use `@Controller("admin/spots")`, `@UseGuards(RolesGuard)`, `@Roles(SUPER_ADMIN, OPERATOR, REVIEWER)` on reads, `@ApiCookieAuth`, `@ApiClientHeaders`, `@ApiTags("admin spots")` and envelope response decorators. Import `AdminSpotsModule` in `AppModule.forRoot()`.

- [ ] **Step 4: Run the focused test to green**

Run: `pnpm --filter @szfisher/api test:e2e -- admin-spots.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin-spots apps/api/src/app.module.ts apps/api/test/admin-spots.e2e-spec.ts apps/api/test/admin-spots.helpers.ts
git commit -m "feat(api): add admin spot list and detail" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 2: Create draft with validation, duplicate warnings and audit

**Files:**
- Create: `apps/api/src/modules/admin-spots/dto/create-spot.dto.ts`
- Modify: `apps/api/src/modules/admin-spots/dto/admin-spot-response.dto.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spot.types.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.repository.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.service.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.controller.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.module.ts`
- Modify: `apps/api/src/modules/dictionaries/dictionaries.module.ts`
- Test: `apps/api/test/admin-spots.e2e-spec.ts`

**Interfaces:**
- Consumes: `DictionariesRepository.findEnabled()`, `AuditLogService.record(input)`, `isShenzhenCoordinate`, `OPEN_STATUS`, `normalizeKeyword`, `ulid`.
- Produces `CreateSpotDto`, `AdminSpotWriteResult = {spot: AdminSpotDetail, warnings: DuplicateWarning[]}`, `AdminSpotsService.create(dto, admin, request)`, `AdminSpotsRepository.create(data)`, `AdminSpotsRepository.findDuplicateCandidates(district, excludeId?)`.
- Produces `POST /api/v1/admin/spots` returning 201 with `{spot, warnings}`.

- [ ] **Step 1: Write the failing create tests**

```ts
it("creates a draft with only spot_name and fills safe defaults", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const res = await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ spot_name: "深圳湾测试钓点" })
    .expect(201);

  expect(res.body.data.spot).toMatchObject({
    spot_name: "深圳湾测试钓点",
    status: "draft",
    source: "operation",
    city_code: "440300",
    is_core: false,
    sort_weight: 0,
    fish_types: [],
    images: [],
  });
  expect(res.body.data.warnings).toEqual([]);
  const row = await prisma.spot.findUniqueOrThrow({ where: { spot_id: res.body.data.spot.spot_id } });
  expect(row.status).toBe("draft");
});

it("rejects out-of-range coordinates and unknown dictionary values", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ spot_name: "越界", latitude: "23.000000", longitude: "114.000000" })
    .expect(400);

  await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ spot_name: "字典错误", district: "不存在区", fish_types: ["not_a_fish"] })
    .expect(400);
});

it("returns duplicate warnings without blocking the create", async () => {
  await seedSpot({ spot_name: "深圳湾公园钓点", district: "南山区", latitude: "22.517600", longitude: "113.952300" });
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const res = await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({
      spot_name: "深圳湾公园钓鱼点",
      district: "南山区",
      latitude: "22.517700",
      longitude: "113.952400",
    })
    .expect(201);
  expect(res.body.data.warnings).toEqual([
    expect.objectContaining({ spot_id: expect.any(String), distance_m: expect.any(Number) }),
  ]);
});

it("defaults a missing cover to the first image and rejects a cover outside images", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const defaulted = await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ spot_name: "封面默认", images: ["cover-a.jpg", "cover-b.jpg"] })
    .expect(201);
  expect(defaulted.body.data.spot.cover_image_key).toBe("cover-a.jpg");

  const bad = await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ spot_name: "封面越界", images: ["cover-a.jpg"], cover_image_key: "cover-x.jpg" })
    .expect(400);
  expect(bad.body.code).toBe(40001);
});

it("writes a spot.create audit row and blocks reviewer writes", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const res = await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ spot_name: "审计钓点" })
    .expect(201);
  const audit = await prisma.auditLog.findFirst({
    where: { admin_id: operator.admin.adminId, action: "spot.create", entity_id: res.body.data.spot.spot_id },
  });
  expect(audit).not.toBeNull();

  const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
  await request(server)
    .post("/api/v1/admin/spots")
    .set(clientHeaders())
    .set("Cookie", reviewer.cookie)
    .set("X-CSRF-Token", reviewer.csrf)
    .send({ spot_name: "审核员不能写" })
    .expect(403);
});
```

- [ ] **Step 2: Run the red test**

Run: `pnpm --filter @szfisher/api test:e2e -- admin-spots.e2e-spec.ts`
Expected: FAIL because the create route is missing.

- [ ] **Step 3: Implement draft create**

`CreateSpotDto` requires `spot_name` 1-60; all other PRD fields are optional, with `source` restricted to `official|operation|user_report|third_party` and default `operation`. The service:
1. Validate all present fields against `DictionariesRepository.findEnabled()`: district, fish_types, fee_status, fee_unit, water_type, venue_type, fishing_method.
2. Validate coordinate pairs and Shenzhen bounds; if nav is absent and spot coordinates exist, default nav to the spot coordinates; reject half a pair.
3. Validate images max 9; if images exist and cover is absent, set cover to the first; reject a cover outside images. A draft may be saved with `open_status: "banned"` and no `ban_note`; publish owns that invariant.
4. Set `spot_id = ulid()`, `status = "draft"`, `source = dto.source ?? "operation"`, `is_core = dto.is_core ?? false`, `sort_weight = dto.sort_weight ?? 0`, arrays to `[]` when omitted.
5. Persist, then query duplicate candidates in the same district, exclude the new id, normalize names, apply Levenshtein or containment similarity, calculate Haversine distance and return candidates under 200 metres (matching seed config `spot_duplicate_distance_m`; E2 uses a module constant, no config read).
6. Audit `spot.create` with the created detail; audit failure must not fail the request.
7. Return `{spot, warnings}`.

Use `@Roles(SUPER_ADMIN, OPERATOR)` on the POST handler; the global `AdminAuthGuard` enforces CSRF. Import `DictionariesModule` and `AuditLogModule` into `AdminSpotsModule`; export `DictionariesRepository` from `DictionariesModule`.

- [ ] **Step 4: Run the focused test to green**

Expected: PASS for create, validation, duplicate and audit tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin-spots apps/api/src/modules/dictionaries/dictionaries.module.ts apps/api/test/admin-spots.e2e-spec.ts
git commit -m "feat(api): create admin spot drafts with duplicate warnings" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 3: Update drafts and protect published spots

**Files:**
- Create: `apps/api/src/modules/admin-spots/dto/update-spot.dto.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spot.types.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.repository.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.service.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.controller.ts`
- Test: `apps/api/test/admin-spots.e2e-spec.ts`

**Interfaces:**
- Produces `UpdateSpotDto`, `AdminSpotsService.update(spotId, dto, admin, request)`, `AdminSpotsRepository.update(spotId, data, expectedUpdatedAt): Promise<number>`.
- Produces `PUT /api/v1/admin/spots/:id` returning `{spot, warnings}`.

- [ ] **Step 1: Write the failing update tests**

```ts
it("lets a draft clear optional fields and defaults navigation", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const created = await createDraft(operator, {
    spot_name: "可清空草稿",
    district: "南山区",
    latitude: "22.517600",
    longitude: "113.952300",
    address: "旧地址",
    fish_types: ["luofei"],
  });
  const res = await request(server)
    .put(`/api/v1/admin/spots/${created.spot_id}`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ address: null, fish_types: [] })
    .expect(200);
  expect(res.body.data.spot.address).toBeNull();
  expect(res.body.data.spot.fish_types).toEqual([]);
  expect(res.body.data.spot.nav_latitude).toBe("22.517600");
  expect(res.body.data.spot.nav_longitude).toBe("113.952300");
});

it("falls back to the first image when the cover is removed", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const draft = await createDraft(operator, {
    spot_name: "封面回退",
    images: ["cover-a.jpg", "cover-b.jpg"],
    cover_image_key: "cover-a.jpg",
  });
  const res = await request(server)
    .put(`/api/v1/admin/spots/${draft.spot_id}`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ images: ["cover-b.jpg"] })
    .expect(200);
  expect(res.body.data.spot.cover_image_key).toBe("cover-b.jpg");
});

it("does not let a published spot clear required fields", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const published = await createPublishedSpot(operator);
  const res = await request(server)
    .put(`/api/v1/admin/spots/${published.spot_id}`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ district: null })
    .expect(422);
  expect(res.body.code).toBe(42201);
  expect(res.body.details).toEqual([{ field: "district", message: expect.any(String) }]);
});

it("updates other fields and writes before/after audit", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const published = await createPublishedSpot(operator);
  const res = await request(server)
    .put(`/api/v1/admin/spots/${published.spot_id}`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ description: "新的钓位说明" })
    .expect(200);
  expect(res.body.data.spot.description).toBe("新的钓位说明");
  const audit = await prisma.auditLog.findFirst({
    where: { admin_id: operator.admin.adminId, action: "spot.update", entity_id: published.spot_id },
    orderBy: { created_at: "desc" },
  });
  expect(audit?.before_json).toBeTruthy();
  expect(audit?.after_json).toBeTruthy();
});
```

- [ ] **Step 2: Run the red test**

Expected: FAIL because PUT is missing.

- [ ] **Step 3: Implement update**

Load the non-deleted spot or return 40401. Merge only provided keys; treat explicit `null` as a request to clear. `spot_name` must stay non-empty on every status; reject `null` or an empty/whitespace value with 40001. Re-validate dictionaries, coordinates, images and cover on the merged result. When images are replaced and the cover is absent or no longer belongs to the new images, set the cover to the first image; when images become empty, clear the cover. For published rows, run the publish-required validation against the merged result and return 42201 details if any required field is cleared; do not change status or verified_at. For draft/offline rows, allow clearing the other optional fields. Default missing nav from spot coordinates whenever spot coordinates are present. When spot coordinates are cleared and nav is not explicitly provided, clear nav too. Persist with optimistic concurrency: `updateMany` where `spot_id`, `deleted_at: null` and `updated_at` equals the loaded row's `updated_at`; if the count is 0, return `40901` so a concurrent publish or edit cannot be overwritten. Then calculate duplicate warnings excluding this id, audit `spot.update` with before/after and return `{spot, warnings}`. Use `@Roles(SUPER_ADMIN, OPERATOR)` and CSRF.

- [ ] **Step 4: Run the focused test to green**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin-spots apps/api/test/admin-spots.e2e-spec.ts
git commit -m "feat(api): update admin spots with publish invariant protection" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 4: Publish and offline with validation, state machine and idempotency

**Files:**
- Create: `apps/api/src/modules/admin-spots/idempotency.service.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spot.types.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.repository.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.service.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.controller.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.module.ts`
- Test: `apps/api/test/admin-spots.e2e-spec.ts`

**Interfaces:**
- Consumes: `idempotency_key` table, `Idempotency-Key` header, `AuditLogService.record`, publish-required validation.
- Produces `IdempotencyService.execute<T>({adminId, key, scope, body, ttlMs, operation})`, `AdminSpotsService.publish(spotId, admin, request, idempotencyKey?)`, `AdminSpotsService.offline(...)`, `AdminSpotsRepository.transitionStatus(spotId, fromStatuses, toStatus, expectedUpdatedAt): Promise<number>`.
- Produces `POST /api/v1/admin/spots/:id/publish` and `.../offline`, returning the updated detail.

- [ ] **Step 1: Write the failing publish/offline/idempotency tests**

```ts
it("rejects publish when required fields are missing, with field details", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const draft = await createDraft(operator, { spot_name: "缺字段草稿" });
  const res = await request(server)
    .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .expect(422);
  expect(res.body.code).toBe(42201);
  expect(res.body.details.map((issue: { field: string }) => issue.field)).toEqual(
    expect.arrayContaining(["district", "latitude", "longitude", "address", "fish_types", "verified_at"]),
  );
});

it("publishes a complete verified spot, then refuses a repeated publish", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const draft = await createCompleteDraft(operator);
  await markVerifiedInDb(draft.spot_id);

  const published = await request(server)
    .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .expect(200);
  expect(published.body.data.status).toBe("published");

  await request(server)
    .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .expect(409);
});

it("offlines a published spot idempotently and rejects offline from draft", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const draft = await createDraft(operator, { spot_name: "未发布下线" });
  await request(server)
    .post(`/api/v1/admin/spots/${draft.spot_id}/offline`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .expect(409);

  const published = await createPublishedSpot(operator);
  const key = "offline-idem-1";
  const first = await request(server)
    .post(`/api/v1/admin/spots/${published.spot_id}/offline`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .set("Idempotency-Key", key)
    .expect(200);
  expect(first.body.data.status).toBe("offline");

  const replay = await request(server)
    .post(`/api/v1/admin/spots/${published.spot_id}/offline`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .set("Idempotency-Key", key)
    .expect(200);
  expect(replay.body.data).toEqual(first.body.data);
  const audits = await prisma.auditLog.count({
    where: { admin_id: operator.admin.adminId, action: "spot.offline", entity_id: published.spot_id },
  });
  expect(audits).toBe(1);
});

it("replays an idempotent publish without a second audit row", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const draft = await createVerifiedCompleteDraft(operator);
  const key = "publish-idem-1";
  const first = await request(server)
    .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .set("Idempotency-Key", key)
    .expect(200);
  const replay = await request(server)
    .post(`/api/v1/admin/spots/${draft.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .set("Idempotency-Key", key)
    .expect(200);
  expect(replay.body.data).toEqual(first.body.data);
  const audits = await prisma.auditLog.count({
    where: { admin_id: operator.admin.adminId, action: "spot.publish", entity_id: draft.spot_id },
  });
  expect(audits).toBe(1);
});

it("returns 40902 for the same key with a different request scope", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const first = await createVerifiedCompleteDraft(operator, { spot_name: "幂等甲" });
  const second = await createVerifiedCompleteDraft(operator, { spot_name: "幂等乙" });
  const key = "publish-idem-different";
  await request(server)
    .post(`/api/v1/admin/spots/${first.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .set("Idempotency-Key", key)
    .expect(200);

  const conflict = await request(server)
    .post(`/api/v1/admin/spots/${second.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .set("Idempotency-Key", key)
    .expect(409);
  expect(conflict.body.code).toBe(40902);
});

it("rejects publish for a banned spot without ban_note and a core spot without images", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const banned = await createCompleteDraft(operator, {
    spot_name: "禁钓无备注",
    open_status: "banned",
    ban_note: null,
  });
  await markVerifiedInDb(banned.spot_id);
  const bannedRes = await request(server)
    .post(`/api/v1/admin/spots/${banned.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .expect(422);
  expect(bannedRes.body.code).toBe(42201);
  expect(bannedRes.body.details.map((issue: { field: string }) => issue.field)).toContain("ban_note");

  const core = await createCompleteDraft(operator, {
    spot_name: "核心无图",
    is_core: true,
    images: [],
  });
  await markVerifiedInDb(core.spot_id);
  const coreRes = await request(server)
    .post(`/api/v1/admin/spots/${core.spot_id}/publish`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .expect(422);
  expect(coreRes.body.code).toBe(42201);
  expect(coreRes.body.details.map((issue: { field: string }) => issue.field)).toContain("images");
});
```

- [ ] **Step 2: Run the red test**

Expected: FAIL because publish/offline routes are missing.

- [ ] **Step 3: Implement validation and state transitions**

Publish validation returns 42201 details for missing spot_name, district, latitude/longitude, nav latitude/longitude, address, fish_types (empty), fee_status, water_type, venue_type, open_status, verified_at, source, banned `ban_note`, core images, and a cover outside images. It never auto-sets verified_at. State: draft/offline -> published; published -> 40901; deleted/missing -> 40401. Offline: published -> offline; draft/offline -> 40901. Implement each transition with a conditional `updateMany` (`where: { spot_id, deleted_at: null, status: { in: [...] }, updated_at: expectedUpdatedAt }`), then re-read; when the count is 0, distinguish 40901 from 40401 by loading the row, so a concurrent edit or transition cannot slip between validation and the state change. Both audit after a successful change and return the detail. Use `@Roles(SUPER_ADMIN, OPERATOR)` and CSRF.

`IdempotencyService.execute`:
- Reject an empty or longer-than-128-character key with `AppError(ERROR_CODES.VALIDATION, 400, "Invalid Idempotency-Key")`.
- `actor_type = "admin"`, `actor_id = adminId`, `key` from the header (max 128), `request_hash = sha256(scope + "\n" + JSON.stringify(body ?? null))`, `expires_at = now + 24h`. Publish passes `scope = "spot.publish:" + spotId`; offline passes `scope = "spot.offline:" + spotId`; both pass `body = null`.
- If a row exists with an expired `expires_at`, delete it and continue as new.
- If a row exists with a different hash, throw `AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, 409, "Idempotency key conflict")`.
- If a row exists with the same hash and a stored response, return `{replayed: true, data: response_json}`.
- If a row exists with the same hash but no response, throw `AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, 409, "Idempotency request in progress")`.
- Otherwise create a reservation with `response_json = null`, execute the operation, store `response_json`, and return `{replayed: false, data}`. On operation error, delete the reservation and rethrow.
- Do not write a second audit on replay; the operation runs only once.
The controller passes the `Idempotency-Key` header only for publish/offline; missing header executes without idempotency.

- [ ] **Step 4: Run the focused tests to green**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin-spots apps/api/test/admin-spots.e2e-spec.ts
git commit -m "feat(api): publish and offline spots with idempotency" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 5: Delete, verify, OpenAPI contract and full verification

**Files:**
- Create: `apps/api/src/modules/admin-spots/dto/verify-spot.dto.ts`
- Modify: `apps/api/src/modules/admin-spots/dto/admin-spot-response.dto.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.repository.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.service.ts`
- Modify: `apps/api/src/modules/admin-spots/admin-spots.controller.ts`
- Modify: `apps/api/test/admin-spots.e2e-spec.ts`
- Modify: `apps/api/test/openapi-contract.e2e-spec.ts`
- Regenerate: `openapi/openapi.yaml`
- Regenerate: `packages/api-client/src/schema.d.ts`

**Interfaces:**
- Produces `DELETE /api/v1/admin/spots/:id`, `POST /api/v1/admin/spots/:id/verify`, `VerifySpotDto {method?, note?}` (method max 32, note max 200).
- Produces `AdminSpotsService.delete(spotId, admin, request): Promise<{deleted: true}>`, `AdminSpotsService.verify(spotId, dto, admin, request): Promise<AdminSpotDetail>`.
- Produces `AdminSpotsRepository.softDelete(spotId, fromStatuses, expectedUpdatedAt): Promise<number>` and `AdminSpotsRepository.markVerified(spotId): Promise<Spot | null>`.
- Produces OpenAPI paths and generated types for all admin spot routes.

- [ ] **Step 1: Write the failing delete/verify tests**

```ts
it("soft-deletes draft and offline spots but not published spots", async () => {
  const superAdmin = await loginAsSuperAdmin(app);
  const draft = await createDraft(superAdmin, { spot_name: "待删除草稿" });
  await request(server)
    .delete(`/api/v1/admin/spots/${draft.spot_id}`)
    .set(clientHeaders())
    .set("Cookie", superAdmin.cookie)
    .set("X-CSRF-Token", superAdmin.csrf)
    .expect(200);
  const row = await prisma.spot.findUniqueOrThrow({ where: { spot_id: draft.spot_id } });
  expect(row.deleted_at).not.toBeNull();

  const published = await createPublishedSpot(superAdmin);
  await request(server)
    .delete(`/api/v1/admin/spots/${published.spot_id}`)
    .set(clientHeaders())
    .set("Cookie", superAdmin.cookie)
    .set("X-CSRF-Token", superAdmin.csrf)
    .expect(409);
});

it("does not let operator delete spots", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const draft = await createDraft(operator, { spot_name: "运营不能删" });
  await request(server)
    .delete(`/api/v1/admin/spots/${draft.spot_id}`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .expect(403);
});

it("marks a spot verified and records method and note in audit", async () => {
  const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
  const draft = await createDraft(operator, { spot_name: "待核实草稿" });
  const before = Date.now();
  const res = await request(server)
    .post(`/api/v1/admin/spots/${draft.spot_id}/verify`)
    .set(clientHeaders())
    .set("Cookie", operator.cookie)
    .set("X-CSRF-Token", operator.csrf)
    .send({ method: "现场", note: "水情稳定" })
    .expect(200);
  expect(new Date(res.body.data.verified_at).getTime()).toBeGreaterThanOrEqual(before);
  const audit = await prisma.auditLog.findFirst({
    where: { admin_id: operator.admin.adminId, action: "spot.verify", entity_id: draft.spot_id },
  });
  expect(audit).not.toBeNull();
  expect(audit?.after_json).toMatchObject({ method: "现场", note: "水情稳定" });
});

it("rejects reviewer verify writes", async () => {
  const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
  await request(server)
    .post("/api/v1/admin/spots/01ARZ3NDEKTSV4RRFFQ69G5FAV/verify")
    .set(clientHeaders())
    .set("Cookie", reviewer.cookie)
    .set("X-CSRF-Token", reviewer.csrf)
    .expect(403);
});
```

Add this test to `apps/api/test/openapi-contract.e2e-spec.ts` inside the existing `describe`:

```ts
it("documents all eight admin spot operations", () => {
  const operations = [
    document.paths["/api/v1/admin/spots"]?.get,
    document.paths["/api/v1/admin/spots"]?.post,
    document.paths["/api/v1/admin/spots/{id}"]?.get,
    document.paths["/api/v1/admin/spots/{id}"]?.put,
    document.paths["/api/v1/admin/spots/{id}"]?.delete,
    document.paths["/api/v1/admin/spots/{id}/publish"]?.post,
    document.paths["/api/v1/admin/spots/{id}/offline"]?.post,
    document.paths["/api/v1/admin/spots/{id}/verify"]?.post,
  ];
  expect(operations.every((operation) => operation !== undefined)).toBe(true);
  expect(
    document.paths["/api/v1/admin/spots/{id}/publish"]?.post?.responses?.["409"]
      ?.content?.["application/json"]?.schema?.$ref,
  ).toBe("#/components/schemas/ApiErrorEnvelopeDto");
  expect(
    document.paths["/api/v1/admin/spots/{id}"]?.put?.responses?.["422"]
      ?.content?.["application/json"]?.schema?.$ref,
  ).toBe("#/components/schemas/ApiErrorEnvelopeDto");
});
```

- [ ] **Step 2: Run the red test**

Expected: FAIL because delete/verify routes and OpenAPI paths are missing.

- [ ] **Step 3: Implement delete and verify**

Delete: `@Roles(SUPER_ADMIN)` only. Load non-deleted; published -> 40901; draft/offline -> conditional `updateMany` with `deleted_at: null`, `status: { in: ["draft", "offline"] }` and `updated_at: expectedUpdatedAt`, then audit `spot.delete` with `before: existingDetail` and `after: null`; return `{deleted: true}` documented with `AdminSpotDeleteResponseDto`. If the conditional count is 0, re-read and return 40901 for published or 40401 for deleted/missing. Verify: `@Roles(SUPER_ADMIN, OPERATOR)`. Load non-deleted; set `verified_at = now`; do not change status; audit `spot.verify` with `before: existingDetail` and `after: { ...updatedDetail, method: body.method ?? null, note: body.note ?? null }`; return the updated detail. Both require CSRF.

- [ ] **Step 4: Add OpenAPI decorators and regenerate**

Add `@ApiProperty`/`@ApiPropertyOptional` to every request/response DTO, `@ApiCookieAuth("admin-cookie")`, `@ApiHeader` `X-CSRF-Token` on writes, `@ApiHeader` optional `Idempotency-Key` on publish/offline, `@ApiClientHeaders`, envelope response decorators (`AdminSpotPageDto`, `AdminSpotDetailDto`, `AdminSpotWriteResponseDto` with status 201 on create, `AdminSpotDeleteResponseDto`) and common error responses. Add explicit `@ApiErrorResponse` decorators: 404 on detail/update/delete/publish/offline/verify, 409 on publish/offline/delete, 409 on publish/offline for idempotency conflict, and 422 on update/publish for `42201`. Regenerate:

Run: `pnpm --filter @szfisher/api openapi:generate && pnpm --filter @szfisher/api-client typecheck && pnpm openapi:check`
Expected: exit 0; YAML contains all eight admin spot operations and `AdminSpotDetailDto`; generated client typechecks.

- [ ] **Step 5: Run the full E2 verification**

Run:
- `pnpm --filter @szfisher/api test:e2e -- admin-spots.e2e-spec.ts`
- `pnpm --filter @szfisher/api test:e2e`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm openapi:check`
- `pnpm install --frozen-lockfile`
Expected: all exit 0; the admin spot suite and the existing 72 API e2e tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin-spots apps/api/test/admin-spots.e2e-spec.ts apps/api/test/openapi-contract.e2e-spec.ts openapi packages/api-client/src/schema.d.ts
git commit -m "feat(api): add admin spot delete and verify with OpenAPI contract" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Self-Review Notes

- The plan covers E2 endpoints, draft/publish rules, state transitions, duplicate warnings, RBAC, audit, idempotency and OpenAPI. Image upload/import/POI remain E3/E4/E5.
- `verified_at` is never accepted from create/update DTOs; only verify sets it. Publish reads it.
- The plan follows PRD 3.10 for publish-required fields. The older master-plan Review Focus line that listed `cover_image_key` as universally required is superseded: cover is optional unless images exist; core spots require at least one image.
- The `AdminSpotsModule` depends on `AdminAuthModule` (RolesGuard), `AuditLogModule` (AuditLogService) and `DictionariesModule` (validation); export `DictionariesRepository` to avoid duplicating dictionary SQL.
- The idempotency reservation stores only business data in `response_json`; the response `request_id` stays per-request.
