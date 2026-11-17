// The fourth endless set's sounds (docs/NEW_ENEMIES_3.md NT7): VariantCueEvents counts a Mortar's release (its draw
// leaving for the flight; a called-off draw is silent), its shells, the heal pulses, beam cuts, lunges and spooks; the
// mapper plays each of the six IDs once per frame that has one, a shell never as the Stormcaller's lightning, the
// shrapnel ring never as the enemy shot, and every one of the six under its minimum interval.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ALL_EVENT_FIELDS,
	AiState,
	EMPTY_INPUT,
	MORTAR,
	MORTAR_ATTACK_LOB,
	MORTAR_FLIGHT,
	MORTAR_KEEP,
	createSimState,
	eventDefault,
	playerAt,
	step,
	type ActorSpawn,
	type SimConfig,
	type SimEvents,
	type SimState,
} from "shared/sim";
import { NEW_ENEMY_3_AUDIO_IDS, PORT_AUDIO_EVENTS } from "shared/theme";
import { NO_BOOST_EVENTS } from "../boosts";
import { NO_COMBO_EVENTS, NO_VARIANT_CUES, VariantCueEvents, type VariantCueSource } from "../fx";
import { FxEventBuffer } from "../fx/events";
import { NEW_ENEMY_3_AUDIO } from "../newEnemies3Config";
import { ALL_SFX, AudioCueList, AudioCueMapper, PORT_SFX, SFX, SFX_MIN_INTERVAL, type SfxId } from ".";

