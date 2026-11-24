# Spot Condition MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured on-site condition reports to the existing report pipeline and surface the latest condition on the spot detail and list pages.

**Architecture:** Extend `report` with five condition columns and a new `content_type='condition'`. Reuse the existing login, rate limit, image, moderation, abuse and admin queue. Public spot reads aggregate the latest published condition within 7 days; the public UGC feed excludes condition entries. No new table and no new feature flag.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 18, native TypeScript WeChat mini program, Jest, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-spot-condition-mvp-design.md`

## Global Constraints

- `content_type` value is exactly `condition`.
- Condition reports accept an `observed_at` no more than 24 hours in the past and no more than 5 minutes in the future.
- Condition reports allow at most 3 images; other report types keep the existing 6-image limit.
- A condition report must carry at least one of `open_status`, `fee_status`, `crowd_level`, `facilities`.
- `content` may be empty only for `condition`; empty content skips the WeChat text moderation call.
- Public detail and list show the latest condition only when `observed_at` is within 7 days.
- Public UGC timeline excludes `condition`; the admin list includes it.
- Reuse `features.ugc`; do not add a second feature flag in this slice.
- UI copy uses `现场` and `钓友上报`; do not use `实时` or `——`.
- No new table; all condition fields live on `report`.

## Review Focus

- A condition report with no structured fields and empty content must be rejected, not published as a blank report.
- An `observed_at` in the future or older than 24 hours must be rejected with a field-level 400.
- A condition report with 4 or more images must be rejected while other types still allow 6.
- A non-condition report that sends a `condition` payload must be rejected.
- A structured-only condition report must publish without calling WeChat text moderation.
- Detail and list must return `latest_condition: null` when no condition exists; they must not fabricate a summary.

---

### Task 1: Shared condition enums and content type

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/contract.test.ts`

**Interfaces:**
- Produces: `REPORT_CONTENT_TYPE.CONDITION`, `CONDITION_CROWD_LEVEL`, `CONDITION_FACILITY`, types `ConditionCrowdLevel` and `ConditionFacility`.
- `OPEN_STATUS` remains the source for `open_status`; the existing `fee_status` dictionary keys `free|paid|member` remain the source for `fee_status`.

- [ ] **Step 1: Update the contract test first**

In `packages/shared/src/contract.test.ts`, extend the `REPORT_CONTENT_TYPE` expectation to:

```ts
expect(REPORT_CONTENT_TYPE).toEqual({
  COMMENT: 'comment',
  CATCH: 'catch',
  INTEL: 'intel',
  CONDITION: 'condition',
});
expect(CONDITION_CROWD_LEVEL).toEqual({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });
expect(CONDITION_FACILITY).toEqual({
  TOILET: 'toilet',
  PARKING: 'parking',
  FOOD: 'food',
  WATER: 'water',
  SHADE: 'shade',
  RENTAL: 'rental',
});
```

Add the two new imports to the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx pnpm@10.0.0 --filter @szfisher/shared test`
Expected: FAIL because `CONDITION` and the new enums are missing.

- [ ] **Step 3: Add the enums**

In `packages/shared/src/enums.ts`, add:

```ts
export const CONDITION_CROWD_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

export type ConditionCrowdLevel =
  (typeof CONDITION_CROWD_LEVEL)[keyof typeof CONDITION_CROWD_LEVEL];

export const CONDITION_FACILITY = {
  TOILET: 'toilet',
  PARKING: 'parking',
  FOOD: 'food',
  WATER: 'water',
  SHADE: 'shade',
  RENTAL: 'rental',
} as const;

export type ConditionFacility =
  (typeof CONDITION_FACILITY)[keyof typeof CONDITION_FACILITY];
```

Add `CONDITION: 'condition'` to `REPORT_CONTENT_TYPE`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx pnpm@10.0.0 --filter @szfisher/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/contract.test.ts
git commit -m "feat(shared): add condition report enums"
```

---

### Task 2: Prisma schema and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261123150000_spot_condition/migration.sql`

**Interfaces:**
- Produces: `Report.condition_open_status`, `condition_fee_status`, `condition_crowd_level`, `condition_facilities`, `observed_at`.

- [ ] **Step 1: Add the fields to the Prisma model**

In the `Report` model after `catch_weight_kg`, add:

```prisma
  condition_open_status String?   @db.VarChar(16)
  condition_fee_status  String?   @db.VarChar(16)
  condition_crowd_level String?   @db.VarChar(16)
  condition_facilities  String[]  @default([])
  observed_at           DateTime? @db.Timestamptz(6)
```

Add the index:

```prisma
  @@index([spot_id, content_type, moderation_status, observed_at(sort: Desc)])
```

- [ ] **Step 2: Write the migration SQL**

Create `apps/api/prisma/migrations/20261123150000_spot_condition/migration.sql`:

```sql
ALTER TABLE "report"
  ADD COLUMN "condition_open_status" VARCHAR(16),
  ADD COLUMN "condition_fee_status" VARCHAR(16),
  ADD COLUMN "condition_crowd_level" VARCHAR(16),
  ADD COLUMN "condition_facilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "observed_at" TIMESTAMPTZ(6);

CREATE INDEX "report_spot_id_content_type_moderation_status_observed_at_idx"
  ON "report"("spot_id", "content_type", "moderation_status", "observed_at" DESC);
```

- [ ] **Step 3: Generate the client and apply to the test database**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api prisma:generate
DATABASE_URL='postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public' \
  npx pnpm@10.0.0 --filter @szfisher/api exec prisma migrate deploy
```

Expected: client generation succeeds and the additive migration applies without a database reset.

Do not use `pnpm db:test:prepare` in an agent session: it resets the test database and Prisma requires explicit human consent for that destructive action. CI has its own disposable database and may continue to use the prepare script.

- [ ] **Step 4: Verify the columns exist**

Run:

```bash
psql postgresql://szfisher:szfisher@localhost:5432/szfisher_test -c '\d report'
```

Expected: the five columns and the new index are listed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261123150000_spot_condition/migration.sql
git commit -m "feat(api): add report condition columns"
```

---

### Task 3: Create condition reports

