import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { paths } from '../../../packages/api-client/src/schema';

const REPO_ROOT = join(__dirname, '..', '..', '..');

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string };
}

interface OpenApiResponse {
  description?: string;
  content?: {
    'application/json'?: {
      schema?: { $ref?: string };
    };
  };
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation | undefined>>;
  components?: {
    schemas?: Record<string, { properties?: Record<string, { type?: string }> }>;
  };
}

type AuditLogOperation = paths['/api/v1/admin/audit-logs']['get'];
type AuditLogQuery = NonNullable<AuditLogOperation['parameters']['query']>;
type AuditLogHeader = NonNullable<AuditLogOperation['parameters']['header']>;
type DictionaryCreateError =
  paths['/api/v1/admin/dictionaries']['post']['responses'][409]['content']['application/json'];
type CreateSpotBody =
  paths['/api/v1/admin/spots']['post']['requestBody']['content']['application/json'];
type UpdateSpotBody =
  paths['/api/v1/admin/spots/{id}']['put']['requestBody']['content']['application/json'];

const minimalCreateSpot: CreateSpotBody = { spot_name: '深圳湾测试钓点' };
const partialUpdateSpot: UpdateSpotBody = { description: '新的钓位说明' };
const clearSpotSource: UpdateSpotBody = { source: null };

const auditQuery: AuditLogQuery = {
  admin_id: '01HX0000000000000000000000',
  action: 'dictionary.update',
  entity_type: 'dictionary',
  from: '2026-11-16T00:00:00.000Z',
  to: '2026-11-16T23:59:59.999Z',
  page: 1,
  page_size: 20,
};

const auditHeaders: AuditLogHeader = {
  'X-Client-Type': 'admin',
  'X-Client-Version': '1.0.0',
};

const conflictEnvelope: DictionaryCreateError = {
  code: 40901,
  message: 'Dictionary key already exists',
  data: null,
  request_id: 'req_contract_409',
};

function loadDocument(): OpenApiDocument {
  return parse(readFileSync(join(REPO_ROOT, 'openapi', 'openapi.yaml'), 'utf8')) as OpenApiDocument;
}

