/**
 * Test support for specs (never imported by the game): pacts (docs/FORTUNE.md PS2-PS5). Setups with the game's pacts
 * config on or off over the same endless run, the first floor of a run that has pact altars, and the altar moves the
 * sim specs and the census use:
 *   teleport   test surgery: a player put on a point (position and previous position; hashed state, so both runs of a
 *              comparison must do the same)
 *   pressPact  a player teleported onto an altar, one SHRINE_BUTTON press (down, then up)
 *   walkToAltar  the endless bot (Driver.walkTo) walks onto an altar without pressing (no surgery)
 *
 * @module
 */
import {
	DEBUG_FLOOR_BUTTON,
	ENDLESS_PACTS_CONFIG,
	SHRINE_BUTTON,
	SHRINE_RADIUS,
	partySize,
	playerAt,
	step,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import type { FloorPacts } from "shared/dungeon";
import { buildEndlessRunConfig, type EndlessRunSetup } from "../endless";
import { dismissDraft, frame, skipToFloor, type Driver } from "./endlessBot";

/** The endless run `seed` for a party of `partySize`, with the game's pacts config (`on`) or without it. */
export function pactsSetup(seed: number, partySize = 1, on = true): EndlessRunSetup {
	const base = buildEndlessRunConfig(seed, partySize);
	const config: SimConfig = { ...base.config, pacts: on ? ENDLESS_PACTS_CONFIG : undefined };
	return { ...base, config };
}

/** The first floor in from..to of the run whose world has pact altars, or -1. */
export function altarFloor(setup: EndlessRunSetup, from = 1, to = 20): number {
	for (let f = from; f <= to; f++) if (setup.endlessFloor(f).pactAltars !== undefined) return f;
	return -1;
}

/** The current floor's altars (from its world), or undefined. */
export function floorAltars(setup: EndlessRunSetup, s: Readonly<SimState>): FloorPacts | undefined {
	return setup.endlessFloor(s.endless!.floor).pactAltars;
}

/** Test surgery: player `i` stands on (x, z) (position and previous position). */
export function teleport(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

/** One tick with `buttons` for player `i` (and nothing for the others), solo or co-op. */
export function stepWith(s: SimState, config: Readonly<SimConfig>, i: number, buttons: number): void {
	const n = partySize(s);
	if (s.party === undefined) {
		step(s, frame(0, 0, buttons), config);
		return;
	}
	const inputs: InputFrame[] = [];
	for (let k = 0; k < n; k++) inputs.push(frame(0, 0, k === i ? buttons : 0));
	stepParty(s, inputs, config);
}

/**
 * Test-only: debug-skips floors until `floor` (player 0's press, a release), every draft dismissed (endlessBot
 * dismissDraft); solo or co-op.
 */
export function skipToFloorAny(s: SimState, config: Readonly<SimConfig>, floor: number): void {
	if (s.party === undefined) {
		skipToFloor(s, config, floor);
		return;
	}
	while (s.endless!.floor < floor) {
		stepWith(s, config, 0, DEBUG_FLOOR_BUTTON);
		dismissDraft(s);
		stepWith(s, config, 0, 0);
	}
}

/** Test surgery + input: player `i` put on altar `kind` (PactKind) of the floor, one SHRINE_BUTTON press, a release. */
export function pressPact(setup: EndlessRunSetup, s: SimState, kind: number, i = 0): void {
	const altars = floorAltars(setup, s);
	if (altars === undefined) error("pressPact: no altars on this floor", 0);
	const a = altars.altars[kind];
	teleport(s, i, a.x, a.z);
	stepWith(s, setup.config, i, SHRINE_BUTTON);
	stepWith(s, setup.config, i, 0);
}

/**
 * The endless bot walks onto altar `kind` of its floor (within a quarter of the zone of its centre) without pressing;
 * true when it got there. The stairwell is avoided (open on a non-boss floor: walking into it would end the floor).
 */
export function walkToAltar(drv: Driver, kind: number, maxTicks = 3000): boolean {
	const altars = drv.world().pactAltars;
	if (altars === undefined) return false;
	const a = altars.altars[kind];
	const p = drv.state.player;
	const near = () => {
		const dx = p.x - a.x;
		const dz = p.z - a.z;
		return dx * dx + dz * dz < SHRINE_RADIUS * SHRINE_RADIUS * 0.25;
	};
	const w = drv.world();
	drv.walkTo(a.x, a.z, near, maxTicks, [w.stairX, w.stairZ]);
	return near();
}
