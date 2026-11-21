# UniHuan 内容到商品拓展 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在钓点详情和品牌页展示 UniHuan 商品卡，点击后跳转微店，后台可独立维护商品、渠道和展示位置，交易不进入 SZFisher。

**Architecture:** 新增独立 `commerce` 模块，商品、渠道、展示位置三层分离。公共商品接口独立于钓点详情接口，小程序用第二次请求组合页面。购买动作是标准契约，微店先接，京东后续通过新增渠道实现接入。

**Tech Stack:** Node 24, pnpm 10, NestJS 11, Prisma 6/PostgreSQL 18, native TypeScript mini program, Next.js 16/Ant Design 6, Jest/Supertest/Playwright, Aliyun OSS.

**Spec:** `docs/superpowers/specs/2026-11-21-unihuan-commerce-extension-design.md`

## Global Constraints

- `features.shop` 默认 `false`，staging 验收时开启，生产保持关闭。
- 第一版 `surface` 只允许 `spot_detail` 和 `brand_page`；`home`、`report_detail` 返回空数组。
- 第一版渠道只允许 `weidian`；`jd` 字段保留但不开放。
- 第一版购买动作只允许 `mini_program`、`h5`、`copy_link`；`qr` 保留但不进入契约。
- 品牌页返回最多 100 个 active 商品，服务端按 `category` 筛选，不读取展示位置。
- `spot_detail` 展示位置只有 `scope=spot` 和 `scope=fish` 两种；一个商品要覆盖钓点和鱼种时创建两条位置。
- 商品图 key 为 `products/{productId}/{ulid}.webp`；工作桶私有，发布桶公开，后台预览签名 15 分钟。
- 商品图最大 10 MB，只接受 JPG、PNG、WebP，统一转 WebP、去 EXIF、目标 250 KB。
- 不修改 `spot`、`report`、`feedback` 的现有响应结构和表结构。
- 权限只有 `super_admin` 和 `operator` 拥有 `product:read`、`product:write`；`reviewer` 无商品权限。
- 可见文案禁止 U+2014 和 U+2013；沿用现有松绿、朱砂配色。
- 微店商品链接形态未确定时，先用 `copy_link` 做后台和页面验收；staging 真实跳转验收前补齐 `mini_program` 或 `h5` 参数。
- 每个任务结束运行对应测试；涉及 API 时运行 `openapi:generate` 并提交生成物。
- 提交信息末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

- **展示位置作用域错误**：`scope=spot` 必须只命中指定钓点，`scope=fish` 必须只命中鱼种匹配，不能因为字段混填把商品推到全城。`commerce.e2e-spec.ts` 和 `commerce-admin.e2e-spec.ts` 覆盖。
- **开关关闭仍展示**：`features.shop=false` 时公共接口必须返回空数组，小程序详情页不得发出商品请求。`commerce.e2e-spec.ts` 和 `commerce.test.ts` 覆盖。
- **购买动作注入**：非法 appid、非 https 链接、V1 不允许的渠道和动作必须被后台拒绝。`purchase-action.service.spec.ts` 覆盖。
- **草稿图泄漏**：草稿商品图只能通过签名预览读取，不能从公开商品图路由拿到；只有 active 商品才复制到发布桶。`commerce-images.e2e-spec.ts` 覆盖。
- **后台越权**：reviewer 不能读写商品和展示位置，所有写操作必须写审计。`commerce-admin.e2e-spec.ts` 覆盖。

---