**Files:**
- Modify: `apps/api/src/modules/reports/dto/create-report.dto.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/modules/reports/reports.repository.ts`
- Test: `apps/api/test/reports.e2e-spec.ts`

**Interfaces:**
- Consumes: `REPORT_CONTENT_TYPE.CONDITION`, `CONDITION_CROWD_LEVEL`, `CONDITION_FACILITY` from Task 1; `Report` fields from Task 2.
- Produces: `CreateReportInput.condition?: CreateReportConditionInput`; `CreateReportRowInput` condition fields; `reports.service.create` accepts and persists a condition payload.

- [ ] **Step 1: Add failing e2e tests**

In `apps/api/test/reports.e2e-spec.ts`, add tests using the existing `loginAppUser`, `appAuthHeaders`, `seedSpot`, `setUgcFeature` and `FakeContentSecurityProvider` helpers:

```ts
it('creates a structured condition report without content', async () => {
  const session = await loginAppUser(app, 'openid-condition');
  const response = await request(server)
    .post('/api/v1/reports')
    .set(HEADERS)
    .set(appAuthHeaders(session))
    .send({
      spot_id: spotId,
      content_type: 'condition',
      content: '',
      condition: {
        open_status: 'open',
        fee_status: 'free',
        crowd_level: 'low',
        facilities: ['toilet', 'parking'],
      },
    })
    .expect(201);
  expect(response.body.data.moderation_status).toBe('published');
});

it('rejects a condition report without structured fields', async () => {
  const session = await loginAppUser(app, 'openid-condition-empty');
  await request(server)
    .post('/api/v1/reports')
    .set(HEADERS)
    .set(appAuthHeaders(session))
    .send({ spot_id: spotId, content_type: 'condition', content: '' })
    .expect(400);
});

it('rejects a future or stale observed_at', async () => {
  const session = await loginAppUser(app, 'openid-condition-time');
  const base = { spot_id: spotId, content_type: 'condition', content: '' };
  await request(server)
    .post('/api/v1/reports')
    .set(HEADERS)
    .set(appAuthHeaders(session))
    .send({
      ...base,
      condition: { crowd_level: 'low', observed_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
    })
    .expect(400);
  await request(server)
    .post('/api/v1/reports')
    .set(HEADERS)
    .set(appAuthHeaders(session))
    .send({
      ...base,
      condition: {
        crowd_level: 'low',
        observed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      },
    })
    .expect(400);
});

it('limits condition reports to three images', async () => {
  const session = await loginAppUser(app, 'openid-condition-images');
  const response = await request(server)
    .post('/api/v1/reports')
    .set(HEADERS)
    .set(appAuthHeaders(session))
    .send({
      spot_id: spotId,
      content_type: 'condition',
      content: '',
      condition: { crowd_level: 'low' },
      image_keys: [
        'ugc/01HX0000000000000000000000/01HX0000000000000000000001.webp',
        'ugc/01HX0000000000000000000000/01HX0000000000000000000002.webp',
        'ugc/01HX0000000000000000000000/01HX0000000000000000000003.webp',
        'ugc/01HX0000000000000000000000/01HX0000000000000000000004.webp',
      ],
    })
    .expect(400);
  expect(response.body.message).toContain('3 images');
});

it('rejects condition fields on other content types', async () => {
  const session = await loginAppUser(app, 'openid-condition-other');
  await request(server)
    .post('/api/v1/reports')
    .set(HEADERS)
    .set(appAuthHeaders(session))
    .send({
      spot_id: spotId,
      content_type: 'comment',
      content: '普通评论',
      condition: { crowd_level: 'low' },
    })
    .expect(400);
});
```

Also assert the fake content-security provider was not called for the structured-only test. Give `FakeContentSecurityProvider` a call counter if it does not already expose one; use `expect(provider.textCalls).toBe(0)` in that test and `1` in a condition report with content.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api test:e2e -- reports.e2e-spec.ts
```

Expected: FAIL because `condition` is rejected as an unknown field and the new tests do not pass.

- [ ] **Step 3: Extend the DTO**

In `create-report.dto.ts`, add:

```ts
export class CreateReportConditionDto {
  @ApiPropertyOptional({ enum: Object.values(OPEN_STATUS) })
  @IsOptional()
  @IsIn(Object.values(OPEN_STATUS))
  open_status?: string;

  @ApiPropertyOptional({ enum: ['free', 'paid', 'member'] })
  @IsOptional()
  @IsIn(['free', 'paid', 'member'])
  fee_status?: string;

  @ApiPropertyOptional({ enum: Object.values(CONDITION_CROWD_LEVEL) })
  @IsOptional()
  @IsIn(Object.values(CONDITION_CROWD_LEVEL))
  crowd_level?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(Object.values(CONDITION_FACILITY), { each: true })
  facilities?: string[];

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  observed_at?: string;
}
```

Add to `CreateReportDto`:

```ts
  @ApiPropertyOptional({ type: () => CreateReportConditionDto })
  @IsOptional()
  @Type(() => CreateReportConditionDto)
  @ValidateNested()
  condition?: CreateReportConditionDto;
```

Import `OPEN_STATUS`, `CONDITION_CROWD_LEVEL`, `CONDITION_FACILITY` from `@szfisher/shared`, and `IsISO8601`/`ValidateNested`/`Type` as needed.

- [ ] **Step 4: Validate and persist the condition in the service/repository**

In `reports.service.ts`:

```ts
export interface CreateReportConditionInput {
  open_status?: string;
  fee_status?: string;
  crowd_level?: string;
  facilities?: string[];
  observed_at?: string;
}

