import * as assert from 'assert';
import {
    DEFAULT_THROTTLE_CONFIG,
    applyDailyCap,
    computeSaveXp,
    nextDailyXpState,
    todayKey,
} from '../../extension/activity-throttle';

suite('activity-throttle', () => {
    test('nextDailyXpState resets when the date changes', () => {
        const now = Date.parse('2026-07-12T10:00:00Z');
        const yesterday: { date: string; amount: number } = { date: '2026-07-11', amount: 300 };
        const result = nextDailyXpState(yesterday, now);
        assert.strictEqual(result.date, todayKey(now));
        assert.strictEqual(result.amount, 0);
    });

    test('nextDailyXpState carries the same day forward unchanged', () => {
        const now = Date.parse('2026-07-12T10:00:00Z');
        const today = { date: todayKey(now), amount: 120 };
        const result = nextDailyXpState(today, now);
        assert.deepStrictEqual(result, today);
    });

    test('nextDailyXpState starts fresh when no prior state exists', () => {
        const now = Date.parse('2026-07-12T10:00:00Z');
        const result = nextDailyXpState(undefined, now);
        assert.strictEqual(result.amount, 0);
    });

    test('computeSaveXp grants full XP for the first save in a window', () => {
        const now = Date.now();
        const { xp, nextEntry } = computeSaveXp(10, undefined, now, DEFAULT_THROTTLE_CONFIG);
        assert.strictEqual(xp, 10);
        assert.strictEqual(nextEntry.count, 1);
    });

    test('computeSaveXp decays repeated saves within the same window', () => {
        const now = Date.now();
        const entry = { count: 3, windowStart: now };
        const { xp } = computeSaveXp(10, entry, now, DEFAULT_THROTTLE_CONFIG);
        assert.ok(xp < 10);
        assert.ok(xp >= DEFAULT_THROTTLE_CONFIG.minSaveXp);
    });

    test('computeSaveXp never grants less than the configured floor', () => {
        const now = Date.now();
        const entry = { count: 50, windowStart: now };
        const { xp } = computeSaveXp(10, entry, now, DEFAULT_THROTTLE_CONFIG);
        assert.strictEqual(xp, DEFAULT_THROTTLE_CONFIG.minSaveXp);
    });

    test('computeSaveXp resets decay once the rolling window has elapsed', () => {
        const windowStart = Date.now() - DEFAULT_THROTTLE_CONFIG.saveWindowMs - 1;
        const entry = { count: 10, windowStart };
        const { xp, nextEntry } = computeSaveXp(10, entry, Date.now(), DEFAULT_THROTTLE_CONFIG);
        assert.strictEqual(xp, 10);
        assert.strictEqual(nextEntry.count, 1);
    });

    test('applyDailyCap clamps grants to the remaining daily allowance', () => {
        const dailyState = { date: todayKey(Date.now()), amount: 495 };
        const { granted, nextState } = applyDailyCap(dailyState, 10, DEFAULT_THROTTLE_CONFIG);
        assert.strictEqual(granted, 5);
        assert.strictEqual(nextState.amount, 500);
    });

    test('applyDailyCap grants nothing once the cap is exhausted', () => {
        const dailyState = { date: todayKey(Date.now()), amount: 500 };
        const { granted } = applyDailyCap(dailyState, 10, DEFAULT_THROTTLE_CONFIG);
        assert.strictEqual(granted, 0);
    });
});