## Task 1: Shared contract, schema, feature flag and permissions

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/contract.test.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261122120000_commerce_extension/migration.sql`
- Modify: `apps/api/src/modules/config/config.service.ts`
- Modify: `apps/api/src/modules/config/config.service.spec.ts`
- Modify: `apps/api/src/modules/config/dto/client-config.dto.ts`
- Modify: `apps/api/src/modules/auth/permissions.ts`
- Modify: `apps/api/prisma/seed.ts`

**Interfaces:**
- Produces: `PRODUCT_STATUS`, `PRODUCT_CATEGORY`, `COMMERCE_CHANNEL`, `PURCHASE_ACTION_TYPE`, `PLACEMENT_SCOPE`, `PLACEMENT_SURFACE`; Prisma models `Product`, `ProductChannel`, `ProductPlacement`; `features.shop`; permissions `product:read`, `product:write`.

- [ ] Add the six enum constants to `enums.ts` with values exactly as the spec.
- [ ] Add contract assertions for all six enums in `contract.test.ts`; run `pnpm --filter @szfisher/shared test -- contract.test.ts`, expect PASS.
- [ ] Add the three Prisma models exactly as spec section 6; keep `target_id` nullable; use `String[]` for `fish_keys`; add `@@index([fish_keys], type: Gin)`; both child tables use `onDelete: Cascade`.
- [ ] Run `pnpm --filter @szfisher/api exec prisma migrate dev --name commerce_extension`; confirm the migration contains the three tables, foreign keys and GIN index.
- [ ] Add `features.shop=false` to `DEFAULT_CLIENT_CONFIG`, `CLIENT_CONFIG_WHITELIST`, `FeatureFlagsDto` and the seed rows in `prisma/seed.ts`.
- [ ] Add a config service test: absent value returns `false`; DB value `true` returns `true`.
- [ ] Add `product:read` and `product:write` to `SUPER_ADMIN` and `OPERATOR` in `permissions.ts`; do not add to `REVIEWER`.
- [ ] Run `pnpm --filter @szfisher/api typecheck`; expect PASS.
- [ ] Commit: `feat(commerce): add product schema, flag and permissions`.

## Task 2: Purchase action validation

**Files:**
- Create: `apps/api/src/modules/commerce/dto/purchase-action.dto.ts`
- Create: `apps/api/src/modules/commerce/purchase-action.service.ts`
- Test: `apps/api/src/modules/commerce/purchase-action.service.spec.ts`

**Interfaces:**
- Produces: `PurchaseActionInputDto`, `PurchaseActionDto`; `PurchaseActionService.validate(channel: string, input: PurchaseActionInputDto): PurchaseActionDto`.
- Consumes: `ERROR_CODES.VALIDATION`.

- [ ] Write failing tests for `validate`:
  - accepts `weidian` + `mini_program` with `app_id: 'wx0123456789abcdef'`, `path: '/pages/product/detail?id=1'`, `fallback_url: 'https://weidian.com/item.html?itemID=1'`.
  - accepts `h5` and `copy_link` with `https://` URLs.
  - rejects `app_id` without the `wx` plus 16 hex format.
  - rejects `path` not starting with `/` and path longer than 200.
  - rejects `http://` URLs and URLs longer than 500.
  - rejects `channel='jd'`, `type='qr'` and unknown types with `ERROR_CODES.VALIDATION`.
- [ ] Run `pnpm --filter @szfisher/api test -- purchase-action.service.spec.ts`, expect FAIL.
- [ ] Implement `validate`: channel allowlist `['weidian']`; type allowlist `['mini_program','h5','copy_link']`; return a normalized DTO with only the fields valid for the type. Throw `AppError(ERROR_CODES.VALIDATION, 400, message)`.
- [ ] Run the test again, expect PASS.
- [ ] Commit: `feat(commerce): validate purchase actions`.

## Task 3: Public product endpoint and placement matching

**Files:**
- Create: `apps/api/src/modules/commerce/commerce.module.ts`
- Create: `apps/api/src/modules/commerce/product.controller.ts`
- Create: `apps/api/src/modules/commerce/product.service.ts`
- Create: `apps/api/src/modules/commerce/product.repository.ts`
- Create: `apps/api/src/modules/commerce/placement.service.ts`
- Create: `apps/api/src/modules/commerce/dto/public-product-query.dto.ts`
- Create: `apps/api/src/modules/commerce/dto/product-card.dto.ts`
- Modify: `apps/api/src/modules/storage/local-storage.adapter.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/commerce.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/products`; `ProductService.listPublic(query: PublicProductQueryDto): Promise<ProductCardListDto>`; `PlacementService.match(surface: string, targetId?: string, fishKeys?: string[]): Promise<PlacementMatch[]>`; DTOs `ProductCardListDto`, `ProductCardDto`, `ProductChannelCardDto`, `PurchaseActionDto`.
- Consumes: `ClientConfigService.getClientConfig()`, `StorageService.getPublicUrl(key)`.

