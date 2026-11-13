// Gamepad menus (docs/GAMEPAD_MENUS.md GM1 / GM9): the pad button table per surface (padActions.ts), the hint bar
// built from it (padHints.ts), hold-B to exit and the menu tunables / haptics (config.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import { GAMEPAD_MENU_STRING_KEYS, PAD_HINT_STRING_KEYS, PLACEHOLDER_MANIFEST } from "shared/theme";
import {
	FOCUS_LAYERS,
	GAMEPAD_MENU,
	MENU_HAPTICS,
	MENU_HAPTIC_KINDS,
	MENU_HAPTIC_MAX_PULSE_SEC,
	PAD_HINT_STRINGS,
	PAD_KEYS,
	PAD_SURFACES,
	PAD_SURFACE_IDS,
	PadHoldGate,
	holdProgress,
	menuPadAction,
	padBackMeaning,
	padHints,
	padKeyYields,
	padRowYields,
	padRows,
	padShortcutYields,
	type MenuPadAction,
	type PadCondition,
	type PadContext,
	type PadSurface,
} from ".";

const ALL_CONDITIONS: ReadonlyArray<PadCondition> = [
	"invitePending",
	"canCreate",
	"subTabs",
	"canReady",
	"canInvite",
	"recap",
	"partyTabs",
	"scrollList",
	"canReset",
];
const EVERYTHING: PadContext = {
	invitePending: true,
	canCreate: true,
	subTabs: true,
	canReady: true,
	canInvite: true,
	recap: true,
	partyTabs: true,
	scrollList: true,
	canReset: true,
};
const NOTHING: PadContext = {};
const ALL_KEYS: ReadonlyArray<string> = [
	PAD_KEYS.a,
	PAD_KEYS.b,
	PAD_KEYS.x,
	PAD_KEYS.y,
	PAD_KEYS.lb,
	PAD_KEYS.rb,
	PAD_KEYS.lt,
	PAD_KEYS.rt,
	PAD_KEYS.start,
	PAD_KEYS.rightStick,
	"DPadUp",
	"ButtonSelect",
];

/** An action's identity for comparison (kind, plus the shortcut's meaning). */
function actionId(a: MenuPadAction): string {
	return a.kind === "shortcutX" || a.kind === "shortcutY" ? `${a.kind}:${a.meaning}` : a.kind;
}

function hintKeys(surface: PadSurface, ctx: PadContext): string[] {
	return padHints(surface, ctx).map((h) => h.stringKey);
}

describe("PAD_SURFACES census (GM1)", () => {
	it("lists every surface once", () => {
		const ids = new Array<string>();
		for (const [id] of pairs(PAD_SURFACES as unknown as Map<string, unknown>)) ids.push(id);
		ids.sort();
		const listed = [...PAD_SURFACE_IDS];
		listed.sort();
		expect(listed).toEqual(ids);
		expect(new Set(PAD_SURFACE_IDS).size()).toBe(PAD_SURFACE_IDS.size());
	});

	it("every surface has a layer (only the sim-input draft has none) and a B meaning", () => {
		for (const id of PAD_SURFACE_IDS) {
			const def = PAD_SURFACES[id];
			const layerOk =
				def.simInput === true
					? def.layer === undefined
					: def.layer !== undefined && FOCUS_LAYERS.includes(def.layer);
			expect([id, layerOk]).toEqual([id, true]);
			expect([id, typeIs(padBackMeaning(id), "string")]).toEqual([id, true]);
		}
		// every layer has a surface
		for (const layer of FOCUS_LAYERS) {
			expect([layer, PAD_SURFACE_IDS.some((id) => PAD_SURFACES[id].layer === layer)]).toEqual([layer, true]);
		}
	});

	it("every action a surface maps has a hint (some row with the same action names it)", () => {
		for (const id of PAD_SURFACE_IDS) {
			const rows = padRows(id);
			const hinted = new Set<string>();
			for (const row of rows) if (row.hint !== undefined) for (const a of row.actions) hinted.add(actionId(a));
			for (const row of rows) {
				expect([id, row.keys.size(), row.actions.size()]).toEqual([id, row.actions.size(), row.keys.size()]);
				for (const a of row.actions) {
					expect([id, a.kind === "none"]).toEqual([id, false]);
					expect([id, actionId(a), hinted.has(actionId(a))]).toEqual([id, actionId(a), true]);
				}
			}
		}
	});

	it("no key is mapped twice on one surface under the same condition", () => {
		for (const id of PAD_SURFACE_IDS) {
			const seen = new Set<string>();
			for (const row of padRows(id)) {
				for (const k of row.keys) {
					const tag = `${k}|${row.when ?? ""}`;
					expect([id, tag, seen.has(tag)]).toEqual([id, tag, false]);
					seen.add(tag);
				}
			}
		}
	});

	it("every hint string is a pad.hint.* key in the contract and the placeholder pack (or the recap's toggle)", () => {
		const strings = PLACEHOLDER_MANIFEST.strings;
		for (const id of PAD_SURFACE_IDS) {
			for (const row of padRows(id)) {
				// (Built with pushes: an array literal with a nil hole stops ipairs in Luau.)
				const keys = new Array<string>();
				if (row.hint !== undefined) keys.push(row.hint);
				if (row.hintDetailsOpen !== undefined) keys.push(row.hintDetailsOpen);
				for (const key of keys) {
					const known = PAD_HINT_STRING_KEYS.includes(key) || key === PAD_HINT_STRINGS.highlights;
					expect([id, key, known, typeIs(strings[key], "string")]).toEqual([id, key, true, true]);
				}
			}
		}
		// The view's table and the theme's list name the same pad.hint.* keys.
		const view = new Array<string>();
		for (const [, key] of pairs(PAD_HINT_STRINGS as unknown as Map<string, string>)) {
			if (key !== PAD_HINT_STRINGS.highlights) view.push(key);
		}
		view.sort();
		const theme = [...PAD_HINT_STRING_KEYS];
		theme.sort();
		expect(view).toEqual(theme);
		expect(GAMEPAD_MENU_STRING_KEYS.includes("options.controls.vibration")).toBe(true);
	});
});

