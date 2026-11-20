export type ReportContentType = 'comment' | 'catch' | 'intel';

export interface ReportDraft {
  content_type: ReportContentType;
  content: string;
  fish_key?: string | null;
  catch_weight_kg?: number | null;
  image_count?: number;
  terms_accepted: boolean;
}

export type ReportValidation = { ok: true } | { ok: false; message: string };

export const MAX_CONTENT_CODE_POINTS = 500;
export const MAX_REPORT_IMAGES = 6;
export const MIN_CATCH_WEIGHT_KG = 0.01;
export const MAX_CATCH_WEIGHT_KG = 999.99;

export function contentCodePointCount(value: string): number {
  return Array.from(value).length;
}

function fail(message: string): ReportValidation {
  return { ok: false, message };
}

export function validateReportDraft(draft: ReportDraft): ReportValidation {
  const content = typeof draft.content === 'string' ? draft.content.trim() : '';
  if (content.length === 0) {
    return fail('请填写内容');
  }
  if (contentCodePointCount(content) > MAX_CONTENT_CODE_POINTS) {
    return fail(`内容不能超过 ${MAX_CONTENT_CODE_POINTS} 字`);
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
  if (!Number.isInteger(imageCount) || imageCount < 0 || imageCount > MAX_REPORT_IMAGES) {
    return fail(`图片最多 ${MAX_REPORT_IMAGES} 张`);
  }

  if (!draft.terms_accepted) {
    return fail('请先阅读并同意社区规范');
  }

  return { ok: true };
}
