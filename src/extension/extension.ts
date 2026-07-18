import * as vscode from 'vscode';
import { ColorThemeKind } from 'vscode';
import {
    PokemonSize,
    PokemonColor,
    PokemonType,
    ExtPosition,
    Theme,
    WebviewMessage,
    ALL_COLORS,
    ALL_SCALES,
    ALL_THEMES,
    PokemonGeneration,
    ActivityTickPayload,
    LevelUpPayload,
    EncounterSpawnPayload,
    BattleResultPayload,
} from '../common/types';
import { randomName } from '../common/names';
import * as localize from '../common/localize';
import { availableColors, normalizeColor } from '../panel/pokemon-collection';
import { getDefaultPokemon, getPokemonByGeneration, getRandomPokemonConfig, POKEMON_DATA } from '../common/pokemon-data';
import { ProgressMap, PokemonProgress, DEFAULT_PROGRESS, applyXp, xpForLevel } from '../common/progression';
import { DEFAULT_BATTLE_STATS, resolveBattle } from '../common/battle';
import { ActivityTracker } from './activity-tracker';
import {
    DEFAULT_ENCOUNTER_TRIGGER_STATE,
    EncounterTriggerState,
    evaluateCommitEncounter,
    evaluateSaveStreakEncounter,
} from './encounter-trigger';

const EXTRA_POKEMON_KEY = 'vscode-pokemon.extra-pokemon';
const EXTRA_POKEMON_KEY_TYPES = EXTRA_POKEMON_KEY + '.types';
const EXTRA_POKEMON_KEY_COLORS = EXTRA_POKEMON_KEY + '.colors';
const EXTRA_POKEMON_KEY_NAMES = EXTRA_POKEMON_KEY + '.names';
const EXTRA_POKEMON_KEY_PROGRESS = EXTRA_POKEMON_KEY + '.progress';
const DEFAULT_POKEMON_SCALE = PokemonSize.nano;
const DEFAULT_COLOR = PokemonColor.default;
const DEFAULT_POKEMON_TYPE = getDefaultPokemon();
const DEFAULT_POSITION = ExtPosition.panel;
const DEFAULT_THEME = Theme.none;

class PokemonQuickPickItem implements vscode.QuickPickItem {
    constructor(
        public readonly name_: string,
        public readonly type: string,
        public readonly color: string,
    ) {
        this.name = name_;
        this.label = name_;
        this.description = `${color} ${type}`;
    }

    name: string;
    label: string;
    kind?: vscode.QuickPickItemKind | undefined;
    description?: string | undefined;
    detail?: string | undefined;
    picked?: boolean | undefined;
    alwaysShow?: boolean | undefined;
    buttons?: readonly vscode.QuickInputButton[] | undefined;
}

let webviewViewProvider: PokemonWebviewViewProvider;
let activeExtensionContext: vscode.ExtensionContext | undefined;

interface ActiveEncounter {
    encounterId: string;
    type: PokemonType;
    level: number;
}
let activeEncounter: ActiveEncounter | undefined;
let encounterTriggerState: EncounterTriggerState = { ...DEFAULT_ENCOUNTER_TRIGGER_STATE };

function getConfiguredSize(): PokemonSize {
    var size = vscode.workspace
        .getConfiguration('vscode-pokemon')
        .get<PokemonSize>('pokemonSize', DEFAULT_POKEMON_SCALE);
    if (ALL_SCALES.lastIndexOf(size) === -1) {
        size = DEFAULT_POKEMON_SCALE;
    }
    return size;
}

function getConfiguredTheme(): Theme {
    var theme = vscode.workspace
        .getConfiguration('vscode-pokemon')
        .get<Theme>('theme', DEFAULT_THEME);
    if (ALL_THEMES.lastIndexOf(theme) === -1) {
        theme = DEFAULT_THEME;
    }
    return theme;
}

function getConfiguredThemeKind(): ColorThemeKind {
    return vscode.window.activeColorTheme.kind;
}

function getConfigurationPosition() {
    return vscode.workspace
        .getConfiguration('vscode-pokemon')
        .get<ExtPosition>('position', DEFAULT_POSITION);
}

function getThrowWithMouseConfiguration(): boolean {
    return vscode.workspace
        .getConfiguration('vscode-pokemon')
        .get<boolean>('throwBallWithMouse', true);
}

function updatePanelThrowWithMouse(): void {
    const panel = getPokemonPanel();
    if (panel !== undefined) {
        panel.setThrowWithMouse(getThrowWithMouseConfiguration());
    }
}

async function updateExtensionPositionContext() {
    await vscode.commands.executeCommand(
        'setContext',
        'vscode-pokemon.position',
        getConfigurationPosition(),
    );
}

export class PokemonSpecification {
    color: PokemonColor;
    type: PokemonType;
    size: PokemonSize;
    name: string;
    generation: string;
    originalSpriteSize: number;

    constructor(color: PokemonColor, type: PokemonType, size: PokemonSize, name?: string, generation?: string, originalSpriteSize?: number) {
        this.color = color;
        this.type = type;
        this.size = size;
        if (!name) {
            this.name = randomName(type);
        } else {
            this.name = name;
        }
        this.generation = generation || `gen${POKEMON_DATA[type].generation}`;
        this.originalSpriteSize = POKEMON_DATA[type].originalSpriteSize || 32;
    }

