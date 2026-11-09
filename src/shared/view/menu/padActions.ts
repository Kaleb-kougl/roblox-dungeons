/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md sections 3 and 4.3, GM1): what each pad button means on each menu surface,
 * while a menu owns the pad. One table, PAD_SURFACES, feeds both menuPadAction (FocusController acts on it) and
 * padHints (the hint bar shows it), so a hint can never name a button that does nothing.
 *
 *   A           press the selected button (the engine does it: `select` is for the hint only)
 *   B           back / close / cancel / resume: never destructive on a tap (GMD5); run over: hold to exit (GMD13);
 *               the outro, the loading screen, a rebind capture and the draft: nothing
 *   LB / RB     previous / next tab; LT / RT previous / next sub-tab (Options' device, the leaderboard's board)
 *   X / Y       one contextual shortcut each (4.3)
 *   Right stick scroll the scope's main list (the engine moves nothing; `scroll` is FocusController's)
 *   Start       the pause overlay: resume
 * The D-pad and the left stick move the selection (the engine). Keys are Enum.KeyCode names.
 */
import type { FocusLayer } from "./focus";

/** Every menu surface that can own the pad (the plan's census table). */
export type PadSurface =
	| "loading"
	| "main"
	| "lobbies"
	| "lobby"
	| "credits"
	| "character"
	| "invites"
	| "options"
	| "rebind"
	| "leaderboard"
	| "pause"
	| "party"
	| "confirm"
	| "runOver"
	| "outro"
	| "draft";

/** X / Y shortcuts' meanings (4.3). */
export type PadShortcut = "invites" | "refresh" | "create" | "ready" | "invite" | "details" | "reset";

/** What a pad press means on a surface. */
export type MenuPadAction =
	| { readonly kind: "select" }
	| { readonly kind: "back" }
	| { readonly kind: "close" }
	| { readonly kind: "resume" }
	| { readonly kind: "cancel" }
	| { readonly kind: "holdExit" }
	| { readonly kind: "tabPrev" }
	| { readonly kind: "tabNext" }
	| { readonly kind: "subTabPrev" }
	| { readonly kind: "subTabNext" }
	| { readonly kind: "scroll" }
	| { readonly kind: "shortcutX"; readonly meaning: PadShortcut }
	| { readonly kind: "shortcutY"; readonly meaning: PadShortcut }
	| { readonly kind: "none" };

/** B's meaning per surface: one of these, never destructive on a tap. */
export type PadBackMeaning = "back" | "close" | "resume" | "cancel" | "holdExit" | "none";

/** A surface fact a row can depend on. Absent in PadContext = false. */
export type PadCondition =
	/** Main menu: an invite toast is pending (Y jumps to it). */
	| "invitePending"
	/** Options on the Controls tab, the leaderboard with board tabs: LT / RT switch them. */
	| "subTabs"
	/** Lobby browser: not in a lobby, so Create is on screen (in one, the bar offers Your lobby instead). */
	| "canCreate"
	/** Lobby room: this member can toggle Ready. */
	| "canReady"
	/** Lobby room: this member can open the Roblox invite prompt. */
	| "canInvite"
	/** Run over: the recap is on screen (its Details toggle exists). */
	| "recap"
	/**
	 * Run over: a party run's `You | Team | Party` tabs are on screen (Details closed; docs/RUN_CONTRIBUTION.md CT6):
	 * LB / RB cycle them.
	 */
	| "partyTabs"
	/** The scope's main list is shown (and can overflow). */
	| "scrollList";

/** The surface facts menuPadAction and padHints read (absent = false). */
export type PadContext = { readonly [K in PadCondition]?: boolean } & {
	/** Run over: the breakdown is open (X then reads Highlights). */
	readonly detailsOpen?: boolean;
	/**
	 * The player's pad restart binding (an Enum.KeyCode name, `Bindings.pad.restart`). A menu shortcut on that key
	 * yields to it (padShortcutYields): the restart wins, the shortcut does nothing and is not hinted.
	 */
	readonly restartPad?: string;
};

/** The pad keys menus read (Enum.KeyCode names). */
export const PAD_KEYS = {
	a: "ButtonA",
	b: "ButtonB",
	x: "ButtonX",
	y: "ButtonY",
	lb: "ButtonL1",
	rb: "ButtonR1",
	lt: "ButtonL2",
	rt: "ButtonR2",
	start: "ButtonStart",
	rightStick: "Thumbstick2",
} as const;