- [ ] Write failing e2e tests with direct Prisma seeds:
  - flag off returns `{ items: [] }` with HTTP 200.
  - brand page returns active products sorted by `sort_weight`, filters by `category`, ignores `limit`, caps at 100.
  - `spot_detail` with `scope=spot` returns only the target spot's product.
  - `scope=fish` returns a product for a matching fish key and not for a non-matching spot.
  - product with both a spot placement and a fish placement appears once, spot priority first.
  - draft/archived products, disabled channels, expired placements and `surface=home` are absent.
  - response item has only `product_id`, `title`, `subtitle`, `category`, `image_url`, `channels`; no `status`, `created_at` or `deleted_at`.
- [ ] Run `pnpm --filter @szfisher/api test:e2e -- commerce.e2e-spec.ts`, expect FAIL.
- [ ] Allow `products/{26}/{26}.webp` in `STORAGE_KEY_PATTERN` so public URLs and signed previews accept product keys.
- [ ] Implement query DTO with `surface` in `['spot_detail','brand_page','home','report_detail']`, `target_id` length 26 optional, `fish_keys` comma-separated max 5, `category` in the enum, `limit` 1 to 12.
- [ ] Implement `ProductController.list` with `@ApiClientHeaders()`, `@ApiEnvelopeResponse(ProductCardListDto)`, `Cache-Control: public, max-age=60`.
- [ ] Implement `ProductService.listPublic`: return empty when `features.shop` is false; return empty for `home` and `report_detail`; brand page uses `ProductRepository.listBrandPage(category)`; spot detail requires `target_id`, otherwise throws `AppError(ERROR_CODES.VALIDATION, 400)`, calls `PlacementService.match`, preserves placement order, fetches active products and maps only active channels. `image_url` is the public URL of `cover_image_key` or the first `image_keys`. Channel labels are `weidian` to `微店`, `jd` to `京东`.
- [ ] Implement `PlacementService.match` with `scope=spot` and `scope=fish` OR query, active status and time window; sort spot matches before fish matches, then `sort_order`.
- [ ] Add `afterAll` cleanup deleting placements, channels and products in that order.
- [ ] Run the e2e suite again, expect PASS.
- [ ] Run `pnpm --filter @szfisher/api openapi:generate`; commit generated OpenAPI and api-client changes.
- [ ] Commit: `feat(commerce): add public product endpoint`.

## Task 4: Product image upload and public image route

**Files:**
- Modify: `apps/api/src/modules/uploads/image-processor.service.ts`
- Modify: `apps/api/src/modules/uploads/uploads.public.controller.ts`
- Create: `apps/api/src/modules/commerce/product-image.service.ts`
- Create: `apps/api/src/modules/commerce/admin-product-image.controller.ts`
- Create: `apps/api/src/modules/commerce/dto/product-image-response.dto.ts`
- Test: `apps/api/test/commerce-images.e2e-spec.ts`

**Interfaces:**
- Produces: `ProductImageService.upload(productId: string, file: UploadedImageFile | undefined, admin: AdminContext, request: RequestWithContext): Promise<ProductImageResponseDto>`; `ProductImageService.publishForProduct(productId: string): Promise<void>`.
- Consumes: `ImageProcessorService`, `StorageService`, `AuditLogService`.

- [ ] Write failing e2e tests:
  - upload a PNG to a draft product returns key matching `^products/[A-Za-z0-9]{26}/[A-Za-z0-9]{26}\.webp$`, width and height.
  - `GET` signed preview returns 200 with `image/webp`.
  - `GET /api/v1/uploads/public/products/{id}/{file}` returns 404 before activation.
  - after `publishForProduct`, the public route returns 200; an unknown file returns 404.
  - non-image bytes return 400; over 10 MB returns 413.
  - audit row `product.image_upload` exists and contains key, width, height, size only.
