export interface PokemonProgress {
    level: number;
    xp: number;
    totalXp: number;
}

export type ProgressMap = { [pokemonName: string]: PokemonProgress };

export const DEFAULT_PROGRESS: PokemonProgress = {
    level: 1,
    xp: 0,
    totalXp: 0,
};

export const MAX_LEVEL = 100;

/**
 * XP required to advance from `level` to `level + 1`.
 */
export function xpForLevel(level: number): number {
    return Math.round(50 * Math.pow(level, 1.5));
}

export interface ApplyXpResult {
    progress: PokemonProgress;
    leveledUp: boolean;
    newLevel?: number;
}

/**
 * Pure reducer: applies an XP grant to a progress record, resolving
 * multiple level-ups from a single large grant (e.g. a commit).
 */
export function applyXp(progress: PokemonProgress, amount: number): ApplyXpResult {
    if (amount <= 0 || progress.level >= MAX_LEVEL) {
        return { progress, leveledUp: false };
    }

    let level = progress.level;
    let xp = progress.xp + amount;
    const totalXp = progress.totalXp + amount;
    let leveledUp = false;

    while (level < MAX_LEVEL) {
        const required = xpForLevel(level);
        if (xp < required) {
            break;
        }
        xp -= required;
        level += 1;
        leveledUp = true;
    }

    if (level >= MAX_LEVEL) {
        level = MAX_LEVEL;
        xp = 0;
    }

    return {
        progress: { level, xp, totalXp },
        leveledUp,
        newLevel: leveledUp ? level : undefined,
    };
}
