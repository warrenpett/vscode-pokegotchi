export interface BattleStats {
    power: number;
    guts: number;
}

export const DEFAULT_BATTLE_STATS: BattleStats = { power: 10, guts: 10 };

export interface BattleResult {
    won: boolean;
    playerScore: number;
    wildScore: number;
}

const VARIANCE_MIN = 0.85;
const VARIANCE_RANGE = 0.3;

function computeScore(level: number, stats: BattleStats, rng: () => number): number {
    return stats.power * stats.guts * level * (VARIANCE_MIN + rng() * VARIANCE_RANGE);
}

/**
 * A one-shot stat comparison with a bounded random variance, not a
 * turn-based engine - this is a decorative extension, not a battle sim.
 */
export function resolveBattle(
    playerLevel: number,
    playerStats: BattleStats,
    wildLevel: number,
    wildStats: BattleStats,
    rng: () => number = Math.random,
): BattleResult {
    const playerScore = computeScore(playerLevel, playerStats, rng);
    const wildScore = computeScore(wildLevel, wildStats, rng);
    return {
        won: playerScore >= wildScore,
        playerScore,
        wildScore,
    };
}