describe("menuPadAction (section 3, 4.3)", () => {
	it("B is never destructive on a tap: back / close / resume / cancel, or a hold on the run-over panel", () => {
		const b = (s: PadSurface) => menuPadAction(s, PAD_KEYS.b, NOTHING).kind;
		expect([b("lobbies"), b("lobby"), b("credits"), b("codex"), b("invites")]).toEqual([
			"back",
			"back",
			"back",
			"back",
			"back",
		]);
		expect([b("options"), b("leaderboard"), b("party")]).toEqual(["close", "close", "close"]);
		expect(b("pause")).toBe("resume");
		expect(b("confirm")).toBe("cancel");
		expect(b("runOver")).toBe("holdExit");
		for (const s of ["main", "outro", "draft", "loading", "rebind"] as const)
			expect([s, b(s)]).toEqual([s, "none"]);
	});

	it("Start resumes on the pause overlay only", () => {
		for (const s of PAD_SURFACE_IDS) {
			const want = s === "pause" ? "resume" : "none";
			expect([s, menuPadAction(s, PAD_KEYS.start, EVERYTHING).kind]).toEqual([s, want]);
		}
	});

	it("bumpers and triggers switch tabs on Options and the leaderboard (triggers only with sub-tabs)", () => {
		for (const s of ["options", "leaderboard"] as const) {
			expect(menuPadAction(s, PAD_KEYS.lb, NOTHING).kind).toBe("tabPrev");
			expect(menuPadAction(s, PAD_KEYS.rb, NOTHING).kind).toBe("tabNext");
			expect(menuPadAction(s, PAD_KEYS.lt, NOTHING).kind).toBe("none");
			expect(menuPadAction(s, PAD_KEYS.lt, { subTabs: true }).kind).toBe("subTabPrev");
			expect(menuPadAction(s, PAD_KEYS.rt, { subTabs: true }).kind).toBe("subTabNext");
		}
		for (const s of PAD_SURFACE_IDS) {
			if (s === "options" || s === "leaderboard") continue;
			// claude/codex-plan.md CX7: the Codex's bumpers step its tabs (below); its triggers do nothing.
			if (s === "codex") {
				expect(menuPadAction(s, PAD_KEYS.lb, NOTHING).kind).toBe("tabPrev");
				expect(menuPadAction(s, PAD_KEYS.rb, NOTHING).kind).toBe("tabNext");
				for (const k of [PAD_KEYS.lt, PAD_KEYS.rt]) {
					expect([s, k, menuPadAction(s, k, EVERYTHING).kind]).toEqual([s, k, "none"]);
				}
				continue;
			}
			// The run-over panel's bumpers: a party run's tabs (below); its triggers do nothing.
			const keys =
				s === "runOver" ? [PAD_KEYS.lt, PAD_KEYS.rt] : [PAD_KEYS.lb, PAD_KEYS.rb, PAD_KEYS.lt, PAD_KEYS.rt];
			for (const k of keys) {
				expect([s, k, menuPadAction(s, k, EVERYTHING).kind]).toEqual([s, k, "none"]);
			}
		}
	});

	it("run over (docs/RUN_CONTRIBUTION.md CT6): LB / RB step a party run's tabs only while they show", () => {
		expect(menuPadAction("runOver", PAD_KEYS.lb, { recap: true }).kind).toBe("none");
		expect(menuPadAction("runOver", PAD_KEYS.rb, { recap: true, detailsOpen: true }).kind).toBe("none");
		const tabs: PadContext = { recap: true, partyTabs: true };
		expect(menuPadAction("runOver", PAD_KEYS.lb, tabs).kind).toBe("tabPrev");
		expect(menuPadAction("runOver", PAD_KEYS.rb, tabs).kind).toBe("tabNext");
		// A, B, X keep their meaning beside the tabs (Details, the hold to exit; never a retry from a bumper).
		expect(menuPadAction("runOver", PAD_KEYS.b, tabs).kind).toBe("holdExit");
		expect(actionId(menuPadAction("runOver", PAD_KEYS.x, tabs))).toBe("shortcutX:details");
		expect(menuPadAction("runOver", PAD_KEYS.a, tabs).kind).toBe("select");
		// Other surfaces never read the condition.
		expect(menuPadAction("pause", PAD_KEYS.rb, tabs).kind).toBe("none");
	});

	it("run over's tabs yield to a pad restart on a bumper (the restart is live there); the other bumper still steps", () => {
		const tabs: PadContext = { recap: true, partyTabs: true, restartPad: PAD_KEYS.rb };
		expect(menuPadAction("runOver", PAD_KEYS.rb, tabs).kind).toBe("none");
		expect(menuPadAction("runOver", PAD_KEYS.lb, tabs).kind).toBe("tabPrev");
		// Options' tabs never yield (no restart there).
		expect(menuPadAction("options", PAD_KEYS.rb, { restartPad: PAD_KEYS.rb }).kind).toBe("tabNext");
		const rows = padRows("runOver").filter((r) => r.keys.includes(PAD_KEYS.lb));
		expect(rows.size()).toBe(1);
		expect(padKeyYields(rows[0], 1, tabs)).toBe(true);
		expect(padKeyYields(rows[0], 0, tabs)).toBe(false);
		expect(padRowYields(rows[0], tabs)).toBe(false);
	});

	it("the X / Y shortcuts of 4.3, each only when it can act", () => {
		const act = (s: PadSurface, k: string, ctx: PadContext) => actionId(menuPadAction(s, k, ctx));
		expect(act("main", PAD_KEYS.y, NOTHING)).toBe("none");
		expect(act("main", PAD_KEYS.y, { invitePending: true })).toBe("shortcutY:invites");
		expect(act("main", PAD_KEYS.x, EVERYTHING)).toBe("none");
		expect(act("lobbies", PAD_KEYS.x, NOTHING)).toBe("shortcutX:refresh");
		expect(act("lobbies", PAD_KEYS.y, NOTHING)).toBe("none");
		expect(act("lobbies", PAD_KEYS.y, { canCreate: true })).toBe("shortcutY:create");
		expect(act("lobby", PAD_KEYS.x, NOTHING)).toBe("none");
		expect(act("lobby", PAD_KEYS.x, { canReady: true })).toBe("shortcutX:ready");
		expect(act("lobby", PAD_KEYS.y, { canInvite: true })).toBe("shortcutY:invite");
		expect(act("runOver", PAD_KEYS.x, NOTHING)).toBe("none");
		expect(act("runOver", PAD_KEYS.x, { recap: true })).toBe("shortcutX:details");
		expect(act("options", PAD_KEYS.x, { canReset: true })).toBe("shortcutX:reset");
		// Controls > Touch (docs/HAPTICS.md HP5) has nothing to reset: X does nothing there and is not hinted.
		expect(act("options", PAD_KEYS.x, NOTHING)).toBe("none");
		expect(act("options", PAD_KEYS.y, EVERYTHING)).toBe("none");
	});

	it("A presses the selection on every menu; the draft and a rebind capture map nothing at all", () => {
		for (const s of PAD_SURFACE_IDS) {
			const want = s === "draft" || s === "rebind" ? "none" : "select";
			expect([s, menuPadAction(s, PAD_KEYS.a, NOTHING).kind]).toEqual([s, want]);
		}
		for (const s of ["draft", "rebind"] as const) {
			for (const k of ALL_KEYS) expect([s, k, menuPadAction(s, k, EVERYTHING).kind]).toEqual([s, k, "none"]);
		}
	});

	it("the right stick scrolls a shown list; the D-pad and unknown keys are the engine's (none)", () => {
		expect(menuPadAction("leaderboard", PAD_KEYS.rightStick, NOTHING).kind).toBe("none");
		expect(menuPadAction("leaderboard", PAD_KEYS.rightStick, { scrollList: true }).kind).toBe("scroll");
		expect(menuPadAction("pause", PAD_KEYS.rightStick, EVERYTHING).kind).toBe("none");
		for (const s of PAD_SURFACE_IDS) {
			expect([s, menuPadAction(s, "DPadUp", EVERYTHING).kind]).toEqual([s, "none"]);
			expect([s, menuPadAction(s, "ButtonSelect", EVERYTHING).kind]).toEqual([s, "none"]);
		}
	});
});

