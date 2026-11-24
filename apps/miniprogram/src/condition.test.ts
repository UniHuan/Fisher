/// <reference types="jest" />

import {
  conditionFreshnessText,
  conditionSummary,
  observedAtFor,
} from './condition';

describe('condition helpers', () => {
  it('formats a structured summary', () => {
    expect(
      conditionSummary({
        open_status: 'open',
        fee_status: 'free',
        crowd_level: 'low',
        facilities: ['toilet', 'parking'],
      }),
    ).toBe('开放 · 免费 · 人少 · 有厕所/停车');
  });

  it('omits empty fields from the summary', () => {
    expect(conditionSummary({ crowd_level: 'high' })).toBe('人多');
    expect(conditionSummary({ facilities: [] })).toBe('');
  });

  it('returns a relative freshness label', () => {
    expect(conditionFreshnessText({ age_hours: 0 })).toBe('刚刚');
    expect(conditionFreshnessText({ age_hours: 2 })).toBe('2 小时前');
    expect(conditionFreshnessText({ age_hours: 30 })).toBe('1 天前');
  });

  it('maps observed options to ISO times inside 24 hours', () => {
    const now = new Date('2026-11-23T12:00:00+08:00');
    expect(observedAtFor('now', now)).toBe('2026-11-23T04:00:00.000Z');
    expect(observedAtFor('yesterday', now)).toBe('2026-11-22T08:00:00.000Z');
    expect(observedAtFor('unknown', now)).toBe('2026-11-23T04:00:00.000Z');
  });
});