/** One row of a surface's table: keys pressed alone, their actions (same order), its hint, and a condition. */
export interface PadRow {
	readonly keys: ReadonlyArray<string>;
	readonly actions: ReadonlyArray<MenuPadAction>;
	/** The hint bar's label (pad.hint.*); undefined: another row already names the same action. */
	readonly hint?: string;
	/** The label while `PadContext.detailsOpen` (run over's X: Highlights). */
	readonly hintDetailsOpen?: string;
	readonly when?: PadCondition;
	/**
	 * The row yields to the player's pad restart like a shortcut does (padShortcutYields): the run-over tabs (the
	 * restart key is live on that panel), so a restart on LB / RB is never stolen.
	 */
	readonly yieldsToRestart?: boolean;
}

/** A surface's census entry. */
export interface PadSurfaceDef {
	/** The focus layer its scope mounts on; undefined only for sim-input surfaces (`simInput`). */
	readonly layer: FocusLayer | undefined;
	/** The draft: picked with sim input (stick / RT), not a focus scope; no pad menu meaning at all (GMD12). */
	readonly simInput?: true;
	/** A press presses the selected button (A). */
	readonly select: boolean;
	readonly back: PadBackMeaning;
	/** The other rows (bumpers, triggers, shortcuts, the right stick, Start), in hint order. */
	readonly rows: ReadonlyArray<PadRow>;
}

/** Every pad.hint.* string the hint bar reads (shared/theme padHints.ts PAD_HINT_STRING_KEYS repeats them). */
export const PAD_HINT_STRINGS = {
	select: "pad.hint.select",
	back: "pad.hint.back",
	close: "pad.hint.close",
	resume: "pad.hint.resume",
	cancel: "pad.hint.cancel",
	tabs: "pad.hint.tabs",
	subTabs: "pad.hint.subTabs",
	scroll: "pad.hint.scroll",
	holdExit: "pad.hint.holdExit",
	details: "pad.hint.details",
	/** Run over with the breakdown open: X returns to the highlights (the recap's own toggle label). */
	highlights: "run.recap.detailsHide",
	refresh: "pad.hint.refresh",
	create: "pad.hint.create",
	ready: "pad.hint.ready",
	invite: "pad.hint.invite",
	invites: "pad.hint.invites",
	reset: "pad.hint.reset",
} as const;

/** B's hint per meaning (none: no hint). */
export const PAD_BACK_HINTS: { readonly [K in PadBackMeaning]: string | undefined } = {
	back: PAD_HINT_STRINGS.back,
	close: PAD_HINT_STRINGS.close,
	resume: PAD_HINT_STRINGS.resume,
	cancel: PAD_HINT_STRINGS.cancel,
	holdExit: PAD_HINT_STRINGS.holdExit,
	none: undefined,
};

/** Each shortcut's hint. */
export const PAD_SHORTCUT_HINTS: { readonly [K in PadShortcut]: string } = {
	invites: PAD_HINT_STRINGS.invites,
	refresh: PAD_HINT_STRINGS.refresh,
	create: PAD_HINT_STRINGS.create,
	ready: PAD_HINT_STRINGS.ready,
	invite: PAD_HINT_STRINGS.invite,
	details: PAD_HINT_STRINGS.details,
	reset: PAD_HINT_STRINGS.reset,
};

const TABS: PadRow = {
	keys: [PAD_KEYS.lb, PAD_KEYS.rb],
	actions: [{ kind: "tabPrev" }, { kind: "tabNext" }],
	hint: PAD_HINT_STRINGS.tabs,
};
const SUB_TABS: PadRow = {
	keys: [PAD_KEYS.lt, PAD_KEYS.rt],
	actions: [{ kind: "subTabPrev" }, { kind: "subTabNext" }],
	hint: PAD_HINT_STRINGS.subTabs,
	when: "subTabs",
};
const SCROLL: PadRow = {
	keys: [PAD_KEYS.rightStick],
	actions: [{ kind: "scroll" }],
	hint: PAD_HINT_STRINGS.scroll,
	when: "scrollList",
};

function shortcutX(meaning: PadShortcut, when?: PadCondition): PadRow {
	return { keys: [PAD_KEYS.x], actions: [{ kind: "shortcutX", meaning }], hint: PAD_SHORTCUT_HINTS[meaning], when };
}