    static fromConfiguration(): PokemonSpecification {
        var color = vscode.workspace
            .getConfiguration('vscode-pokemon')
            .get<PokemonColor>('pokemonColor', DEFAULT_COLOR);
        if (ALL_COLORS.lastIndexOf(color) === -1) {
            color = DEFAULT_COLOR;
        }
        var type = vscode.workspace
            .getConfiguration('vscode-pokemon')
            .get<PokemonType>('pokemonType', DEFAULT_POKEMON_TYPE);

        // Use POKEMON_DATA to validate the type
        if (!POKEMON_DATA[type]) {
            type = DEFAULT_POKEMON_TYPE;
        }

        return new PokemonSpecification(color, type, getConfiguredSize());
    }

    static collectionFromMemento(
        context: vscode.ExtensionContext,
        size: PokemonSize,
    ): PokemonSpecification[] {
        var contextTypes = context.globalState.get<PokemonType[]>(
            EXTRA_POKEMON_KEY_TYPES,
            [],
        );
        var contextColors = context.globalState.get<PokemonColor[]>(
            EXTRA_POKEMON_KEY_COLORS,
            [],
        );
        var contextNames = context.globalState.get<string[]>(
            EXTRA_POKEMON_KEY_NAMES,
            [],
        );
        var result: PokemonSpecification[] = new Array();
        for (let index = 0; index < contextTypes.length; index++) {
            result.push(
                new PokemonSpecification(
                    contextColors?.[index] ?? DEFAULT_COLOR,
                    contextTypes[index],
                    size,
                    contextNames[index],
                ),
            );
        }
        return result;
    }
}

export async function storeCollectionAsMemento(
    context: vscode.ExtensionContext,
    collection: PokemonSpecification[],
) {
    var contextTypes = new Array(collection.length);
    var contextColors = new Array(collection.length);
    var contextNames = new Array(collection.length);
    for (let index = 0; index < collection.length; index++) {
        contextTypes[index] = collection[index].type;
        contextColors[index] = collection[index].color;
        contextNames[index] = collection[index].name;
    }
    await context.globalState.update(EXTRA_POKEMON_KEY_TYPES, contextTypes);
    await context.globalState.update(EXTRA_POKEMON_KEY_COLORS, contextColors);
    await context.globalState.update(EXTRA_POKEMON_KEY_NAMES, contextNames);
    context.globalState.setKeysForSync([
        EXTRA_POKEMON_KEY_TYPES,
        EXTRA_POKEMON_KEY_COLORS,
        EXTRA_POKEMON_KEY_NAMES,
        EXTRA_POKEMON_KEY_PROGRESS,
    ]);
}

function getProgressMap(context: vscode.ExtensionContext): ProgressMap {
    return context.globalState.get<ProgressMap>(EXTRA_POKEMON_KEY_PROGRESS, {});
}

async function storeProgressMap(context: vscode.ExtensionContext, map: ProgressMap) {
    await context.globalState.update(EXTRA_POKEMON_KEY_PROGRESS, map);
}

/**
 * The single pokemon that earns coding-activity XP: the first entry in the
 * persisted collection order (i.e. the first one the player spawned).
 */
function getActivePokemonName(context: vscode.ExtensionContext): string | undefined {
    return context.globalState.get<string[]>(EXTRA_POKEMON_KEY_NAMES, [])[0];
}

interface ActivitySettings {
    xpPerSave: number;
    xpPerCommit: number;
    dailyXpCap: number;
    focusIdleMinutes: number;
}

function isActivityTrackingEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('vscode-pokemon')
        .get<boolean>('activity.enabled', true);
}

function getActivitySettings(): ActivitySettings {
    const config = vscode.workspace.getConfiguration('vscode-pokemon');
    return {
        xpPerSave: config.get<number>('activity.xpPerSave', 10),
        xpPerCommit: config.get<number>('activity.xpPerCommit', 50),
        dailyXpCap: config.get<number>('activity.dailyXpCap', 500),
        focusIdleMinutes: config.get<number>('activity.focusIdleMinutes', 2),
    };
}

interface EncounterSettings {
    enabled: boolean;
    commitChance: number;
    cooldownMinutes: number;
    savesPerEncounter: number;
}

function getEncounterSettings(): EncounterSettings {
    const config = vscode.workspace.getConfiguration('vscode-pokemon');
    return {
        enabled: config.get<boolean>('encounters.enabled', true),
        commitChance: config.get<number>('encounters.commitChance', 0.4),
        cooldownMinutes: config.get<number>('encounters.cooldownMinutes', 10),
        savesPerEncounter: config.get<number>('encounters.savesPerEncounter', 15),
    };
}

/**
 * Spawns a random wild pokemon in whichever panel is live, roughly matched
 * to the active pokemon's level, and remembers it host-side so a later
 * `battle-start` message can be resolved authoritatively.
 */
