import * as assert from 'assert';
import { getEvolvedType } from '../../common/pokemon-data';

suite('evolution', () => {
    test('does not evolve below the threshold level', () => {
        assert.strictEqual(getEvolvedType('bulbasaur', 7), 'bulbasaur');
    });

    test('evolves once the threshold level is reached', () => {
        assert.strictEqual(getEvolvedType('bulbasaur', 8), 'ivysaur');
    });

    test('resolves multiple evolution steps from a single big level jump', () => {
        assert.strictEqual(getEvolvedType('bulbasaur', 20), 'venusaur');
    });

    test('a fully evolved species with no evolvesTo stays the same', () => {
        assert.strictEqual(getEvolvedType('venusaur', 100), 'venusaur');
    });

    test('a species with no evolution data at all stays the same', () => {
        assert.strictEqual(getEvolvedType('pikachu', 100), 'pikachu');
    });
});