function shortcutY(meaning: PadShortcut, when?: PadCondition): PadRow {
	return { keys: [PAD_KEYS.y], actions: [{ kind: "shortcutY", meaning }], hint: PAD_SHORTCUT_HINTS[meaning], when };
}

/** The census (the plan's surface table, sections 3, 4.3 and 6). */
export const PAD_SURFACES: { readonly [K in PadSurface]: PadSurfaceDef } = {
	loading: { layer: "loading", select: true, back: "none", rows: [] },
	main: { layer: "screen", select: true, back: "none", rows: [shortcutY("invites", "invitePending")] },
	lobbies: {
		layer: "screen",
		select: true,
		back: "back",
		rows: [shortcutX("refresh"), shortcutY("create", "canCreate"), SCROLL],
	},
	lobby: {
		layer: "screen",
		select: true,
		back: "back",
		rows: [shortcutX("ready", "canReady"), shortcutY("invite", "canInvite"), SCROLL],
	},
	credits: { layer: "screen", select: true, back: "back", rows: [SCROLL] },
	// docs/ARCHER.md AR7: the D-pad / stick move between the cards (the engine), A confirms the selected card, B back.
	character: { layer: "screen", select: true, back: "back", rows: [] },
	invites: { layer: "invites", select: true, back: "back", rows: [] },
	options: { layer: "panel", select: true, back: "close", rows: [TABS, SUB_TABS, shortcutX("reset"), SCROLL] },
	// A rebind capture listens to every input (navigation off): no pad meaning while it runs.
	rebind: { layer: "rebind", select: false, back: "none", rows: [] },
	leaderboard: { layer: "panel", select: true, back: "close", rows: [TABS, SUB_TABS, SCROLL] },
	pause: {
		layer: "overlay",
		select: true,
		back: "resume",
		rows: [{ keys: [PAD_KEYS.start], actions: [{ kind: "resume" }] }],
	},
	party: { layer: "overlay", select: true, back: "close", rows: [] },
	confirm: { layer: "confirm", select: true, back: "cancel", rows: [] },
	runOver: {
		layer: "overlay",
		select: true,
		back: "holdExit",
		rows: [
			// docs/RUN_CONTRIBUTION.md CT6: a party run's tabs cycle (never a retry, never through RunOverRetryGate).
			{ ...TABS, when: "partyTabs", yieldsToRestart: true },
			{
				keys: [PAD_KEYS.x],
				actions: [{ kind: "shortcutX", meaning: "details" }],
				hint: PAD_HINT_STRINGS.details,
				hintDetailsOpen: PAD_HINT_STRINGS.highlights,
				when: "recap",
			},
			SCROLL,
		],
	},
	outro: { layer: "overlay", select: true, back: "none", rows: [] },
	draft: { layer: undefined, simInput: true, select: false, back: "none", rows: [] },
};

/** Every surface, in the census order. */
export const PAD_SURFACE_IDS: ReadonlyArray<PadSurface> = [
	"loading",
	"main",
	"lobbies",
	"lobby",
	"credits",
	"character",
	"invites",
	"options",
	"rebind",
	"leaderboard",
	"pause",
	"party",
	"confirm",
	"runOver",
	"outro",
	"draft",
];

const NONE: MenuPadAction = { kind: "none" };
const SELECT: MenuPadAction = { kind: "select" };

function backAction(back: PadBackMeaning): MenuPadAction {
	return { kind: back } as MenuPadAction;
}

/** `cond` holds in `ctx` (a row without a condition always does). */
export function padConditionHolds(cond: PadCondition | undefined, ctx: PadContext): boolean {
	return cond === undefined || ctx[cond] === true;
}

/**
 * Every row of a surface's table, A and B first (built from `select` / `back`), then its own rows. The hint bar's
 * order is this order.
 */
export function padRows(surface: PadSurface): ReadonlyArray<PadRow> {
	const def = PAD_SURFACES[surface];
	const out = new Array<PadRow>();
	if (def.select) out.push({ keys: [PAD_KEYS.a], actions: [SELECT], hint: PAD_HINT_STRINGS.select });
	if (def.back !== "none") {
		out.push({ keys: [PAD_KEYS.b], actions: [backAction(def.back)], hint: PAD_BACK_HINTS[def.back] });
	}
	for (const row of def.rows) out.push(row);
	return out;
}

