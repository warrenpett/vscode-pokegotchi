export interface DailyXpState {
    date: string;
    amount: number;
}

export interface SaveThrottleEntry {
    count: number;
    windowStart: number;
}

export interface ThrottleConfig {
    dailyCap: number;
    saveWindowMs: number;
    saveDecayFactor: number;
    minSaveXp: number;
}

export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
    dailyCap: 500,
    saveWindowMs: 10 * 60 * 1000,
    saveDecayFactor: 0.6,
    minSaveXp: 1,
};

export function todayKey(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

/**
 * Rolls the persisted daily-XP counter over to a fresh day when needed.
 */
export function nextDailyXpState(state: DailyXpState | undefined, now: number): DailyXpState {
    const date = todayKey(now);
    if (!state || state.date !== date) {
        return { date, amount: 0 };
    }
    return state;
}

/**
 * Applies diminishing returns to repeated saves of the same file within a
 * rolling window, so mashing save on an unchanged-again file yields less XP.
 */
export function computeSaveXp(
    baseXp: number,
    entry: SaveThrottleEntry | undefined,
    now: number,
    config: ThrottleConfig,
): { xp: number; nextEntry: SaveThrottleEntry } {
    if (!entry || now - entry.windowStart > config.saveWindowMs) {
        return { xp: baseXp, nextEntry: { count: 1, windowStart: now } };
    }
    const decayed = Math.max(
        config.minSaveXp,
        Math.round(baseXp * Math.pow(config.saveDecayFactor, entry.count)),
    );
    return {
        xp: decayed,
        nextEntry: { count: entry.count + 1, windowStart: entry.windowStart },
    };
}

/**
 * Clamps a proposed XP grant to whatever remains of the daily cap.
 */
export function applyDailyCap(
    dailyState: DailyXpState,
    proposedXp: number,
    config: ThrottleConfig,
): { granted: number; nextState: DailyXpState } {
    const remaining = Math.max(0, config.dailyCap - dailyState.amount);
    const granted = Math.min(proposedXp, remaining);
    return {
        granted,
        nextState: { date: dailyState.date, amount: dailyState.amount + granted },
    };
}