- [ ] Run `pnpm --filter @szfisher/api test:e2e -- commerce-images.e2e-spec.ts`, expect FAIL.
- [ ] Add `'product'` to `ImagePurpose` and `TARGET_BYTES.product = 250 * 1024`.
- [ ] Implement `ProductImageService.upload`: verify product exists and is not archived; validate/process image; store `products/{productId}/{ulid}.webp`; return signed preview; write audit.
- [ ] Implement `publishForProduct`: copy every key in `product.image_keys` from working to published; skip missing keys with a warning.
- [ ] Add `GET uploads/public/products/:productId/:file`: validate ULID and file pattern; read product with `status='active'` and `image_keys has file`; read published object; return `image/webp` with immutable cache.
- [ ] Run the suite again, expect PASS.
- [ ] Commit: `feat(commerce): add product image upload and public route`.

## Task 5: Admin product CRUD

**Files:**
- Create: `apps/api/src/modules/commerce/admin-product.controller.ts`
- Create: `apps/api/src/modules/commerce/dto/admin-product.dto.ts`
- Create: `apps/api/src/modules/commerce/dto/create-product.dto.ts`
- Create: `apps/api/src/modules/commerce/dto/update-product.dto.ts`
- Modify: `apps/api/src/modules/commerce/product.service.ts`
- Test: `apps/api/test/commerce-admin.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/admin/products`, `GET /api/v1/admin/products/:id`, `POST /api/v1/admin/products`, `PUT /api/v1/admin/products/:id`, `POST /api/v1/admin/products/:id/archive`; DTOs `AdminProductListItemDto`, `AdminProductPageDto`, `AdminProductDetailDto`, `AdminProductChannelDto`.
- Consumes: Task 2 `PurchaseActionService.validate`; Task 4 `ProductImageService.publishForProduct`.

- [ ] Write failing e2e tests:
  - reviewer gets 403 on list, create and update; operator and super_admin get 200.
  - create a draft product with one weidian `mini_program` channel; response has `status='draft'` and the channel.
  - update to `active`; public product endpoint returns it.
  - archive; public endpoint no longer returns it.
  - invalid channel, invalid action and empty channels return 400.
  - audit rows `product.create`, `product.update`, `product.archive` exist and contain no description text.
- [ ] Run `pnpm --filter @szfisher/api test:e2e -- commerce-admin.e2e-spec.ts`, expect FAIL.
- [ ] Implement `CreateProductDto`: title 1 to 80, subtitle max 120, description max 2000, category enum, sort_weight int, image_keys array max 9, cover_image_key optional, channels array 1 to 2. Each channel has `channel`, optional `external_product_id`, `purchase_action`, `action_payload`, optional `price_display`, optional `status`. V1 validation allows only one `weidian` channel per product. `UpdateProductDto` is the same with all fields optional and `status` in `['draft','active','archived']`.
- [ ] On update, replace the channel set by upserting each submitted channel and deleting channels that are no longer present. Build the Task 2 input as `{ type: channel.purchase_action, ...channel.action_payload }`. If `cover_image_key` is set, it must be present in `image_keys`.
- [ ] Implement `AdminProductController` with `@Roles(SUPER_ADMIN, OPERATOR)` and `@UseGuards(RolesGuard)`. `AdminProductDetailDto` includes `image_keys`, `image_urls` (signed preview for draft, public URL for active) and `cover_image_url`.
- [ ] Implement `ProductService.create/update/archive/listAdmin/getAdmin`; list query uses `page` default 1, `page_size` default 20 max 50, optional `status`, `category`, `keyword`; validate every channel through `PurchaseActionService.validate`; when status becomes `active`, call `ProductImageService.publishForProduct`.
- [ ] Write audit `product.create`, `product.update`, `product.archive` with title, status, category, channel codes only.
- [ ] Run the suite again, expect PASS.
- [ ] Commit: `feat(commerce): add admin product management`.

## Task 6: Admin placement CRUD

**Files:**
- Create: `apps/api/src/modules/commerce/admin-placement.controller.ts`
- Create: `apps/api/src/modules/commerce/dto/admin-placement.dto.ts`
- Create: `apps/api/src/modules/commerce/dto/create-placement.dto.ts`
- Create: `apps/api/src/modules/commerce/dto/update-placement.dto.ts`
- Modify: `apps/api/src/modules/commerce/placement.service.ts`
- Test: `apps/api/test/commerce-admin.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/admin/product-placements`, `POST /api/v1/admin/product-placements`, `PUT /api/v1/admin/product-placements/:id`, `DELETE /api/v1/admin/product-placements/:id`; DTOs `AdminPlacementItemDto`, `AdminPlacementListDto`.