/** B's meaning on a surface. */
export function padBackMeaning(surface: PadSurface): PadBackMeaning {
	return PAD_SURFACES[surface].back;
}

/**
 * A shortcut (X / Y, 4.3) on `keyName` yields to the player's pad restart: the key is `ctx.restartPad`, so the restart
 * (InputController's driver keys, gated by the RestartWindow) wins and the shortcut neither acts nor shows a hint.
 * Only shortcuts yield here (tabs, scrolling, A, B and Start keep their menu meaning); a row may opt in with
 * `yieldsToRestart` (padKeyYields: the run-over tabs).
 */
export function padShortcutYields(action: MenuPadAction, keyName: string, ctx: PadContext): boolean {
	if (action.kind !== "shortcutX" && action.kind !== "shortcutY") return false;
	return ctx.restartPad !== undefined && ctx.restartPad === keyName;
}

/** Key `i` of `row` yields to the pad restart: a shortcut on it (padShortcutYields), or a `yieldsToRestart` row's key. */
export function padKeyYields(row: PadRow, i: number, ctx: PadContext): boolean {
	const key = row.keys[i];
	if (row.yieldsToRestart === true) return ctx.restartPad !== undefined && ctx.restartPad === key;
	return padShortcutYields(row.actions[i], key, ctx);
}

/** Every key of `row` yields to the pad restart (padKeyYields): the row neither acts nor is hinted. */
export function padRowYields(row: PadRow, ctx: PadContext): boolean {
	for (let i = 0; i < row.keys.size(); i++) if (!padKeyYields(row, i, ctx)) return false;
	return row.keys.size() > 0;
}

/** What pressing `keyName` (an Enum.KeyCode name) means on `surface` (none: nothing, or another path handles it). */
export function menuPadAction(surface: PadSurface, keyName: string, ctx: PadContext): MenuPadAction {
	for (const row of padRows(surface)) {
		if (!padConditionHolds(row.when, ctx)) continue;
		const i = row.keys.indexOf(keyName);
		if (i < 0) continue;
		return padKeyYields(row, i, ctx) ? NONE : row.actions[i];
	}
	return NONE;
}

/** A hold's progress, 0..1 (the Exit button's fill). A zero or negative hold time is complete once held at all. */
export function holdProgress(heldSec: number, holdSec: number): number {
	if (heldSec <= 0) return 0;
	if (holdSec <= 0) return 1;
	return math.clamp(heldSec / holdSec, 0, 1);
}

/** One frame of a hold: not held (or not counting), held and filling, or completed this frame. */
export type PadHoldStep = "idle" | "holding" | "complete";

/**
 * Hold B to exit on the run-over panel (section 3, GMD13): the press must begin after the panel opened (a B held
 * when it opened counts only once released and pressed again, like RunOverRetryGate's FIRE), letting go early
 * empties it with no effect, and a hold completes once per open.
 */
export class PadHoldGate {
	private isOpen = false;
	private primed = false;
	private heldSec = 0;
	private done = false;

	/** The panel opened; `down`: the button is held right now (it must be let go first). */
	open(down: boolean): void {
		this.isOpen = true;
		this.primed = down;
		this.heldSec = 0;
		this.done = false;
	}

	/** The panel closed: nothing counts until the next open. */
	close(): void {
		this.isOpen = false;
		this.heldSec = 0;
	}

	/** One frame: the button's state and the frame's seconds. Answers "complete" exactly once per open. */
	step(down: boolean, dtSec: number, holdSec: number): PadHoldStep {
		if (!this.isOpen || this.done) return "idle";
		if (!down) {
			this.primed = false;
			this.heldSec = 0;
			return "idle";
		}
		if (this.primed) return "idle";
		this.heldSec += math.max(0, dtSec);
		if (this.heldSec >= holdSec) {
			this.done = true;
			return "complete";
		}
		return "holding";
	}

	/** The fill, 0..1 (1 once completed, 0 while closed). */
	progress(holdSec: number): number {
		if (!this.isOpen) return 0;
		return this.done ? 1 : holdProgress(this.heldSec, holdSec);
	}

	/** The hold completed since the last open. */
	completed(): boolean {
		return this.done;
	}
}
