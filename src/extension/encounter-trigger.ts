export interface EncounterTriggerState {
    lastSpawnAt?: number;
    saveStreakCount: number;
}

export const DEFAULT_ENCOUNTER_TRIGGER_STATE: EncounterTriggerState = {
    saveStreakCount: 0,
};

export interface EncounterTriggerConfig {
    commitChance: number;
    cooldownMinutes: number;
    savesPerEncounter: number;
}

export interface EncounterDecision {
    shouldSpawn: boolean;
    nextState: EncounterTriggerState;
}

function isOnCooldown(
    state: EncounterTriggerState,
    config: EncounterTriggerConfig,
    now: number,
): boolean {
    return (
        state.lastSpawnAt !== undefined &&
        now - state.lastSpawnAt < config.cooldownMinutes * 60 * 1000
    );
}

/**
 * A commit has a chance to spawn a wild encounter, gated by cooldown and
 * whether one is already unresolved in the panel.
 */
export function evaluateCommitEncounter(
    state: EncounterTriggerState,
    config: EncounterTriggerConfig,
    now: number,
    hasActiveEncounter: boolean,
    rng: () => number = Math.random,
): EncounterDecision {
    if (hasActiveEncounter || isOnCooldown(state, config, now)) {
        return { shouldSpawn: false, nextState: state };
    }
    if (rng() < config.commitChance) {
        return { shouldSpawn: true, nextState: { ...state, lastSpawnAt: now } };
    }
    return { shouldSpawn: false, nextState: state };
}

/**
 * A secondary, deterministic trigger for users without git tracking (or on
 * restricted workspaces): every Nth eligible save has a chance to spawn.
 */
export function evaluateSaveStreakEncounter(
    state: EncounterTriggerState,
    config: EncounterTriggerConfig,
    now: number,
    hasActiveEncounter: boolean,
): EncounterDecision {
    const nextCount = state.saveStreakCount + 1;
    if (hasActiveEncounter || isOnCooldown(state, config, now)) {
        return { shouldSpawn: false, nextState: { ...state, saveStreakCount: nextCount } };
    }
    if (nextCount >= config.savesPerEncounter) {
        return {
            shouldSpawn: true,
            nextState: { ...state, lastSpawnAt: now, saveStreakCount: 0 },
        };
    }
    return { shouldSpawn: false, nextState: { ...state, saveStreakCount: nextCount } };
}