- [ ] Add failing tests to `commerce-admin.e2e-spec.ts`:
  - `scope=spot` requires `target_id`, rejects non-empty `fish_keys`, and rejects a missing spot with 404.
  - `scope=fish` requires at least one `fish_keys`, rejects `target_id`, and rejects unknown fish keys with 400.
  - reviewer gets 403 on create/update/delete.
  - a spot placement makes the product appear on that spot detail and not on another spot.
  - a fish placement makes it appear on a second spot with that fish.
  - disabled or expired placement is absent from the public response.
  - audit rows `product.placement_create`, `product.placement_update`, `product.placement_delete` exist.
- [ ] Run `pnpm --filter @szfisher/api test:e2e -- commerce-admin.e2e-spec.ts`, expect FAIL.
- [ ] Implement `CreatePlacementDto`: `product_id`, `surface` in `['spot_detail']`, `scope` in `['spot','fish']`, `target_id` optional length 26, `fish_keys` array max 5, `sort_order`, `starts_at`, `ends_at`, `status`.
- [ ] Implement service validation: product exists; spot exists when `scope=spot`; every fish key exists in `dictionary` with `dict_type='fish_type'`; `scope` field combinations exactly as spec.
- [ ] Add `PlacementService.listAdmin/create/update/delete`; list query supports optional `product_id`, `surface`, `status`, `page` default 1 and `page_size` default 20 max 50; write audit rows with product ID, surface, scope, target ID, fish keys only.
- [ ] Run the suite again, expect PASS.
- [ ] Commit: `feat(commerce): add admin placement management`.

## Task 7: Admin product drawer

**Files:**
- Modify: `apps/admin/src/admin/api.ts`
- Create: `apps/admin/src/admin/ProductDrawer.tsx`
- Modify: `apps/admin/src/admin/SpotsWorkspace.tsx`
- Test: `apps/api/test/playwright/commerce.spec.ts`

**Interfaces:**
- Consumes: admin product endpoints from Task 5 and image endpoint from Task 4.
- Produces: `api.listProducts`, `api.getProduct`, `api.createProduct`, `api.updateProduct`, `api.archiveProduct`, `api.uploadProductImage`.

- [ ] Add failing Playwright test. `beforeAll` seeds two published spots: one with `fish_types: ['luofei']` and one with `fish_types: ['jiyu']`.
  - super admin logs in and binds TOTP; clicks 商品; saves a draft product titled `PW-COMMERCE-<timestamp>`, category `hat`, one weidian `copy_link` channel; reopens it, uploads a generated PNG, selects the cover, then publishes.
  - list row shows the product with status 草稿 before publish, then 已发布 after publish.
  - reviewer logs in and does not see the 商品 button.
- [ ] Run `pnpm test:admin apps/api/test/playwright/commerce.spec.ts`, expect FAIL.
- [ ] Run `pnpm --filter @szfisher/api openapi:generate` so the admin types include Task 5 and Task 6 endpoints.
- [ ] Add generated types and API methods to `api.ts`; use `request<T>` and `FormData` for image upload.
- [ ] Build `ProductDrawer.tsx` with a table and an editor drawer: title, subtitle, description, category, sort weight, image upload and cover selection, channel form, save draft, publish, archive. Follow the existing Ant Design drawer patterns and pine/vermilion palette.
- [ ] Add a 商品 button in `SpotsWorkspace.tsx` gated by `permissions?.includes('product:read')`; render `<ProductDrawer>` with the session and reload key.
- [ ] Run the Playwright test again, expect PASS.
- [ ] Run `pnpm --filter @szfisher/admin typecheck`; expect PASS.
- [ ] Commit: `feat(admin): add product management drawer`.

## Task 8: Admin placement panel

**Files:**
- Modify: `apps/admin/src/admin/ProductDrawer.tsx`
- Modify: `apps/admin/src/admin/api.ts`
- Test: `apps/api/test/playwright/commerce.spec.ts`

**Interfaces:**
- Consumes: placement endpoints from Task 6.
- Produces: `api.listPlacements`, `api.createPlacement`, `api.updatePlacement`, `api.deletePlacement`.