describe('OpenAPI contract', () => {
  const document = loadDocument();
  const auditOperation = document.paths['/api/v1/admin/audit-logs']?.get;

  it('types the audit query and header parameters instead of never', () => {
    expect(auditQuery.page_size).toBe(20);
    expect(auditHeaders['X-Client-Type']).toBe('admin');

    const parameters = auditOperation?.parameters ?? [];
    const names = parameters.map((parameter) => parameter.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'admin_id',
        'action',
        'entity_type',
        'from',
        'to',
        'page',
        'page_size',
        'X-Client-Type',
        'X-Client-Version',
      ]),
    );

    const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
    for (const header of ['X-Client-Type', 'X-Client-Version']) {
      expect(byName.get(header)?.in).toBe('header');
      expect(byName.get(header)?.required).toBe(true);
    }
    for (const query of ['admin_id', 'action', 'entity_type', 'from', 'to', 'page', 'page_size']) {
      expect(byName.get(query)?.in).toBe('query');
    }
  });

  it('documents dictionary 409 and 404 responses with the error envelope', () => {
    const create = document.paths['/api/v1/admin/dictionaries']?.post;
    const update = document.paths['/api/v1/admin/dictionaries/{type}/{key}']?.put;
    expect(create?.responses?.['409']?.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/ApiErrorEnvelopeDto',
    );
    expect(update?.responses?.['404']?.content?.['application/json']?.schema?.$ref).toBe(
      '#/components/schemas/ApiErrorEnvelopeDto',
    );
    expect(conflictEnvelope.data).toBeNull();
  });

  it('documents the client-context headers on every /api/v1 controller', () => {
    const operations = [
      document.paths['/api/v1/admin/auth/login']?.post,
      document.paths['/api/v1/admin/audit-logs']?.get,
      document.paths['/api/v1/admin/dictionaries']?.get,
      document.paths['/api/v1/dictionaries']?.get,
      document.paths['/api/v1/config']?.get,
    ];

    for (const operation of operations) {
      const names = (operation?.parameters ?? []).map((parameter) => parameter.name);
      expect(names).toEqual(expect.arrayContaining(['X-Client-Type', 'X-Client-Version']));
    }
  });

  it('documents all eight admin spot operations', () => {
    const operations = [
      document.paths['/api/v1/admin/spots']?.get,
      document.paths['/api/v1/admin/spots']?.post,
      document.paths['/api/v1/admin/spots/{id}']?.get,
      document.paths['/api/v1/admin/spots/{id}']?.put,
      document.paths['/api/v1/admin/spots/{id}']?.delete,
      document.paths['/api/v1/admin/spots/{id}/publish']?.post,
      document.paths['/api/v1/admin/spots/{id}/offline']?.post,
      document.paths['/api/v1/admin/spots/{id}/verify']?.post,
    ];
    expect(operations.every((operation) => operation !== undefined)).toBe(true);
    expect(
      document.paths['/api/v1/admin/spots/{id}/publish']?.post?.responses?.['409']
        ?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/ApiErrorEnvelopeDto');
    expect(
      document.paths['/api/v1/admin/spots/{id}']?.put?.responses?.['422']
        ?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/ApiErrorEnvelopeDto');
  });

  it('documents public spot list, map, detail and POI operations', () => {
    const list = document.paths['/api/v1/spots']?.get;
    const map = document.paths['/api/v1/spots/map']?.get;
    const detail = document.paths['/api/v1/spots/{id}']?.get;
    const pois = document.paths['/api/v1/spots/{id}/pois']?.get;
    expect(list).toBeDefined();
    expect(map).toBeDefined();
    expect(detail).toBeDefined();
    expect(pois).toBeDefined();
    expect((list?.parameters ?? []).map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining([
        'district',
        'fish_types',
        'fee_status',
        'water_type',
        'venue_type',
        'open_status',
        'include_banned',
        'keyword',
        'latitude',
        'longitude',
        'sort',
        'page',
        'page_size',
      ]),
    );
    expect((map?.parameters ?? []).map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(['north', 'south', 'east', 'west', 'zoom']),
    );
    expect(
      detail?.responses?.['404']?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/ApiErrorEnvelopeDto');
  });

  it('documents Excel import, template, job status and error report endpoints', () => {
    const template = document.paths['/api/v1/admin/spots/import-template']?.get;
    const importSpots = document.paths['/api/v1/admin/spots/import']?.post;
    const job = document.paths['/api/v1/admin/imports/{id}']?.get;
    const errors = document.paths['/api/v1/admin/imports/{id}/errors']?.get;
    expect(template).toBeDefined();
    expect(importSpots).toBeDefined();
    expect(job).toBeDefined();
    expect(errors).toBeDefined();
    expect(
      importSpots?.responses?.['400']?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/ApiErrorEnvelopeDto');
    expect(
      job?.responses?.['404']?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/ApiErrorEnvelopeDto');
    expect(document.components?.schemas?.ImportJobDto).toBeDefined();
  });

  it('documents the admin media upload with CSRF and client headers', () => {
    const upload = document.paths['/api/v1/admin/uploads']?.post;
    expect(upload).toBeDefined();
    const names = (upload?.parameters ?? []).map((parameter) => parameter.name);
    expect(names).toEqual(
      expect.arrayContaining(['X-Client-Type', 'X-Client-Version', 'X-CSRF-Token']),
    );
    expect(
      upload?.responses?.['413']?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/ApiErrorEnvelopeDto');
  });

  it('generated client accepts minimal create and documented partial updates', () => {
    expect(minimalCreateSpot.spot_name).toBe('深圳湾测试钓点');
    expect(partialUpdateSpot.description).toBe('新的钓位说明');
    expect(clearSpotSource.source).toBeNull();
  });

  it('types integer spot fields as OpenAPI integers', () => {
    expect(
      document.components?.schemas?.CreateSpotDto?.properties?.sort_weight?.type,
    ).toBe('integer');
    expect(
      document.components?.schemas?.AdminSpotPageDto?.properties?.page?.type,
    ).toBe('integer');
    const listParameters = document.paths['/api/v1/admin/spots']?.get?.parameters ?? [];
    const page = listParameters.find((parameter) => parameter.name === 'page');
    const pageSize = listParameters.find((parameter) => parameter.name === 'page_size');
    expect(page?.schema?.type).toBe('integer');
    expect(pageSize?.schema?.type).toBe('integer');
  });
});
