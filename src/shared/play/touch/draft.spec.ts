// Headless spec for the touch draft helpers (docs/MOBILE_IMPL.md MB6). A tap in a card's column goes through the real
// touch mapping and selects that card; draftStatus follows the snapshot's draft rule (draftReady) on a real endless run.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessRunConfig } from "shared/run";
import { frame, skipToFloor } from "shared/run/testing";
import {
	DEBUG_FLOOR_BUTTON,
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	createSimState,
	draftCardFor,
	draftColumn,
	step,
	type SimState,
} from "shared/sim";
import { mapDevicesToInput, type DeviceSnapshot } from "../inputMapping";
import { takeSnapshot } from "../snapshot";
import { TouchControls, draftScreenX } from "./controls";
import { draftColumnForCard, draftStatus } from "./draft";

/** A touch-only snapshot: one frame of move stick, pushed screen-right by `moveX`. */
function touchSnap(moveX: number): DeviceSnapshot {
	return {
		kbm: { keys: new Set<string>(), mouseButtons: new Set<string>() },
		pad: undefined,
		aimDevice: "none",
		pointerAimX: 0,
		pointerAimZ: 0,
		touch: { moveX, moveY: 0, aimX: 0, aimZ: 0, buttons: 0 },
	};
}

describe("draftColumnForCard", () => {
	it("is the inverse of draftCardFor for every card count", () => {
		for (let n = 1; n <= DRAFT_OFFER_COUNT; n++) {
			for (let i = 0; i < n; i++) {
				expect(draftCardFor(draftColumnForCard(i, n), n)).toBe(i);
			}
		}
	});

	it("a tap on a card, through the touch mapping, selects that card", () => {
		for (let n = 1; n <= DRAFT_OFFER_COUNT; n++) {
			for (let i = 0; i < n; i++) {
				const frame = mapDevicesToInput(touchSnap(draftScreenX(draftColumnForCard(i, n))));
				expect(draftCardFor(draftColumn(frame), n)).toBe(i);
			}
		}
	});

	it("each column reads back as itself through the touch mapping", () => {
		for (const column of [DRAFT_COLUMN_LEFT, DRAFT_COLUMN_CENTRE, DRAFT_COLUMN_RIGHT]) {
			expect(draftColumn(mapDevicesToInput(touchSnap(draftScreenX(column))))).toBe(column);
		}
	});
});

describe("draftStatus", () => {
	it("is closed on a fresh run, and open then ready on the snapshot's draft rule", () => {
		const setup = buildEndlessRunConfig(42);
		const st = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
		const extras = { paused: false, outcome: "playing" as const, recordedTicks: 0, config: setup.config };
		expect(draftStatus(st, 0)).toEqual({ open: false, ready: false, deal: 0 });

		// A hand-set draft (the sim opens it on a boon pick): the ready boundary is draftTicks + 1 >= DRAFT_MIN_OPEN_TICKS.
		const p = st.run!.players[0];
		p.draftOpen = 1;
		p.draftTicks = DRAFT_MIN_OPEN_TICKS - 2;
		expect(draftStatus(st, 0)).toEqual({ open: true, ready: false, deal: 0 });
		expect(takeSnapshot(st, extras).draftReady).toBe(false);
		p.draftTicks = DRAFT_MIN_OPEN_TICKS - 1;
		expect(draftStatus(st, 0)).toEqual({ open: true, ready: true, deal: 0 });
		expect(takeSnapshot(st, extras).draftReady).toBe(true);
	});
});

describe("a tapped pick in the boss double draft (docs/BUILDS.md BUD4)", () => {
	/** One client frame: the touch controls on the live draft, through the touch mapping, one sim step. */
	function stepTouch(st: SimState, c: TouchControls, config: Parameters<typeof step>[2], chosen: number[]): void {
		const d = draftStatus(st, 0);
		const touch = c.frame({
			dt: 1 / 60,
			stickRadiusPx: 100,
			autoTarget: false,
			facingX: 0,
			facingZ: 1,
			autoAim: () => undefined,
			draftOpen: d.open,
			draftReady: d.ready,
			draftDeal: d.deal,
		});
		step(st, mapDevicesToInput({ ...touchSnap(0), touch }), config);
		const card = st.run!.events.draftChosen;
		if (card > 0) chosen.push(card - 1);
	}

	it("the first deal's tap takes only its card; the re-deal waits for a tap of its own", () => {
		const setup = buildEndlessRunConfig(42);
		const config = setup.config;
		const st = createSimState(42, setup.spawn!.x, setup.spawn!.z, config);
		skipToFloor(st, config, 5);
		step(st, frame(0, 0, DEBUG_FLOOR_BUTTON), config);
		expect(st.endless!.floor).toBe(6);
		expect(draftStatus(st, 0)).toEqual({ open: true, ready: false, deal: 2 });

		const p = st.run!.players[0];
		const first = [...p.draftOffers];
		const c = new TouchControls();
		const chosen: number[] = [];
		c.queueDraftPick(draftColumnForCard(0, first.size()));
		let guard = 0;
		while (draftStatus(st, 0).deal === 2 && guard < 600) {
			stepTouch(st, c, config, chosen);
			guard += 1;
		}
		expect(chosen).toEqual([first[0]]);
		expect(draftStatus(st, 0).open).toBe(true);
		expect(draftStatus(st, 0).deal).toBe(1);

		// Five seconds on the second deal with no tap: nothing is taken (the old queued pick re-fired after 0.5 s).
		for (let i = 0; i < 300; i++) stepTouch(st, c, config, chosen);
		expect(chosen).toEqual([first[0]]);
		expect(draftStatus(st, 0).open).toBe(true);
		expect(c.hasDraftPick()).toBe(false);

		// A tap on the second deal's last card takes that card and closes the draft.
		const second = [...p.draftOffers];
		c.queueDraftPick(draftColumnForCard(second.size() - 1, second.size()));
		guard = 0;
		while (draftStatus(st, 0).open && guard < 600) {
			stepTouch(st, c, config, chosen);
			guard += 1;
		}
		expect(chosen).toEqual([first[0], second[second.size() - 1]]);
		expect(draftStatus(st, 0)).toEqual({ open: false, ready: false, deal: 0 });
	});
});