function spawnWildEncounter(context: vscode.ExtensionContext): void {
    const panel = getPokemonPanel();
    if (!panel) {
        return;
    }
    const [wildType, wildConfig] = getRandomPokemonConfig();
    const activeName = getActivePokemonName(context);
    const activeLevel = activeName ? getProgressMap(context)[activeName]?.level ?? 1 : 1;
    const wildLevel = Math.max(1, activeLevel + Math.floor(Math.random() * 5) - 2);
    const encounterId = `encounter-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    activeEncounter = { encounterId, type: wildType, level: wildLevel };
    panel.spawnEncounter({
        encounterId,
        type: wildType,
        color: wildConfig.possibleColors[0],
        generation: `gen${wildConfig.generation}`,
        originalSpriteSize: wildConfig.originalSpriteSize ?? 32,
        name: `Wild ${wildConfig.name}`,
    });
}

function maybeSpawnCommitEncounter(context: vscode.ExtensionContext): void {
    const settings = getEncounterSettings();
    if (!settings.enabled) {
        return;
    }
    const decision = evaluateCommitEncounter(
        encounterTriggerState,
        settings,
        Date.now(),
        activeEncounter !== undefined,
    );
    encounterTriggerState = decision.nextState;
    if (decision.shouldSpawn) {
        spawnWildEncounter(context);
    }
}

function maybeSpawnSaveStreakEncounter(context: vscode.ExtensionContext): void {
    const settings = getEncounterSettings();
    if (!settings.enabled) {
        return;
    }
    const decision = evaluateSaveStreakEncounter(
        encounterTriggerState,
        settings,
        Date.now(),
        activeEncounter !== undefined,
    );
    encounterTriggerState = decision.nextState;
    if (decision.shouldSpawn) {
        spawnWildEncounter(context);
    }
}

/**
 * Resolves a `battle-start` request from the webview. Battle resolution is
 * host-authoritative so it can't be gamed by inspecting/modifying the
 * webview - the wild pokemon's identity is only ever known here.
 */
async function handleBattleStart(context: vscode.ExtensionContext, encounterId: string): Promise<void> {
    if (!activeEncounter || activeEncounter.encounterId !== encounterId) {
        return;
    }
    const encounter = activeEncounter;
    activeEncounter = undefined;

    const activeName = getActivePokemonName(context);
    const playerProgress = activeName
        ? getProgressMap(context)[activeName] ?? DEFAULT_PROGRESS
        : DEFAULT_PROGRESS;
    const collection = PokemonSpecification.collectionFromMemento(context, getConfiguredSize());
    const playerType = collection[0]?.type;
    const playerStats = (playerType ? POKEMON_DATA[playerType]?.baseStats : undefined) ?? DEFAULT_BATTLE_STATS;
    const wildStats = POKEMON_DATA[encounter.type]?.baseStats ?? DEFAULT_BATTLE_STATS;

    const result = resolveBattle(playerProgress.level, playerStats, encounter.level, wildStats);

    const activitySettings = getActivitySettings();
    const xpAwarded = result.won
        ? Math.round(activitySettings.xpPerCommit * 1.5)
        : Math.round(activitySettings.xpPerCommit * 0.2);
    await awardActivityXp(context, xpAwarded);

    const panel = getPokemonPanel();
    panel?.postBattleResult({ encounterId, won: result.won });

    const wildName = POKEMON_DATA[encounter.type]?.name ?? encounter.type;
    void vscode.window.showInformationMessage(
        result.won
            ? vscode.l10n.t('You won the battle against the wild {0}! Bonus XP earned.', wildName)
            : vscode.l10n.t('The wild {0} got away this time.', wildName),
    );
}

/**
 * Grants XP earned from coding activity to the active pokemon, persists the
 * result, and notifies whichever panel is live so it can update the UI.
 */
async function awardActivityXp(
    context: vscode.ExtensionContext,
    amount: number,
): Promise<void> {
    const activeName = getActivePokemonName(context);
    if (!activeName) {
        return;
    }
    const progressMap = getProgressMap(context);
    const current: PokemonProgress = progressMap[activeName] ?? { ...DEFAULT_PROGRESS };
    const result = applyXp(current, amount);
    progressMap[activeName] = result.progress;
    await storeProgressMap(context, progressMap);

    updateStatusBar();

    const panel = getPokemonPanel();
    if (!panel) {
        return;
    }
    panel.postActivityTick({
        pokemonName: activeName,
        level: result.progress.level,
        xp: result.progress.xp,
        xpToNextLevel: xpForLevel(result.progress.level),
    });
    if (result.leveledUp && result.newLevel !== undefined) {
        panel.postLevelUp({ pokemonName: activeName, newLevel: result.newLevel });
    }
}

/**
 * Pushes the active pokemon's current level/XP to whichever panel is live -
 * used right after the panel (re)spawns its collection so the level badge
 * and XP bar populate immediately instead of waiting for the next activity
 * event.
 */
function pushActivitySnapshot(context: vscode.ExtensionContext): void {
    const activeName = getActivePokemonName(context);
    if (!activeName) {
        return;
    }
    const progress = getProgressMap(context)[activeName];
    if (!progress) {
        return;
    }
    const panel = getPokemonPanel();
    panel?.postActivityTick({
        pokemonName: activeName,
        level: progress.level,
        xp: progress.xp,
        xpToNextLevel: xpForLevel(progress.level),
    });
}

let spawnPokemonStatusBar: vscode.StatusBarItem;

interface IPokemonInfo {
    type: PokemonType;
    name: string;
    color: PokemonColor;
}

async function handleRemovePokemonMessage(
    this: vscode.ExtensionContext,
    message: WebviewMessage,
) {
    var pokemonList: IPokemonInfo[] = Array();
    switch (message.command) {
        case 'list-pokemon':
            message.text.split('\n').forEach((pokemon) => {
                if (!pokemon) {
                    return;
                }
                var parts = pokemon.split(',');
                pokemonList.push({
                    type: parts[0] as PokemonType,
                    name: parts[1],
                    color: parts[2] as PokemonColor,
                });
            });
            break;
        default:
            return;
    }
    if (!pokemonList) {
        return;
    }
    if (!pokemonList.length) {
        await vscode.window.showErrorMessage(
            vscode.l10n.t('There are no pokemon to remove.'),
        );
        return;
    }
    await vscode.window
        .showQuickPick<PokemonQuickPickItem>(
            pokemonList.map((val) => {
                return new PokemonQuickPickItem(val.name, val.type, val.color);
            }),
            {
                placeHolder: vscode.l10n.t('Select the pokemon to remove.'),
            },
        )
        .then(async (pokemon: PokemonQuickPickItem | undefined) => {
            if (pokemon) {
                const panel = getPokemonPanel();
                if (panel !== undefined) {
                    panel.deletePokemon(pokemon.name);
                    const collection = pokemonList
                        .filter((item) => {
                            return item.name !== pokemon.name;
                        })
                        .map<PokemonSpecification>((item) => {
                            return new PokemonSpecification(
                                item.color,
                                item.type,
                                PokemonSize.medium,
                                item.name,
                            );
                        });
                    await storeCollectionAsMemento(this, collection);
                }
            }
        });
}

function getPokemonPanel(): IPokemonPanel | undefined {
    if (
        getConfigurationPosition() === ExtPosition.explorer &&
        webviewViewProvider
    ) {
        return webviewViewProvider;
    } else if (PokemonPanel.currentPanel) {
        return PokemonPanel.currentPanel;
    } else {
        return undefined;
    }
}

function getWebview(): vscode.Webview | undefined {
    if (
        getConfigurationPosition() === ExtPosition.explorer &&
        webviewViewProvider
    ) {
        return webviewViewProvider.getWebview();
    } else if (PokemonPanel.currentPanel) {
        return PokemonPanel.currentPanel.getWebview();
    }
}

export function activate(context: vscode.ExtensionContext) {
    activeExtensionContext = context;

    const activityTracker = new ActivityTracker({
        context,
        isEnabled: isActivityTrackingEnabled,
        getConfig: getActivitySettings,
        onXpEarned: (amount, source) => {
            void awardActivityXp(context, amount);
            if (source === 'commit') {
                maybeSpawnCommitEncounter(context);
            } else if (source === 'save') {
                maybeSpawnSaveStreakEncounter(context);
            }
        },
    });
    activityTracker.register();
    context.subscriptions.push(activityTracker);

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-pokemon.start', async () => {
            if (
                getConfigurationPosition() === ExtPosition.explorer &&
                webviewViewProvider
            ) {
                await vscode.commands.executeCommand('pokemonView.focus');
            } else {
                const spec = PokemonSpecification.fromConfiguration();
                PokemonPanel.createOrShow(
                    context.extensionUri,
                    spec.color,
                    spec.type,
                    spec.size,
                    spec.generation,
                    spec.originalSpriteSize,
                    getConfiguredTheme(),
                    getConfiguredThemeKind(),
                    getThrowWithMouseConfiguration(),
                );

                if (PokemonPanel.currentPanel) {
                    var collection = PokemonSpecification.collectionFromMemento(
                        context,
                        getConfiguredSize(),
                    );
                    collection.forEach((item) => {
                        PokemonPanel.currentPanel?.spawnPokemon(item);
                    });
                    // Store the collection in the memento, incase any of the null values (e.g. name) have been set
                    await storeCollectionAsMemento(context, collection);
                    pushActivitySnapshot(context);
                }
            }
        }),
    );

    spawnPokemonStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100,
    );
    spawnPokemonStatusBar.command = 'vscode-pokemon.spawn-pokemon';
    context.subscriptions.push(spawnPokemonStatusBar);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
    );
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(updateStatusBar),
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(
            updateExtensionPositionContext,
        ),
    );
    updateStatusBar();

    const spec = PokemonSpecification.fromConfiguration();
    webviewViewProvider = new PokemonWebviewViewProvider(
        context.extensionUri,
        spec.color,
        spec.type,
        spec.size,
        spec.generation,
        spec.originalSpriteSize,
        getConfiguredTheme(),
        getConfiguredThemeKind(),
        getThrowWithMouseConfiguration(),
    );
    updateExtensionPositionContext().catch((e) => {
        console.error(e);
    });

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            PokemonWebviewViewProvider.viewType,
            webviewViewProvider,
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-pokemon.delete-pokemon', async () => {
            const panel = getPokemonPanel();
            if (panel !== undefined) {
                panel.listPokemon();
                getWebview()?.onDidReceiveMessage(
                    handleRemovePokemonMessage,
                    context,
                );
            } else {
                await createPokemonPlayground(context);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-pokemon.roll-call', async () => {
            const panel = getPokemonPanel();
            if (panel !== undefined) {
                panel.rollCall();
            } else {
                await createPokemonPlayground(context);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-pokemon.trigger-test-encounter', () => {
            spawnWildEncounter(context);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'vscode-pokemon.export-pokemon-list',
            async () => {
                const pokemonCollection = PokemonSpecification.collectionFromMemento(
                    context,
                    getConfiguredSize(),
                );
                const pokemonJson = JSON.stringify(pokemonCollection, null, 2);
                const fileName = `pokemonCollection-${Date.now()}.json`;
                if (!vscode.workspace.workspaceFolders) {
                    await vscode.window.showErrorMessage(
                        vscode.l10n.t(
                            'You must have a folder or workspace open to export pokemonCollection.',
                        ),
                    );
                    return;
                }
                const filePath = vscode.Uri.joinPath(
                    vscode.workspace.workspaceFolders[0].uri,
                    fileName,
                );
                const newUri = vscode.Uri.file(fileName).with({
                    scheme: 'untitled',
                    path: filePath.fsPath,
                });
                await vscode.workspace
                    .openTextDocument(newUri)
                    .then(async (doc) => {
                        await vscode.window
                            .showTextDocument(doc)
                            .then(async (editor) => {
                                await editor.edit((edit) => {
                                    edit.insert(
                                        new vscode.Position(0, 0),
                                        pokemonJson,
                                    );
                                });
                            });
                    });
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'vscode-pokemon.import-pokemon-list',
            async () => {
                const options: vscode.OpenDialogOptions = {
                    canSelectMany: false,
                    openLabel: 'Open pokemonCollection.json',
                    filters: {
                        json: ['json'],
                    },
                };
                const fileUri = await vscode.window.showOpenDialog(options);

                if (fileUri && fileUri[0]) {
                    console.log('Selected file: ' + fileUri[0].fsPath);
                    try {
                        const fileContents = await vscode.workspace.fs.readFile(
                            fileUri[0],
                        );
                        const pokemonToLoad = JSON.parse(
                            String.fromCharCode.apply(
                                null,
                                Array.from(fileContents),
                            ),
                        );

                        // load the pokemon into the collection
                        var collection = PokemonSpecification.collectionFromMemento(
                            context,
                            getConfiguredSize(),
                        );
                        // fetch just the pokemon types
                        const panel = getPokemonPanel();
                        for (let i = 0; i < pokemonToLoad.length; i++) {
                            const pokemon = pokemonToLoad[i];
                            const pokemonSpec = new PokemonSpecification(
                                normalizeColor(pokemon.color, pokemon.type),
                                pokemon.type,
                                pokemon.size,
                                pokemon.name,
                            );
                            collection.push(pokemonSpec);
                            if (panel !== undefined) {
                                panel.spawnPokemon(pokemonSpec);
                            }
                        }
                        await storeCollectionAsMemento(context, collection);
                    } catch (e: any) {
                        await vscode.window.showErrorMessage(
                            vscode.l10n.t(
                                'Failed to import pokemon: {0}',
                                e?.message,
                            ),
                        );
                    }
                }
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-pokemon.spawn-pokemon', async () => {
            const panel = getPokemonPanel();
            if (getConfigurationPosition() === ExtPosition.explorer && webviewViewProvider) {
                await vscode.commands.executeCommand('pokemonView.focus');
            }
            if (panel) {
                // First, select a generation
                const generations = Object.values(PokemonGeneration)
                    .filter(gen => typeof gen === 'number')
                    .map(gen => ({
                        label: `Generation ${gen}`,
                        value: gen as PokemonGeneration,
                        description: `Gen ${gen} Pokémon`
                    }));

                const selectedGeneration = await vscode.window.showQuickPick(
                    generations,
                    {
                        placeHolder: vscode.l10n.t('Select a generation'),
                    }
                );

                if (!selectedGeneration) {
                    console.log('Cancelled Spawning Pokemon - No Generation Selected');
                    return;
                }

                // Get Pokémon from selected generation
                const pokemonInGeneration = getPokemonByGeneration(selectedGeneration.value);
                const pokemonOptions = pokemonInGeneration.map(type => ({
                    label: POKEMON_DATA[type].name,
                    value: type,
                    description: `#${POKEMON_DATA[type].id.toString().padStart(4, '0')}`
                }));

                const selectedPokemonType = await vscode.window.showQuickPick(
                    pokemonOptions,
                    {
                        placeHolder: vscode.l10n.t('Select a Pokémon'),
                    }
                );

                if (!selectedPokemonType) {
                    console.log('Cancelled Spawning Pokemon - No Pokémon Selected');
                    return;
                }

                // Rest of the existing code
                var pokemonColor: PokemonColor = DEFAULT_COLOR;
                const possibleColors = availableColors(selectedPokemonType.value);

                if (possibleColors.length > 1) {
                    var selectedColor = await vscode.window.showQuickPick(
                        localize.stringListAsQuickPickItemList<PokemonColor>(
                            possibleColors,
                        ),
                        {
                            placeHolder: vscode.l10n.t('Select a color'),
                        },
                    );
                    if (!selectedColor) {
                        console.log('Cancelled Spawning Pokemon - No Color Selected');
                        return;
                    }
                    pokemonColor = selectedColor.value;
                } else {
                    pokemonColor = possibleColors[0];
                }

                const name = await vscode.window.showInputBox({
                    placeHolder: vscode.l10n.t('Leave blank for a random name'),
                    prompt: vscode.l10n.t('Name your Pokémon'),
                    value: randomName(selectedPokemonType.value),
                });

                const spec = new PokemonSpecification(
                    pokemonColor,
                    selectedPokemonType.value,
                    getConfiguredSize(),
                    name,
                );

                panel.spawnPokemon(spec);
                var collection = PokemonSpecification.collectionFromMemento(
                    context,
                    getConfiguredSize(),
                );
                collection.push(spec);
                await storeCollectionAsMemento(context, collection);
            } else {
                await createPokemonPlayground(context);
                await vscode.window.showInformationMessage(
                    vscode.l10n.t(
                        "A Pokemon Playground has been created. You can now use the 'Spawn Additional Pokemon' Command to add more Pokemon.",
                    ),
                );
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-pokemon.spawn-random-pokemon', async () => {
            const panel = getPokemonPanel();
            if (getConfigurationPosition() === ExtPosition.explorer && webviewViewProvider) {
                await vscode.commands.executeCommand('pokemonView.focus');
            }
            if (panel) {
                var [randomPokemonType, randomPokemonConfig] = getRandomPokemonConfig();
                const spec = new PokemonSpecification(
                    randomPokemonConfig.possibleColors[0],
                    randomPokemonType,
                    getConfiguredSize(),
                    randomPokemonConfig.name,
                );

                panel.spawnPokemon(spec);
                var collection = PokemonSpecification.collectionFromMemento(
                    context,
                    getConfiguredSize(),
                );
                collection.push(spec);
                await storeCollectionAsMemento(context, collection);

            } else {
                await createPokemonPlayground(context);
                await vscode.window.showInformationMessage(
                    vscode.l10n.t(
                        "A Pokemon Playground has been created. You can now use the 'Remove All Pokemon' Command to remove all Pokemon.",
                    ),
                );
            }
        }))

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'vscode-pokemon.remove-all-pokemon',
            async () => {
                const panel = getPokemonPanel();
                if (panel !== undefined) {
                    panel.resetPokemon();
                    await storeCollectionAsMemento(context, []);
                } else {
                    await createPokemonPlayground(context);
                    await vscode.window.showInformationMessage(
                        vscode.l10n.t(
                            "A Pokemon Playground has been created. You can now use the 'Remove All Pokemon' Command to remove all Pokemon.",
                        ),
                    );
                }
            },
        ),
    );

    // Listening to configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(
            (e: vscode.ConfigurationChangeEvent): void => {
                if (
                    e.affectsConfiguration('vscode-pokemon.pokemonColor') ||
                    e.affectsConfiguration('vscode-pokemon.pokemonType') ||
                    e.affectsConfiguration('vscode-pokemon.pokemonSize') ||
                    e.affectsConfiguration('vscode-pokemon.theme') ||
                    e.affectsConfiguration('workbench.colorTheme')
                ) {
                    const spec = PokemonSpecification.fromConfiguration();
                    const panel = getPokemonPanel();
                    if (panel) {
                        panel.updatePokemonColor(spec.color);
                        panel.updatePokemonSize(spec.size);
                        panel.updatePokemonType(spec.type);
                        panel.updateTheme(
                            getConfiguredTheme(),
                            getConfiguredThemeKind(),
                        );
                        panel.update();
                    }
                }

                if (e.affectsConfiguration('vscode-pokemon.position')) {
                    void updateExtensionPositionContext();
                }

                if (e.affectsConfiguration('vscode-pokemon.throwBallWithMouse')) {
                    updatePanelThrowWithMouse();
                }
            },
        ),
    );

    if (vscode.window.registerWebviewPanelSerializer) {
        // Make sure we register a serializer in activation event
        vscode.window.registerWebviewPanelSerializer(PokemonPanel.viewType, {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
                // Reset the webview options so we use latest uri for `localResourceRoots`.
                webviewPanel.webview.options = getWebviewOptions(
                    context.extensionUri,
                );
                const spec = PokemonSpecification.fromConfiguration();
                PokemonPanel.revive(
                    webviewPanel,
                    context.extensionUri,
                    spec.color,
                    spec.type,
                    spec.size,
                    spec.generation,
                    spec.originalSpriteSize,
                    getConfiguredTheme(),
                    getConfiguredThemeKind(),
                    getThrowWithMouseConfiguration(),
                );
            },
        });
    }
}

