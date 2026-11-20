import { createProducer } from "@rbxts/reflex";
import type { CharacterId } from "shared/characters";
import { ownedCharacterOr, walletShown, type SilverFigures, type WalletShown } from "shared/view/silver";
import { selectSelectedCharacter, type SettingsState } from "./settings";
import type { SilverGrantBreakdown, WalletActionResult, WalletStatus } from "shared/wallet";

/**
 * Client-local Reflex slice for Silver (docs/SILVER.md SV8 / SV9 / SV18). WalletController fills it: every `wallet`
 * push (the latest status; its `result` and `grant` kept apart so a later push without them does not drop them), and
 * the run's frozen Silver preview at run over (SilverHudController). Read by the main menu's balance and Armory button,
 * the Armory, the character screen's lock and the run-over panel's Silver rows. Dispatched rarely (a push, a run over,
 * a buy), never per frame.
 */
export interface WalletState {
	/** The latest `wallet` payload (undefined until the first). */
	readonly status: WalletStatus | undefined;
	/** pending / loaded / unavailable (walletShown). */
	readonly shown: WalletShown;
	/** Bumped on every push. */
	readonly version: number;
	/** The last buy / equip answer, and the push version it came with. */
	readonly result: WalletActionResult | undefined;
	readonly resultVersion: number;
	/** The settled grants of this session's runs, by runId (newest kept; a few). */
	readonly grants: ReadonlyMap<string, SilverGrantBreakdown>;
	/** An Armory purchase waiting for the server's answer (the item id), else undefined. */
	readonly buying: string | undefined;
	/** The run-over Silver preview of the last finished run (SilverHudController), else undefined. */
	readonly run: SilverRunView | undefined;
	/**
	 * The affordable item ids recorded when the Armory was last seen (HudController `armorySeen`); `armoryBadge`
	 * compares the wallet against them for the main menu's newly-affordable dot.
	 */
	readonly seenAffordable: ReadonlyArray<string>;
	/** The character screen bought this character in this visit (its card lights). */
	readonly justUnlocked: CharacterId | undefined;
	/** The run on screen shows the live Silver counter (silverCounterShown; set at each run start). */
	readonly counterShown: boolean;
	/**
	 * docs/SILVER.md OC12: the returning-player card's decision for this session, latched once both join pushes are in
	 * (shared/view/menu silverWelcomeDecision; WalletController); undefined until then.
	 */
	readonly welcome: boolean | undefined;
}

/** The finished run's Silver as the client saw it (RunOverPanel reads it with the verdict and the grants). */
export interface SilverRunView {
	/** RunInfo.run of the run. */
	readonly run: number;
	/** The server's run id (undefined: the unranked fallback). */
	readonly runId: string | undefined;
	/** The run's world pays at all (endless / the Daily, never the tutorial or dev). */
	readonly paidWorld: boolean;
	/** The client's facts say it can pay (silverRunPays). */
	readonly pays: boolean;
	/** A Daily run (the Daily bonus may apply). */
	readonly daily: boolean;
	/** The client's own figures. */
	readonly client: SilverFigures;
}

/** Grants kept for the run-over rows (a session rarely needs more than the last). */
const GRANTS_KEPT = 4;

const initialState: WalletState = {
	status: undefined,
	shown: "pending",
	version: 0,
	result: undefined,
	resultVersion: 0,
	grants: new Map(),
	buying: undefined,
	run: undefined,
	seenAffordable: [],
	justUnlocked: undefined,
	counterShown: false,
	welcome: undefined,
};

/**
 * The Silver slice (state: `WalletState`). `walletReceive` takes each `wallet` push: it bumps the version, keeps a
 * loaded status over a later `loaded: false`, keeps the last action result and files a settled grant under its run id
 * (the newest few kept), and a buy's answer ends the purchase in flight. WalletController also sets the purchase in
 * flight and latches the welcome decision; SilverHudController sets the run preview and the counter flag. Nothing
 * resets the slice within a session.
 */