- [ ] Add failing Playwright test. `beforeAll` seeds a product with one active `weidian` `copy_link` channel directly in Prisma so the test starts from a known active product.
  - from the product drawer, open 展示位置, create a `scope=spot` placement for a seeded spot, save.
  - request `GET /api/v1/products?surface=spot_detail&target_id=<spot_id>` and assert the product appears.
  - create a `scope=fish` placement for `luofei`; request a second spot with that fish and assert it appears; request a spot without it and assert it does not.
  - delete the spot placement and assert it disappears from the public response.
- [ ] Run `pnpm test:admin apps/api/test/playwright/commerce.spec.ts`, expect FAIL.
- [ ] Add a 展示位置 tab to `ProductDrawer.tsx`: table, create/edit form with product, scope, spot picker, fish multi-select, sort, date range, status.
- [ ] Add API methods and generated types.
- [ ] Run the Playwright test again, expect PASS.
- [ ] Commit: `feat(admin): add product placement management`.

## Task 9: Mini program product card and spot detail section

**Files:**
- Modify: `apps/miniprogram/src/api.ts`
- Create: `apps/miniprogram/src/commerce.ts`
- Create: `apps/miniprogram/src/commerce.test.ts`
- Create: `apps/miniprogram/src/components/product-card/index.ts`
- Create: `apps/miniprogram/src/components/product-card/index.wxml`
- Create: `apps/miniprogram/src/components/product-card/index.wxss`
- Create: `apps/miniprogram/src/components/product-card/index.json`
- Modify: `apps/miniprogram/src/pages/detail/detail.ts`
- Modify: `apps/miniprogram/src/pages/detail/detail.wxml`
- Modify: `apps/miniprogram/src/pages/detail/detail.wxss`
- Modify: `apps/miniprogram/src/pages/detail/detail.json`

**Interfaces:**
- Produces: `fetchProductCards(query: ProductCardQuery): Promise<ProductCardList>`; `loadProductCards(query): Promise<ProductCard[]>`; `openPurchaseAction(action: PurchaseAction): void`; `productCategoryLabel`; component `product-card`.
- Consumes: public product endpoint from Task 3.

- [ ] Write failing `commerce.test.ts` tests with a `wx` mock:
  - `openPurchaseAction` with `mini_program` calls `wx.navigateToMiniProgram` with appId and path.
  - navigate failure with `fallback_url` calls `wx.setClipboardData`.
  - `copy_link` calls `wx.setClipboardData`.
  - `h5` copies the URL and shows a toast.
  - `loadProductCards` returns `[]` when the request rejects.
- [ ] Run `pnpm --filter @szfisher/miniprogram test -- src/commerce.test.ts`, expect FAIL.
- [ ] Add product types and `fetchProductCards` to `api.ts`; use the existing request helper and client headers.
- [ ] Implement `commerce.ts` and the `product-card` component. Card shows cover image, title, subtitle, `参考价` plus price, and channel label. Use `mode="aspectFill"`, 2-column grid, existing palette, no new icon library. The detail section includes the line `价格和售后以微店页面为准`.
- [ ] In `detail.ts`, add `shopEnabled`, `products`, `productsLoading`; read `config.features.shop`; load products after the spot is displayed, with `surface=spot_detail`, `target_id`, `fish_keys=spot.fish_types.join(',')`; failures set `products=[]` and never affect the spot.
- [ ] Add the WXML section before the UGC section, hidden when `products.length === 0`; add `openProduct` and `openShop` handlers; add styles for horizontal cards and the section header.
- [ ] Track `product_impression`, `product_click` and `purchase_action_fail` with product ID, surface, target ID and channel.
- [ ] Run the mini program test and `pnpm --filter @szfisher/miniprogram typecheck`; expect PASS.
- [ ] Commit: `feat(miniprogram): show product cards on spot detail`.

## Task 10: Mini program shop page and profile entry

