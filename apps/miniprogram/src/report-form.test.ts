/// <reference types="jest" />

import { validateReportDraft } from './report-form';

const baseDraft = {
  content_type: 'comment' as const,
  content: '今天罗非爆护，巴掌大，钓了十几条。',
  image_count: 0,
  terms_accepted: true,
};

describe('validateReportDraft', () => {
  it('accepts a comment that accepts the terms', () => {
    expect(validateReportDraft(baseDraft)).toEqual({ ok: true });
  });

  it('rejects empty content', () => {
    const result = validateReportDraft({ ...baseDraft, content: '   ' });
    expect(result.ok).toBe(false);
  });

  it('counts unicode code points for the 500 character limit', () => {
    expect(validateReportDraft({ ...baseDraft, content: '🐟'.repeat(500) })).toEqual({
      ok: true,
    });
    expect(validateReportDraft({ ...baseDraft, content: '🐟'.repeat(501) }).ok).toBe(false);
  });

  it('rejects catch content without a fish key', () => {
    const result = validateReportDraft({
      ...baseDraft,
      content_type: 'catch',
      content: '上了条大鱼',
      fish_key: '',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects catch weights outside 0.01 to 999.99 kg', () => {
    const catchDraft = {
      ...baseDraft,
      content_type: 'catch' as const,
      content: '上了条大鱼',
      fish_key: 'luofei',
    };
    expect(validateReportDraft({ ...catchDraft, catch_weight_kg: 0 }).ok).toBe(false);
    expect(validateReportDraft({ ...catchDraft, catch_weight_kg: 0.009 }).ok).toBe(false);
    expect(validateReportDraft({ ...catchDraft, catch_weight_kg: 1000 }).ok).toBe(false);
    expect(validateReportDraft({ ...catchDraft, catch_weight_kg: Number.NaN }).ok).toBe(false);
    expect(validateReportDraft({ ...catchDraft, catch_weight_kg: 0.01 })).toEqual({ ok: true });
    expect(validateReportDraft({ ...catchDraft, catch_weight_kg: 999.99 })).toEqual({
      ok: true,
    });
  });

  it('rejects more than six images', () => {
    expect(validateReportDraft({ ...baseDraft, image_count: 6 })).toEqual({ ok: true });
    expect(validateReportDraft({ ...baseDraft, image_count: 7 }).ok).toBe(false);
  });

  it('rejects a draft without terms acceptance', () => {
    const result = validateReportDraft({ ...baseDraft, terms_accepted: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
