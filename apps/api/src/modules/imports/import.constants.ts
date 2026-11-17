export interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
  width: number;
  note: string;
  example: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'spot_name', label: '钓点名称', required: true, width: 26, note: '60 字以内', example: '深圳湾公园北湾钓点' },
  { key: 'district', label: '区域', required: true, width: 14, note: '必须使用字典值', example: '南山区' },
  { key: 'address', label: '详细地址', required: true, width: 30, note: '120 字以内', example: '滨海大道深圳湾公园北湾' },
  { key: 'latitude', label: '纬度', required: true, width: 14, note: 'GCJ-02', example: '22.517600' },
  { key: 'longitude', label: '经度', required: true, width: 14, note: 'GCJ-02', example: '113.952300' },
  { key: 'nav_latitude', label: '导航纬度', required: false, width: 14, note: '不填则等于钓点纬度', example: '22.517600' },
  { key: 'nav_longitude', label: '导航经度', required: false, width: 14, note: '不填则等于钓点经度', example: '113.952300' },
  { key: 'parking_latitude', label: '停车场纬度', required: false, width: 14, note: '可选', example: '22.516900' },
  { key: 'parking_longitude', label: '停车场经度', required: false, width: 14, note: '可选', example: '113.951800' },
  { key: 'fish_types', label: '鱼种', required: true, width: 24, note: '分号分隔字典值', example: '罗非;鲫鱼;鲈鱼' },
  { key: 'fee_status', label: '收费状态', required: true, width: 14, note: '免费、收费、需会员', example: '免费' },
  { key: 'fee_unit', label: '收费单位', required: false, width: 14, note: '按天、按小时、按竿、按年、其他', example: '按天' },
  { key: 'fee_detail', label: '收费说明', required: false, width: 24, note: '200 字以内', example: '免费开放，禁夜钓' },
  { key: 'water_type', label: '水域类型', required: true, width: 14, note: '字典值', example: '海域' },
  { key: 'venue_type', label: '场所类型', required: true, width: 14, note: '字典值', example: '野钓' },
  { key: 'fishing_method', label: '钓法', required: false, width: 20, note: '分号分隔', example: '台钓;路亚' },
  { key: 'open_status', label: '开放状态', required: true, width: 14, note: '开放、暂停、禁钓', example: '开放' },
  { key: 'ban_note', label: '禁钓说明', required: false, width: 24, note: '禁钓点必填', example: '' },
  { key: 'open_hours', label: '开放时间', required: false, width: 20, note: '', example: '06:00-22:00' },
  { key: 'description', label: '简介', required: false, width: 32, note: '1000 字以内', example: '湾内水深约 3 米，适合台钓' },
  { key: 'tips', label: '注意事项', required: false, width: 32, note: '1000 字以内', example: '涨潮时注意安全' },
  { key: 'images', label: '图片', required: false, width: 32, note: '分号分隔，最多 9 张', example: '' },
  { key: 'source', label: '数据来源', required: true, width: 14, note: '官方、运营、用户上报、第三方', example: '运营' },
  { key: 'verified_at', label: '核实时间', required: true, width: 16, note: 'YYYY-MM-DD', example: '2026-11-01' },
  { key: 'sort_weight', label: '排序权重', required: false, width: 12, note: '越大越靠前', example: '100' },
  { key: 'is_core', label: '核心钓点', required: false, width: 12, note: '是或否，默认否', example: '否' },
];

export const IMPORT_HEADER_TO_KEY = new Map(
  IMPORT_COLUMNS.map((column) => [column.label, column.key]),
);

export const IMPORT_REQUIRED_HEADERS = IMPORT_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.label);

export const OPEN_STATUS_LABEL_TO_KEY: Record<string, string> = {
  开放: 'open',
  暂停: 'paused',
  禁钓: 'banned',
};

export const SOURCE_LABEL_TO_KEY: Record<string, string> = {
  官方: 'official',
  运营: 'operation',
  用户上报: 'user_report',
  第三方: 'third_party',
};

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
