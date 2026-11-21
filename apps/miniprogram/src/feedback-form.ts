export const FEEDBACK_CATEGORIES = ['bug', 'suggestion', 'content', 'photo', 'other'] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const MIN_CONTENT_CODE_POINTS = 10;
export const MAX_CONTENT_CODE_POINTS = 500;
export const MAX_CONTACT_LENGTH = 80;
export const MAX_FEEDBACK_IMAGES = 3;

export const PHOTO_CONSENT_TEXT = '提交即授权优丽环钓鱼助手在对应钓点页展示这张照片，我们会先审核';

export interface FeedbackDraft {
  category: FeedbackCategory | '';
  content: string;
  contact?: string;
  image_count?: number;
  photo_consent?: boolean;
}

export type FeedbackValidation = { ok: true } | { ok: false; message: string };

export function isFeedbackCategory(value: string): value is FeedbackCategory {
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export function contentCodePointCount(value: string): number {
  return Array.from(value).length;
}

function fail(message: string): FeedbackValidation {
  return { ok: false, message };
}

export function validateFeedbackDraft(draft: FeedbackDraft): FeedbackValidation {
  if (!isFeedbackCategory(draft.category)) {
    return fail('请选择反馈类型');
  }

  const content = typeof draft.content === 'string' ? draft.content.trim() : '';
  if (content.length === 0) {
    return fail('请填写反馈内容');
  }
  const codePoints = contentCodePointCount(content);
  if (codePoints < MIN_CONTENT_CODE_POINTS) {
    return fail(`反馈内容至少 ${MIN_CONTENT_CODE_POINTS} 字`);
  }
  if (codePoints > MAX_CONTENT_CODE_POINTS) {
    return fail(`反馈内容不能超过 ${MAX_CONTENT_CODE_POINTS} 字`);
  }

  const contact = typeof draft.contact === 'string' ? draft.contact.trim() : '';
  if (contact.length > MAX_CONTACT_LENGTH) {
    return fail(`联系方式不能超过 ${MAX_CONTACT_LENGTH} 字`);
  }

  const imageCount = draft.image_count ?? 0;
  if (!Number.isInteger(imageCount) || imageCount < 0 || imageCount > MAX_FEEDBACK_IMAGES) {
    return fail(`图片最多 ${MAX_FEEDBACK_IMAGES} 张`);
  }

  if (draft.category === 'photo' && draft.photo_consent !== true) {
    return fail('请阅读并勾选照片授权说明');
  }

  return { ok: true };
}