function updateStatusBar(): void {
    const activeName = activeExtensionContext ? getActivePokemonName(activeExtensionContext) : undefined;
    const progress = activeName && activeExtensionContext
        ? getProgressMap(activeExtensionContext)[activeName]
        : undefined;

    if (activeName && progress) {
        spawnPokemonStatusBar.text = `$(squirrel) Lv.${progress.level} (${progress.xp}/${xpForLevel(progress.level)})`;
        spawnPokemonStatusBar.tooltip = vscode.l10n.t('{0} - Level {1}', activeName, progress.level);
    } else {
        spawnPokemonStatusBar.text = `$(squirrel)`;
        spawnPokemonStatusBar.tooltip = vscode.l10n.t('Spawn Pokemon');
    }
    spawnPokemonStatusBar.show();
}

export function spawnPokemonDeactivate() {
    spawnPokemonStatusBar.dispose();
}

function getWebviewOptions(
    extensionUri: vscode.Uri,
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,
        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    };
}

interface IPokemonPanel {
    // throwBall(): void;
    resetPokemon(): void;
    spawnPokemon(spec: PokemonSpecification): void;
    deletePokemon(pokemonName: string): void;
    listPokemon(): void;
    rollCall(): void;
    themeKind(): vscode.ColorThemeKind;
    throwBallWithMouse(): boolean;
    updatePokemonColor(newColor: PokemonColor): void;
    updatePokemonType(newType: PokemonType): void;
    updatePokemonSize(newSize: PokemonSize): void;
    updateTheme(newTheme: Theme, themeKind: vscode.ColorThemeKind): void;
    update(): void;
    setThrowWithMouse(newThrowWithMouse: boolean): void;
    postActivityTick(payload: ActivityTickPayload): void;
    postLevelUp(payload: LevelUpPayload): void;
    spawnEncounter(payload: EncounterSpawnPayload): void;
    postBattleResult(payload: BattleResultPayload): void;
}

