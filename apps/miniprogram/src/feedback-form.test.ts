/// <reference types="jest" />

import {
  MAX_CONTACT_LENGTH,
  MAX_FEEDBACK_IMAGES,
  validateFeedbackDraft,
  type FeedbackDraft,
} from './feedback-form';

const baseDraft: FeedbackDraft = {
  category: 'bug',
  content: '钓点详情页的收藏按钮点击后没有反应，重复进入也一样。',
  contact: '',
  image_count: 0,
  photo_consent: false,
};

describe('validateFeedbackDraft', () => {
  it('accepts a bug report with enough content', () => {
    expect(validateFeedbackDraft(baseDraft)).toEqual({ ok: true });
  });

  it('rejects a draft without a category', () => {
    const result = validateFeedbackDraft({ ...baseDraft, category: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('类型');
    }
  });

  it('rejects an unknown category', () => {
    const result = validateFeedbackDraft({
      ...baseDraft,
      category: 'praise' as FeedbackDraft['category'],
    });
    expect(result.ok).toBe(false);
  });

  it('requires at least 10 code points after trimming', () => {
    expect(validateFeedbackDraft({ ...baseDraft, content: ' 有问题  ' }).ok).toBe(false);
    expect(validateFeedbackDraft({ ...baseDraft, content: '  123456789  ' }).ok).toBe(false);
    expect(validateFeedbackDraft({ ...baseDraft, content: '  1234567890  ' })).toEqual({
      ok: true,
    });
  });

  it('counts unicode code points for the 500 code point limit', () => {
    expect(validateFeedbackDraft({ ...baseDraft, content: '🐟'.repeat(500) })).toEqual({
      ok: true,
    });
    expect(validateFeedbackDraft({ ...baseDraft, content: '🐟'.repeat(501) }).ok).toBe(false);
  });

  it('rejects more than 80 contact characters after trimming', () => {
    const longContact = '钓'.repeat(MAX_CONTACT_LENGTH);
    expect(validateFeedbackDraft({ ...baseDraft, contact: longContact })).toEqual({
      ok: true,
    });
    expect(validateFeedbackDraft({ ...baseDraft, contact: `  ${longContact}  ` })).toEqual({
      ok: true,
    });
    expect(validateFeedbackDraft({ ...baseDraft, contact: `${longContact}钓` }).ok).toBe(false);
  });

  it('rejects more than three images', () => {
    expect(validateFeedbackDraft({ ...baseDraft, image_count: MAX_FEEDBACK_IMAGES })).toEqual({
      ok: true,
    });
    expect(validateFeedbackDraft({ ...baseDraft, image_count: MAX_FEEDBACK_IMAGES + 1 }).ok).toBe(
      false,
    );
    expect(validateFeedbackDraft({ ...baseDraft, image_count: -1 }).ok).toBe(false);
    expect(validateFeedbackDraft({ ...baseDraft, image_count: 1.5 }).ok).toBe(false);
  });

  it('requires photo consent for the photo category', () => {
    const photoDraft: FeedbackDraft = { ...baseDraft, category: 'photo' };
    const withoutConsent = validateFeedbackDraft(photoDraft);
    expect(withoutConsent.ok).toBe(false);
    if (!withoutConsent.ok) {
      expect(withoutConsent.message).toContain('授权');
    }
    expect(validateFeedbackDraft({ ...photoDraft, photo_consent: true })).toEqual({
      ok: true,
    });
  });

  it('does not require photo consent for other categories', () => {
    expect(
      validateFeedbackDraft({ ...baseDraft, category: 'suggestion', photo_consent: false }),
    ).toEqual({ ok: true });
  });
});