const NT_FIELDS: ReadonlyArray<readonly [keyof VariantCueSource, SfxId]> = [
	["lobs", SFX.enemyLob],
	["shells", SFX.enemyShell],
	["heals", SFX.enemyHeal],
	["healCuts", SFX.enemyHealCut],
	["lunges", SFX.enemyLunge],
	["spooks", SFX.enemySpooked],
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

function frame(
	m: AudioCueMapper,
	now: number,
	variants: VariantCueSource,
	events: SimEvents = noEvents(),
	state: SimState = createSimState(1, 0, 0),
): AudioCueList {
	return m.frame(
		now,
		events,
		NO_FX,
		state,
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
	it("a Mortar's release: once as its draw leaves for the flight, not while the shell flies, not a called-off draw", () => {
		const s = createSimState(3, 0, 0, openConfig([{ kind: MORTAR.id, x: 0, z: 7 }]));
		const m = s.combat.actors[0];
		const ev = new VariantCueEvents();
		ev.collect(s);
		const draw = () => {
			m.aiState = AiState.TELEGRAPH;
			m.attack = MORTAR_ATTACK_LOB;
		};
		tick(ev, s, draw);
		tick(ev, s, () => (m.aiState = MORTAR_FLIGHT));
		expect(ev.lobs).toBe(1);
		tick(ev, s, () => (m.aiState = MORTAR_FLIGHT));
		expect(ev.lobs).toBe(0);
		tick(ev, s, draw);
		tick(ev, s, () => {
			m.aiState = MORTAR_KEEP; // the target left the room during the draw: nothing fired
			m.attack = 0;
		});
		expect(ev.lobs).toBe(0);
	});

	it("shells, cuts, lunges and spooks from SimEvents; heals per pulse (CombatState.healEvents)", () => {
		const s = createSimState(4, 0, 0, openConfig([]));
		const ev = new VariantCueEvents();
		ev.collect(s);
		tick(ev, s, () => {
			s.events.shells = 1;
			s.events.strikes = 1;
			s.events.healCuts = 2;
			s.events.lunges = 1;
			s.events.spooks = 3;
			s.combat.healEvents.healSlot.push(0, 1);
			s.combat.healEvents.healAmount.push(1, 1);
		});
		expect([ev.shells, ev.heals, ev.healCuts, ev.lunges, ev.spooks, ev.strikes]).toEqual([1, 2, 2, 1, 3, 0]);
		tick(ev, s, () => {
			s.events.shells = 0;
			s.events.strikes = 0;
			s.events.healCuts = 0;
			s.events.lunges = 0;
			s.events.spooks = 0;
			s.combat.healEvents.healSlot.clear();
			s.combat.healEvents.healAmount.clear();
		});
		expect(ev.count()).toBe(0);
	});

	it("a real Mortar: one release per shell, and every shell an impact (never lightning)", () => {
		const config = openConfig([{ kind: MORTAR.id, x: 0, z: 7 }]);
		const s = createSimState(5, 0, 0, config);
		playerAt(s, 0).hurtTicks = 1e6;
		const ev = new VariantCueEvents();
		ev.collect(s);
		let lobs = 0;
		let shells = 0;
		let strikes = 0;
		for (let t = 0; t < 900; t++) {
			ev.reset();
			step(s, EMPTY_INPUT, config);
			ev.collect(s);
			lobs += ev.lobs;
			shells += ev.shells;
			strikes += ev.strikes;
		}
		expect(shells).toBeGreaterThanOrEqual(2);
		// the last release may still be in the air
		expect(lobs === shells || lobs === shells + 1).toBe(true);
		expect(strikes).toBe(0);
	});
});

describe("mapper rows", () => {
	it("each count plays its ID once; nothing on the next frame without one, nothing by default", () => {
		for (const [field, id] of NT_FIELDS) {
			const m = new AudioCueMapper();
			expect([field, frame(m, 0, cues({ [field]: 3 })).toIds()]).toEqual([field, [id]]);
			expect([field, frame(m, 5, NO_VARIANT_CUES).toIds()]).toEqual([field, []]);
		}
		expect(frame(new AudioCueMapper(), 0, NO_VARIANT_CUES).toIds()).toEqual([]);
	});

	it("a shell plays the shell, never the lightning's strike", () => {
		const ids = frame(new AudioCueMapper(), 0, cues({ shells: 2, strikes: 0 })).toIds();
		expect(ids).toEqual([SFX.enemyShell]);
	});

	it("the shrapnel ring of a shell's impact never plays the enemy shot; the same rise without a shell does", () => {
		const s = createSimState(1, 0, 0);
		const shrapnel = NEW_ENEMY_3_AUDIO.shrapnelPerShell;
		expect(shrapnel).toBe(MORTAR.data.shrapnel.count);
		const m = new AudioCueMapper();
		frame(m, 0, NO_VARIANT_CUES, noEvents(), s); // the baseline
		const impact = noEvents();
		impact.strikes = 1;
		impact.shells = 1;
		s.combat.enemySpawned += 1 + shrapnel;
		expect(frame(m, 1, cues({ shells: 1 }), impact, s).toIds()).toEqual([SFX.enemyShell]);
		// lightning (a strike without a shell) and six more bullets: the shot plays
		const lightning = noEvents();
		lightning.strikes = 1;
		s.combat.enemySpawned += 1 + shrapnel;
		expect(
			frame(m, 2, cues({ strikes: 1 }), lightning, s)
				.toIds()
				.includes(SFX.enemyShoot),
		).toBe(true);
	});

	it("every one of the six has a minimum interval; heal pulses inside it are one sound", () => {
		for (const [, id] of NT_FIELDS) expect([id, (SFX_MIN_INTERVAL[id] ?? 0) > 0]).toEqual([id, true]);
		const m = new AudioCueMapper();
		const gap = NEW_ENEMY_3_AUDIO.healMinIntervalSec;
		expect(frame(m, 0, cues({ heals: 1 })).toIds()).toEqual([SFX.enemyHeal]);
		expect(frame(m, gap / 2, cues({ heals: 1 })).toIds()).toEqual([]);
		expect(frame(m, gap + 0.01, cues({ heals: 1 })).toIds()).toEqual([SFX.enemyHeal]);
	});

	it("the six are the theme's port audio IDs, in ALL_SFX and PORT_SFX", () => {
		expect(NT_FIELDS.map(([, id]) => id as string)).toEqual([...NEW_ENEMY_3_AUDIO_IDS]);
		for (const [, id] of NT_FIELDS) {
			expect([
				id,
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
			]).toEqual([id, true, true, true]);
		}
	});
});
