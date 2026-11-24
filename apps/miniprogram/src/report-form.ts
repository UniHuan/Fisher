export type ReportContentType = 'comment' | 'catch' | 'intel' | 'condition';

export interface ReportConditionDraft {
  open_status?: string | null;
  fee_status?: string | null;
  crowd_level?: string | null;
  facilities?: string[];
}

export interface ReportDraft {
  content_type: ReportContentType;
  content: string;
  fish_key?: string | null;
  catch_weight_kg?: number | null;
  condition?: ReportConditionDraft | null;
  image_count?: number;
  terms_accepted: boolean;
}

export type ReportValidation = { ok: true } | { ok: false; message: string };

export const MAX_CONTENT_CODE_POINTS = 500;
export const MAX_REPORT_IMAGES = 6;
export const MAX_CONDITION_IMAGES = 3;
export const MIN_CATCH_WEIGHT_KG = 0.01;
export const MAX_CATCH_WEIGHT_KG = 999.99;

export function contentCodePointCount(value: string): number {
  return Array.from(value).length;
}

function fail(message: string): ReportValidation {
  return { ok: false, message };
}

export interface ReportImageUpload {
  path: string;
  /** A key from an earlier successful attempt; reused instead of uploading again. */
  key?: string;
}

export interface SubmitReportWithImagesOptions<TInput extends object, TResult> {
  input: TInput;
  images: ReportImageUpload[];
  upload: (path: string, onProgress?: (progress: number) => void) => Promise<string>;
  create: (input: TInput & { image_keys?: string[] }) => Promise<TResult>;
  onProgress?: (index: number, progress: number) => void;
  onImageUploaded?: (index: number, key: string) => void;
}

export interface SubmitReportWithImagesResult<TResult> {
  result: TResult;
  imageKeys: string[];
}

/**
 * Uploads every image one at a time and only calls create after all uploads
 * succeed. Keys from a failed attempt are reused so a retry never re-uploads.
 */
export async function submitReportWithImages<TInput extends object, TResult>(
  options: SubmitReportWithImagesOptions<TInput, TResult>,
): Promise<SubmitReportWithImagesResult<TResult>> {
  const imageKeys: string[] = [];
  for (let index = 0; index < options.images.length; index += 1) {
    const image = options.images[index];
    if (image === undefined) {
      continue;
    }
    if (typeof image.key === 'string' && image.key.length > 0) {
      imageKeys.push(image.key);
      continue;
    }
    const key = await options.upload(image.path, (progress) => {
      options.onProgress?.(index, progress);
    });
    imageKeys.push(key);
    options.onImageUploaded?.(index, key);
  }
  const input =
    imageKeys.length > 0
      ? { ...options.input, image_keys: imageKeys }
      : options.input;
  const result = await options.create(input as TInput & { image_keys?: string[] });
  return { result, imageKeys };
}

export function validateReportDraft(draft: ReportDraft): ReportValidation {
  const content = typeof draft.content === 'string' ? draft.content.trim() : '';
  const isCondition = draft.content_type === 'condition';
  if (isCondition) {
    if (contentCodePointCount(content) > MAX_CONTENT_CODE_POINTS) {
      return fail(`内容不能超过 ${MAX_CONTENT_CODE_POINTS} 字`);
    }
    const condition = draft.condition ?? {};
    const hasCondition =
      (typeof condition.open_status === 'string' && condition.open_status !== '') ||
      (typeof condition.fee_status === 'string' && condition.fee_status !== '') ||
      (typeof condition.crowd_level === 'string' && condition.crowd_level !== '') ||
      (condition.facilities?.length ?? 0) > 0;
    if (!hasCondition) {
      return fail('请至少选择一项现场情况');
    }
  } else {
    if (content.length === 0) {
      return fail('请填写内容');
    }
    if (contentCodePointCount(content) > MAX_CONTENT_CODE_POINTS) {
      return fail(`内容不能超过 ${MAX_CONTENT_CODE_POINTS} 字`);
    }
  }

  if (draft.content_type === 'catch') {
    const fishKey = typeof draft.fish_key === 'string' ? draft.fish_key.trim() : '';
    if (fishKey.length === 0) {
      return fail('请选择鱼种');
    }
    const weight = draft.catch_weight_kg;
    if (weight !== undefined && weight !== null) {
      if (
        !Number.isFinite(weight) ||
        weight < MIN_CATCH_WEIGHT_KG ||
        weight > MAX_CATCH_WEIGHT_KG
      ) {
        return fail(
          `重量需在 ${MIN_CATCH_WEIGHT_KG} 到 ${MAX_CATCH_WEIGHT_KG} 公斤之间`,
        );
      }
    }
  }

  const imageCount = draft.image_count ?? 0;
  const maxImages = isCondition ? MAX_CONDITION_IMAGES : MAX_REPORT_IMAGES;
  if (!Number.isInteger(imageCount) || imageCount < 0 || imageCount > maxImages) {
    return fail(`图片最多 ${maxImages} 张`);
  }

  if (!draft.terms_accepted) {
    return fail('请先阅读并同意社区规范');
  }

  return { ok: true };
}
