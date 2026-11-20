import { test, expect, type Locator, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ulid } from 'ulid';

const TEST_DATABASE_URL =
  'postgresql://szfisher:szfisher@localhost:5432/szfisher_test?schema=public';
const STORAGE_ROOT = '/tmp/szfisher-playwright-storage';
const PREFIX = `PW-FB-${Date.now()}`;
const BUG_CONTENT = `${PREFIX} 问题：钓点详情页的收藏按钮点击后没有反应，请查看。`;
const SUGGESTION_CONTENT = `${PREFIX} 建议：希望列表支持按鱼种筛选，方便周末出行。`;
const CONTACT = `${PREFIX}_wx_contact`;
const PAGE_PATH = 'pages/detail/detail';
const APP_VERSION = '1.1.0';
const DEVICE_MODEL = 'iPhone 15 Pro';
const NOTE_TEXT = '已复现，安排修复';

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

interface RoleAccount {
  username: string;
  password: string;
  adminId: string;
}

let reviewerAccount: RoleAccount;
let operatorAccount: RoleAccount;
let userId = '';
let spotId = '';
let bugFeedbackId = '';
let suggestionFeedbackId = '';
let imageKey = '';
const adminIds: string[] = [];
const imageDirectories: string[] = [];

async function createRoleAccount(role: 'operator' | 'reviewer'): Promise<RoleAccount> {
  const username = `pw_feedback_${role}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const password = `Playwright-${role}-${Date.now()}-Strong!`;
  const adminId = ulid();
  await prisma.adminUser.create({
    data: {
      admin_id: adminId,
      username,
      password_hash: await hash(password, { type: argon2id }),
      role,
      status: 'active',
    },
  });
  adminIds.push(adminId);
  return { username, password, adminId };
}

/**
 * The login limiter is per IP and lives in Postgres, so attempts from another
 * spec or run leak into this file's fixed minute. Reset it before each login.
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
}

async function expectSuccessMessage(page: Page, text: string): Promise<void> {
  await expect(
    page.locator('.ant-message-notice-title').filter({ hasText: text }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

async function badgeCount(page: Page): Promise<number> {
  const badge = page.locator('.feedback-badge .ant-badge-count');
  await expect(badge).toBeVisible();
  const text = (await badge.textContent()) ?? '';
  return Number.parseInt(text.trim(), 10);
}

async function openFeedbackQueue(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '体验反馈', exact: true }).click();
  const drawer = page.locator('.ant-drawer-section').filter({ hasText: '反馈队列' });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.ant-table-row').first()).toBeVisible({ timeout: 20_000 });
  return drawer;
}

async function selectFilter(
  page: Page,
  drawer: Locator,
  placeholder: string,
  option: string,
): Promise<void> {
  await drawer
    .locator('.feedback-filter-row .ant-select')
    .filter({ hasText: placeholder })
    .click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText(option, { exact: true })
    .last()
    .click();
}

test.beforeAll(async () => {
  reviewerAccount = await createRoleAccount('reviewer');
  operatorAccount = await createRoleAccount('operator');

  userId = ulid();
  await prisma.appUser.create({
    data: { user_id: userId, nickname: `${PREFIX} 钓友` },
  });

  const spot = await prisma.spot.create({
    data: {
      spot_id: ulid(),
      spot_name: `${PREFIX} 钓点`,
      district: '南山区',
      address: '深圳市南山区Playwright反馈地址',
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
  spotId = spot.spot_id;

  const file = `${ulid()}.webp`;
  imageKey = `feedback/${userId}/${file}`;
  const directory = path.join(STORAGE_ROOT, 'working', 'feedback', userId);
  mkdirSync(directory, { recursive: true });
  imageDirectories.push(directory);
  const buffer = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 18, g: 59, b: 50 },
    },
  })
    .webp()
    .toBuffer();
  writeFileSync(path.join(directory, file), buffer);

  await prisma.feedbackImage.create({
    data: {
      image_id: ulid(),
      user_id: userId,
      object_key: imageKey,
      size_bytes: buffer.length,
      status: 'used',
    },
  });

  bugFeedbackId = ulid();
  suggestionFeedbackId = ulid();
  const now = Date.now();
  await prisma.trialFeedback.create({
    data: {
      feedback_id: bugFeedbackId,
      user_id: userId,
      category: 'bug',
      content: BUG_CONTENT,
      contact: CONTACT,
      page: PAGE_PATH,
      spot_id: spotId,
      app_version: APP_VERSION,
      device_info: { model: DEVICE_MODEL, system: 'iOS 18.1' },
      image_keys: [imageKey],
      status: 'open',
      created_at: new Date(now),
    },
  });
  await prisma.trialFeedback.create({
    data: {
      feedback_id: suggestionFeedbackId,
      user_id: userId,
      category: 'suggestion',
      content: SUGGESTION_CONTENT,
      status: 'open',
      created_at: new Date(now - 1000),
    },
  });
});

test.afterAll(async () => {
  for (const directory of imageDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  await prisma.trialFeedback.deleteMany({
    where: {
      OR: [
        { feedback_id: { in: [bugFeedbackId, suggestionFeedbackId] } },
        { user_id: userId },
      ],
    },
  });
  if (userId !== '') {
    await prisma.feedbackImage.deleteMany({ where: { user_id: userId } });
    await prisma.appUser.deleteMany({ where: { user_id: userId } });
  }
  if (spotId !== '') {
    await prisma.spot.deleteMany({ where: { spot_id: spotId } });
  }
  if (adminIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { admin_id: { in: adminIds } } });
    await prisma.adminUser.deleteMany({ where: { admin_id: { in: adminIds } } });
  }
  await prisma.$disconnect();
});

test('reviewer handles feedback from the workspace', async ({ page }) => {
  test.setTimeout(180_000);
  await loginWithPassword(page, reviewerAccount);
  await expect(page.getByRole('button', { name: '体验反馈', exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const openBefore = await badgeCount(page);
  expect(openBefore).toBeGreaterThanOrEqual(2);

  const drawer = await openFeedbackQueue(page);
  const bugRow = drawer.locator('.ant-table-row').filter({ hasText: BUG_CONTENT });
  const suggestionRow = drawer
    .locator('.ant-table-row')
    .filter({ hasText: SUGGESTION_CONTENT });
  await expect(bugRow).toBeVisible();
  await expect(bugRow.getByText('问题', { exact: true })).toBeVisible();
  await expect(bugRow.getByText(`${PREFIX} 钓点`, { exact: true })).toBeVisible();
  await expect(bugRow.getByText(`${PREFIX} 钓友`, { exact: true })).toBeVisible();
  await expect(bugRow.getByText('1 张', { exact: true })).toBeVisible();
  await expect(bugRow.getByText('待处理', { exact: true })).toBeVisible();

  await selectFilter(page, drawer, '全部类型', '问题');
  await expect(bugRow).toBeVisible();
  await expect(suggestionRow).toHaveCount(0);

  await bugRow.getByRole('button', { name: '详情', exact: true }).click();
  const detail = page.locator('.ant-drawer-section').filter({ hasText: '反馈详情' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(BUG_CONTENT)).toBeVisible();
  await expect(detail.getByText(CONTACT, { exact: true })).toBeVisible();
  await expect(detail.getByText(PAGE_PATH, { exact: true })).toBeVisible();
  await expect(detail.getByText(APP_VERSION, { exact: true })).toBeVisible();
  await expect(detail.getByText(DEVICE_MODEL, { exact: true })).toBeVisible();

  const thumbnail = detail.locator('img').first();
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(async () => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);

  await detail.getByRole('button', { name: '处理中', exact: true }).click();
  await expectSuccessMessage(page, '已标记为处理中');
  await expect
    .poll(async () => {
      const row = await prisma.trialFeedback.findUnique({
        where: { feedback_id: bugFeedbackId },
        select: { status: true, handler_id: true, handled_at: true },
      });
      return `${row?.status}|${row?.handler_id ?? ''}|${row?.handled_at === null ? '' : 'set'}`;
    })
    .toBe(`reviewing|${reviewerAccount.adminId}|set`);

  const noteBox = detail.getByLabel('处理备注');
  await noteBox.fill(NOTE_TEXT);
  await detail.getByRole('button', { name: /^保\s*存$/ }).click();
  await expectSuccessMessage(page, '已保存');
  await expect
    .poll(async () => {
      const row = await prisma.trialFeedback.findUnique({
        where: { feedback_id: bugFeedbackId },
        select: { status: true, note: true },
      });
      return `${row?.status}|${row?.note ?? ''}`;
    })
    .toBe(`reviewing|${NOTE_TEXT}`);

  await expect(detail.getByText('处理人', { exact: true })).toBeVisible();
  await expect(detail.getByText(reviewerAccount.adminId, { exact: true })).toBeVisible();
  await expect(detail.getByText('处理时间', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await expect
    .poll(async () => badgeCount(page))
    .toBe(openBefore - 1);
});

test('operator also sees the feedback entries', async ({ page }) => {
  await loginWithPassword(page, operatorAccount);
  await expect(page.getByRole('button', { name: '体验反馈', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const drawer = await openFeedbackQueue(page);
  await expect(
    drawer.locator('.ant-table-row').filter({ hasText: BUG_CONTENT }),
  ).toBeVisible();
});