describe("padHints (4.1)", () => {
	it("names exactly the buttons that act, in order A, B, bumpers, triggers, X, Y, right stick", () => {
		expect(hintKeys("options", EVERYTHING)).toEqual([
			"pad.hint.select",
			"pad.hint.close",
			"pad.hint.tabs",
			"pad.hint.subTabs",
			"pad.hint.reset",
			"pad.hint.scroll",
		]);
		expect(padHints("options", NOTHING).map((h) => h.keyNames)).toEqual([
			[PAD_KEYS.a],
			[PAD_KEYS.b],
			[PAD_KEYS.lb, PAD_KEYS.rb],
		]);
		expect(hintKeys("options", { subTabs: true }).includes("pad.hint.reset")).toBe(false);
		expect(hintKeys("lobby", { canReady: true, canInvite: true })).toEqual([
			"pad.hint.select",
			"pad.hint.back",
			"pad.hint.ready",
			"pad.hint.invite",
		]);
	});

	it("the Y invite hint only while an invite is pending", () => {
		expect(hintKeys("main", NOTHING)).toEqual(["pad.hint.select"]);
		expect(hintKeys("main", { invitePending: true })).toEqual(["pad.hint.select", "pad.hint.invites"]);
	});

	it("lobby browser: Y Create only while not in a lobby (Create is on screen)", () => {
		expect(hintKeys("lobbies", NOTHING)).toEqual(["pad.hint.select", "pad.hint.back", "pad.hint.refresh"]);
		expect(hintKeys("lobbies", { canCreate: true, scrollList: true })).toEqual([
			"pad.hint.select",
			"pad.hint.back",
			"pad.hint.refresh",
			"pad.hint.create",
			"pad.hint.scroll",
		]);
	});

	it("run over: hold B shows Hold: Exit; X reads Highlights while the breakdown is open", () => {
		expect(hintKeys("runOver", { recap: true })).toEqual([
			"pad.hint.select",
			"pad.hint.holdExit",
			"pad.hint.details",
		]);
		expect(hintKeys("runOver", { recap: true, detailsOpen: true })).toEqual([
			"pad.hint.select",
			"pad.hint.holdExit",
			"run.recap.detailsHide",
		]);
		expect(hintKeys("runOver", NOTHING)).toEqual(["pad.hint.select", "pad.hint.holdExit"]);
	});

	it("run over, a party run (docs/RUN_CONTRIBUTION.md CT6): LB / RB Tabs before X, the stick for a long Party list", () => {
		expect(hintKeys("runOver", { recap: true, partyTabs: true })).toEqual([
			"pad.hint.select",
			"pad.hint.holdExit",
			"pad.hint.tabs",
			"pad.hint.details",
		]);
		expect(hintKeys("runOver", { recap: true, partyTabs: true, scrollList: true })).toEqual([
			"pad.hint.select",
			"pad.hint.holdExit",
			"pad.hint.tabs",
			"pad.hint.details",
			"pad.hint.scroll",
		]);
		// Details open: the tabs are swapped out with the highlights, so no Tabs hint.
		expect(hintKeys("runOver", { recap: true, detailsOpen: true })).toEqual([
			"pad.hint.select",
			"pad.hint.holdExit",
			"run.recap.detailsHide",
		]);
		const keys = padHints("runOver", { recap: true, partyTabs: true }).map((h) => h.keyNames.join("+"));
		expect(keys.includes(`${PAD_KEYS.lb}+${PAD_KEYS.rb}`)).toBe(true);
	});

	it("pause: B Resume once (Start resumes too, unhinted); B shows nothing where it does nothing", () => {
		expect(hintKeys("pause", EVERYTHING)).toEqual(["pad.hint.select", "pad.hint.resume"]);
		expect(hintKeys("confirm", EVERYTHING)).toEqual(["pad.hint.select", "pad.hint.cancel"]);
		expect(hintKeys("outro", EVERYTHING)).toEqual(["pad.hint.select"]);
		expect(hintKeys("draft", EVERYTHING)).toEqual([]);
		expect(hintKeys("rebind", EVERYTHING)).toEqual([]);
	});

	it("every hinted key acts in that context, in every combination of conditions", () => {
		const combos = 1 << ALL_CONDITIONS.size();
		for (const id of PAD_SURFACE_IDS) {
			for (let m = 0; m < combos; m++) {
				const ctx: { [K in PadCondition]?: boolean } = {};
				for (let i = 0; i < ALL_CONDITIONS.size(); i++) {
					if (bit32.band(m, bit32.lshift(1, i)) !== 0) ctx[ALL_CONDITIONS[i]] = true;
				}
				for (const h of padHints(id, ctx)) {
					for (const k of h.keyNames) {
						expect([id, m, k, menuPadAction(id, k, ctx).kind !== "none"]).toEqual([id, m, k, true]);
					}
				}
			}
		}
	});
});

