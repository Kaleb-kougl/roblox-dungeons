// The third endless set's sounds (docs/NEW_ENEMIES_2.md NX7): VariantCueEvents counts each moment once (SimEvents'
// blocks / guard breaks / latches / braziers lit, a Chainhook's throw leaving its aim, the Snatcher's pellet events),
// and the mapper plays each of the eight IDs once per frame that has one (the snatch pitched down), never again on a
// frame without one.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ALL_EVENT_FIELDS,
	AiState,
	CHAINHOOK,
	CHAINHOOK_ATTACK_THROW,
	CHAINHOOK_KEEP,
	CHAINHOOK_THROWN,
	PELLETS_CONFIG,
	createSimState,
	eventDefault,
	type ActorSpawn,
	type SimConfig,
	type SimEvents,
	type SimState,
} from "shared/sim";
import { NEW_ENEMY_2_AUDIO_IDS, PORT_AUDIO_EVENTS } from "shared/theme";
import { NO_BOOST_EVENTS } from "../boosts";
import { NO_COMBO_EVENTS, NO_VARIANT_CUES, VariantCueEvents, type VariantCueSource } from "../fx";
import { FxEventBuffer } from "../fx/events";
import { NEW_ENEMY_2_AUDIO } from "../newEnemies2Config";
import { ALL_SFX, AudioCueList, AudioCueMapper, PORT_SFX, SFX, type SfxId } from ".";

const NX_FIELDS: ReadonlyArray<readonly [keyof VariantCueSource, SfxId]> = [
	["blocks", SFX.enemyBlock],
	["guardBreaks", SFX.enemyGuardBreak],
	["hookThrows", SFX.enemyHook],
	["hookLatches", SFX.enemyHookLatch],
	["snatches", SFX.enemySnatch],
	["swallows", SFX.enemySwallow],
	["pelletReturns", SFX.pelletReturn],
	["pyreLights", SFX.enemyPyreLight],
];
const NO_FX = new FxEventBuffer(1);

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

function cues(fields: Partial<Record<keyof VariantCueSource, number>>): VariantCueEvents {
	const ev = new VariantCueEvents();
	for (const [k, v] of pairs(fields)) (ev as unknown as Record<string, number>)[k] = v;
	return ev;
}

function frame(m: AudioCueMapper, now: number, variants: VariantCueSource): AudioCueList {
	return m.frame(
		now,
		noEvents(),
		NO_FX,
		createSimState(1, 0, 0),
		0,
		new AudioCueList(),
		NO_BOOST_EVENTS,
		NO_COMBO_EVENTS,
		undefined,
		variants,
	);
}

const openConfig = (spawns: ActorSpawn[]): SimConfig => ({
	encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 },
});

/** One fake tick: the state is edited by hand, then the tick advances as a step would. */
function tick(ev: VariantCueEvents, s: SimState, edit: () => void): void {
	ev.reset();
	edit();
	s.tick += 1;
	ev.collect(s);
}

