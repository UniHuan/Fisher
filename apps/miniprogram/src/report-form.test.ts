/// <reference types="jest" />

import { submitReportWithImages, validateReportDraft } from './report-form';

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

  it('rejects a catch with a weight but no fish key', () => {
    const result = validateReportDraft({
      ...baseDraft,
      content_type: 'catch',
      content: '上了条大鱼',
      fish_key: '',
      catch_weight_kg: 2.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('鱼种');
    }
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

describe('submitReportWithImages', () => {
  it('uploads images sequentially and creates the report with their keys', async () => {
    const order: string[] = [];
    const upload = jest.fn((path: string) => {
      order.push(path);
      return Promise.resolve(`key-${path}`);
    });
    const create = jest.fn().mockResolvedValue({ moderation_status: 'machine_pending' });

    const outcome = await submitReportWithImages({
      input: { content: '今天鱼口不错' },
      images: [{ path: 'a.jpg' }, { path: 'b.jpg' }],
      upload,
      create,
    });

    expect(order).toEqual(['a.jpg', 'b.jpg']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      content: '今天鱼口不错',
      image_keys: ['key-a.jpg', 'key-b.jpg'],
    });
    expect(outcome.imageKeys).toEqual(['key-a.jpg', 'key-b.jpg']);
  });

  it('does not call create when an image upload fails', async () => {
    const upload = jest
      .fn()
      .mockResolvedValueOnce('key-a')
      .mockRejectedValueOnce(new Error('upload failed'));
    const create = jest.fn();

    await expect(
      submitReportWithImages({
        input: { content: '今天鱼口不错' },
        images: [{ path: 'a.jpg' }, { path: 'b.jpg' }],
        upload,
        create,
      }),
    ).rejects.toThrow('upload failed');

    expect(upload).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it('reuses keys from a previous attempt and only uploads the missing images', async () => {
    const upload = jest.fn().mockResolvedValue('key-b');
    const create = jest.fn().mockResolvedValue({ moderation_status: 'published' });
    const uploaded: Array<[number, string]> = [];

    await submitReportWithImages({
      input: { content: '今天鱼口不错' },
      images: [{ path: 'a.jpg', key: 'key-a' }, { path: 'b.jpg' }],
      upload,
      create,
      onImageUploaded: (index, key) => {
        uploaded.push([index, key]);
      },
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith('b.jpg', expect.any(Function));
    expect(uploaded).toEqual([[1, 'key-b']]);
    expect(create).toHaveBeenCalledWith({
      content: '今天鱼口不错',
      image_keys: ['key-a', 'key-b'],
    });
  });
});
