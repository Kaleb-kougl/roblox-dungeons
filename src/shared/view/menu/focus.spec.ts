// Gamepad menus (docs/GAMEPAD_MENUS.md GM1): focus scopes' owner, recovery / memory decisions, scrolling (focus.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	FOCUS_LAYERS,
	FocusMemory,
	focusAction,
	focusLayerRank,
	pathUnder,
	pickFocusScope,
	scrollToShow,
	type FocusContext,
	type FocusScopeEntry,
	type FocusSelection,
	type FocusState,
} from ".";

const PAD: FocusContext = { stageCovered: false, rebindCapturing: false, device: "gamepad" };
const OK: FocusSelection = { insideOwner: true, visible: true, selectable: true };

function scope(id: string, layer: FocusScopeEntry["layer"], mountOrder: number, active?: boolean): FocusScopeEntry {
	return { id, layer, mountOrder, active };
}

const MAIN = scope("main", "screen", 1);

/**
 * One decision's facts: `sel` "none" for a nil selection, `owner` "none" for no owner (set after the spread: a nil
 * field cannot override through a spread in Luau).
 */
function state(
	sel: FocusSelection | "none",
	over: Partial<FocusState> = {},
	owner: FocusScopeEntry | "none" = MAIN,
): FocusState {
	return {
		...PAD,
		memoryAvailable: false,
		...over,
		owner: owner === "none" ? undefined : owner,
		selection: sel === "none" ? undefined : sel,
	};
}

describe("focus layers (section 1)", () => {
	it("orders loading > rebind > confirm > panel > invites > overlay > screen", () => {
		expect([...FOCUS_LAYERS]).toEqual(["loading", "rebind", "confirm", "panel", "invites", "overlay", "screen"]);
		for (let i = 1; i < FOCUS_LAYERS.size(); i++) {
			expect(focusLayerRank(FOCUS_LAYERS[i - 1]) > focusLayerRank(FOCUS_LAYERS[i])).toBe(true);
		}
		expect(focusLayerRank("screen")).toBe(1);
	});
});

describe("pickFocusScope", () => {
	it("nothing mounted: no owner", () => {
		expect(pickFocusScope([], PAD)).toBe(undefined);
	});

	it("the topmost layer owns the pad, whatever the mount order", () => {
		const mounted = [scope("options", "panel", 3), scope("pause", "overlay", 2), scope("main", "screen", 1)];
		expect(pickFocusScope(mounted, PAD)?.id).toBe("options");
		const confirm = [scope("pause", "overlay", 1), scope("leave", "confirm", 0)];
		expect(pickFocusScope(confirm, PAD)?.id).toBe("leave");
	});

	it("on one layer the latest mounted wins", () => {
		expect(pickFocusScope([scope("a", "overlay", 4), scope("b", "overlay", 7)], PAD)?.id).toBe("b");
		expect(pickFocusScope([scope("b", "overlay", 7), scope("a", "overlay", 4)], PAD)?.id).toBe("b");
	});

	it("an inactive scope never owns (the invite toasts until Y)", () => {
		const mounted = [scope("invites", "invites", 5, false), scope("main", "screen", 1)];
		expect(pickFocusScope(mounted, PAD)?.id).toBe("main");
		expect(pickFocusScope([scope("invites", "invites", 5, true), scope("main", "screen", 1)], PAD)?.id).toBe(
			"invites",
		);
	});

	it("under the stage cover and during a rebind capture nobody owns, except the loading screen", () => {
		const mounted = [scope("options", "panel", 2), scope("main", "screen", 1)];
		expect(pickFocusScope(mounted, { ...PAD, stageCovered: true })).toBe(undefined);
		expect(pickFocusScope(mounted, { ...PAD, rebindCapturing: true })).toBe(undefined);
		const loading = [...mounted, scope("loading", "loading", 0)];
		expect(pickFocusScope(loading, { ...PAD, stageCovered: true })?.id).toBe("loading");
		expect(pickFocusScope(loading, PAD)?.id).toBe("loading");
	});

	it("the owner does not depend on the device (B / Backspace go back by owner)", () => {
		const mounted = [scope("main", "screen", 1)];
		expect(pickFocusScope(mounted, { ...PAD, device: "keyboard" })?.id).toBe("main");
		expect(pickFocusScope(mounted, { ...PAD, device: "touch" })?.id).toBe("main");
	});
});