export const walletSlice = createProducer(initialState, {
	/** A `wallet` push. A `loaded: false` after a loaded one keeps the loaded copy (the session's load already ran). */
	walletReceive: (state, status: WalletStatus): WalletState => {
		const version = state.version + 1;
		let grants = state.grants;
		if (status.grant !== undefined) {
			const kept = new Map<string, SilverGrantBreakdown>();
			for (const [id, g] of state.grants) if (kept.size() < GRANTS_KEPT - 1) kept.set(id, g);
			kept.set(status.grant.runId, status.grant);
			grants = kept;
		}
		const keep = !status.loaded && state.status !== undefined && state.status.loaded;
		const result = status.result ?? state.result;
		const buying = status.result !== undefined && status.result.action === "buy" ? undefined : state.buying;
		return {
			...state,
			status: keep ? state.status : status,
			shown: keep ? state.shown : walletShown(status),
			version,
			result,
			resultVersion: status.result !== undefined ? version : state.resultVersion,
			grants,
			buying,
		};
	},
	setWalletBuying: (state, itemId: string | undefined): WalletState => ({ ...state, buying: itemId }),
	setSilverRun: (state, run: SilverRunView | undefined): WalletState => ({ ...state, run }),
	setSeenAffordable: (state, ids: ReadonlyArray<string>): WalletState => ({ ...state, seenAffordable: ids }),
	setSilverCounterShown: (state, shown: boolean): WalletState =>
		state.counterShown === shown ? state : { ...state, counterShown: shown },
	latchSilverWelcome: (state, show: boolean): WalletState =>
		state.welcome !== undefined ? state : { ...state, welcome: show },
	setJustUnlocked: (state, id: CharacterId | undefined): WalletState =>
		state.justUnlocked === id ? state : { ...state, justUnlocked: id },
});

/**
 * The latest `wallet` payload from the server (loaded or not, the balance, what is owned and equipped), undefined
 * until the first push. Note that this is the status only; the whole slice is `selectWalletState`.
 */
export const selectWallet = (state: { wallet: WalletState }) => state.wallet.status;
/** What the client knows of its wallet: `pending` before the first push, then `loaded` or `unavailable`. */
export const selectWalletShown = (state: { wallet: WalletState }) => state.wallet.shown;
/**
 * The whole `wallet` slice: the status with its version, the last buy / equip result, the settled grants, the purchase
 * in flight, the last run's preview and the menu-side flags. The Armory, the main menu and the character screen read it
 * beside `selectWallet`.
 */
export const selectWalletState = (state: { wallet: WalletState }) => state.wallet;
/**
 * The last finished run's Silver as the client worked it out at run over (its run counter, the server's run id, whether
 * it pays, the client's figures), undefined until a run has ended. The run-over Silver rows read it with the verdict
 * and the settled grants.
 */
export const selectSilverRun = (state: { wallet: WalletState }) => state.wallet.run;
/**
 * The Silver grants the server has settled for this session's runs, keyed by the server's run id (an empty map at
 * first; only the newest few are kept). The run-over rows switch from the predicted grant to the settled one when the
 * run's id appears here.
 */
export const selectWalletGrants = (state: { wallet: WalletState }) => state.wallet.grants;
/**
 * The item id of the Armory purchase waiting for the server's answer, undefined when none is in flight. The push
 * carrying a buy result clears it.
 */
export const selectWalletBuying = (state: { wallet: WalletState }) => state.wallet.buying;
/**
 * The run on screen shows the live Silver counter in the score panel. Decided at each run start (`silverCounterShown`);
 * false before the first run.
 */
export const selectSilverCounterShown = (state: { wallet: WalletState }) => state.wallet.counterShown;
/**
 * Whether the returning-player Silver card shows this session: undefined until both join pushes (wallet and records)
 * are in, then latched true or false and never changed again.
 */
export const selectSilverWelcome = (state: { wallet: WalletState }) => state.wallet.welcome;

/**
 * docs/SILVER.md SV18: the remembered pick (DisplaySettings.character) when the wallet owns it, else the Knight (a
 * stored pick of a locked character, or an unknown wallet, reads as the Knight).
 */
export const selectPlayableCharacter = (state: { settings: SettingsState; wallet: WalletState }): CharacterId =>
	ownedCharacterOr(state.wallet.status, selectSelectedCharacter(state));
