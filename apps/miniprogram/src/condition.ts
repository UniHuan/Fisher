export interface ConditionLike {
  open_status?: string | null;
  fee_status?: string | null;
  crowd_level?: string | null;
  facilities?: string[] | null;
  age_hours?: number;
  freshness?: string;
}

export interface ConditionOption {
  key: string;
  label: string;
}

export const CONDITION_OPEN_OPTIONS: ConditionOption[] = [
  { key: 'open', label: '开放' },
  { key: 'paused', label: '暂停' },
  { key: 'banned', label: '禁钓' },
];

export const CONDITION_FEE_OPTIONS: ConditionOption[] = [
  { key: 'free', label: '免费' },
  { key: 'paid', label: '收费' },
  { key: 'member', label: '需会员' },
];

export const CONDITION_CROWD_OPTIONS: ConditionOption[] = [
  { key: 'low', label: '人少' },
  { key: 'medium', label: '一般' },
  { key: 'high', label: '人多' },
];

export const CONDITION_FACILITY_OPTIONS: ConditionOption[] = [
  { key: 'toilet', label: '厕所' },
  { key: 'parking', label: '停车' },
  { key: 'food', label: '餐饮' },
  { key: 'water', label: '补水' },
  { key: 'shade', label: '遮阴' },
  { key: 'rental', label: '租赁' },
];

export interface ConditionObservedOption {
  key: string;
  label: string;
  offsetMinutes: number;
}

export const CONDITION_OBSERVED_OPTIONS: ConditionObservedOption[] = [
  { key: 'now', label: '刚刚', offsetMinutes: 0 },
  { key: 'hour', label: '1 小时内', offsetMinutes: 60 },
  { key: 'today', label: '今天早些时候', offsetMinutes: 360 },
  { key: 'yesterday', label: '昨天', offsetMinutes: 1200 },
];

function optionLabel(options: ConditionOption[], key: string | null | undefined): string {
  if (key === null || key === undefined) {
    return '';
  }
  return options.find((option) => option.key === key)?.label ?? key;
}

export interface ConditionLabels {
  openLabel: string;
  feeLabel: string;
  crowdLabel: string;
  facilityLabels: string[];
}

export function conditionLabels(value: ConditionLike): ConditionLabels {
  return {
    openLabel: optionLabel(CONDITION_OPEN_OPTIONS, value.open_status),
    feeLabel: optionLabel(CONDITION_FEE_OPTIONS, value.fee_status),
    crowdLabel: optionLabel(CONDITION_CROWD_OPTIONS, value.crowd_level),
    facilityLabels: (value.facilities ?? [])
      .map((key) => optionLabel(CONDITION_FACILITY_OPTIONS, key))
      .filter((label) => label !== ''),
  };
}

export function conditionSummary(value: ConditionLike): string {
  const labels = conditionLabels(value);
  const parts: string[] = [];
  if (labels.openLabel !== '') {
    parts.push(labels.openLabel);
  }
  if (labels.feeLabel !== '') {
    parts.push(labels.feeLabel);
  }
  if (labels.crowdLabel !== '') {
    parts.push(labels.crowdLabel);
  }
  if (labels.facilityLabels.length > 0) {
    parts.push(`有${labels.facilityLabels.join('/')}`);
  }
  return parts.join(' · ');
}

export function conditionFreshnessText(value: { age_hours?: number }): string {
  const hours = Math.max(0, Math.floor(value.age_hours ?? 0));
  if (hours === 0) {
    return '刚刚';
  }
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.floor(hours / 24)} 天前`;
}

export function observedAtFor(key: string, now: Date = new Date()): string {
  const option = CONDITION_OBSERVED_OPTIONS.find((item) => item.key === key);
  const offsetMinutes = option?.offsetMinutes ?? 0;
  return new Date(now.getTime() - offsetMinutes * 60 * 1000).toISOString();
}
