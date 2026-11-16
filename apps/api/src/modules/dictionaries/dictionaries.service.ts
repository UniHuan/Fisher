import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@szfisher/shared';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import {
  type AdminDictionaryItem,
  type AdminDictionaryList,
  type PublicDictionaries,
  publicGroupFor,
} from './dictionary.constants';
import { DictionariesRepository, toAdminDictionaryItem } from './dictionaries.repository';
import type { CreateDictionaryDto } from './dto/create-dictionary.dto';
import type { UpdateDictionaryDto } from './dto/update-dictionary.dto';

export function emptyPublicDictionaries(): PublicDictionaries {
  return {
    districts: [],
    fish_types: [],
    fee_status: [],
    water_types: [],
    venue_types: [],
    fishing_methods: [],
    poi_types: [],
  };
}

@Injectable()
export class DictionariesService {
  constructor(
    private readonly dictionaries: DictionariesRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async getPublicDictionaries(): Promise<PublicDictionaries> {
    const rows = await this.dictionaries.findEnabled();
    const payload = emptyPublicDictionaries();

    for (const row of rows) {
      const group = publicGroupFor(row.dict_type);
      if (group === undefined) {
        // fee_unit and any unknown type stay out of the public contract in V1.0.
        continue;
      }
      payload[group].push({
        key: row.dict_key,
        label: row.dict_label,
        sort_order: row.sort_order,
      });
    }

    return payload;
  }

  async listAll(): Promise<AdminDictionaryList> {
    const rows = await this.dictionaries.findAll();
    return { items: rows.map(toAdminDictionaryItem) };
  }

  async create(
    input: CreateDictionaryDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminDictionaryItem> {
    const existing = await this.dictionaries.findByKey(input.dict_type, input.dict_key);
    if (existing !== null) {
      throw new AppError(
        ERROR_CODES.STATE_CONFLICT,
        HttpStatus.CONFLICT,
        `Dictionary item ${input.dict_type}:${input.dict_key} already exists`,
      );
    }

    const row = await this.dictionaries.create({
      dict_type: input.dict_type,
      dict_key: input.dict_key,
      dict_label: input.dict_label,
      sort_order: input.sort_order ?? 0,
      enabled: input.enabled ?? true,
      parent_key: input.parent_key ?? null,
    });
    const item = toAdminDictionaryItem(row);
    await this.recordAudit(admin, request, 'dictionary.create', null, item);
    return item;
  }

  async update(
    dictType: string,
    dictKey: string,
    input: UpdateDictionaryDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminDictionaryItem> {
    const existing = await this.dictionaries.findByKey(dictType, dictKey);
    if (existing === null) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        HttpStatus.NOT_FOUND,
        `Dictionary item ${dictType}:${dictKey} not found`,
      );
    }

    const row = await this.dictionaries.update(dictType, dictKey, {
      ...(input.dict_label === undefined ? {} : { dict_label: input.dict_label }),
      ...(input.sort_order === undefined ? {} : { sort_order: input.sort_order }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.parent_key === undefined ? {} : { parent_key: input.parent_key }),
    });
    const before = toAdminDictionaryItem(existing);
    const after = toAdminDictionaryItem(row);
    await this.recordAudit(admin, request, 'dictionary.update', before, after);
    return after;
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    action: string,
    before: AdminDictionaryItem | null,
    after: AdminDictionaryItem,
  ): Promise<void> {
    const userAgentHeader = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action,
      entityType: 'dictionary',
      entityId: `${after.dict_type}:${after.dict_key}`,
      before,
      after,
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : null,
    });
  }
}