**Files:**
- Create: `apps/miniprogram/src/pages/shop/index.ts`
- Create: `apps/miniprogram/src/pages/shop/index.wxml`
- Create: `apps/miniprogram/src/pages/shop/index.wxss`
- Create: `apps/miniprogram/src/pages/shop/index.json`
- Modify: `apps/miniprogram/src/app.json`
- Modify: `apps/miniprogram/src/pages/profile/index.ts`
- Modify: `apps/miniprogram/src/pages/profile/index.wxml`
- Modify: `apps/miniprogram/src/pages/profile/index.wxss`
- Test: `apps/miniprogram/src/commerce.test.ts`

**Interfaces:**
- Consumes: Task 9 `fetchProductCards`, `openPurchaseAction`, `productCategoryLabel`.
- Produces: route `pages/shop/index`; profile entry `openShop`.

- [ ] Add a failing test for `productCategoryLabel` mapping all eight categories to the exact labels in spec section 8.2.
- [ ] Run `pnpm --filter @szfisher/miniprogram test -- src/commerce.test.ts`, expect FAIL.
- [ ] Implement the shop page: brand header `UniHuan 钓具`, short intro, category chips, 2-column product grid, footer `商品由 UniHuan 微店提供，价格和售后以微店页面为准`. Register the `product-card` component in `index.json`.
- [ ] On load, read `features.shop`; when false show `暂未开放`; when true fetch `surface=brand_page` with the selected category.
- [ ] Add `pages/shop/index` to `app.json`.
- [ ] In the profile page, add `shopEnabled` from config and a `UniHuan 装备` card. Place it before the existing `wx:elif="{{!ugcEnabled}}"` chain so it stays visible when UGC is off; tapping navigates to the shop page.
- [ ] Run mini program tests and typecheck; expect PASS.
- [ ] Commit: `feat(miniprogram): add UniHuan shop page`.

## Task 11: Analytics, OpenAPI, documentation and full verification

**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.interceptor.ts`
- Modify: `apps/api/src/modules/analytics/analytics.service.ts`
- Test: `apps/api/test/analytics.e2e-spec.ts`
- Modify: `docs/ops/deployment.md`
- Modify: `docs/ops/admin-guide.md`
- Modify: generated `openapi/openapi.yaml`
- Modify: generated `packages/api-client/src/schema.d.ts`

**Interfaces:**
- Produces: `api_product_list` analytics event with `surface`, `result_count`, `spot_id`; deployment and admin docs for `features.shop`.

- [ ] Add a failing analytics e2e test: request `GET /api/v1/products?surface=spot_detail&target_id=<spot_id>` and assert an `api_product_list` row with `surface='spot_detail'`, `result_count` and `spot_id`.
- [ ] Run `pnpm --filter @szfisher/api test:e2e -- analytics.e2e-spec.ts`, expect FAIL.
- [ ] Extend `AnalyticsInterceptor` to detect `/api/v1/products`, read `request.query.surface`, `request.query.target_id` and payload `items.length`, and record `api_product_list`.
- [ ] Add `'api_product_list'` to `SERVER_ANALYTICS_EVENTS` and `'surface'` to `ALLOWED_PROPERTIES`; keep `spot_id` and `result_count`.
- [ ] Run the test again, expect PASS.
- [ ] Update `docs/ops/deployment.md` with `features.shop` seed/rollback SQL and product image bucket notes.
- [ ] Update `docs/ops/admin-guide.md` with product, channel, placement and image operations, including the rule that V1 only supports 微店.
- [ ] Run `pnpm --filter @szfisher/api openapi:generate`, then `pnpm openapi:check`.
- [ ] Run the full gate:
  - `pnpm -r lint`
  - `pnpm -r typecheck`
  - `pnpm -r test`
  - `pnpm --filter @szfisher/api test:e2e`
  - `pnpm --filter @szfisher/admin build`
  - `pnpm test:admin apps/api/test/playwright/commerce.spec.ts`
- [ ] Commit: `feat(commerce): complete Phase 1 commerce extension`.

## Phase 1 acceptance

- 后台能创建商品、配置微店购买动作、上传图片并发布。
- 钓点详情按钓点和鱼种显示商品，点击后能打开微店入口或复制链接。
- 品牌页能按分类浏览 active 商品，最多 100 个。
- `features.shop=false` 时所有商品入口消失，钓点详情和情报不受影响。
- 公共接口、后台接口、权限、审计、图片隔离、OpenAPI 和全部测试通过。
