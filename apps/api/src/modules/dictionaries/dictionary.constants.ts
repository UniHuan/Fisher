/** Dictionary types stored in the dictionary table (PRD 3.9). */
export const DICTIONARY_TYPES = [
  'district',
  'fish_type',
  'fee_status',
  'fee_unit',
  'water_type',
  'venue_type',
  'fishing_method',
  'poi_type',
] as const;

export type DictionaryType = (typeof DICTIONARY_TYPES)[number];

/** DB dict_type to public response group. fee_unit is intentionally not public in V1.0. */
export const PUBLIC_DICTIONARY_GROUPS = {
  district: 'districts',
  fish_type: 'fish_types',
  fee_status: 'fee_status',
  water_type: 'water_types',
  venue_type: 'venue_types',
  fishing_method: 'fishing_methods',
  poi_type: 'poi_types',
} as const;

export type PublicDictionaryGroup =
  (typeof PUBLIC_DICTIONARY_GROUPS)[keyof typeof PUBLIC_DICTIONARY_GROUPS];

export interface PublicDictionaryItem {
  key: string;
  label: string;
  sort_order: number;
}

export interface PublicDictionaries {
  districts: PublicDictionaryItem[];
  fish_types: PublicDictionaryItem[];
  fee_status: PublicDictionaryItem[];
  water_types: PublicDictionaryItem[];
  venue_types: PublicDictionaryItem[];
  fishing_methods: PublicDictionaryItem[];
  poi_types: PublicDictionaryItem[];
}

export interface AdminDictionaryItem {
  dict_type: string;
  dict_key: string;
  dict_label: string;
  sort_order: number;
  enabled: boolean;
  parent_key: string | null;
}

export interface AdminDictionaryList {
  items: AdminDictionaryItem[];
}

export function publicGroupFor(dictType: string): PublicDictionaryGroup | undefined {
  return (PUBLIC_DICTIONARY_GROUPS as Record<string, PublicDictionaryGroup>)[dictType];
}
