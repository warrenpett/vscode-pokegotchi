import { POKEMON_DATA } from "./pokemon-data";

export const enum PokemonColor {
    default = 'default',
    shiny = 'shiny',
    null = 'null',
}

export enum PokemonGeneration {
    Gen1 = 1,
    Gen2 = 2,
    // Gen3 = 3,
}

export type PokemonTypeString = string & keyof typeof POKEMON_DATA;

export type PokemonType = PokemonTypeString;

export interface PokemonConfig {
    id: number;
    name: string;
    generation: PokemonGeneration;
    cry: string;
    possibleColors: PokemonColor[];
    originalSpriteSize?: number,
    evolvesTo?: PokemonType;
    evolvesAtLevel?: number;
    baseStats?: {
        power: number;
        guts: number;
    };
}

export const enum PokemonSpeed {
    still = 0,
    verySlow = 1,
    slow = 2,
    normal = 3,
    fast = 4,
    veryFast = 5,
}

export const enum PokemonSize {
    nano = 'nano',
    small = 'small',
    medium = 'medium',
    large = 'large',
}

export const enum ExtPosition {
    panel = 'panel',
    explorer = 'explorer',
}

export const enum Theme {
    none = 'none',
    forest = 'forest',
    castle = 'castle',
    beach = 'beach',
}

export const enum ColorThemeKind {
    light = 1,
    dark = 2,
    highContrast = 3,
}

export class WebviewMessage {
    text: string;
    command: string;
    payload?: Record<string, unknown>;

    constructor(text: string, command: string, payload?: Record<string, unknown>) {
        this.text = text;
        this.command = command;
        this.payload = payload;
    }
}

export interface ActivityTickPayload {
    pokemonName: string;
    level: number;
    xp: number;
    xpToNextLevel: number;
}

export interface LevelUpPayload {
    pokemonName: string;
    newLevel: number;
}

export interface EncounterSpawnPayload {
    encounterId: string;
    type: PokemonType;
    color: PokemonColor;
    generation: string;
    originalSpriteSize: number;
    name: string;
}

export interface BattleResultPayload {
    encounterId: string;
    won: boolean;
}

export const ALL_COLORS = [
    PokemonColor.default,
];
export const ALL_SCALES = [
    PokemonSize.nano,
    PokemonSize.small,
    PokemonSize.medium,
    PokemonSize.large,
];
export const ALL_THEMES = [Theme.none, Theme.forest, Theme.castle, Theme.beach];