class PokemonWebviewContainer implements IPokemonPanel {
    protected _extensionUri: vscode.Uri;
    protected _disposables: vscode.Disposable[] = [];
    protected _pokemonColor: PokemonColor;
    protected _pokemonType: PokemonType;
    protected _pokemonSize: PokemonSize;
    protected _pokemonGeneration: string;
    protected _pokemonOriginalSpriteSize: number;
    protected _theme: Theme;
    protected _themeKind: vscode.ColorThemeKind;
    protected _throwBallWithMouse: boolean;

    constructor(
        extensionUri: vscode.Uri,
        color: PokemonColor,
        type: PokemonType,
        size: PokemonSize,
        generation: string,
        originalSpriteSize: number,
        theme: Theme,
        themeKind: ColorThemeKind,
        throwBallWithMouse: boolean,
    ) {
        this._extensionUri = extensionUri;
        this._pokemonColor = color;
        this._pokemonType = type;
        this._pokemonSize = size;
        this._pokemonGeneration = generation;
        this._pokemonOriginalSpriteSize = originalSpriteSize;
        this._theme = theme;
        this._themeKind = themeKind;
        this._throwBallWithMouse = throwBallWithMouse;
    }

    public pokemonColor(): PokemonColor {
        return normalizeColor(this._pokemonColor, this._pokemonType);
    }

