import { Injectable } from '@nestjs/common';
import type { Dictionary, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminDictionaryItem } from './dictionary.constants';

export interface CreateDictionaryRowInput {
  dict_type: string;
  dict_key: string;
  dict_label: string;
  sort_order: number;
  enabled: boolean;
  parent_key: string | null;
}

export type UpdateDictionaryRowInput = Partial<
  Pick<Dictionary, 'dict_label' | 'sort_order' | 'enabled' | 'parent_key'>
>;

export function toAdminDictionaryItem(row: Dictionary): AdminDictionaryItem {
  return {
    dict_type: row.dict_type,
    dict_key: row.dict_key,
    dict_label: row.dict_label,
    sort_order: row.sort_order,
    enabled: row.enabled,
    parent_key: row.parent_key,
  };
}

/** Owns every Prisma query for the dictionary table. */
@Injectable()
export class DictionariesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Public payload: enabled rows only, stable sort order then key (PRD 10.7 index). */
  findEnabled(): Promise<Dictionary[]> {
    return this.prisma.dictionary.findMany({
      where: { enabled: true },
      orderBy: [{ sort_order: 'asc' }, { dict_key: 'asc' }],
    });
  }

  /** Admin payload: every row, including disabled ones, in a stable order. */
  findAll(): Promise<Dictionary[]> {
    return this.prisma.dictionary.findMany({
      orderBy: [{ dict_type: 'asc' }, { sort_order: 'asc' }, { dict_key: 'asc' }],
    });
  }

  findByKey(dictType: string, dictKey: string): Promise<Dictionary | null> {
    return this.prisma.dictionary.findUnique({
      where: { dict_type_dict_key: { dict_type: dictType, dict_key: dictKey } },
    });
  }

  create(input: CreateDictionaryRowInput): Promise<Dictionary> {
    return this.prisma.dictionary.create({ data: input });
  }

  update(
    dictType: string,
    dictKey: string,
    input: UpdateDictionaryRowInput,
  ): Promise<Dictionary> {
    const data: Prisma.DictionaryUpdateInput = {};
    if (input.dict_label !== undefined) {
      data.dict_label = input.dict_label;
    }
    if (input.sort_order !== undefined) {
      data.sort_order = input.sort_order;
    }
    if (input.enabled !== undefined) {
      data.enabled = input.enabled;
    }
    if (input.parent_key !== undefined) {
      data.parent_key = input.parent_key;
    }
    return this.prisma.dictionary.update({
      where: { dict_type_dict_key: { dict_type: dictType, dict_key: dictKey } },
      data,
    });
  }
}
