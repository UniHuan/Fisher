import { Logger, type ExecutionContext, type INestApplication } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ADMIN_ROLE, ERROR_CODES } from '@szfisher/shared';
import request from 'supertest';
import { ulid } from 'ulid';
import { AppError } from '../src/common/errors/app-error';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AuditLogRepository } from '../src/modules/audit/audit-log.repository';
import { AuditLogService } from '../src/modules/audit/audit-log.service';
import { PERMISSIONS } from '../src/modules/auth/permissions';
import { createTestApp } from './create-test-app';
import {
  cleanupAuthTestData,
  clientHeaders,
  getAuthTestPrisma,
  loginAs,
  loginAsSuperAdmin,
} from './support/auth-helpers';

jest.setTimeout(30000);

const TEST_ACTION_PREFIX = 'test.rbac';

function contextWithRequest(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('denies a missing admin context with 401', () => {
    const reflector = {
      getAllAndOverride: () => [ADMIN_ROLE.SUPER_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    let caught: unknown;
    try {
      guard.canActivate(contextWithRequest({}));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ code: ERROR_CODES.UNAUTHENTICATED, httpStatus: 401 });
  });

  it('allows handlers without role metadata and denies an authenticated wrong role', () => {
    const openGuard = new RolesGuard({
      getAllAndOverride: () => undefined,
    } as unknown as Reflector);
    expect(openGuard.canActivate(contextWithRequest({}))).toBe(true);

    const superOnlyGuard = new RolesGuard({
      getAllAndOverride: () => [ADMIN_ROLE.SUPER_ADMIN],
    } as unknown as Reflector);
    let caught: unknown;
    try {
      superOnlyGuard.canActivate(
        contextWithRequest({
          admin: {
            adminId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            username: 'reviewer',
            role: ADMIN_ROLE.REVIEWER,
            tokenVersion: 0,
            jti: 'test-jti',
          },
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ code: ERROR_CODES.FORBIDDEN, httpStatus: 403 });
  });
});

describe('AuditLogService resilience', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs and swallows repository failures', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const repository = {
      create: jest.fn().mockRejectedValue(new Error('database down')),
    } as unknown as AuditLogRepository;
    const service = new AuditLogService(repository);

    await expect(
      service.record({
        adminId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        action: 'spot.create',
        entityType: 'spot',
        requestId: 'req_audit_failure_1',
        before: { password: 'super-secret' },
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('request_id=req_audit_failure_1'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('spot.create'));
  });
});

describe('RBAC and audit logging (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await cleanupAuthTestData();
    await app.close();
  });

  it('blocks an operator from a super-admin-only route', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);

    const res = await request(server)
      .post('/api/v1/admin/__test__/super-only')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .expect(403);

    expect(res.body).toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Insufficient permissions',
      data: null,
    });
  });

  it('lets a super admin call the super-admin-only route', async () => {
    const superAdmin = await loginAsSuperAdmin(app);

    const res = await request(server)
      .post('/api/v1/admin/__test__/super-only')
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .set('X-CSRF-Token', superAdmin.csrf)
      .expect(200);

    expect(res.body).toMatchObject({ code: ERROR_CODES.SUCCESS, data: { ok: true } });
  });

  it('records sanitized audit rows and truncates client metadata', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const audit = app.get(AuditLogService);
    const entityId = `spot_${ulid()}`;
    const longIp = '1'.repeat(60);
    const longUserAgent = 'agent-'.padEnd(300, 'x');

    await audit.record({
      adminId: operator.admin.adminId,
      action: 'spot.create',
      entityType: 'spot',
      entityId,
      before: {
        password: 'plain-text-password',
        nested: { access_token: 'token-value', spot_name: 'initial' },
      },
      after: { spot_name: '测试钓点', phone: '13800138000' },
      ip: longIp,
      requestId: 'req_audit_record_1',
      userAgent: longUserAgent,
    });

    const row = await getAuthTestPrisma().auditLog.findFirst({ where: { entity_id: entityId } });
    expect(row).not.toBeNull();
    expect(row?.log_id).toHaveLength(26);
    expect(row?.action).toBe('spot.create');
    expect(row?.before_json).toMatchObject({
      password: '[REDACTED]',
      nested: { access_token: '[REDACTED]', spot_name: 'initial' },
    });
    expect(row?.after_json).toMatchObject({ spot_name: '测试钓点', phone: '[REDACTED]' });
    expect(row?.ip).toHaveLength(45);
    expect(row?.user_agent).toHaveLength(255);
  });

  it('blocks reviewers from reading audit logs', async () => {
    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);

    const res = await request(server)
      .get('/api/v1/admin/audit-logs')
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .expect(403);

    expect(res.body).toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Insufficient permissions',
      data: null,
    });
  });

  it('forces operators to see only their own audit rows', async () => {
    const first = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const second = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const audit = app.get(AuditLogService);
    const action = `${TEST_ACTION_PREFIX}.own.${ulid()}`;

    await audit.record({
      adminId: first.admin.adminId,
      action,
      entityType: 'spot',
      entityId: `spot_a_${ulid()}`,
      requestId: 'req_audit_own_1',
    });
    await audit.record({
      adminId: second.admin.adminId,
      action,
      entityType: 'spot',
      entityId: `spot_b_${ulid()}`,
      requestId: 'req_audit_own_2',
    });

    const res = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({ admin_id: second.admin.adminId, action })
      .set(clientHeaders())
      .set('Cookie', first.cookie)
      .expect(200);

    const items = res.body.data.items as Array<{ admin_id: string }>;
    expect(items).toHaveLength(1);
    expect(items.every((item) => item.admin_id === first.admin.adminId)).toBe(true);
    expect(res.body.data.total).toBe(1);
  });

  it('lets a super admin filter by admin, action, entity type and time range', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const audit = app.get(AuditLogService);
    const createAction = `${TEST_ACTION_PREFIX}.filter.create.${ulid()}`;
    const updateAction = `${TEST_ACTION_PREFIX}.filter.update.${ulid()}`;
    const createEntityId = `spot_filter_${ulid()}`;
    const updateEntityId = `poi_filter_${ulid()}`;

    await audit.record({
      adminId: superAdmin.admin.adminId,
      action: createAction,
      entityType: 'spot',
      entityId: createEntityId,
    });
    await audit.record({
      adminId: superAdmin.admin.adminId,
      action: updateAction,
      entityType: 'poi',
      entityId: updateEntityId,
    });

    const from = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const res = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({
        admin_id: superAdmin.admin.adminId,
        action: createAction,
        entity_type: 'spot',
        from,
        to,
      })
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .expect(200);

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      admin_id: superAdmin.admin.adminId,
      action: createAction,
      entity_type: 'spot',
      entity_id: createEntityId,
    });
    expect(res.body.data.items[0].created_at).toEqual(expect.any(String));

    const outsideRange = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({
        admin_id: superAdmin.admin.adminId,
        action: createAction,
        to: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .expect(200);
    expect(outsideRange.body.data.total).toBe(0);
  });

  it('paginates results with page metadata and defaults', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const audit = app.get(AuditLogService);
    const action = `${TEST_ACTION_PREFIX}.page.${ulid()}`;
    for (let index = 0; index < 3; index += 1) {
      await audit.record({
        adminId: superAdmin.admin.adminId,
        action,
        entityType: 'spot',
        entityId: `spot_page_${index}`,
      });
    }

    const defaults = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({ admin_id: superAdmin.admin.adminId, action })
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .expect(200);
    expect(defaults.body.data).toMatchObject({ page: 1, page_size: 20, total: 3, has_more: false });

    const firstPage = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({ admin_id: superAdmin.admin.adminId, action, page: 1, page_size: 2 })
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .expect(200);
    expect(firstPage.body.data).toMatchObject({ page: 1, page_size: 2, total: 3, has_more: true });
    expect(firstPage.body.data.items).toHaveLength(2);

    const secondPage = await request(server)
      .get('/api/v1/admin/audit-logs')
      .query({ admin_id: superAdmin.admin.adminId, action, page: 2, page_size: 2 })
      .set(clientHeaders())
      .set('Cookie', superAdmin.cookie)
      .expect(200);
    expect(secondPage.body.data).toMatchObject({ page: 2, page_size: 2, total: 3, has_more: false });
    expect(secondPage.body.data.items).toHaveLength(1);
  });

  it('rejects invalid audit log queries', async () => {
    const superAdmin = await loginAsSuperAdmin(app);
    const invalidQueries = [
      { page: 0 },
      { page_size: 101 },
      { admin_id: 'short' },
      { from: 'not-a-date' },
    ];

    for (const query of invalidQueries) {
      await request(server)
        .get('/api/v1/admin/audit-logs')
        .query(query)
        .set(clientHeaders())
        .set('Cookie', superAdmin.cookie)
        .expect(400);
    }
  });

  it('returns the operator permission set from PERMISSIONS', async () => {
    const operator = await loginAs(app, ADMIN_ROLE.OPERATOR);
    const me = await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(me.body.data.permissions).toEqual([...PERMISSIONS[ADMIN_ROLE.OPERATOR]]);

    const reviewer = await loginAs(app, ADMIN_ROLE.REVIEWER);
    const reviewerMe = await request(server)
      .get('/api/v1/admin/me')
      .set(clientHeaders())
      .set('Cookie', reviewer.cookie)
      .expect(200);
    expect(reviewerMe.body.data.permissions).toEqual([...PERMISSIONS[ADMIN_ROLE.REVIEWER]]);
    expect(reviewerMe.body.data.permissions).not.toContain('audit:read');
    expect(reviewerMe.body.data.permissions).not.toContain('audit:read:self');
  });
});