interface ResolvedCondition {
  openStatus: string | null;
  feeStatus: string | null;
  crowdLevel: string | null;
  facilities: string[];
  observedAt: Date;
}
```

Add `condition?: CreateReportConditionInput` to `CreateReportInput`, and `condition: ResolvedCondition | null` to the `ContentShape` interface.

Add `resolveCondition(input, now): ResolvedCondition | null`:

```ts
private resolveCondition(input: CreateReportInput, now: Date): ResolvedCondition | null {
  if (input.content_type !== REPORT_CONTENT_TYPE.CONDITION) {
    if (input.condition !== undefined) {
      throw validationError('condition', 'Only condition content may include condition fields');
    }
    return null;
  }
  if (input.condition === undefined) {
    throw validationError('condition', 'Condition content requires condition fields');
  }
  const facilities = [...new Set(input.condition.facilities ?? [])];
  if (facilities.length > 6) {
    throw validationError('facilities', 'At most 6 facilities are allowed');
  }
  const hasAny =
    input.condition.open_status !== undefined ||
    input.condition.fee_status !== undefined ||
    input.condition.crowd_level !== undefined ||
    facilities.length > 0;
  if (!hasAny) {
    throw validationError('condition', 'At least one condition field is required');
  }
  let observedAt = now;
  if (input.condition.observed_at !== undefined) {
    observedAt = new Date(input.condition.observed_at);
    if (Number.isNaN(observedAt.getTime())) {
      throw validationError('observed_at', 'Invalid observation time');
    }
    const delta = now.getTime() - observedAt.getTime();
    if (delta < -5 * 60 * 1000 || delta > 24 * 60 * 60 * 1000) {
      throw validationError('observed_at', 'Observation time must be within 24 hours');
    }
  }
  return {
    openStatus: input.condition.open_status ?? null,
    feeStatus: input.condition.fee_status ?? null,
    crowdLevel: input.condition.crowd_level ?? null,
    facilities,
    observedAt,
  };
}
```

In `create`:

- Call `const shape = await this.resolveContentShape(input, now);`
- Change `resolveContentShape(input)` to `resolveContentShape(input, now)` and add a `CONDITION` branch that calls `resolveCondition`.
- Allow empty content only for condition:

```ts
const content = input.content.trim();
const codePoints = Array.from(content).length;
if (input.content_type === REPORT_CONTENT_TYPE.CONDITION) {
  if (codePoints > MAX_CONTENT_CODE_POINTS) {
    throw validationError('content', `Content must be at most ${MAX_CONTENT_CODE_POINTS} characters`);
  }
} else if (codePoints < 1 || codePoints > MAX_CONTENT_CODE_POINTS) {
  throw validationError('content', 'Content must be 1 to 500 characters');
}
```

- Reject more than 3 images for condition **before** `resolveImageKeys`, so the limit is checked even when the keys are not owned uploads:

```ts
if (
  input.content_type === REPORT_CONTENT_TYPE.CONDITION &&
  (input.image_keys?.length ?? 0) > 3
) {
  throw validationError('image_keys', 'Condition reports allow at most 3 images');
}
```

- Skip text moderation when content is empty:

```ts
const result = content === '' ? null : await this.checkText(content, appUser.openid);
let moderationStatus = result === null
  ? imageKeys.length > 0
    ? MODERATION_STATUS.MACHINE_PENDING
    : MODERATION_STATUS.PUBLISHED
  : result.suggest === 'pass' && imageKeys.length > 0
    ? MODERATION_STATUS.MACHINE_PENDING
    : moderationStatusFor(result.suggest);
moderationStatus = await this.repository.updateModeration(
  reportId,
  moderationStatus,
  result === null ? { skipped: 'structured_only' } : toMachineResult(result),
  now,
);
if ((result === null || result.suggest !== 'risky') && imageKeys.length > 0) {
  // existing image submission block
}
```

Pass `shape.condition` into `repository.createReport`.

In `report-moderation.service.ts`, change `isTextPassed` so a structured-only result counts as passed:

```ts
const result = machineResult as { suggest?: unknown; skipped?: unknown };
return result.suggest === 'pass' || result.skipped === 'structured_only';
```

Without this, a condition report with images would stay `machine_pending` forever because the media callback recompute requires a passed text result.

Add `apps/api/test/media-moderation.e2e-spec.ts` coverage: upload one image, create a structured-only condition report, send the media callback as `pass`, and assert the report becomes `published` and keeps `condition_crowd_level`.

In `reports.repository.ts`, add to `CreateReportRowInput`:

```ts
conditionOpenStatus: string | null;
conditionFeeStatus: string | null;
conditionCrowdLevel: string | null;
conditionFacilities: string[];
observedAt: Date | null;
```

and to the `tx.report.create` data:

```ts
condition_open_status: input.conditionOpenStatus,
condition_fee_status: input.conditionFeeStatus,
condition_crowd_level: input.conditionCrowdLevel,
condition_facilities: input.conditionFacilities,
observed_at: input.observedAt,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api test:e2e -- reports.e2e-spec.ts
```

Expected: PASS, including the five new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/reports apps/api/test/reports.e2e-spec.ts
git commit -m "feat(api): accept structured condition reports"
```

---

### Task 4: Public detail and list aggregation

**Files:**
- Modify: `apps/api/src/modules/public-spots/public-spot.types.ts`
- Modify: `apps/api/src/modules/public-spots/public-spots.service.ts`
- Modify: `apps/api/src/modules/public-spots/dto/public-spot-response.dto.ts`
- Modify: `apps/api/src/modules/reports/reports.repository.ts`
- Test: `apps/api/test/public-spots.e2e-spec.ts`
- Test: `apps/api/test/reports.e2e-spec.ts`

**Interfaces:**
- Consumes: the condition columns from Task 2 and the create path from Task 3.
- Produces: `PublicCondition` and `latest_condition` on `PublicSpotListItem` and `PublicSpotDetail`; public UGC feed excludes condition by default.

- [ ] **Step 1: Add failing e2e tests**

In `public-spots.e2e-spec.ts`, seed a published spot and a published condition report directly with Prisma, then:

```ts
it('returns the latest condition on spot detail', async () => {
  const response = await request(server).get(`/api/v1/spots/${spotId}`).set(HEADERS).expect(200);
  expect(response.body.data.latest_condition).toMatchObject({
    open_status: 'open',
    fee_status: 'free',
    crowd_level: 'low',
    facilities: ['toilet', 'parking'],
    freshness: 'today',
  });
  expect(response.body.data.latest_condition.report_count_7d).toBe(1);
});

it('omits a condition older than seven days', async () => {
  await prisma.report.update({
    where: { report_id: oldConditionId },
    data: { observed_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
  });
  const response = await request(server).get(`/api/v1/spots/${spotId}`).set(HEADERS).expect(200);
  expect(response.body.data.latest_condition).toBeNull();
});

it('returns condition summaries on the spot list', async () => {
  const response = await request(server).get('/api/v1/spots').set(HEADERS).expect(200);
  const item = response.body.data.items.find((row: { spot_id: string }) => row.spot_id === spotId);
  expect(item.latest_condition).toMatchObject({ crowd_level: 'low', freshness: 'today' });
});
```

