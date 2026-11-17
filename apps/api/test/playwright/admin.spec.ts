import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { generateSync } from 'otplib';
import { ulid } from 'ulid';

const TEST_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
const SPOT_PREFIX = `PW-UI-${Date.now()}`;
const POI_PREFIX = `PW-POI-${Date.now()}`;
const USERNAME = `pw_admin_${Date.now()}`;
const PASSWORD = `Playwright-${Date.now()}-Strong!`;
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
let adminId = '';

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

async function selectMultiple(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option })
    .first()
    .click({ force: true });
  await page.keyboard.press('Escape');
}

async function cleanupTestData(): Promise<void> {
  const spots = await prisma.spot.findMany({
    where: { spot_name: { startsWith: SPOT_PREFIX } },
    select: { spot_id: true },
  });
  const spotIds = spots.map((spot) => spot.spot_id);
  if (spotIds.length > 0) {
    await prisma.spotPoi.deleteMany({ where: { spot_id: { in: spotIds } } });
    await prisma.poiSyncRun.deleteMany({ where: { spot_id: { in: spotIds } } });
    await prisma.spot.deleteMany({ where: { spot_id: { in: spotIds } } });
  }
  await prisma.poi.deleteMany({ where: { poi_name: { startsWith: POI_PREFIX } } });
  if (adminId !== '') {
    await prisma.auditLog.deleteMany({ where: { admin_id: adminId } });
    await prisma.idempotencyKey.deleteMany({ where: { actor_id: adminId } });
    await prisma.importJob.deleteMany({ where: { admin_id: adminId } });
    await prisma.adminUser.deleteMany({ where: { admin_id: adminId } });
  }
}

test.beforeAll(async () => {
  const dictionaryCount = await prisma.dictionary.count();
  if (dictionaryCount === 0) {
    throw new Error('Playwright database is not seeded; run pnpm db:test:prepare first');
  }
  const admin = await prisma.adminUser.create({
    data: {
      admin_id: ulid(),
      username: USERNAME,
      password_hash: await hash(PASSWORD, { type: argon2id }),
      role: 'super_admin',
      status: 'active',
    },
  });
  adminId = admin.admin_id;
});

test.afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

test('super admin can bind TOTP, create, publish and manage a spot', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByLabel('账号').fill(USERNAME);
  await page.getByLabel('密码').fill(PASSWORD);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();

  await expect(page.getByText('首次登录需要绑定 TOTP')).toBeVisible();
  const manualKey = await page.locator('.manual-key').innerText();
  const secret = manualKey.match(/[A-Z2-7]{16,}/)?.[0];
  expect(secret).toBeTruthy();
  await page.getByLabel('动态码').fill(generateSync({ secret: secret as string }));
  await page.getByRole('button', { name: '完成绑定' }).click();
  await expect(page.getByText('TOTP 已绑定')).toBeVisible();
  await page.getByRole('button', { name: '我已保存，进入后台' }).click();
  await expect(page.getByRole('heading', { name: '钓点库' })).toBeVisible();

  await page.getByRole('button', { name: '新增钓点' }).click();
  await expect(page.getByText('新增钓点').last()).toBeVisible();
  await page.getByLabel('钓点名称').fill(SPOT_PREFIX);
  await selectOption(page, '所属区域', '南山区');
  await page.getByLabel('地址').fill('深圳市南山区Playwright测试地址');
  await page.getByLabel('钓点纬度').fill('22.517600');
  await page.getByLabel('钓点经度').fill('113.952300');
  await page.getByLabel('导航纬度').fill('22.517600');
  await page.getByLabel('导航经度').fill('113.952300');
  await selectMultiple(page, '可钓鱼种', '罗非');
  await selectOption(page, '收费状态', '免费');
  await selectOption(page, '水域类型', '海域');
  await selectOption(page, '场所类型', '野钓');
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(page.getByText('已保存')).toBeVisible();

  await page.getByRole('button', { name: '标记核实', exact: true }).click();
  await page
    .locator('.ant-modal')
    .getByRole('button', { name: '确认核实', exact: true })
    .click();
  await expect(page.getByText('已标记核实')).toBeVisible();
  await expect(page.locator('.ant-modal-wrap:visible')).toHaveCount(0);

  await page.locator('.editor-footer button.ant-btn-primary').click();
  await expect(page.getByText('钓点已发布')).toBeVisible();
  await page.getByRole('button', { name: /^关\s*闭$/ }).click();

  const row = page.locator('.ant-table-row').filter({ hasText: SPOT_PREFIX });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^周\s*边$/ }).click();
  await expect(page.getByText(/周边场所/).last()).toBeVisible();
  await page.getByRole('button', { name: '新增 POI' }).click();
  const poiModal = page.locator('.ant-modal:visible');
  await poiModal.getByLabel('场所名称').fill(`${POI_PREFIX}停车场`);
  await selectOption(page, '场所类型', '停车', poiModal);
  await poiModal.getByPlaceholder('选填').fill('深圳市南山区测试停车场');
  await poiModal.getByRole('button', { name: '保存并绑定' }).click();
  await expect(page.getByText('POI 已新增并绑定')).toBeVisible();
  await expect(page.getByText(`${POI_PREFIX}停车场`)).toBeVisible();
  await page.locator('.ant-drawer-close').last().click();

  await page.getByRole('button', { name: /^字\s*典$/ }).click();
  await expect(page.getByText('字典维护')).toBeVisible();
  await page.locator('.ant-drawer-close').last().click();

  await page.getByRole('button', { name: /^审\s*计$/ }).click();
  await expect(page.getByText('审计日志')).toBeVisible();
  await expect(page.getByText('spot.publish').first()).toBeVisible();
  await page.locator('.ant-drawer-close').last().click();

  await page.reload();
  const publishedRow = page.locator('.ant-table-row').filter({ hasText: SPOT_PREFIX });
  await expect(publishedRow).toBeVisible();
  await publishedRow.getByRole('button', { name: /^下\s*线$/ }).click();
  await page
    .locator('.ant-modal')
    .getByRole('button', { name: /^下\s*线$/ })
    .click();
  await expect(page.getByText('钓点已下线')).toBeVisible();
});