describe("hold B to exit (section 3, GMD13)", () => {
	const HOLD = GAMEPAD_MENU.holdExitSec;

	it("holdProgress fills 0..1", () => {
		expect(HOLD).toBe(0.6);
		expect(holdProgress(0, HOLD)).toBe(0);
		expect(holdProgress(0.3, 0.6)).toBe(0.5);
		expect(holdProgress(0.9, 0.6)).toBe(1);
		expect(holdProgress(-1, 0.6)).toBe(0);
		expect(holdProgress(0.1, 0)).toBe(1);
	});

	it("completes once after the hold time; an early release empties it", () => {
		const g = new PadHoldGate();
		g.open(false);
		expect(g.step(true, 0.25, 0.5)).toBe("holding");
		expect(g.progress(0.5)).toBe(0.5);
		expect(g.step(false, 0.1, 0.5)).toBe("idle");
		expect(g.progress(0.5)).toBe(0);
		expect(g.step(true, 0.25, 0.5)).toBe("holding");
		expect(g.step(true, 0.25, 0.5)).toBe("complete");
		expect(g.completed()).toBe(true);
		expect(g.progress(0.5)).toBe(1);
		expect(g.step(true, 1, 0.5)).toBe("idle");
		expect(g.step(false, 0, 0.5)).toBe("idle");
		expect(g.step(true, 1, 0.5)).toBe("idle"); // once per open
	});

	it("a press that began before the panel opened never counts until released", () => {
		const g = new PadHoldGate();
		g.open(true);
		expect(g.step(true, 5, 0.5)).toBe("idle");
		expect(g.progress(0.5)).toBe(0);
		expect(g.step(false, 0.01, 0.5)).toBe("idle");
		expect(g.step(true, 0.5, 0.5)).toBe("complete");
	});

	it("does nothing while closed; reopening starts over", () => {
		const g = new PadHoldGate();
		expect(g.step(true, 1, 0.5)).toBe("idle");
		g.open(false);
		g.step(true, 0.25, 0.5);
		g.close();
		expect(g.progress(0.5)).toBe(0);
		expect(g.step(true, 1, 0.5)).toBe("idle");
		g.open(false);
		expect(g.completed()).toBe(false);
		expect(g.step(true, 0.5, 0.5)).toBe("complete");
	});
});

