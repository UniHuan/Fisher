import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateSync } from 'otplib';
import sharp from 'sharp';
import { ulid } from 'ulid';

const TEST_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
const STORAGE_ROOT = '/tmp/szfisher-playwright-storage';
const PREFIX = `PW-COMMERCE-${Date.now()}`;
const PRODUCT_TITLE = PREFIX;
const PLACEMENT_PRODUCT_TITLE = `PW-PLACEMENT-${Date.now()} 展示商品`;
const LUOFEI_SPOT_NAME = `${PREFIX} 罗非钓点`;
const JIYU_SPOT_NAME = `${PREFIX} 鲷鱼钓点`;
const IMAGE_DIR = path.resolve('test-results/playwright-commerce');
const IMAGE_PATH = path.join(IMAGE_DIR, 'product.png');
const PRODUCT_URL = 'https://weidian.com/item.html?itemID=10001';
const API_ORIGIN = 'http://localhost:3011';
const PUBLIC_CLIENT_HEADERS = {
  'X-Client-Type': 'miniprogram',
  'X-Client-Version': '1.0.0',
} as const;

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

interface RoleAccount {
  username: string;
  password: string;
  totpSecret?: string;
}

let superAdminAccount: RoleAccount;
let reviewerAccount: RoleAccount;
let superAdminId = '';
let reviewerId = '';

// Task 8 placement tests reuse these published spots and their fish keys.
let luofeiSpotId = '';
let jiyuSpotId = '';
let placementProductId = '';
let shopFlagBefore = 'false';

