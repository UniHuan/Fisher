import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import ExcelJS from 'exceljs';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { generateSync } from 'otplib';
import { ulid } from 'ulid';
import { IMPORT_COLUMNS } from '../../src/modules/imports/import.constants';

const TEST_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
const SPOT_PREFIX = `PW-UI-${Date.now()}`;
const POI_PREFIX = `PW-POI-${Date.now()}`;
const IMPORT_PREFIX = `PW-IMPORT-${Date.now()}`;
const IMPORT_FIXTURE = path.resolve('test-results/playwright-import.xlsx');
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

async function expectSuccessMessage(page: Page, text: string): Promise<void> {
  await expect(
    page.locator('.ant-message-notice-title').filter({ hasText: text }).first(),
  ).toBeVisible();
}

async function cleanupTestData(): Promise<void> {
  const spots = await prisma.spot.findMany({
    where: {
      OR: [
        { spot_name: { startsWith: SPOT_PREFIX } },
        { spot_name: { startsWith: IMPORT_PREFIX } },
      ],
    },
    select: { spot_id: true },
  });
  const spotIds = spots.map((spot) => spot.spot_id);
  if (spotIds.length > 0) {
    await prisma.spotPoi.deleteMany({ where: { spot_id: { in: spotIds } } });
    await prisma.poiSyncRun.deleteMany({ where: { spot_id: { in: spotIds } } });
    await prisma.spot.deleteMany({ where: { spot_id: { in: spotIds } } });
  }
  await prisma.poi.deleteMany({ where: { poi_name: { startsWith: POI_PREFIX } } });
  rmSync('/tmp/szfisher-playwright-storage', { recursive: true, force: true });
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
  mkdirSync(path.dirname(IMPORT_FIXTURE), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('钓点导入');
  sheet.addRow(IMPORT_COLUMNS.map((column) => column.label));
  const importRow: Record<string, string> = {
    spot_name: `${IMPORT_PREFIX}批量钓点`,
    district: '南山区',
    address: '深圳市南山区Playwright导入地址',
    latitude: '22.518000',
    longitude: '113.953000',
    nav_latitude: '22.518000',
    nav_longitude: '113.953000',
    fish_types: '罗非',
    fee_status: '免费',
    water_type: '海域',
    venue_type: '野钓',
    open_status: '开放',
    source: '运营',
    verified_at: '2026-11-17',
    sort_weight: '10',
    is_core: '否',
  };
  sheet.addRow(IMPORT_COLUMNS.map((column) => importRow[column.key] ?? ''));
  await workbook.xlsx.writeFile(IMPORT_FIXTURE);

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
  await page.locator('.editor-footer button').filter({ hasText: '保 存' }).click();
  await expectSuccessMessage(page, '已保存');

  await page.locator('input[type=file]').setInputFiles(
    path.resolve('apps/miniprogram/src/assets/pin.png'),
  );
  await expectSuccessMessage(page, '图片已上传，保存后生效');
  await expect(page.locator('.image-tile')).toHaveCount(1);
  const uploadedImage = page.locator('.image-tile img').first();
  await expect(uploadedImage).toBeVisible();
  await uploadedImage.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => uploadedImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.locator('.editor-footer button').filter({ hasText: '保 存' }).click();
  await expectSuccessMessage(page, '已保存');

  await page.getByRole('button', { name: '标记核实', exact: true }).click();
  await page
    .locator('.ant-modal')
    .getByRole('button', { name: '确认核实', exact: true })
    .click();
  await expectSuccessMessage(page, '已标记核实');
  await expect(page.locator('.ant-modal-wrap:visible')).toHaveCount(0);

  await page.locator('.editor-footer button.ant-btn-primary').click();
  await expectSuccessMessage(page, '钓点已发布');
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
  await expectSuccessMessage(page, 'POI 已新增并绑定');
  await expect(page.getByText(`${POI_PREFIX}停车场`)).toBeVisible();
  await page.locator('.ant-drawer-close').last().click();

  await page.getByRole('button', { name: /^字\s*典$/ }).click();
  await expect(page.getByText('字典维护')).toBeVisible();
  await page.locator('.ant-drawer-close').last().click();

  await page.getByRole('button', { name: /^审\s*计$/ }).click();
  await expect(page.getByText('审计日志')).toBeVisible();
  await expect(page.getByText('spot.publish').first()).toBeVisible();
  await page.locator('.ant-drawer-close').last().click();

  await page.getByRole('button', { name: 'Excel 导入' }).click();
  await page.locator('input[type=file]').last().setInputFiles(IMPORT_FIXTURE);
  await page.getByRole('button', { name: '开始导入' }).click();
  await expect(
    page.getByText('全部行已处理，成功行已创建为草稿'),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^关\s*闭$/ }).last().click();

  await page.reload();
  const publishedRow = page.locator('.ant-table-row').filter({ hasText: SPOT_PREFIX });
  await expect(publishedRow).toBeVisible();
  await publishedRow.getByRole('button', { name: /^下\s*线$/ }).click();
  await page
    .locator('.ant-modal')
    .getByRole('button', { name: /^下\s*线$/ })
    .click();
  await expectSuccessMessage(page, '钓点已下线');
});