In `reports.e2e-spec.ts`, add:

```ts
it('excludes condition reports from the public UGC feed', async () => {
  const response = await request(server)
    .get(`/api/v1/spots/${spotId}/reports`)
    .set(HEADERS)
    .expect(200);
  expect(response.body.data.items.every((item: { content_type: string }) => item.content_type !== 'condition')).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api test:e2e -- public-spots.e2e-spec.ts reports.e2e-spec.ts
```

Expected: FAIL because `latest_condition` is undefined and the feed still includes condition rows.

- [ ] **Step 3: Add the public types and DTOs**

In `public-spot.types.ts`:

```ts
export type ConditionFreshness = 'today' | 'recent' | 'stale';

export interface PublicCondition {
  open_status: string | null;
  fee_status: string | null;
  crowd_level: string | null;
  facilities: string[];
  observed_at: string;
  reported_at: string;
  age_hours: number;
  freshness: ConditionFreshness;
  report_count_7d?: number;
}
```

Add `latest_condition: PublicCondition | null` to `PublicSpotListItem`. In `toListItem`, return `latest_condition: null` as the default; `list` and `detail` overwrite it with the aggregated value.

In `public-spot-response.dto.ts`, add `PublicConditionDto` with the same fields (`report_count_7d` optional) and add `latest_condition` to `PublicSpotListItemDto` and `PublicSpotDetailDto`:

```ts
@ApiProperty({ type: () => PublicConditionDto, nullable: true })
latest_condition!: PublicConditionDto | null;
```

- [ ] **Step 4: Implement aggregation in the service**

In `public-spots.service.ts`, add constants:

```ts
const CONDITION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CONDITION_STATUSES = [MODERATION_STATUS.PUBLISHED, MODERATION_STATUS.HUMAN_APPROVED] as const;
```

Add:

```ts
private async latestConditions(
  spotIds: string[],
  now: Date,
): Promise<Map<string, PublicCondition>> {
  if (spotIds.length === 0) {
    return new Map();
  }
  const since = new Date(now.getTime() - CONDITION_WINDOW_MS);
  const rows = await this.prisma.report.findMany({
    where: {
      spot_id: { in: spotIds },
      content_type: REPORT_CONTENT_TYPE.CONDITION,
      moderation_status: { in: [...CONDITION_STATUSES] },
      deleted_at: null,
      observed_at: { gte: since },
    },
    orderBy: [{ observed_at: 'desc' }, { report_id: 'desc' }],
    select: {
      spot_id: true,
      condition_open_status: true,
      condition_fee_status: true,
      condition_crowd_level: true,
      condition_facilities: true,
      observed_at: true,
      created_at: true,
    },
  });
  const latest = new Map<string, PublicCondition>();
  for (const row of rows) {
    if (latest.has(row.spot_id) || row.observed_at === null) {
      continue;
    }
    latest.set(row.spot_id, this.toPublicCondition(row, row.observed_at, now));
  }
  return latest;
}

private toPublicCondition(
  row: {
    condition_open_status: string | null;
    condition_fee_status: string | null;
    condition_crowd_level: string | null;
    condition_facilities: string[];
    created_at: Date;
  },
  observedAt: Date,
  now: Date,
): PublicCondition {
  const ageHours = Math.max(0, Math.floor((now.getTime() - observedAt.getTime()) / 3_600_000));
  return {
    open_status: row.condition_open_status,
    fee_status: row.condition_fee_status,
    crowd_level: row.condition_crowd_level,
    facilities: row.condition_facilities,
    observed_at: observedAt.toISOString(),
    reported_at: row.created_at.toISOString(),
    age_hours: ageHours,
    freshness: ageHours <= 24 ? 'today' : ageHours <= 72 ? 'recent' : 'stale',
  };
}
```

In `list`, after `const pageItems = items.slice(start, start + pageSize);`:

```ts
const conditionBySpot = await this.latestConditions(
  pageItems.map((item) => item.spot_id),
  new Date(),
);
const pageWithConditions = pageItems.map((item) => ({
  ...item,
  latest_condition: conditionBySpot.get(item.spot_id) ?? null,
}));
```

Return `items: pageWithConditions`.

In `detail`, after `const base = this.toListItem(row);`:

```ts
const now = new Date();
const latest = await this.latestConditions([row.spot_id], now);
const condition = latest.get(row.spot_id) ?? null;
if (condition !== null) {
  condition.report_count_7d = await this.prisma.report.count({
    where: {
      spot_id: row.spot_id,
      content_type: REPORT_CONTENT_TYPE.CONDITION,
      moderation_status: { in: [...CONDITION_STATUSES] },
      deleted_at: null,
      observed_at: { gte: new Date(now.getTime() - CONDITION_WINDOW_MS) },
    },
  });
}
```

Add `latest_condition: condition` to the returned detail object.

- [ ] **Step 5: Exclude condition from the public UGC feed**

In `reports.repository.ts` `listPublic`, change the content-type clause to:

```ts
...(params.contentType === undefined
  ? { content_type: { not: REPORT_CONTENT_TYPE.CONDITION } }
  : { content_type: params.contentType }),
```