    public pokemonType(): PokemonType {
        return this._pokemonType;
    }

    public pokemonSize(): PokemonSize {
        return this._pokemonSize;
    }

    public pokemonGeneration(): string {
        return this._pokemonGeneration;
    }

    public pokemonOriginalSpriteSize(): number {
        return this._pokemonOriginalSpriteSize;
    }

    public theme(): Theme {
        return this._theme;
    }

    public themeKind(): vscode.ColorThemeKind {
        return this._themeKind;
    }

    public throwBallWithMouse(): boolean {
        return this._throwBallWithMouse;
    }

    public updatePokemonColor(newColor: PokemonColor) {
        this._pokemonColor = newColor;
    }

    public updatePokemonType(newType: PokemonType) {
        this._pokemonType = newType;
    }

    public updatePokemonSize(newSize: PokemonSize) {
        this._pokemonSize = newSize;
    }

    public updatePokemonGeneration(newGeneration: string) {
        this._pokemonGeneration = newGeneration;
    }

    public updateTheme(newTheme: Theme, themeKind: vscode.ColorThemeKind) {
        this._theme = newTheme;
        this._themeKind = themeKind;
    }

    public setThrowWithMouse(newThrowWithMouse: boolean): void {
        this._throwBallWithMouse = newThrowWithMouse;
        void this.getWebview().postMessage({
            command: 'throw-with-mouse',
            enabled: newThrowWithMouse,
        });
    }