async function createRoleAccount(role: 'super_admin' | 'reviewer'): Promise<RoleAccount> {
  const username = `pw_commerce_${role}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const password = `Playwright-${role}-${Date.now()}-Strong!`;
  const admin = await prisma.adminUser.create({
    data: {
      admin_id: ulid(),
      username,
      password_hash: await hash(password, { type: argon2id }),
      role,
      status: 'active',
    },
  });
  if (role === 'super_admin') {
    superAdminId = admin.admin_id;
  } else {
    reviewerId = admin.admin_id;
  }
  return { username, password };
}

/**
 * The admin login limiter is 5 attempts per IP per fixed minute and lives in
 * Postgres. Reset it so logins in this file do not depend on other specs.
 */
async function resetAdminLoginLimit(): Promise<void> {
  await prisma.rateLimitCounter.deleteMany({
    where: { counter_key: { startsWith: 'admin-login:' } },
  });
}

async function expectSuccessMessage(page: Page, text: string): Promise<void> {
  await expect(
    page.locator('.ant-message-notice-title').filter({ hasText: text }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

async function selectOption(
  page: Page,
  label: string,
  option: string,
  scope?: Locator,
): Promise<void> {
  const field = (scope ?? page).getByLabel(label, { exact: true });
  await field.click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText(option, { exact: true })
    .last()
    .click();
}

async function selectMultipleOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  const optionLocator = page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option })
    .first();
  // Multi-select dropdowns can render outside the viewport. Dispatch the DOM
  // click directly so the Ant Design option handler runs without Playwright's
  // viewport actionability check.
  await optionLocator.evaluate((element) => (element as HTMLElement).click());
  await page.keyboard.press('Escape');
}

async function fetchPublicProductIds(
  request: APIRequestContext,
  query: string,
): Promise<string[]> {
  const response = await request.get(`${API_ORIGIN}/api/v1/products?${query}`, {
    headers: PUBLIC_CLIENT_HEADERS,
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    data: { items: Array<{ product_id: string }> };
  };
  return payload.data.items.map((item) => item.product_id);
}

async function loginWithPassword(page: Page, account: RoleAccount): Promise<void> {
  await resetAdminLoginLimit();
  await page.goto('/');
  await page.getByLabel('账号').fill(account.username);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();

  if (account.totpSecret === undefined) {
    await expect(page.getByText('首次登录需要绑定 TOTP')).toBeVisible();
    const manualKey = await page.locator('.manual-key').innerText();
    const secret = manualKey.match(/[A-Z2-7]{16,}/)?.[0];
    expect(secret).toBeTruthy();
    const totpSecret = secret as string;
    account.totpSecret = totpSecret;
    await page.getByLabel('动态码').fill(generateSync({ secret: totpSecret }));
    await page.getByRole('button', { name: '完成绑定' }).click();
    await expect(page.getByText('TOTP 已绑定')).toBeVisible();
    await page.getByRole('button', { name: '我已保存，进入后台' }).click();
    return;
  }

  await expect(page.getByText('请输入认证器中的 6 位动态码')).toBeVisible();
  await page.getByLabel('动态码').fill(generateSync({ secret: account.totpSecret }));
  await page.getByRole('button', { name: '验证并进入' }).click();
}

test.beforeAll(async () => {
  const dictionaryCount = await prisma.dictionary.count();
  if (dictionaryCount === 0) {
    throw new Error('Playwright database is not seeded; run pnpm db:test:prepare first');
  }

  mkdirSync(IMAGE_DIR, { recursive: true });
  const png = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 30, g: 107, b: 87 },
    },
  })
    .png()
    .toBuffer();
  writeFileSync(IMAGE_PATH, png);

  superAdminAccount = await createRoleAccount('super_admin');
  reviewerAccount = await createRoleAccount('reviewer');

  const luofeiSpot = await prisma.spot.create({
    data: {
      spot_id: ulid(),
      spot_name: LUOFEI_SPOT_NAME,
      district: '南山区',
      address: '深圳市南山区Playwright商品罗非钓点',
      latitude: '22.518000',
      longitude: '113.953000',
      nav_latitude: '22.518000',
      nav_longitude: '113.953000',
      fish_types: ['luofei'],
      fee_status: 'free',
      water_type: 'sea',
      venue_type: 'wild',
      open_status: 'open',
      status: 'published',
      source: 'operation',
    },
  });
  luofeiSpotId = luofeiSpot.spot_id;

  const jiyuSpot = await prisma.spot.create({
    data: {
      spot_id: ulid(),
      spot_name: JIYU_SPOT_NAME,
      district: '南山区',
      address: '深圳市南山区Playwright商品鲷鱼钓点',
      latitude: '22.519000',
      longitude: '113.954000',
      nav_latitude: '22.519000',
      nav_longitude: '113.954000',
      fish_types: ['jiyu'],
      fee_status: 'free',
      water_type: 'sea',
      venue_type: 'wild',
      open_status: 'open',
      status: 'published',
      source: 'operation',
    },
  });
  jiyuSpotId = jiyuSpot.spot_id;

  // The public product endpoint returns an empty list while features.shop is off.
  const shopFlag = await prisma.config.findUnique({
    where: { config_key: 'features.shop' },
  });
  shopFlagBefore = shopFlag?.config_value ?? 'false';
  await prisma.config.upsert({
    where: { config_key: 'features.shop' },
    create: {
      config_key: 'features.shop',
      config_value: 'true',
      description: 'V2 商品展示开关',
    },
    update: { config_value: 'true' },
  });

  // Placement tests start from a known active product with a usable channel.
  const placementProduct = await prisma.product.create({
    data: {
      product_id: ulid(),
      title: PLACEMENT_PRODUCT_TITLE,
      category: 'rod',
      status: 'active',
      sort_weight: 0,
      channels: {
        create: [
          {
            channel_id: ulid(),
            channel: 'weidian',
            purchase_action: 'copy_link',
            action_payload: { url: PRODUCT_URL },
            status: 'active',
          },
        ],
      },
    },
  });
  placementProductId = placementProduct.product_id;
});

test.afterAll(async () => {
  if (placementProductId !== '') {
    await prisma.productPlacement.deleteMany({
      where: { product_id: placementProductId },
    });
    await prisma.product.deleteMany({ where: { product_id: placementProductId } });
  }
  const products = await prisma.product.findMany({
    where: { title: { startsWith: PREFIX } },
    select: { product_id: true },
  });
  const productIds = products.map((product) => product.product_id);
  if (productIds.length > 0) {
    await prisma.product.deleteMany({ where: { product_id: { in: productIds } } });
    for (const productId of productIds) {
      rmSync(path.join(STORAGE_ROOT, 'working', 'products', productId), {
        recursive: true,
        force: true,
      });
      rmSync(path.join(STORAGE_ROOT, 'published', 'products', productId), {
        recursive: true,
        force: true,
      });
    }
  }
  rmSync(IMAGE_DIR, { recursive: true, force: true });

  const spotIds = [luofeiSpotId, jiyuSpotId].filter((value) => value !== '');
  if (spotIds.length > 0) {
    await prisma.spot.deleteMany({ where: { spot_id: { in: spotIds } } });
  }

  const adminIds = [superAdminId, reviewerId].filter((value) => value !== '');
  if (adminIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { admin_id: { in: adminIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { actor_id: { in: adminIds } } });
    await prisma.adminUser.deleteMany({ where: { admin_id: { in: adminIds } } });
  }
  await prisma.config.upsert({
    where: { config_key: 'features.shop' },
    create: {
      config_key: 'features.shop',
      config_value: shopFlagBefore,
      description: 'V2 商品展示开关',
    },
    update: { config_value: shopFlagBefore },
  });
  await prisma.$disconnect();
});

test('super admin drafts, illustrates and publishes a product', async ({ page }) => {
  test.setTimeout(150_000);
  await loginWithPassword(page, superAdminAccount);
  await expect(page.getByRole('heading', { name: '钓点库' })).toBeVisible();

  await page.getByRole('button', { name: /^商\s*品$/ }).click();
  await expect(page.getByText('商品管理')).toBeVisible();
  await page.getByRole('button', { name: '新增商品' }).click();
  await expect(page.getByText('新增商品').last()).toBeVisible();

  await page.getByLabel('商品名称').fill(PRODUCT_TITLE);
  await selectOption(page, '分类', '帽子');
  await selectOption(page, '购买方式', '复制链接');
  await page.getByLabel('商品链接').fill(PRODUCT_URL);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expectSuccessMessage(page, '草稿已保存');

  await page.getByRole('button', { name: /^关\s*闭$/ }).click();
  const productRows = page.locator('.ant-drawer:visible .ant-table-row');
  const draftRow = productRows.filter({ hasText: PRODUCT_TITLE });
  await expect(draftRow).toBeVisible();
  await expect(draftRow.locator('.ant-tag').filter({ hasText: '草稿' })).toBeVisible();

  await draftRow.getByRole('button', { name: /^编\s*辑$/ }).click();
  await expect(page.getByLabel('商品名称')).toHaveValue(PRODUCT_TITLE);
  await page.locator('input[type=file]').setInputFiles(IMAGE_PATH);
  await expectSuccessMessage(page, '图片已上传，请保存');
  await page.getByRole('button', { name: '设为封面' }).click();
  await page
    .locator('.ant-drawer:visible')
    .last()
    .getByRole('button', { name: /^发\s*布$/ })
    .click();
  await expectSuccessMessage(page, '商品已发布');

  await page.getByRole('button', { name: /^关\s*闭$/ }).click();
  const publishedRow = productRows.filter({ hasText: PRODUCT_TITLE });
  await expect(publishedRow).toBeVisible();
  await expect(publishedRow.locator('.ant-tag').filter({ hasText: '已发布' })).toBeVisible();
});

test('reviewer does not see the product entry', async ({ page }) => {
  await loginWithPassword(page, reviewerAccount);
  await expect(page.getByRole('heading', { name: '钓点库' })).toBeVisible();
  // Wait for the permission-driven header to settle before asserting absence.
  await expect(page.getByRole('button', { name: '体验反馈' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^商\s*品$/ })).toHaveCount(0);
});

test('super admin manages placements and public products follow them', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await loginWithPassword(page, superAdminAccount);
  await expect(page.getByRole('heading', { name: '钓点库' })).toBeVisible();

  await page.getByRole('button', { name: /^商\s*品$/ }).click();
  await expect(page.getByText('商品管理')).toBeVisible();
  await page.getByRole('tab', { name: '展示位置' }).click();
  await expect(page.getByRole('button', { name: '新增展示位置' })).toBeVisible();

  const drawer = page.locator('.ant-drawer:visible').first();
  const jiyuQuery = `surface=spot_detail&target_id=${jiyuSpotId}`;
  const luofeiQuery = `surface=spot_detail&target_id=${luofeiSpotId}`;
  const luofeiFishQuery = `${luofeiQuery}&fish_keys=luofei`;
  const jiyuFishQuery = `${jiyuQuery}&fish_keys=jiyu`;

  const createFishPlacement = async (
    status: string,
    endsAt: string | undefined,
  ): Promise<void> => {
    await page.getByRole('button', { name: '新增展示位置' }).click();
    await expect(page.getByLabel('关联商品')).toBeVisible();
    await selectOption(page, '关联商品', PLACEMENT_PRODUCT_TITLE);
    await selectOption(page, '范围', '按鱼种');
    await selectMultipleOption(page, '鱼种', '罗非');
    await selectOption(page, '状态', status);
    if (endsAt !== undefined) {
      await page.getByLabel('生效结束').fill(endsAt);
    }
    await page.getByRole('button', { name: /^保\s*存$/ }).click();
    await expectSuccessMessage(page, '展示位置已创建');
  };

  // One disabled and one expired fish placement must both stay hidden.
  await createFishPlacement('停用', undefined);
  await createFishPlacement('启用', '2020-01-01T00:00');

  expect(await fetchPublicProductIds(request, luofeiFishQuery)).not.toContain(
    placementProductId,
  );
  expect(await fetchPublicProductIds(request, jiyuFishQuery)).not.toContain(
    placementProductId,
  );

  // Re-enabling the fish placement surfaces it on a spot with luofei.
  const disabledRow = drawer
    .locator('.ant-table-row')
    .filter({ hasText: '按鱼种' })
    .filter({ hasText: '停用' });
  await disabledRow.getByRole('button', { name: /^编\s*辑$/ }).click();
  await selectOption(page, '状态', '启用');
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expectSuccessMessage(page, '展示位置已保存');
  expect(await fetchPublicProductIds(request, luofeiFishQuery)).toContain(
    placementProductId,
  );

  // Spot placement on the jiyu spot surfaces there and nowhere else.
  await page.getByRole('button', { name: '新增展示位置' }).click();
  await expect(page.getByLabel('关联商品')).toBeVisible();
  await selectOption(page, '关联商品', PLACEMENT_PRODUCT_TITLE);
  await selectOption(page, '范围', '单个钓点');
  await selectOption(page, '钓点', JIYU_SPOT_NAME);
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expectSuccessMessage(page, '展示位置已创建');

  expect(await fetchPublicProductIds(request, jiyuQuery)).toContain(
    placementProductId,
  );
  expect(await fetchPublicProductIds(request, luofeiQuery)).not.toContain(
    placementProductId,
  );

  // Deleting the active fish placement leaves only the expired row, hidden.
  const activeFishRow = drawer
    .locator('.ant-table-row')
    .filter({ hasText: '按鱼种' })
    .filter({ hasText: '长期' });
  await activeFishRow.getByRole('button', { name: /^删\s*除$/ }).click();
  await page
    .locator('.ant-modal:visible')
    .getByRole('button', { name: /^删\s*除$/ })
    .click();
  await expectSuccessMessage(page, '展示位置已删除');
  expect(await fetchPublicProductIds(request, luofeiFishQuery)).not.toContain(
    placementProductId,
  );

  // Deleting the spot placement drops the product from its spot response.
  const spotRow = drawer.locator('.ant-table-row').filter({ hasText: '单个钓点' });
  await spotRow.getByRole('button', { name: /^删\s*除$/ }).click();
  await page
    .locator('.ant-modal:visible')
    .getByRole('button', { name: /^删\s*除$/ })
    .click();
  await expectSuccessMessage(page, '展示位置已删除');
  expect(await fetchPublicProductIds(request, jiyuQuery)).not.toContain(
    placementProductId,
  );
});
