import * as vscode from 'vscode';
import type { GitExtension, Repository } from './git-api';
import {
    DEFAULT_THROTTLE_CONFIG,
    DailyXpState,
    SaveThrottleEntry,
    ThrottleConfig,
    applyDailyCap,
    computeSaveXp,
    nextDailyXpState,
} from './activity-throttle';

const DAILY_XP_KEY = 'vscode-pokemon.activity.dailyXp';
const LAST_COMMIT_SHA_KEY_PREFIX = 'vscode-pokemon.activity.lastCommitSha.';
const FOCUS_HEARTBEAT_MS = 60 * 1000;
const FOCUS_TICK_XP = 5;

export type ActivitySource = 'save' | 'focus' | 'commit';
export type XpEarnedHandler = (amount: number, source: ActivitySource) => void;

export interface ActivityConfig {
    xpPerSave: number;
    xpPerCommit: number;
    dailyXpCap: number;
    focusIdleMinutes: number;
}

export interface ActivityTrackerOptions {
    context: vscode.ExtensionContext;
    onXpEarned: XpEarnedHandler;
    isEnabled: () => boolean;
    getConfig: () => ActivityConfig;
}

export class ActivityTracker implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _dirtyUris = new Set<string>();
    private readonly _saveThrottle = new Map<string, SaveThrottleEntry>();
    private _lastActivityAt = Date.now();

    constructor(private readonly options: ActivityTrackerOptions) { }

    public register(): void {
        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.contentChanges.length > 0) {
                    this._dirtyUris.add(e.document.uri.toString());
                    this._lastActivityAt = Date.now();
                }
            }),
        );
        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => this._handleSave(doc)),
        );
        this._disposables.push(
            vscode.window.onDidChangeTextEditorSelection(() => {
                this._lastActivityAt = Date.now();
            }),
        );

        const heartbeat = setInterval(() => this._handleFocusHeartbeat(), FOCUS_HEARTBEAT_MS);
        this._disposables.push(new vscode.Disposable(() => clearInterval(heartbeat)));

        void this._registerGitTracking();
    }

    public dispose(): void {
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private _handleSave(doc: vscode.TextDocument): void {
        if (!this.options.isEnabled()) {
            return;
        }
        const uriStr = doc.uri.toString();
        if (!this._dirtyUris.has(uriStr)) {
            // Nothing actually changed since the last grant for this file -
            // blocks the "mash ctrl+s on an unchanged file" exploit.
            return;
        }
        this._dirtyUris.delete(uriStr);

        const config = this.options.getConfig();
        const throttleConfig = this._throttleConfig(config);
        const now = Date.now();
        const { xp, nextEntry } = computeSaveXp(
            config.xpPerSave,
            this._saveThrottle.get(uriStr),
            now,
            throttleConfig,
        );
        this._saveThrottle.set(uriStr, nextEntry);
        this._grantXp(xp, 'save', throttleConfig, now);
    }

    private _handleFocusHeartbeat(): void {
        if (!this.options.isEnabled()) {
            return;
        }
        const config = this.options.getConfig();
        const idleMs = config.focusIdleMinutes * 60 * 1000;
        const now = Date.now();
        if (now - this._lastActivityAt > idleMs) {
            return;
        }
        this._grantXp(FOCUS_TICK_XP, 'focus', this._throttleConfig(config), now);
    }

    private _throttleConfig(config: ActivityConfig): ThrottleConfig {
        return { ...DEFAULT_THROTTLE_CONFIG, dailyCap: config.dailyXpCap };
    }

    private _grantXp(
        proposedXp: number,
        source: ActivitySource,
        throttleConfig: ThrottleConfig,
        now: number,
    ): void {
        if (proposedXp <= 0) {
            return;
        }
        const dailyState = nextDailyXpState(
            this.options.context.globalState.get<DailyXpState>(DAILY_XP_KEY),
            now,
        );
        if (source === 'commit') {
            // Commits are exempt from the daily cap - they self-rate-limit
            // by being meaningful checkpoints, unlike saves/focus ticks.
            void this.options.context.globalState.update(DAILY_XP_KEY, {
                ...dailyState,
                amount: dailyState.amount + proposedXp,
            });
            this.options.onXpEarned(proposedXp, source);
            return;
        }
        const { granted, nextState } = applyDailyCap(dailyState, proposedXp, throttleConfig);
        void this.options.context.globalState.update(DAILY_XP_KEY, nextState);
        if (granted > 0) {
            this.options.onXpEarned(granted, source);
        }
    }

    private async _registerGitTracking(): Promise<void> {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) {
            // Not installed/available (e.g. some web/restricted workspaces) - no-op.
            return;
        }
        try {
            const exports = gitExtension.isActive
                ? gitExtension.exports
                : await gitExtension.activate();
            const git = exports.getAPI(1);

            const watchRepo = (repo: Repository) => {
                const key = LAST_COMMIT_SHA_KEY_PREFIX + repo.rootUri.fsPath;
                // Seed from the current HEAD if we've never tracked this repo
                // before, so pre-existing commits don't retroactively grant XP.
                let lastSha = this.options.context.globalState.get<string>(key) ?? repo.state.HEAD?.commit;
                if (lastSha) {
                    void this.options.context.globalState.update(key, lastSha);
                }
                this._disposables.push(
                    repo.state.onDidChange(() => {
                        const currentSha = repo.state.HEAD?.commit;
                        if (!currentSha || currentSha === lastSha) {
                            return;
                        }
                        lastSha = currentSha;
                        void this.options.context.globalState.update(key, currentSha);
                        if (!this.options.isEnabled()) {
                            return;
                        }
                        const config = this.options.getConfig();
                        this._grantXp(
                            config.xpPerCommit,
                            'commit',
                            this._throttleConfig(config),
                            Date.now(),
                        );
                    }),
                );
            };

            git.repositories.forEach(watchRepo);
            this._disposables.push(git.onDidOpenRepository(watchRepo));
        } catch (e) {
            console.error('vscode-pokemon: failed to register git activity tracking', e);
        }
    }
}