describe("GAMEPAD_MENU and MENU_HAPTICS (GM9)", () => {
	it("tunables are in range", () => {
		expect(GAMEPAD_MENU.scrollStepPx > 0).toBe(true);
		expect(GAMEPAD_MENU.scrollRepeatSec > 0).toBe(true);
		expect(GAMEPAD_MENU.stickDeadZone > 0 && GAMEPAD_MENU.stickDeadZone < 1).toBe(true);
		expect(GAMEPAD_MENU.followMarginPx >= 0).toBe(true);
		expect(GAMEPAD_MENU.tvSafe.x >= 0 && GAMEPAD_MENU.tvSafe.x < 0.5).toBe(true);
		expect(GAMEPAD_MENU.tvSafe.y >= 0 && GAMEPAD_MENU.tvSafe.y < 0.5).toBe(true);
	});

	it("every cue is a few short pulses on a known motor; the disabled cue is a double buzz", () => {
		expect([...MENU_HAPTIC_KINDS]).toEqual(["confirm", "disabled", "listEnd", "holdComplete"]);
		for (const kind of MENU_HAPTIC_KINDS) {
			const pulses = MENU_HAPTICS[kind];
			expect([kind, pulses.size() >= 1]).toEqual([kind, true]);
			for (const p of pulses) {
				const ok =
					(p.motor === "Small" || p.motor === "Large") &&
					p.strength > 0 &&
					p.strength <= 1 &&
					p.seconds > 0 &&
					p.seconds <= MENU_HAPTIC_MAX_PULSE_SEC &&
					p.delaySec >= 0;
				expect([kind, ok]).toEqual([kind, true]);
			}
		}
		const d = MENU_HAPTICS.disabled;
		expect(d.size()).toBe(2);
		expect(d[1].delaySec > d[0].delaySec + d[0].seconds).toBe(true);
	});
});

