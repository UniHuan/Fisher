import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, ProductPlacement } from '@prisma/client';
import { ERROR_CODES, PLACEMENT_SCOPE } from '@szfisher/shared';
import { ulid } from 'ulid';
import { AppError } from '../../common/errors/app-error';
import type { AdminContext, RequestWithContext } from '../../common/types/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminPlacementItemDto,
  AdminPlacementListDto,
  AdminPlacementListQueryDto,
} from './dto/admin-placement.dto';
import type { CreatePlacementDto } from './dto/create-placement.dto';
import type { UpdatePlacementDto } from './dto/update-placement.dto';

const ACTIVE_STATUS = 'active';
const DICTIONARY_FISH_TYPE = 'fish_type';
const ADMIN_PLACEMENT_DEFAULT_PAGE_SIZE = 20;
const SCOPE_ORDER = new Map<string, number>([
  [PLACEMENT_SCOPE.SPOT, 0],
  [PLACEMENT_SCOPE.FISH, 1],
]);

export interface PlacementMatch {
  placement_id: string;
  product_id: string;
  scope: string;
  sort_order: number;
  sort_weight: number;
}

interface PlacementScopeFields {
  target_id: string | null;
  fish_keys: string[];
}

/**
 * Resolves the active placements that apply to a public surface request and owns
 * the admin placement write path. Spot matches always sort before fish matches,
 * then by sort_order, then by the product sort_weight.
 */