    public throwBall() {
        void this.getWebview().postMessage({
            command: 'throw-ball',
        });
    }

    public resetPokemon(): void {
        void this.getWebview().postMessage({
            command: 'reset-pokemon',
        });
    }

    public spawnPokemon(spec: PokemonSpecification) {
        void this.getWebview().postMessage({
            command: 'spawn-pokemon',
            type: spec.type,
            color: spec.color,
            name: spec.name,
            generation: spec.generation,
            originalSpriteSize: spec.originalSpriteSize,
        });
        void this.getWebview().postMessage({
            command: 'set-size',
            size: spec.size,
        });
    }

    public listPokemon() {
        void this.getWebview().postMessage({ command: 'list-pokemon' });
    }

    public rollCall(): void {
        void this.getWebview().postMessage({ command: 'roll-call' });
    }

    public deletePokemon(pokemonName: string) {
        void this.getWebview().postMessage({
            command: 'delete-pokemon',
            name: pokemonName,
        });
    }

    public postActivityTick(payload: ActivityTickPayload): void {
        void this.getWebview().postMessage({
            command: 'activity-tick',
            ...payload,
        });
    }

    public postLevelUp(payload: LevelUpPayload): void {
        void this.getWebview().postMessage({
            command: 'level-up',
            ...payload,
        });
    }

    public spawnEncounter(payload: EncounterSpawnPayload): void {
        void this.getWebview().postMessage({
            command: 'encounter-spawn',
            ...payload,
        });
    }

    public postBattleResult(payload: BattleResultPayload): void {
        void this.getWebview().postMessage({
            command: 'battle-result',
            ...payload,
        });
    }

    protected getWebview(): vscode.Webview {
        throw new Error('Not implemented');
    }

    protected _update() {
        const webview = this.getWebview();
        webview.html = this._getHtmlForWebview(webview);
    }

    public update() { }

