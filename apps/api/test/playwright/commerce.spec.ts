import { test, expect, type Locator, type Page } from '@playwright/test';
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
const LUOFEI_SPOT_NAME = `${PREFIX} 罗非钓点`;
const JIYU_SPOT_NAME = `${PREFIX} 鲷鱼钓点`;
const IMAGE_DIR = path.resolve('test-results/playwright-commerce');
const IMAGE_PATH = path.join(IMAGE_DIR, 'product.png');
const PRODUCT_URL = 'https://weidian.com/item.html?itemID=10001';

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
  const field = (scope ?? page).getByLabel(label);
  await field.click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText(option, { exact: true })
    .last()
    .click();
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
});

test.afterAll(async () => {
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