Import `REPORT_CONTENT_TYPE` if not already imported.

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api test:e2e -- public-spots.e2e-spec.ts reports.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/public-spots apps/api/src/modules/reports/reports.repository.ts apps/api/test/public-spots.e2e-spec.ts apps/api/test/reports.e2e-spec.ts
git commit -m "feat(api): expose latest spot condition"
```

---

### Task 5: Admin condition fields

**Files:**
- Modify: `apps/api/src/modules/admin-reports/dto/admin-report-response.dto.ts`
- Modify: `apps/api/src/modules/admin-reports/admin-reports.repository.ts`
- Modify: `apps/api/src/modules/admin-reports/admin-reports.service.ts`
- Test: `apps/api/test/admin-moderation.e2e-spec.ts`

**Interfaces:**
- Consumes: the condition columns from Task 2.
- Produces: admin report list/detail responses include `condition_open_status`, `condition_fee_status`, `condition_crowd_level`, `condition_facilities`, `observed_at`.

- [ ] **Step 1: Add a failing e2e test**

Seed a published condition report and fetch it through the admin list and detail. Assert:

```ts
expect(item.condition_open_status).toBe('open');
expect(item.condition_fee_status).toBe('free');
expect(item.condition_crowd_level).toBe('low');
expect(item.condition_facilities).toEqual(['toilet', 'parking']);
expect(item.observed_at).toBeTruthy();
```

Also filter by `content_type=condition` and assert the row is returned.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api test:e2e -- admin-moderation.e2e-spec.ts
```

Expected: FAIL because the admin response does not include the new fields.

- [ ] **Step 3: Extend the admin response DTO**

Add to `AdminReportItemDto` (and any detail DTO that shares the shape):

```ts
@ApiProperty({ type: String, nullable: true })
condition_open_status!: string | null;

@ApiProperty({ type: String, nullable: true })
condition_fee_status!: string | null;

@ApiProperty({ type: String, nullable: true })
condition_crowd_level!: string | null;

@ApiProperty({ type: [String] })
condition_facilities!: string[];

@ApiProperty({ type: String, format: 'date-time', nullable: true })
observed_at!: string | null;
```

- [ ] **Step 4: Select and map the fields**

In `admin-reports.repository.ts`, add the five fields to the report row select used by list and detail. In `admin-reports.service.ts` `toReportItem`, add:

```ts
condition_open_status: row.condition_open_status,
condition_fee_status: row.condition_fee_status,
condition_crowd_level: row.condition_crowd_level,
condition_facilities: row.condition_facilities,
observed_at: row.observed_at === null ? null : row.observed_at.toISOString(),
```

Update the `AdminReportRow` type so TypeScript accepts the fields.

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api test:e2e -- admin-moderation.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin-reports apps/api/test/admin-moderation.e2e-spec.ts
git commit -m "feat(api): return condition fields to admin reports"
```

---

### Task 6: Regenerate OpenAPI, client types and admin display

**Files:**
- Modify: `openapi/openapi.yaml` (generated)
- Modify: `packages/api-client/src/schema.d.ts` (generated)
- Modify: `apps/admin/src/admin/ContentModerationDrawer.tsx`

**Interfaces:**
- Produces: `CreateReportDto.condition`, `PublicSpotListItemDto.latest_condition`, `PublicSpotDetailDto.latest_condition`, and the admin condition fields in the generated client; the admin type filter and drawer show `现场`.

- [ ] **Step 1: Regenerate**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api openapi:generate
npx pnpm@10.0.0 openapi:check
```

Expected: generation succeeds and `openapi:check` exits 0.

- [ ] **Step 2: Inspect the generated diff**

Run:

```bash
git diff --stat -- openapi/openapi.yaml packages/api-client/src/schema.d.ts
```

Expected: the new `CreateReportConditionDto`, `PublicConditionDto`, and condition fields appear.

- [ ] **Step 3: Add the admin label, filter option and detail block**

In `apps/admin/src/admin/ContentModerationDrawer.tsx`:

```ts
const CONTENT_TYPE_LABEL: Record<string, string> = {
  comment: '评论',
  catch: '鱼获',
  intel: '情报',
  condition: '现场',
};

const CONDITION_OPEN_LABEL: Record<string, string> = {
  open: '开放', paused: '暂停', banned: '禁钓',
};
const CONDITION_FEE_LABEL: Record<string, string> = {
  free: '免费', paid: '收费', member: '需会员',
};
const CONDITION_CROWD_LABEL: Record<string, string> = {
  low: '人少', medium: '一般', high: '人多',
};
const CONDITION_FACILITY_LABEL: Record<string, string> = {
  toilet: '厕所', parking: '停车', food: '餐饮',
  water: '补水', shade: '遮阴', rental: '租赁',
};
```

Add `{ value: 'condition', label: '现场' }` to the type filter options.

Add a block after the existing 鱼获信息 block, and show `仅结构化上报` when `item.content` is empty:

```tsx
{item.content_type === 'condition' && (
  <Descriptions column={2} size="small" bordered title="现场情况">
    <Descriptions.Item label="开放状态">
      {CONDITION_OPEN_LABEL[item.condition_open_status ?? ''] ?? '未填'}
    </Descriptions.Item>
    <Descriptions.Item label="收费">
      {CONDITION_FEE_LABEL[item.condition_fee_status ?? ''] ?? '未填'}
    </Descriptions.Item>
    <Descriptions.Item label="人流">
      {CONDITION_CROWD_LABEL[item.condition_crowd_level ?? ''] ?? '未填'}
    </Descriptions.Item>
    <Descriptions.Item label="观察时间">
      {item.observed_at === null ? '未填' : formatDateTime(item.observed_at)}
    </Descriptions.Item>
    <Descriptions.Item label="设施">
      {item.condition_facilities
        .map((key) => CONDITION_FACILITY_LABEL[key] ?? key)
        .join('、') || '未填'}
    </Descriptions.Item>
  </Descriptions>
)}
```

- [ ] **Step 4: Verify the admin build**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/admin typecheck
npx pnpm@10.0.0 --filter @szfisher/admin build
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add openapi/openapi.yaml packages/api-client/src/schema.d.ts apps/admin/src/admin/ContentModerationDrawer.tsx
git commit -m "chore(openapi): add condition report contract and admin display"
```

---

### Task 7: Mini program condition helpers and draft validation

**Files:**
- Create: `apps/miniprogram/src/condition.ts`
- Create: `apps/miniprogram/src/condition.test.ts`
- Modify: `apps/miniprogram/src/report-form.ts`
- Modify: `apps/miniprogram/src/report-form.test.ts`
- Modify: `apps/miniprogram/src/api.ts`

**Interfaces:**
- Produces: `CONDITION_OPEN_OPTIONS`, `CONDITION_FEE_OPTIONS`, `CONDITION_CROWD_OPTIONS`, `CONDITION_FACILITY_OPTIONS`, `CONDITION_OBSERVED_OPTIONS`, `observedAtFor(key, now)`, `conditionSummary(draft)`, `conditionFreshnessText(condition)`, and `ReportDraft.condition`.
- `ReportContentType` becomes `'comment' | 'catch' | 'intel' | 'condition'`.

- [ ] **Step 1: Write the failing helper tests**

`apps/miniprogram/src/condition.test.ts`:

```ts
import {
  conditionFreshnessText,
  conditionSummary,
  observedAtFor,
} from './condition';