describe("a shortcut yields to the player's pad restart (review fix)", () => {
	it("a shortcut on the restart key does nothing; another key, or no restart binding, keeps it", () => {
		const recap: PadContext = { recap: true };
		expect(menuPadAction("runOver", PAD_KEYS.x, recap).kind).toBe("shortcutX");
		expect(menuPadAction("runOver", PAD_KEYS.x, { ...recap, restartPad: PAD_KEYS.x }).kind).toBe("none");
		expect(menuPadAction("runOver", PAD_KEYS.x, { ...recap, restartPad: "DPadDown" }).kind).toBe("shortcutX");
		const lobby: PadContext = { canReady: true, canInvite: true, restartPad: PAD_KEYS.y };
		expect(menuPadAction("lobby", PAD_KEYS.x, lobby).kind).toBe("shortcutX");
		expect(menuPadAction("lobby", PAD_KEYS.y, lobby).kind).toBe("none");
	});

	it("only shortcuts yield: tabs, sub-tabs, B and Start keep their menu meaning", () => {
		expect(menuPadAction("options", PAD_KEYS.lb, { restartPad: PAD_KEYS.lb }).kind).toBe("tabPrev");
		expect(menuPadAction("options", PAD_KEYS.rt, { subTabs: true, restartPad: PAD_KEYS.rt }).kind).toBe(
			"subTabNext",
		);
		expect(menuPadAction("pause", PAD_KEYS.b, { restartPad: PAD_KEYS.b }).kind).toBe("resume");
		expect(menuPadAction("pause", PAD_KEYS.start, { restartPad: PAD_KEYS.start }).kind).toBe("resume");
		const reset: MenuPadAction = { kind: "shortcutX", meaning: "reset" };
		expect(padShortcutYields(reset, PAD_KEYS.x, { restartPad: PAD_KEYS.x })).toBe(true);
		expect(padShortcutYields(reset, PAD_KEYS.x, {})).toBe(false);
		expect(padShortcutYields({ kind: "tabNext" }, PAD_KEYS.rb, { restartPad: PAD_KEYS.rb })).toBe(false);
	});

	it("the hint bar leaves a yielded shortcut out (it never names a button that does nothing)", () => {
		const keysOf = (ctx: PadContext) => padHints("runOver", ctx).map((h) => h.keyNames.join("+"));
		expect(keysOf({ recap: true }).includes(PAD_KEYS.x)).toBe(true);
		expect(keysOf({ recap: true, restartPad: PAD_KEYS.x }).includes(PAD_KEYS.x)).toBe(false);
		// The tab pair never yields, even with the restart on one of its keys.
		const tabs = padHints("options", { restartPad: PAD_KEYS.lb }).map((h) => h.keyNames.join("+"));
		expect(tabs.includes(`${PAD_KEYS.lb}+${PAD_KEYS.rb}`)).toBe(true);
		for (const row of padRows("options")) {
			if (row.keys.includes(PAD_KEYS.x)) expect(padRowYields(row, { restartPad: PAD_KEYS.x })).toBe(true);
		}
	});
});