describe("focusAction (section 2)", () => {
	it("keeps a usable selection inside the owner", () => {
		expect(focusAction(state(OK))).toBe("keep");
	});

	it("recovers a nil, outside, hidden or unselectable selection: memory first, else the default", () => {
		const bad: Array<FocusSelection | "none"> = [
			"none",
			{ ...OK, insideOwner: false },
			{ ...OK, visible: false },
			{ ...OK, selectable: false },
		];
		expect(bad.size()).toBe(4);
		for (const sel of bad) {
			expect(focusAction(state(sel))).toBe("selectDefault");
			expect(focusAction(state(sel, { memoryAvailable: true }))).toBe("restoreMemory");
		}
	});

	it("off the gamepad the selection is cleared (and a nil one left alone)", () => {
		for (const device of ["keyboard", "touch"] as const) {
			expect(focusAction(state(OK, { device }))).toBe("clear");
			expect(focusAction(state({ ...OK, insideOwner: false }, { device }))).toBe("clear");
			expect(focusAction(state("none", { device }))).toBe("keep");
		}
	});

	it("with no owner (stage cover) the selection is cleared", () => {
		expect(focusAction(state(OK, {}, "none"))).toBe("clear");
		expect(focusAction(state("none", {}, "none"))).toBe("keep");
	});

	it("a rebind capture leaves the selection alone", () => {
		expect(focusAction(state("none", { rebindCapturing: true }))).toBe("keep");
		expect(focusAction(state(OK, { rebindCapturing: true, device: "keyboard" }))).toBe("keep");
	});
});

describe("FocusMemory and paths (section 2, GMD9)", () => {
	it("pathUnder gives the Names below a root, or undefined outside it", () => {
		const root = ["KV_Menu", "Main"];
		expect(pathUnder(["KV_Menu", "Main", "Column", "Lobbies"], root)).toEqual(["Column", "Lobbies"]);
		expect(pathUnder(["KV_Menu", "Main"], root)).toBe(undefined);
		expect(pathUnder(["KV_Menu", "Lobby", "Back"], root)).toBe(undefined);
		expect(pathUnder(["KV_Menu"], root)).toBe(undefined);
	});

	it("remembers a copy per key, forgets on an empty path, clears", () => {
		const m = new FocusMemory();
		const path = ["Column", "Lobbies"];
		m.remember("main", path);
		path.push("Mutated");
		expect(m.recall("main")).toEqual(["Column", "Lobbies"]);
		m.remember("pause", ["Leaderboards"]);
		expect(m.size()).toBe(2);
		m.remember("main", ["Column", "Credits"]);
		expect(m.recall("main")).toEqual(["Column", "Credits"]);
		m.remember("main", []);
		expect(m.recall("main")).toBe(undefined);
		m.remember("pause", undefined);
		expect(m.size()).toBe(0);
		m.remember("a", ["x"]);
		m.forget("a");
		expect(m.recall("a")).toBe(undefined);
		m.remember("b", ["y"]);
		m.clear();
		expect(m.size()).toBe(0);
	});
});

describe("scrollToShow (section 5)", () => {
	it("leaves a row already inside the frame (with the margin) alone", () => {
		expect(scrollToShow(100, 150, 30, 300, 10)).toBe(100);
	});

	it("scrolls up to a row above the frame, down to one below, by as little as possible", () => {
		expect(scrollToShow(100, 95, 30, 300, 10)).toBe(85);
		expect(scrollToShow(100, 380, 30, 300, 10)).toBe(120);
	});

	it("never goes below 0, and with a canvas height never past its end", () => {
		expect(scrollToShow(20, 5, 30, 300, 10)).toBe(0);
		expect(scrollToShow(0, 580, 30, 300, 10, 600)).toBe(300);
		expect(scrollToShow(0, 580, 30, 300, 10)).toBe(320);
		expect(scrollToShow(0, 0, 30, 300, 10, 200)).toBe(0);
	});

	it("aligns the top of a row taller than the frame", () => {
		expect(scrollToShow(0, 400, 500, 300, 10)).toBe(390);
		expect(scrollToShow(800, 400, 500, 300, 10)).toBe(390);
	});
});