describe('condition helpers', () => {
  it('formats a structured summary', () => {
    expect(conditionSummary({
      open_status: 'open',
      fee_status: 'free',
      crowd_level: 'low',
      facilities: ['toilet', 'parking'],
    })).toBe('开放 · 免费 · 人少 · 有厕所/停车');
  });

  it('returns a relative freshness label', () => {
    expect(conditionFreshnessText({ age_hours: 2, freshness: 'today' })).toBe('2 小时前');
    expect(conditionFreshnessText({ age_hours: 30, freshness: 'recent' })).toBe('1 天前');
  });

  it('maps observed options to ISO times inside 24 hours', () => {
    const now = new Date('2026-11-23T12:00:00+08:00');
    expect(observedAtFor('now', now)).toBe('2026-11-23T04:00:00.000Z');
    expect(observedAtFor('yesterday', now)).toBe('2026-11-22T16:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run: `npx pnpm@10.0.0 --filter @szfisher/miniprogram test -- condition.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `condition.ts`**

Define the option arrays with the exact labels:

- open: `open` 开放, `paused` 暂停, `banned` 禁钓
- fee: `free` 免费, `paid` 收费, `member` 需会员
- crowd: `low` 人少, `medium` 一般, `high` 人多
- facilities: `toilet` 厕所, `parking` 停车, `food` 餐饮, `water` 补水, `shade` 遮阴, `rental` 租赁
- observed: `now` 刚刚 (0), `hour` 1 小时内 (60), `today` 今天早些时候 (360), `yesterday` 昨天 (1200)

`observedAtFor(key, now)` returns `new Date(now.getTime() - offsetMinutes * 60_000).toISOString()`.

`conditionSummary` joins the selected labels with ` · `, using `有` + facilities joined by `/`; omit empty fields.

`conditionFreshnessText` returns `刚刚` for 0 hours, `X 小时前` for under 24, `X 天前` otherwise.

- [ ] **Step 4: Extend `report-form.ts` and its tests**

Add `'condition'` to `ReportContentType`, add:

```ts
export interface ReportConditionDraft {
  open_status?: string | null;
  fee_status?: string | null;
  crowd_level?: string | null;
  facilities?: string[];
}

export interface ReportDraft {
  ...
  condition?: ReportConditionDraft | null;
}
```

Add `MAX_CONDITION_IMAGES = 3`.

In `validateReportDraft`:

- For `condition`, allow empty content; if non-empty, enforce 500 code points.
- Require at least one of the four condition fields.
- Enforce `image_count <= MAX_CONDITION_IMAGES`.
- Keep the existing content-required rule for other types.
- Keep the terms check last.

Add tests:

```ts
it('accepts a structured-only condition draft', () => {
  expect(validateReportDraft({
    content_type: 'condition',
    content: '',
    condition: { crowd_level: 'low' },
    image_count: 0,
    terms_accepted: true,
  })).toEqual({ ok: true });
});

it('rejects an empty condition draft', () => {
  expect(validateReportDraft({
    content_type: 'condition',
    content: '',
    condition: {},
    image_count: 0,
    terms_accepted: true,
  }).ok).toBe(false);
});

it('rejects four condition images', () => {
  expect(validateReportDraft({
    content_type: 'condition',
    content: '',
    condition: { crowd_level: 'low' },
    image_count: 4,
    terms_accepted: true,
  }).ok).toBe(false);
});
```

- [ ] **Step 5: Update `api.ts`**

Change `export type ReportContentType = 'comment' | 'catch' | 'intel' | 'condition';` and add `condition` to `contentTypeLabel` returning `现场`.

- [ ] **Step 6: Run the tests**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/miniprogram test
npx pnpm@10.0.0 --filter @szfisher/miniprogram typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/miniprogram/src/condition.ts apps/miniprogram/src/condition.test.ts apps/miniprogram/src/report-form.ts apps/miniprogram/src/report-form.test.ts apps/miniprogram/src/api.ts
git commit -m "feat(miniprogram): add condition helpers and validation"
```

---

### Task 8: Report form condition UI

**Files:**
- Modify: `apps/miniprogram/src/pages/report/create.ts`
- Modify: `apps/miniprogram/src/pages/report/create.wxml`
- Modify: `apps/miniprogram/src/pages/report/create.wxss`

**Interfaces:**
- Consumes: `condition.ts` helpers from Task 7; generated `CreateReportInput.condition` from Task 6.
- Produces: a fourth type card `现场`, condition chip rows, and a payload with `condition`.

- [ ] **Step 1: Extend the page state and submit payload**

In `create.ts`:

- Add `condition` option arrays to data.
- Add `conditionOpen`, `conditionFee`, `conditionCrowd`, `conditionFacilities`, `conditionObserved` state.
- Add handlers `selectConditionOpen`, `selectConditionFee`, `selectConditionCrowd`, `toggleConditionFacility`, `selectConditionObserved`.
- In `selectType`, when switching away from condition, keep the values but do not send them.
- In the submit builder, when `contentType === 'condition'`:

```ts
condition: {
  open_status: this.data.conditionOpen || undefined,
  fee_status: this.data.conditionFee || undefined,
  crowd_level: this.data.conditionCrowd || undefined,
  facilities: this.data.conditionFacilities,
  observed_at: observedAtFor(this.data.conditionObserved),
},
```

- Build the `ReportDraft` with `condition` so `validateReportDraft` enforces the condition rules.
- Keep `content: ''` allowed for condition.

- [ ] **Step 2: Update the WXML**

- Change the type grid to render 4 cards; the existing `wx:for` handles it.
- Add a `wx:if="{{contentType === 'condition'}}"` section with:
  - 开放状态 chips
  - 收费 chips
  - 人流 chips
  - 设施 multi-select chips
  - 观察时间 chips
  - The existing textarea stays, with placeholder `补充说明（选填）`
  - Hint `至少选择一项现场情况`
- The image section remains; the hint shows `最多 3 张` when condition.

- [ ] **Step 3: Update the WXSS**

- Change `.type-grid` from 3 columns to a 2×2 wrap:

```css
.type-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.type-card {
  flex: 1 1 calc(50% - 6rpx);
  min-width: 0;
}
```

- Add `.condition-row`, `.condition-chip`, `.condition-chip.is-active` styles consistent with `.category-chip` (min-height 64rpx).
- Add `.condition-hint` using the 24rpx muted style.

- [ ] **Step 4: Verify**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/miniprogram typecheck
npx pnpm@10.0.0 --filter @szfisher/miniprogram test
```

Expected: PASS.

- [ ] **Step 5: Manual check in WeChat DevTools**

Open the report page, switch to 现场, verify:
- 4 type cards lay out 2×2.
- At least one field is required.
- Selecting 4 images is blocked.
- Submitting a structured-only draft succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/miniprogram/src/pages/report/create.ts apps/miniprogram/src/pages/report/create.wxml apps/miniprogram/src/pages/report/create.wxss
git commit -m "feat(miniprogram): add condition report form"
```

---

### Task 9: Detail page condition card

**Files:**
- Modify: `apps/miniprogram/src/pages/detail/detail.ts`
- Modify: `apps/miniprogram/src/pages/detail/detail.wxml`
- Modify: `apps/miniprogram/src/pages/detail/detail.wxss`

**Interfaces:**
- Consumes: `PublicSpotDetail.latest_condition` from Task 4/Task 6; `conditionSummary`/`conditionFreshnessText` from Task 7.
- Produces: a `conditionView` data object and an `openConditionReport` handler.

- [ ] **Step 1: Map the condition in `display()`**

Add to `DetailData`:

```ts
conditionView: {
  hasData: boolean;
  openLabel: string;
  feeLabel: string;
  crowdLabel: string;
  facilityLabels: string[];
  timeText: string;
  countText: string;
  freshnessTone: string;
} | null;
```

In `display(spot)`, derive it from `spot.latest_condition`:

- `openLabel` via `openStatusLabel`
- `feeLabel` via `dictionaryLabel(dictionaries?.fee_status, ...)`
- `crowdLabel` via the condition helper
- `facilityLabels` via the condition helper
- `timeText` via `relativeTimeText(condition.observed_at)`
- `countText` = `${condition.report_count_7d} 人上报`
- `freshnessTone` = `tag-warn` when `freshness === 'stale'`, else `''`

If `latest_condition` is null, set `conditionView` to a `{ hasData: false }` object.

- [ ] **Step 2: Add the WXML card**

Insert after the heading block and before the alerts:

```xml
<view class="condition-card card">
  <view class="condition-head">
    <text class="condition-title">现场情况</text>
    <text wx:if="{{conditionView.hasData}}" class="condition-time {{conditionView.freshnessTone}}">{{conditionView.timeText}}</text>
  </view>
  <block wx:if="{{conditionView.hasData}}">
    <view class="condition-tags">
      <text wx:if="{{conditionView.openLabel}}" class="tag">{{conditionView.openLabel}}</text>
      <text wx:if="{{conditionView.feeLabel}}" class="tag">{{conditionView.feeLabel}}</text>
      <text wx:if="{{conditionView.crowdLabel}}" class="tag">{{conditionView.crowdLabel}}</text>
      <text wx:for="{{conditionView.facilityLabels}}" wx:key="*this" class="tag tag-soft">{{item}}</text>
    </view>
    <text class="condition-meta">{{conditionView.countText}} · 钓友上报，仅供参考</text>
  </block>
  <block wx:else>
    <text class="condition-empty">暂无近期现场情况，欢迎补充。</text>
    <button wx:if="{{ugcVisible}}" class="primary-button condition-button" bindtap="openConditionReport">补充现场</button>
  </block>
</view>
```

- [ ] **Step 3: Add the handler and analytics**

`openConditionReport()` navigates to the report page and records the CTA:

```ts
track('condition_cta_click', { spot_id: this.data.spot.spot_id });
wx.navigateTo({
  url: `/pages/report/create?spot_id=${encodeURIComponent(this.data.spot.spot_id)}&spot_name=${encodeURIComponent(this.data.spot.spot_name)}&type=condition`,
});
```

In `display(spot)`, when `spot.latest_condition !== null`, record:

```ts
track('condition_view', {
  spot_id: spot.spot_id,
  freshness: spot.latest_condition.freshness,
});
```

In `onLoad`, read `type` and pass it to the report page via the URL; the report page's `loadOptions` must accept `type` and preselect `condition`.

- [ ] **Step 4: Update the report page to preselect condition**

In `apps/miniprogram/src/pages/report/create.ts`, extend `LoadOptions` with `type?: string`; if `type === 'condition'`, set `contentType: 'condition'`. If UGC is disabled, keep the existing gate.

- [ ] **Step 5: Add WXSS**

Add `.condition-card` padding, `.condition-head` flex, `.condition-title` 30rpx 600, `.condition-time` 24rpx muted, `.condition-tags` flex wrap gap 8, `.condition-meta` 24rpx muted margin-top 12, `.condition-empty` 26rpx body, `.condition-button` margin-top 16 height 76.

- [ ] **Step 6: Verify**

Run typecheck and tests. Manual DevTools check: a spot with a condition shows the tags and time; a spot without shows the empty state and the button opens the condition form.

- [ ] **Step 7: Commit**

```bash
git add apps/miniprogram/src/pages/detail apps/miniprogram/src/pages/report/create.ts
git commit -m "feat(miniprogram): show spot condition on detail"
```

---

### Task 10: Home list condition summary

**Files:**
- Modify: `apps/miniprogram/src/pages/index/index.ts`
- Modify: `apps/miniprogram/src/pages/index/index.wxml`
- Modify: `apps/miniprogram/src/pages/index/index.wxss`

**Interfaces:**
- Consumes: `PublicSpotListItem.latest_condition` from Task 4/Task 6; `conditionSummary`/`conditionFreshnessText` from Task 7.
- Produces: `DisplaySpot.conditionText` and `DisplaySpot.conditionFreshness`.

- [ ] **Step 1: Extend `DisplaySpot` and `displaySpot`**

Add:

```ts
conditionText: string;
conditionFreshness: string;
```

In `displaySpot`:

```ts
conditionText: item.latest_condition === null ? '' : conditionSummary(item.latest_condition),
conditionFreshness: item.latest_condition === null
  ? ''
  : conditionFreshnessText(item.latest_condition),
```

The `conditionSummary` helper accepts the public condition shape (same field names as the draft) with snake_case keys.

- [ ] **Step 2: Add the WXML line**

Below the existing tag row:

```xml
<view wx:if="{{item.conditionText}}" class="spot-condition">
  <text class="spot-condition-time">{{item.conditionFreshness}}</text>
  <text class="spot-condition-text">{{item.conditionText}}</text>
</view>
```

- [ ] **Step 3: Add WXSS**

`.spot-condition` flex wrap, margin-top 6, font 24rpx, color #5C6B64; `.spot-condition-time` color #1E6B57, font-weight 600, margin-right 8rpx.

- [ ] **Step 4: Verify**

Run typecheck and tests. Manual check: a spot with a condition shows the line; a spot without does not render an empty line.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/src/pages/index
git commit -m "feat(miniprogram): show condition summary on spot cards"
```

---

### Task 11: Admin Playwright coverage

**Files:**
- Modify: `apps/api/test/playwright/content-moderation.spec.ts`

**Interfaces:**
- Consumes: the admin fields from Task 5; the seeded condition report.
- Produces: a Playwright test proving the moderation drawer shows structured condition fields and the type filter works.

- [ ] **Step 1: Seed a condition report in the spec setup**

Use the existing Prisma client and spot author to create a published report:

```ts
await prisma.report.create({
  data: {
    report_id: ulid(),
    spot_id: spotId,
    user_id: authorId,
    content_type: 'condition',
    content: '',
    condition_open_status: 'open',
    condition_fee_status: 'free',
    condition_crowd_level: 'low',
    condition_facilities: ['toilet', 'parking'],
    observed_at: new Date(),
    moderation_status: 'published',
  },
});
```

Track the id for cleanup.

- [ ] **Step 2: Add the test**

After logging in as reviewer:

```ts
test('shows structured condition fields in the moderation drawer', async ({ page }) => {
  await loginAsReviewer(page);
  await page.goto('/reports');
  await page.getByLabel('类型').selectOption('condition');
  await page.getByText(CONDITION_MARKER).click();
  await expect(page.getByText('现场情况')).toBeVisible();
  await expect(page.getByText('开放')).toBeVisible();
  await expect(page.getByText('免费')).toBeVisible();
  await expect(page.getByText('人少')).toBeVisible();
  await expect(page.getByText('厕所')).toBeVisible();
});
```

Use the exact admin labels discovered from the existing `content-moderation.spec.ts`; if the type filter is a button group rather than a select, use the same locator pattern as the existing filter tests.

- [ ] **Step 3: Run the Playwright suite**

Run:

```bash
npx pnpm@10.0.0 test:admin -- content-moderation.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/playwright/content-moderation.spec.ts
git commit -m "test(admin): cover condition report moderation"
```

---

### Task 12: Full verification and staging notes

**Files:**
- Modify: `docs/ops/deployment.md` (only if a staging note is needed)
- No production code changes.

**Interfaces:**
- Consumes: all previous tasks.

- [ ] **Step 1: Run the full local suite**

Run:

```bash
npx pnpm@10.0.0 lint
npx pnpm@10.0.0 typecheck
npx pnpm@10.0.0 --filter @szfisher/miniprogram test
npx pnpm@10.0.0 --filter @szfisher/api test
npx pnpm@10.0.0 --filter @szfisher/api test:e2e
npx pnpm@10.0.0 openapi:check
```

Expected: all exit 0. The focused e2e command uses the migrated test database; the root `test:integration` script resets it and therefore requires explicit human consent before running in an agent session.

- [ ] **Step 2: Run the focused e2e suites**

Run:

```bash
npx pnpm@10.0.0 --filter @szfisher/api test:e2e -- reports.e2e-spec.ts public-spots.e2e-spec.ts admin-moderation.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 3: Staging smoke**

On staging:
- Apply the migration.
- Set `features.ugc=true` if the trial group is enabled.
- Submit one structured-only condition report through the mini program.
- Confirm the detail page shows the condition and the admin drawer shows the fields.
- Confirm the public UGC timeline does not show the condition entry.

- [ ] **Step 4: Commit any doc updates**

```bash
git add docs/ops/deployment.md
git commit -m "docs(ops): note condition report staging check"
```

- [ ] **Step 5: Open the implementation PR**

Push the branch and open a PR against `main` with the design doc, implementation, tests and staging notes. The existing draft PR #58 can be reused or closed and replaced.

---

## Self-Review

**Spec coverage:**
- Data model / enums: Tasks 1–2.
- Create validation, 24h window, 3 images, empty content moderation skip: Task 3.
- Detail/list aggregation and UGC exclusion: Task 4.
- Admin fields: Task 5.
- OpenAPI: Task 6.
- Mini program helpers/form/detail/home: Tasks 7–10.
- Playwright: Task 11.
- Verification/rollout: Task 12.

**Type consistency:**
- Condition fields use snake_case in API/JSON and camelCase only inside service-local `ResolvedCondition`.
- `PublicCondition.freshness` values are `today|recent|stale` everywhere.
- `ReportContentType` includes `condition` in both shared and mini program types.

**Review Focus tests:**
- Empty condition → Task 3 test.
- Future/stale observed_at → Task 3 test.
- >3 images → Task 3 test.
- Non-condition with condition payload → Task 3 test.
- Structured-only skips text moderation → Task 3 test.
- No condition → null → Task 4 tests.
- UGC feed exclusion → Task 4 test.
