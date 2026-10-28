// Headless spec for the touch draft helpers (docs/MOBILE_IMPL.md MB6). A tap in a card's column goes through the real
// touch mapping and selects that card; draftStatus follows the snapshot's draft rule (draftReady) on a real endless run.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessRunConfig } from "shared/run";
import {
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	createSimState,
	draftCardFor,
	draftColumn,
} from "shared/sim";
import { mapDevicesToInput, type DeviceSnapshot } from "../inputMapping";
import { takeSnapshot } from "../snapshot";
import { draftScreenX } from "./controls";
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
		expect(draftStatus(st, 0)).toEqual({ open: false, ready: false });

		// A hand-set draft (the sim opens it on a boon pick): the ready boundary is draftTicks + 1 >= DRAFT_MIN_OPEN_TICKS.
		const p = st.run!.players[0];
		p.draftOpen = 1;
		p.draftTicks = DRAFT_MIN_OPEN_TICKS - 2;
		expect(draftStatus(st, 0)).toEqual({ open: true, ready: false });
		expect(takeSnapshot(st, extras).draftReady).toBe(false);
		p.draftTicks = DRAFT_MIN_OPEN_TICKS - 1;
		expect(draftStatus(st, 0)).toEqual({ open: true, ready: true });
		expect(takeSnapshot(st, extras).draftReady).toBe(true);
	});
});
