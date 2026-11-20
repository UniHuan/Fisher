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
const PREFIX = `PW-UGC-${Date.now()}`;
const SPOT_NAME = `${PREFIX} 钓点`;
const APPROVE_CONTENT = `${PREFIX} 待通过评论`;
const REJECT_CONTENT = `${PREFIX} 待驳回评论`;
const OPERATOR_CONTENT = `${PREFIX} 运营可见内容`;
const REVIEWER_CONTENT = `${PREFIX} 审核员可见内容`;

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

interface RoleAccount {
  username: string;
  password: string;
  totpSecret?: string;
}

let reviewerAccount: RoleAccount;
let operatorAccount: RoleAccount;
let authorId = '';
let spotId = '';
let decoySpotId = '';
const reportIds: string[] = [];
const decoyReportIds: string[] = [];
const imagePaths: string[] = [];
const adminIds: string[] = [];
let ugcFeatureBefore = 'false';

async function createRoleAccount(role: 'operator' | 'reviewer'): Promise<RoleAccount> {
  const username = `pw_ugc_${role}_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
  adminIds.push(admin.admin_id);
  return { username, password };
}

/**
 * The admin login limiter is 5 attempts per IP per fixed minute and lives in
 * Postgres, so attempts from an earlier spec or an earlier Playwright run leak
 * into this file's window. The API e2e suites reset the same counters between
 * tests; mirror that here so role logins are deterministic.
 */
async function resetAdminLoginLimit(): Promise<void> {
  await prisma.rateLimitCounter.deleteMany({
    where: { counter_key: { startsWith: 'admin-login:' } },
  });
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

async function openModeration(page: Page, content: string): Promise<Locator> {
  await page.getByRole('button', { name: '内容审核', exact: true }).click();
  await expect(page.getByRole('tab', { name: /待抽查/ })).toBeVisible();
  const spotInput = page.getByPlaceholder('钓点名称或 ID');
  await spotInput.fill(SPOT_NAME);
  await spotInput.press('Enter');
  const row = page.locator('.ant-table-row').filter({ hasText: content });
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

async function seedReport(input: {
  content: string;
  image?: boolean;
  contentType?: string;
}): Promise<string> {
  const id = ulid();
  const images: string[] = [];
  if (input.image === true) {
    const file = `${ulid()}.webp`;
    const buffer = await sharp({
      create: {
        width: 16,
        height: 12,
        channels: 3,
        background: { r: 24, g: 120, b: 84 },
      },
    })
      .webp()
      .toBuffer();
    const target = path.join(STORAGE_ROOT, 'published', 'ugc', id, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, buffer);
    imagePaths.push(path.dirname(target));
    images.push(`ugc/${id}/${file}`);
  }
  await prisma.report.create({
    data: {
      report_id: id,
      user_id: authorId,
      spot_id: spotId,
      content_type: input.contentType ?? 'comment',
      content: input.content,
      images,
      moderation_status: 'published',
      machine_result: { suggest: 'pass', label: 100, trace_id: `pw-${id}` },
    },
  });
  reportIds.push(id);
  return id;
}

test.beforeAll(async () => {
  const dictionaryCount = await prisma.dictionary.count();
  if (dictionaryCount === 0) {
    throw new Error('Playwright database is not seeded; run pnpm db:test:prepare first');
  }

  reviewerAccount = await createRoleAccount('reviewer');
  operatorAccount = await createRoleAccount('operator');

  const feature = await prisma.config.findUnique({ where: { config_key: 'features.ugc' } });
  ugcFeatureBefore = feature?.config_value ?? 'false';
  await prisma.config.upsert({
    where: { config_key: 'features.ugc' },
    create: {
      config_key: 'features.ugc',
      config_value: 'true',
      description: 'V1.1 钓友情报开关',
    },
    update: { config_value: 'true' },
  });

  const author = await prisma.appUser.create({
    data: {
      user_id: ulid(),
      nickname: `${PREFIX} 作者`,
      status: 'active',
    },
  });
  authorId = author.user_id;

  const spot = await prisma.spot.create({
    data: {
      spot_id: ulid(),
      spot_name: SPOT_NAME,
      district: '南山区',
      address: '深圳市南山区Playwright内容审核地址',
      latitude: '22.518000',
      longitude: '113.953000',
      nav_latitude: '22.518000',
      nav_longitude: '113.953000',
      fish_types: ['罗非'],
      fee_status: 'free',
      water_type: 'sea',
      venue_type: 'wild',
      open_status: 'open',
      status: 'published',
      source: 'operation',
    },
  });
  spotId = spot.spot_id;

  // Twenty older published reports on another spot fill the unfiltered first
  // page. The spot name filter must be applied by the server before paging,
  // otherwise the rows below are invisible.
  const decoySpot = await prisma.spot.create({
    data: {
      spot_id: ulid(),
      spot_name: `${PREFIX} 干扰钓点`,
      district: '南山区',
      address: '深圳市南山区Playwright干扰地址',
      latitude: '22.519000',
      longitude: '113.954000',
      nav_latitude: '22.519000',
      nav_longitude: '113.954000',
      fish_types: ['罗非'],
      fee_status: 'free',
      water_type: 'sea',
      venue_type: 'wild',
      open_status: 'open',
      status: 'published',
      source: 'operation',
    },
  });
  decoySpotId = decoySpot.spot_id;
  const oldCreatedAt = Date.now() - 48 * 60 * 60 * 1000;
  const decoys = Array.from({ length: 20 }, (_value, index) => ({
    report_id: ulid(),
    user_id: authorId,
    spot_id: decoySpotId,
    content_type: 'comment',
    content: `${PREFIX} 干扰内容 ${index}`,
    moderation_status: 'published',
    created_at: new Date(oldCreatedAt + index * 1000),
  }));
  await prisma.report.createMany({ data: decoys });
  decoyReportIds.push(...decoys.map((row) => row.report_id));

  await seedReport({ content: APPROVE_CONTENT, image: true });
  await seedReport({ content: REJECT_CONTENT });
  await seedReport({ content: OPERATOR_CONTENT, contentType: 'intel' });
  await seedReport({ content: REVIEWER_CONTENT });
});

test.afterAll(async () => {
  for (const directory of imagePaths) {
    rmSync(directory, { recursive: true, force: true });
  }
  await prisma.report.deleteMany({
    where: { report_id: { in: [...reportIds, ...decoyReportIds] } },
  });
  if (authorId !== '') {
    await prisma.appUser.deleteMany({ where: { user_id: authorId } });
  }
  const spotIds = [spotId, decoySpotId].filter((value) => value !== '');
  if (spotIds.length > 0) {
    await prisma.spot.deleteMany({ where: { spot_id: { in: spotIds } } });
  }
  if (adminIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { admin_id: { in: adminIds } } });
    await prisma.adminUser.deleteMany({ where: { admin_id: { in: adminIds } } });
  }
  await prisma.config.upsert({
    where: { config_key: 'features.ugc' },
    create: {
      config_key: 'features.ugc',
      config_value: ugcFeatureBefore,
      description: 'V1.1 钓友情报开关',
    },
    update: { config_value: ugcFeatureBefore },
  });
  await prisma.$disconnect();
});

test('reviewer approves content and must pick a reject reason', async ({ page }) => {
  test.setTimeout(120_000);
  await loginWithPassword(page, reviewerAccount);
  const row = await openModeration(page, APPROVE_CONTENT);

  await expect(row.getByText('评论').first()).toBeVisible();
  await expect(row.getByText(`${PREFIX} 作者`).first()).toBeVisible();
  const thumbnail = row.locator('img').first();
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(async () => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);

  // The spot name filter runs on the server, so the total reflects only the
  // four reports on this spot even though twenty older decoy reports exist.
  await expect(page.locator('.moderation-list-footer')).toContainText('共 4 条');
  const overdueCheckbox = page.getByRole('checkbox', { name: '仅看超时' });
  await overdueCheckbox.check();
  await expect(page.getByText('这个队列暂时没有内容')).toBeVisible();
  await expect(
    page.locator('.ant-table-row').filter({ hasText: APPROVE_CONTENT }),
  ).toHaveCount(0);
  await overdueCheckbox.uncheck();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /^通\s*过$/ }).click();
  const confirm = page.locator('.ant-modal-confirm:visible');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /^通\s*过$/ }).click();
  await expectSuccessMessage(page, '已通过');
  await expect
    .poll(async () => {
      const report = await prisma.report.findUnique({
        where: { report_id: reportIds[0] },
        select: { moderation_status: true },
      });
      return report?.moderation_status;
    })
    .toBe('human_approved');

  const rejectRow = page.locator('.ant-table-row').filter({ hasText: REJECT_CONTENT });
  await expect(rejectRow).toBeVisible();
  await rejectRow.getByRole('button', { name: /^驳\s*回$/ }).click();

  const rejectModal = page.locator('.ant-modal:visible').filter({ hasText: '驳回内容' });
  await expect(rejectModal).toBeVisible();
  await rejectModal.getByRole('button', { name: /^驳\s*回$/ }).click();
  await expect(rejectModal.getByText('驳回原因必填')).toBeVisible();
  await expect
    .poll(async () => {
      const report = await prisma.report.findUnique({
        where: { report_id: reportIds[1] },
        select: { moderation_status: true },
      });
      return report?.moderation_status;
    })
    .toBe('published');

  await selectOption(page, '驳回原因', '广告引流', rejectModal);
  await rejectModal.getByRole('button', { name: /^驳\s*回$/ }).click();
  await expectSuccessMessage(page, '已驳回');
  await expect
    .poll(async () => {
      const report = await prisma.report.findUnique({
        where: { report_id: reportIds[1] },
        select: { moderation_status: true, reject_reason: true },
      });
      return `${report?.moderation_status}|${report?.reject_reason ?? ''}`;
    })
    .toContain('human_rejected|');
  const rejected = await prisma.report.findUniqueOrThrow({
    where: { report_id: reportIds[1] },
    select: { reject_reason: true },
  });
  expect(rejected.reject_reason).toContain('广告引流');
});

test('operator sees restrict and ban actions', async ({ page }) => {
  await loginWithPassword(page, operatorAccount);
  const row = await openModeration(page, OPERATOR_CONTENT);

  await expect(row.getByRole('button', { name: '封禁用户', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '限制发布', exact: true })).toBeVisible();
});

test('reviewer cannot see user enforcement actions', async ({ page }) => {
  await loginWithPassword(page, reviewerAccount);
  const row = await openModeration(page, REVIEWER_CONTENT);

  await expect(row.getByRole('button', { name: '封禁用户', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: '限制发布', exact: true })).toHaveCount(0);
});
