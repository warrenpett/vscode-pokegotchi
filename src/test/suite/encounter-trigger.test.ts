import * as assert from 'assert';
import {
    DEFAULT_ENCOUNTER_TRIGGER_STATE,
    EncounterTriggerConfig,
    evaluateCommitEncounter,
    evaluateSaveStreakEncounter,
} from '../../extension/encounter-trigger';

const CONFIG: EncounterTriggerConfig = {
    commitChance: 0.5,
    cooldownMinutes: 10,
    savesPerEncounter: 3,
};

suite('encounter-trigger', () => {
    test('evaluateCommitEncounter spawns when the roll beats the chance and off cooldown', () => {
        const decision = evaluateCommitEncounter(
            DEFAULT_ENCOUNTER_TRIGGER_STATE,
            CONFIG,
            Date.now(),
            false,
            () => 0,
        );
        assert.strictEqual(decision.shouldSpawn, true);
        assert.ok(decision.nextState.lastSpawnAt !== undefined);
    });

    test('evaluateCommitEncounter does not spawn when the roll loses', () => {
        const decision = evaluateCommitEncounter(
            DEFAULT_ENCOUNTER_TRIGGER_STATE,
            CONFIG,
            Date.now(),
            false,
            () => 0.99,
        );
        assert.strictEqual(decision.shouldSpawn, false);
    });

    test('evaluateCommitEncounter never spawns while one is already active', () => {
        const decision = evaluateCommitEncounter(
            DEFAULT_ENCOUNTER_TRIGGER_STATE,
            CONFIG,
            Date.now(),
            true,
            () => 0,
        );
        assert.strictEqual(decision.shouldSpawn, false);
    });

    test('evaluateCommitEncounter respects the cooldown', () => {
        const now = Date.now();
        const state = { ...DEFAULT_ENCOUNTER_TRIGGER_STATE, lastSpawnAt: now - 60 * 1000 };
        const decision = evaluateCommitEncounter(state, CONFIG, now, false, () => 0);
        assert.strictEqual(decision.shouldSpawn, false);
    });

    test('evaluateCommitEncounter spawns again once the cooldown has elapsed', () => {
        const now = Date.now();
        const state = {
            ...DEFAULT_ENCOUNTER_TRIGGER_STATE,
            lastSpawnAt: now - (CONFIG.cooldownMinutes + 1) * 60 * 1000,
        };
        const decision = evaluateCommitEncounter(state, CONFIG, now, false, () => 0);
        assert.strictEqual(decision.shouldSpawn, true);
    });

    test('evaluateSaveStreakEncounter spawns only once the streak threshold is reached', () => {
        const now = Date.now();
        let state = DEFAULT_ENCOUNTER_TRIGGER_STATE;
        let lastDecision;
        for (let i = 0; i < CONFIG.savesPerEncounter; i++) {
            lastDecision = evaluateSaveStreakEncounter(state, CONFIG, now, false);
            state = lastDecision.nextState;
        }
        assert.strictEqual(lastDecision?.shouldSpawn, true);
        assert.strictEqual(state.saveStreakCount, 0);
    });

    test('evaluateSaveStreakEncounter does not spawn before the threshold', () => {
        const now = Date.now();
        const decision = evaluateSaveStreakEncounter(
            { ...DEFAULT_ENCOUNTER_TRIGGER_STATE, saveStreakCount: 0 },
            CONFIG,
            now,
            false,
        );
        assert.strictEqual(decision.shouldSpawn, false);
        assert.strictEqual(decision.nextState.saveStreakCount, 1);
    });

    test('evaluateSaveStreakEncounter never spawns while one is already active', () => {
        const now = Date.now();
        const state = { ...DEFAULT_ENCOUNTER_TRIGGER_STATE, saveStreakCount: CONFIG.savesPerEncounter - 1 };
        const decision = evaluateSaveStreakEncounter(state, CONFIG, now, true);
        assert.strictEqual(decision.shouldSpawn, false);
    });
});
