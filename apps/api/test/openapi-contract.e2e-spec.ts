import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { paths } from '../../../packages/api-client/src/schema';

const REPO_ROOT = join(__dirname, '..', '..', '..');

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
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
}

type AuditLogOperation = paths['/api/v1/admin/audit-logs']['get'];
type AuditLogQuery = NonNullable<AuditLogOperation['parameters']['query']>;
type AuditLogHeader = NonNullable<AuditLogOperation['parameters']['header']>;
type DictionaryCreateError =
  paths['/api/v1/admin/dictionaries']['post']['responses'][409]['content']['application/json'];

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
});