describe("counting (VariantCueEvents)", () => {
	it("each SimEvents / PelletEvents moment counts once on its tick and never on the next", () => {
		const s = createSimState(2, 0, 0, openConfig([{ kind: CHAINHOOK.id, x: 0, z: 6 }]));
		const ev = new VariantCueEvents();
		ev.collect(s);
		const pe = () => s.pellets?.events;
		tick(ev, s, () => {
			s.events.shieldBlocks = 2;
			s.events.guardBreaks = 1;
			s.events.hookLatched = 1;
			s.events.pyresLanded = 1;
		});
		expect([ev.blocks, ev.guardBreaks, ev.hookLatches, ev.pyreLights]).toEqual([2, 1, 1, 1]);
		tick(ev, s, () => {
			s.events.shieldBlocks = 0;
			s.events.guardBreaks = 0;
			s.events.hookLatched = 0;
			s.events.pyresLanded = 0;
		});
		expect(ev.count()).toBe(0);
		// Without pellet state the Snatcher's three are 0 (no error).
		expect([pe(), ev.snatches, ev.swallows, ev.pelletReturns]).toEqual([undefined, 0, 0, 0]);
	});

	it("a Chainhook's throw: once as it leaves its aim for the throw, not while the hook flies, not a dropped throw", () => {
		const s = createSimState(3, 0, 0, openConfig([{ kind: CHAINHOOK.id, x: 0, z: 6 }]));
		const c = s.combat.actors[0];
		const ev = new VariantCueEvents();
		ev.collect(s);
		const aim = () => {
			c.aiState = AiState.TELEGRAPH;
			c.attack = CHAINHOOK_ATTACK_THROW;
		};
		tick(ev, s, aim);
		tick(ev, s, () => (c.aiState = CHAINHOOK_THROWN));
		expect(ev.hookThrows).toBe(1);
		tick(ev, s, () => (c.aiState = CHAINHOOK_THROWN));
		expect(ev.hookThrows).toBe(0);
		tick(ev, s, aim);
		tick(ev, s, () => (c.aiState = CHAINHOOK_KEEP)); // the target died on the last aim tick: no throw
		expect(ev.hookThrows).toBe(0);
	});

	it("the Snatcher's pellet events: snatches, swallows and returns from the tick's PelletEvents", () => {
		const s = createSimState(4, 0, 0, {
			pellets: PELLETS_CONFIG,
		});
		const e = s.pellets!.events;
		const ev = new VariantCueEvents();
		ev.collect(s);
		tick(ev, s, () => {
			e.stolen.push({ index: 0, x: 0, z: 0 }, { index: 1, x: 1, z: 0 });
			e.swallowed.push({ x: 0, z: 0, indices: [0, 1] });
			e.returned.push({ index: 2, fromX: 0, fromZ: 0 });
		});
		expect([ev.snatches, ev.swallows, ev.pelletReturns]).toEqual([2, 1, 1]);
	});
});

describe("mapper rows", () => {
	it("each count plays its ID once; nothing on the next frame without one, nothing by default", () => {
		for (const [field, id] of NX_FIELDS) {
			const m = new AudioCueMapper();
			expect([field, frame(m, 0, cues({ [field]: 3 })).toIds()]).toEqual([field, [id]]);
			expect([field, frame(m, 5, NO_VARIANT_CUES).toIds()]).toEqual([field, []]);
		}
		expect(frame(new AudioCueMapper(), 0, NO_VARIANT_CUES).toIds()).toEqual([]);
	});

	it("the snatch plays pitched down (NEW_ENEMY_2_AUDIO.snatchSpeed); the others at the pack's jitter", () => {
		const list = frame(new AudioCueMapper(), 0, cues({ snatches: 1, blocks: 1 }));
		const speeds = new Map<string, number>();
		for (let i = 0; i < list.size(); i++) speeds.set(list.id(i), list.speed(i));
		expect(speeds.get(SFX.enemySnatch)).toBe(NEW_ENEMY_2_AUDIO.snatchSpeed);
		expect(NEW_ENEMY_2_AUDIO.snatchSpeed < 1).toBe(true);
		expect(speeds.get(SFX.enemyBlock)).toBe(0);
	});

	it("the eight are the theme's port audio IDs, in ALL_SFX and PORT_SFX", () => {
		expect(NX_FIELDS.map(([, id]) => id as string)).toEqual([
			SFX.enemyBlock,
			SFX.enemyGuardBreak,
			SFX.enemyHook,
			SFX.enemyHookLatch,
			SFX.enemySnatch,
			SFX.enemySwallow,
			SFX.pelletReturn,
			SFX.enemyPyreLight,
		]);
		for (const [, id] of NX_FIELDS) {
			expect([
				id,
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
				NEW_ENEMY_2_AUDIO_IDS.includes(id),
			]).toEqual([id, true, true, true, true]);
		}
	});
});