    protected _getHtmlForWebview(webview: vscode.Webview) {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(
            this._extensionUri,
            'media',
            'main-bundle.js',
        );

        // And the uri we use to load this script in the webview
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        // Local path to css styles
        const styleResetPath = vscode.Uri.joinPath(
            this._extensionUri,
            'media',
            'reset.css',
        );
        const stylesPathMainPath = vscode.Uri.joinPath(
            this._extensionUri,
            'media',
            'pokemon.css',
        );
        const silkScreenFontPath = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                'media',
                'Silkscreen-Regular.ttf',
            ),
        );

        // Uri to load styles into webview
        const stylesResetUri = webview.asWebviewUri(styleResetPath);
        const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

        // Get path to resource on disk
        const basePokemonUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media'),
        );

        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource
            } 'nonce-${nonce}'; img-src ${webview.cspSource
            } https:; script-src 'nonce-${nonce}';
                font-src ${webview.cspSource};">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${stylesResetUri}" rel="stylesheet" nonce="${nonce}">
				<link href="${stylesMainUri}" rel="stylesheet" nonce="${nonce}">
                <style nonce="${nonce}">
                @font-face {
                    font-family: 'silkscreen';
                    src: url('${silkScreenFontPath}') format('truetype');
                }
                </style>
				<title>VS Code Pokemon</title>
			</head>
			<body>
                <canvas id="pokemonCanvas"></canvas>
                <div id="pokemonContainer"></div>
                <div id="foreground"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
                <script nonce="${nonce}">
                    pokemonApp.pokemonPanelApp(
                        "${basePokemonUri}",
                        "${this.theme()}",
                        ${this.themeKind()},
                        "${this.pokemonColor()}",
                        "${this.pokemonSize()}",
                        "${this.pokemonType()}",
                        "${this.throwBallWithMouse()}",
                        "${this.pokemonGeneration()}",
                        "${this.pokemonOriginalSpriteSize()}",
                    );
                </script>
            </body>
			</html>`;
    }
}

function handleWebviewMessage(message: WebviewMessage) {
    switch (message.command) {
        case 'alert':
            void vscode.window.showErrorMessage(message.text);
            return;
        case 'info':
            void vscode.window.showInformationMessage(message.text);
            return;
        case 'battle-start': {
            const encounterId = message.payload?.encounterId;
            if (activeExtensionContext && typeof encounterId === 'string') {
                void handleBattleStart(activeExtensionContext, encounterId);
            }
            return;
        }
    }
}

/**
 * Manages pokemon coding webview panels
 */
class PokemonPanel extends PokemonWebviewContainer implements IPokemonPanel {
    /**
     * Track the currently panel. Only allow a single panel to exist at a time.
     */
    public static currentPanel: PokemonPanel | undefined;

    public static readonly viewType = 'pokemonCoding';

    private readonly _panel: vscode.WebviewPanel;

    public static createOrShow(
        extensionUri: vscode.Uri,
        pokemonColor: PokemonColor,
        pokemonType: PokemonType,
        pokemonSize: PokemonSize,
        pokemonGeneration: string,
        pokemonOriginalSpriteSize: number,
        theme: Theme,
        themeKind: ColorThemeKind,
        throwBallWithMouse: boolean,
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        // If we already have a panel, show it.
        if (PokemonPanel.currentPanel) {
            if (
                pokemonColor === PokemonPanel.currentPanel.pokemonColor() &&
                pokemonType === PokemonPanel.currentPanel.pokemonType() &&
                pokemonSize === PokemonPanel.currentPanel.pokemonSize() &&
                pokemonGeneration === PokemonPanel.currentPanel.pokemonGeneration()
            ) {
                PokemonPanel.currentPanel._panel.reveal(column);
                return;
            } else {
                PokemonPanel.currentPanel.updatePokemonColor(pokemonColor);
                PokemonPanel.currentPanel.updatePokemonType(pokemonType);
                PokemonPanel.currentPanel.updatePokemonSize(pokemonSize);
                PokemonPanel.currentPanel.update();
            }
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            PokemonPanel.viewType,
            vscode.l10n.t('Pokemon Panel'),
            vscode.ViewColumn.Two,
            getWebviewOptions(extensionUri),
        );

        PokemonPanel.currentPanel = new PokemonPanel(
            panel,
            extensionUri,
            pokemonColor,
            pokemonType,
            pokemonSize,
            pokemonGeneration,
            pokemonOriginalSpriteSize,
            theme,
            themeKind,
            throwBallWithMouse,
        );
    }

    public resetPokemon() {
        void this.getWebview().postMessage({ command: 'reset-pokemon' });
    }

    public listPokemon() {
        void this.getWebview().postMessage({ command: 'list-pokemon' });
    }

    public rollCall(): void {
        void this.getWebview().postMessage({ command: 'roll-call' });
    }

    public deletePokemon(pokemonName: string): void {
        void this.getWebview().postMessage({
            command: 'delete-pokemon',
            name: pokemonName,
        });
    }

    public static revive(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        pokemonColor: PokemonColor,
        pokemonType: PokemonType,
        pokemonSize: PokemonSize,
        pokemonGeneration: string,
        pokemonOriginalSpriteSize: number,
        theme: Theme,
        themeKind: ColorThemeKind,
        throwBallWithMouse: boolean,
    ) {
        PokemonPanel.currentPanel = new PokemonPanel(
            panel,
            extensionUri,
            pokemonColor,
            pokemonType,
            pokemonSize,
            pokemonGeneration,
            pokemonOriginalSpriteSize,
            theme,
            themeKind,
            throwBallWithMouse,
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        color: PokemonColor,
        type: PokemonType,
        size: PokemonSize,
        generation: string,
        originalSpriteSize: number,
        theme: Theme,
        themeKind: ColorThemeKind,
        throwBallWithMouse: boolean,
    ) {
        super(
            extensionUri,
            color,
            type,
            size,
            generation,
            originalSpriteSize,
            theme,
            themeKind,
            throwBallWithMouse,
        );

        this._panel = panel;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            () => {
                this.update();
            },
            null,
            this._disposables,
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            handleWebviewMessage,
            null,
            this._disposables,
        );
    }

    public dispose() {
        PokemonPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public update() {
        if (this._panel.visible) {
            this._update();
        }
    }

    getWebview(): vscode.Webview {
        return this._panel.webview;
    }
}

class PokemonWebviewViewProvider extends PokemonWebviewContainer {
    public static readonly viewType = 'pokemonView';

    private _webviewView?: vscode.WebviewView;

    resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
        this._webviewView = webviewView;

        webviewView.webview.options = getWebviewOptions(this._extensionUri);
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            handleWebviewMessage,
            null,
            this._disposables,
        );
    }

    update() {
        this._update();
    }

    getWebview(): vscode.Webview {
        if (this._webviewView === undefined) {
            throw new Error(
                vscode.l10n.t(
                    'Panel not active, make sure the pokemon view is visible before running this command.',
                ),
            );
        } else {
            return this._webviewView.webview;
        }
    }
}

function getNonce() {
    let text = '';
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function createPokemonPlayground(context: vscode.ExtensionContext) {
    const spec = PokemonSpecification.fromConfiguration();
    PokemonPanel.createOrShow(
        context.extensionUri,
        spec.color,
        spec.type,
        spec.size,
        spec.generation,
        spec.originalSpriteSize,
        getConfiguredTheme(),
        getConfiguredThemeKind(),
        getThrowWithMouseConfiguration(),
    );
    if (PokemonPanel.currentPanel) {
        var collection = PokemonSpecification.collectionFromMemento(
            context,
            getConfiguredSize(),
        );
        collection.forEach((item) => {
            PokemonPanel.currentPanel?.spawnPokemon(item);
        });
        await storeCollectionAsMemento(context, collection);
        pushActivitySnapshot(context);
    } else {
        var collection = PokemonSpecification.collectionFromMemento(
            context,
            getConfiguredSize(),
        );
        collection.push(spec);
        await storeCollectionAsMemento(context, collection);
    }
}
