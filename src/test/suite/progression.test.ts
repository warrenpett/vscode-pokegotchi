import * as assert from 'assert';
import { DEFAULT_PROGRESS, applyXp, xpForLevel } from '../../common/progression';

suite('progression', () => {
    test('xpForLevel grows with level', () => {
        assert.ok(xpForLevel(2) > xpForLevel(1));
        assert.ok(xpForLevel(10) > xpForLevel(9));
    });

    test('applyXp accumulates xp without leveling up when below threshold', () => {
        const result = applyXp(DEFAULT_PROGRESS, 1);
        assert.strictEqual(result.leveledUp, false);
        assert.strictEqual(result.progress.level, 1);
        assert.strictEqual(result.progress.xp, 1);
        assert.strictEqual(result.progress.totalXp, 1);
    });

    test('applyXp levels up once the threshold for the current level is reached', () => {
        const threshold = xpForLevel(1);
        const result = applyXp(DEFAULT_PROGRESS, threshold);
        assert.strictEqual(result.leveledUp, true);
        assert.strictEqual(result.newLevel, 2);
        assert.strictEqual(result.progress.level, 2);
        assert.strictEqual(result.progress.xp, 0);
    });

    test('applyXp resolves multiple level-ups from a single large grant', () => {
        const hugeGrant = xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + 5;
        const result = applyXp(DEFAULT_PROGRESS, hugeGrant);
        assert.strictEqual(result.leveledUp, true);
        assert.strictEqual(result.progress.level, 4);
        assert.strictEqual(result.progress.xp, 5);
    });

    test('applyXp is a no-op for zero or negative amounts', () => {
        const result = applyXp(DEFAULT_PROGRESS, 0);
        assert.strictEqual(result.leveledUp, false);
        assert.deepStrictEqual(result.progress, DEFAULT_PROGRESS);
    });

    test('applyXp tracks totalXp across multiple grants', () => {
        const first = applyXp(DEFAULT_PROGRESS, 5);
        const second = applyXp(first.progress, 7);
        assert.strictEqual(second.progress.totalXp, 12);
    });
});
