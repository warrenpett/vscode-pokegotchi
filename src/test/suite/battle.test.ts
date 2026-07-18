import * as assert from 'assert';
import { DEFAULT_BATTLE_STATS, resolveBattle } from '../../common/battle';

suite('battle', () => {
    test('a much higher level and stats guarantees a win regardless of variance', () => {
        const result = resolveBattle(50, { power: 50, guts: 50 }, 1, DEFAULT_BATTLE_STATS, () => 0);
        assert.strictEqual(result.won, true);
    });

    test('a much lower level and stats guarantees a loss regardless of variance', () => {
        const result = resolveBattle(1, DEFAULT_BATTLE_STATS, 50, { power: 50, guts: 50 }, () => 1);
        assert.strictEqual(result.won, false);
    });

    test('equal stats and level with equal rng rolls is a tie that favors the player', () => {
        const result = resolveBattle(10, DEFAULT_BATTLE_STATS, 10, DEFAULT_BATTLE_STATS, () => 0.5);
        assert.strictEqual(result.won, true);
        assert.strictEqual(result.playerScore, result.wildScore);
    });

    test('scores scale with level', () => {
        const low = resolveBattle(1, DEFAULT_BATTLE_STATS, 1, DEFAULT_BATTLE_STATS, () => 0.5);
        const high = resolveBattle(10, DEFAULT_BATTLE_STATS, 1, DEFAULT_BATTLE_STATS, () => 0.5);
        assert.ok(high.playerScore > low.playerScore);
    });

    test('uses Math.random by default when no rng is injected', () => {
        const result = resolveBattle(5, DEFAULT_BATTLE_STATS, 5, DEFAULT_BATTLE_STATS);
        assert.ok(typeof result.won === 'boolean');
    });
});