@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogService,
  ) {}

  async match(
    surface: string,
    targetId?: string,
    fishKeys?: string[],
  ): Promise<PlacementMatch[]> {
    const requestedFishKeys = (fishKeys ?? []).filter((key) => key.length > 0);
    const scopeFilters: Prisma.ProductPlacementWhereInput[] = [];
    if (targetId !== undefined) {
      scopeFilters.push({ scope: PLACEMENT_SCOPE.SPOT, target_id: targetId });
    }
    if (requestedFishKeys.length > 0) {
      scopeFilters.push({
        scope: PLACEMENT_SCOPE.FISH,
        fish_keys: { hasSome: requestedFishKeys },
      });
    }
    if (scopeFilters.length === 0) {
      return [];
    }

    const now = new Date();
    const rows = await this.prisma.productPlacement.findMany({
      where: {
        surface,
        status: ACTIVE_STATUS,
        AND: [
          { OR: [{ starts_at: null }, { starts_at: { lte: now } }] },
          { OR: [{ ends_at: null }, { ends_at: { gte: now } }] },
          { OR: scopeFilters },
        ],
      },
      select: {
        placement_id: true,
        product_id: true,
        scope: true,
        sort_order: true,
        product: { select: { sort_weight: true } },
      },
    });

    return rows
      .map((row) => ({
        placement_id: row.placement_id,
        product_id: row.product_id,
        scope: row.scope,
        sort_order: row.sort_order,
        sort_weight: row.product.sort_weight,
      }))
      .sort((left, right) => {
        const scopeDiff =
          (SCOPE_ORDER.get(left.scope) ?? Number.MAX_SAFE_INTEGER) -
          (SCOPE_ORDER.get(right.scope) ?? Number.MAX_SAFE_INTEGER);
        if (scopeDiff !== 0) {
          return scopeDiff;
        }
        if (left.sort_order !== right.sort_order) {
          return left.sort_order - right.sort_order;
        }
        if (left.sort_weight !== right.sort_weight) {
          return right.sort_weight - left.sort_weight;
        }
        return left.placement_id.localeCompare(right.placement_id);
      });
  }

  async listAdmin(query: AdminPlacementListQueryDto): Promise<AdminPlacementListDto> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? ADMIN_PLACEMENT_DEFAULT_PAGE_SIZE;
    const where: Prisma.ProductPlacementWhereInput = {
      ...(query.product_id === undefined ? {} : { product_id: query.product_id }),
      ...(query.surface === undefined ? {} : { surface: query.surface }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productPlacement.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }, { placement_id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.productPlacement.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toAdminItem(row)),
      page,
      page_size: pageSize,
      total,
      has_more: page * pageSize < total,
    };
  }

  async create(
    input: CreatePlacementDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminPlacementItemDto> {
    const fields = this.scopeFields(input);
    await this.assertProductExists(input.product_id);
    await this.assertScopeTarget(input.scope, fields);

    const row = await this.prisma.productPlacement.create({
      data: {
        placement_id: ulid(),
        product_id: input.product_id,
        surface: input.surface,
        scope: input.scope,
        target_id: fields.target_id,
        fish_keys: fields.fish_keys,
        sort_order: input.sort_order ?? 0,
        starts_at: this.toDate(input.starts_at),
        ends_at: this.toDate(input.ends_at),
        status: input.status ?? ACTIVE_STATUS,
      },
    });
    await this.recordAudit(
      admin,
      request,
      'product.placement_create',
      row.product_id,
      null,
      this.auditSummary(row),
    );
    return this.toAdminItem(row);
  }

  async update(
    placementId: string,
    input: UpdatePlacementDto,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<AdminPlacementItemDto> {
    const existing = await this.findPlacement(placementId);
    const scope = input.scope ?? existing.scope;
    const fields = this.scopeFields({
      scope,
      target_id: input.target_id !== undefined ? input.target_id : existing.target_id,
      fish_keys: input.fish_keys !== undefined ? input.fish_keys : existing.fish_keys,
    });
    const productId = input.product_id ?? existing.product_id;
    await this.assertProductExists(productId);
    await this.assertScopeTarget(scope, fields);

    const row = await this.prisma.productPlacement.update({
      where: { placement_id: placementId },
      data: {
        product_id: productId,
        surface: input.surface ?? existing.surface,
        scope,
        target_id: fields.target_id,
        fish_keys: fields.fish_keys,
        sort_order: input.sort_order ?? existing.sort_order,
        ...(input.starts_at === undefined
          ? {}
          : { starts_at: this.toDate(input.starts_at) }),
        ...(input.ends_at === undefined ? {} : { ends_at: this.toDate(input.ends_at) }),
        status: input.status ?? existing.status,
      },
    });
    await this.recordAudit(
      admin,
      request,
      'product.placement_update',
      row.product_id,
      this.auditSummary(existing),
      this.auditSummary(row),
    );
    return this.toAdminItem(row);
  }

  async delete(
    placementId: string,
    admin: AdminContext,
    request: RequestWithContext,
  ): Promise<{ deleted: true }> {
    const existing = await this.findPlacement(placementId);
    await this.prisma.productPlacement.delete({ where: { placement_id: placementId } });
    await this.recordAudit(
      admin,
      request,
      'product.placement_delete',
      existing.product_id,
      this.auditSummary(existing),
      null,
    );
    return { deleted: true };
  }

  private scopeFields(input: {
    scope: string;
    target_id?: string | null;
    fish_keys?: string[];
  }): PlacementScopeFields {
    const targetId = input.target_id ?? null;
    const fishKeys = input.fish_keys ?? [];
    if (input.scope === PLACEMENT_SCOPE.SPOT) {
      if (targetId === null) {
        throw this.validation('target_id is required when scope=spot');
      }
      if (fishKeys.length > 0) {
        throw this.validation('fish_keys must be empty when scope=spot');
      }
      return { target_id: targetId, fish_keys: [] };
    }
    if (input.scope === PLACEMENT_SCOPE.FISH) {
      if (targetId !== null) {
        throw this.validation('target_id must be empty when scope=fish');
      }
      if (fishKeys.length === 0) {
        throw this.validation('fish_keys must contain at least one key when scope=fish');
      }
      return { target_id: null, fish_keys: fishKeys };
    }
    throw this.validation('Unsupported placement scope');
  }

  private async assertScopeTarget(
    scope: string,
    fields: PlacementScopeFields,
  ): Promise<void> {
    if (scope === PLACEMENT_SCOPE.SPOT) {
      const targetId = fields.target_id;
      if (targetId === null) {
        throw this.validation('target_id is required when scope=spot');
      }
      const spot = await this.prisma.spot.findFirst({
        where: { spot_id: targetId, deleted_at: null },
        select: { spot_id: true },
      });
      if (spot === null) {
        throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Spot not found');
      }
      return;
    }

    const uniqueKeys = [...new Set(fields.fish_keys)];
    const rows = await this.prisma.dictionary.findMany({
      where: { dict_type: DICTIONARY_FISH_TYPE, dict_key: { in: uniqueKeys } },
      select: { dict_key: true },
    });
    const known = new Set(rows.map((row) => row.dict_key));
    const missing = uniqueKeys.filter((key) => !known.has(key));
    if (missing.length > 0) {
      throw this.validation(`Unknown fish keys: ${missing.join(', ')}`);
    }
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { product_id: productId, deleted_at: null },
      select: { product_id: true },
    });
    if (product === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, HttpStatus.NOT_FOUND, 'Product not found');
    }
  }

  private async findPlacement(placementId: string): Promise<ProductPlacement> {
    const row = await this.prisma.productPlacement.findUnique({
      where: { placement_id: placementId },
    });
    if (row === null) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Placement not found',
      );
    }
    return row;
  }

  private validation(message: string): AppError {
    return new AppError(ERROR_CODES.VALIDATION, HttpStatus.BAD_REQUEST, message);
  }

  private toDate(value: string | null | undefined): Date | null {
    return value === undefined || value === null ? null : new Date(value);
  }

  private async recordAudit(
    admin: AdminContext,
    request: RequestWithContext,
    action: string,
    productId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    const userAgent = request.headers['user-agent'];
    await this.auditLogs.record({
      adminId: admin.adminId,
      action,
      entityType: 'product',
      entityId: productId,
      before,
      after,
      ip: request.ip ?? null,
      requestId: request.requestId ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }

  /** Placement audit rows keep identity fields only; ordering and windows stay out. */
  private auditSummary(row: {
    product_id: string;
    surface: string;
    scope: string;
    target_id: string | null;
    fish_keys: string[];
  }): Record<string, unknown> {
    return {
      product_id: row.product_id,
      surface: row.surface,
      scope: row.scope,
      target_id: row.target_id,
      fish_keys: row.fish_keys,
    };
  }

  private toAdminItem(row: ProductPlacement): AdminPlacementItemDto {
    return {
      placement_id: row.placement_id,
      product_id: row.product_id,
      surface: row.surface,
      scope: row.scope,
      target_id: row.target_id,
      fish_keys: row.fish_keys,
      sort_order: row.sort_order,
      starts_at: row.starts_at === null ? null : row.starts_at.toISOString(),
      ends_at: row.ends_at === null ? null : row.ends_at.toISOString(),
      status: row.status,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
