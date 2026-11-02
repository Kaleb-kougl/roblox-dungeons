// The second endless set's sounds (docs/NEW_ENEMIES.md NE8): the per-tick start detection in VariantCueEvents (a
// Bomber's fuse and detonation, a Charger's charge and stun, a Reaper's spin, Stormcaller strikes from
// SimEvents.strikes), the mapper rows (ranks, intervals, the quiet gate) and the enemy shot never counting strikes.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ALL_EVENT_FIELDS,
	AiState,
	BOMBER,
	BOMBER_ATTACK_FUSE,
	BOMBER_DETONATED,
	BOMBER_FUSED,
	BOMBER_FUSE_LIT,
	CHARGER,
	CHARGER_ATTACK_LANE,
	CHARGER_CHARGE,
	CHARGER_RECOVER,
	CHARGER_STUN,
	EMPTY_INPUT,
	NO_KIND,
	REAPER,
	REAPER_DIZZY,
	REAPER_SPIN,
	STORMCALLER,
	archetypeAt,
	createSimState,
	eventDefault,
	partySize,
	playerAt,
	step,
	type ActorSpawn,
	type ActorState,
	type SimConfig,
	type SimEvents,
	type SimState,
} from "shared/sim";
import { PORT_AUDIO_EVENTS } from "shared/theme";
import { NO_BOOST_EVENTS } from "../boosts";
import {
	NO_COMBO_EVENTS,
	NO_VARIANT_CUES,
	VariantCueEvents,
	audibleVariantCues,
	comboQuiet,
	type VariantCueSource,
} from "../fx";
import { FxEventBuffer } from "../fx/events";
import {
	ALL_SFX,
	AudioCueList,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_MIN_INTERVAL,
	SFX_PRIORITY,
	type SfxId,
} from ".";

const NE_FIELDS: ReadonlyArray<readonly [keyof VariantCueSource, SfxId]> = [
	["fuses", SFX.enemyFuse],
	["blasts", SFX.enemyBlast],
	["charges", SFX.enemyCharge],
	["stuns", SFX.enemyStun],
	["strikes", SFX.enemyStrike],
	["spins", SFX.enemySpin],
];
const NE_SFX = NE_FIELDS.map(([, id]) => id);
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
	s: SimState = createSimState(1, 0, 0),
	e: SimEvents = noEvents(),
): string[] {
	return m
		.frame(now, e, NO_FX, s, 0, new AudioCueList(), NO_BOOST_EVENTS, NO_COMBO_EVENTS, undefined, variants)
		.toIds();
}

const openConfig = (spawns: ActorSpawn[]): SimConfig => ({
	encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 },
});

function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}

function firstOf(s: SimState, id: string): ActorState {
	for (const a of s.combat.actors) if (a.kind !== NO_KIND && archetypeAt(a.kind).id === id) return a;
	error(`no ${id}`);
}

/** Collects one fake tick: the state is edited by hand, then the tick advances as a step would. */
function tick(ev: VariantCueEvents, s: SimState, edit: () => void): void {
	edit();
	s.tick += 1;
	ev.collect(s);
}

describe("start detection (VariantCueEvents)", () => {
	it("a real Bomber: one fuse when it lights, one blast when it blows up, nothing after", () => {
		const config = openConfig([{ kind: BOMBER.id, x: 0, z: 4 }]);
		const s = createSimState(2, 0, 0, config);
		ghost(s);
		const b = firstOf(s, BOMBER.id);
		const ev = new VariantCueEvents();
		let fuses = 0;
		let blasts = 0;
		let litTick = -1;
		for (let t = 0; t < 600 && b.alive !== 0; t++) {
			ev.reset();
			step(s, EMPTY_INPUT, config);
			ev.collect(s);
			fuses += ev.fuses;
			blasts += ev.blasts;
			if (ev.fuses > 0) {
				litTick = s.tick;
				expect([b.aiState, b.attack, b.aiTicks]).toEqual([
					AiState.TELEGRAPH,
					BOMBER_ATTACK_FUSE,
					BOMBER.data.fuseTicks,
				]);
			}
			if (ev.blasts > 0) expect(s.tick - litTick).toBe(BOMBER.data.fuseTicks);
		}
		expect([b.alive, b.v[BOMBER_FUSED], fuses, blasts]).toEqual([0, BOMBER_DETONATED, 1, 1]);
		for (let t = 0; t < 40; t++) {
			ev.reset();
			step(s, EMPTY_INPUT, config);
			ev.collect(s);
			expect([ev.fuses, ev.blasts]).toEqual([0, 0]);
		}
	});

	it("a fizzle is no blast; the first tick of a new state only snapshots", () => {
		const s = createSimState(2, 0, 0, openConfig([{ kind: BOMBER.id, x: 0, z: 6 }]));
		const b = s.combat.actors[0];
		b.aiState = AiState.TELEGRAPH;
		b.attack = BOMBER_ATTACK_FUSE;
		const ev = new VariantCueEvents();
		ev.collect(s); // fresh: a fuse already burning makes no sound
		expect(ev.fuses).toBe(0);
		tick(ev, s, () => {
			b.alive = 0;
			b.v[BOMBER_FUSED] = BOMBER_FUSE_LIT; // shot mid-fuse
		});
		expect(ev.blasts).toBe(0);
	});

	it("a Charger: the charge when its lane ends (into the charge or a stun at once), the stun once", () => {
		const s = createSimState(3, 0, 0, openConfig([{ kind: CHARGER.id, x: 0, z: 6 }]));
		const c = s.combat.actors[0];
		const ev = new VariantCueEvents();
		ev.collect(s);
		const lane = () => {
			c.aiState = AiState.TELEGRAPH;
			c.attack = CHARGER_ATTACK_LANE;
		};
		tick(ev, s, lane);
		tick(ev, s, lane);
		expect([ev.charges, ev.stuns]).toEqual([0, 0]);
		tick(ev, s, () => (c.aiState = CHARGER_CHARGE));
		expect(ev.charges).toBe(1);
		tick(ev, s, () => (c.aiState = CHARGER_CHARGE));
		expect(ev.charges).toBe(1); // still charging: no new start
		tick(ev, s, () => (c.aiState = CHARGER_STUN));
		tick(ev, s, () => (c.aiState = CHARGER_STUN));
		expect([ev.charges, ev.stuns]).toEqual([1, 1]);
		// Blocked on its first step: lane -> stun on one tick is a charge and a stun.
		ev.reset();
		tick(ev, s, lane);
		tick(ev, s, () => (c.aiState = CHARGER_STUN));
		expect([ev.charges, ev.stuns]).toEqual([1, 1]);
		// A clear charge's recover: no stun.
		ev.reset();
		tick(ev, s, lane);
		tick(ev, s, () => (c.aiState = CHARGER_RECOVER));
		expect([ev.charges, ev.stuns]).toEqual([1, 0]);
		expect(ev.count()).toBe(1);
	});

	it("a Reaper: one spin per spin start; the dizzy is silent", () => {
		const s = createSimState(4, 0, 0, openConfig([{ kind: REAPER.id, x: 0, z: 6 }]));
		const r = s.combat.actors[0];
		const ev = new VariantCueEvents();
		ev.collect(s);
		tick(ev, s, () => (r.aiState = AiState.TELEGRAPH));
		for (let i = 0; i < 5; i++) tick(ev, s, () => (r.aiState = REAPER_SPIN));
		tick(ev, s, () => (r.aiState = REAPER_DIZZY));
		expect([ev.spins, ev.count()]).toEqual([1, 1]);
	});

	it("a real Reaper and Charger: every spin / charge start the sim makes is counted once", () => {
		for (const [id, isStart] of [
			[REAPER.id, (prev: number, a: ActorState) => a.aiState === REAPER_SPIN && prev !== REAPER_SPIN],
			[
				CHARGER.id,
				(prev: number, a: ActorState) =>
					prev === AiState.TELEGRAPH &&
					(a.aiState === CHARGER_CHARGE || a.aiState === CHARGER_STUN || a.aiState === CHARGER_RECOVER),
			],
		] as const) {
			const config = openConfig([{ kind: id, x: 0, z: 6 }]);
			const s = createSimState(6, 0, 0, config);
			ghost(s);
			const a = firstOf(s, id);
			const ev = new VariantCueEvents();
			ev.collect(s);
			let prev = a.aiState;
			let starts = 0;
			let counted = 0;
			for (let t = 0; t < 1200 && a.alive !== 0; t++) {
				ev.reset();
				step(s, EMPTY_INPUT, config);
				ev.collect(s);
				if (isStart(prev, a)) starts++;
				counted += id === REAPER.id ? ev.spins : ev.charges;
				prev = a.aiState;
			}
			expect([id, starts > 0, counted]).toEqual([id, true, starts]);
		}
	});

	it("strikes: the tick's SimEvents.strikes, summed over the frame", () => {
		const config = openConfig([{ kind: STORMCALLER.id, x: 0, z: 9 }]);
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		const ev = new VariantCueEvents();
		let fired = 0;
		let counted = 0;
		for (let t = 0; t < 900; t++) {
			ev.reset();
			step(s, EMPTY_INPUT, config);
			ev.collect(s);
			fired += s.events.strikes;
			counted += ev.strikes;
		}
		expect(fired).toBeGreaterThan(0);
		expect(counted).toBe(fired);
	});
});

describe("mapper rows", () => {
	it("each count plays its ID once at full volume; none by default", () => {
		for (const [field, id] of NE_FIELDS) {
			expect([field, frame(new AudioCueMapper(), 0, cues({ [field]: 3 }))]).toEqual([field, [id]]);
		}
		expect(frame(new AudioCueMapper(), 0, NO_VARIANT_CUES)).toEqual([]);
	});

	it("keeps each ID's minimum interval (spin and strike included); quiet hands the mapper nothing", () => {
		for (const id of NE_SFX) expect([id, (SFX_MIN_INTERVAL[id] ?? 0) > 0]).toEqual([id, true]);
		const m = new AudioCueMapper();
		const gap = SFX_MIN_INTERVAL[SFX.enemySpin]!;
		expect(frame(m, 1, cues({ spins: 1 }))).toEqual([SFX.enemySpin]);
		expect(frame(m, 1 + gap / 2, cues({ spins: 1 }))).toEqual([]);
		expect(frame(m, 1 + gap, cues({ spins: 1 }))).toEqual([SFX.enemySpin]);
		const all = cues({ fuses: 1, blasts: 1, charges: 1, stuns: 1, strikes: 3, spins: 1 });
		expect(frame(new AudioCueMapper(), 0, audibleVariantCues(all, comboQuiet(true, false)))).toEqual([]);
		expect(frame(new AudioCueMapper(), 0, audibleVariantCues(all, comboQuiet(false, false)))).toEqual([...NE_SFX]);
	});

	it("strikes never play the enemy shot; other bullets fired in the same frame still do", () => {
		const s = createSimState(1, 0, 0);
		const m = new AudioCueMapper();
		const at = (now: number, spawned: number, strikes: number, goo = 0) => {
			s.combat.enemySpawned = spawned;
			const e = noEvents();
			e.strikes = strikes;
			e.gooSpawned = goo;
			return frame(m, now, NO_VARIANT_CUES, s, e);
		};
		expect(at(0, 10, 0)).toEqual([]);
		expect(at(1, 13, 3)).toEqual([]); // a row of three strikes only
		expect(at(2, 17, 2, 2)).toEqual([]); // strikes and goo only
		expect(at(3, 21, 3)).toEqual([SFX.enemyShoot]); // three strikes and one bullet
	});

	it("ranks under every player sound and the telegraph, over the enemy's hurt / death / shot; port IDs, no jingle", () => {
		for (const id of NE_SFX) {
			for (const p of [SFX.playerHurt, SFX.playerSwing, SFX.playerShoot, SFX.enemyTelegraph])
				expect([id, p, SFX_PRIORITY[p] > SFX_PRIORITY[id]]).toEqual([id, p, true]);
			for (const e of [SFX.enemyHurt, SFX.enemyDeath, SFX.enemyShoot])
				expect([id, e, SFX_PRIORITY[id] > SFX_PRIORITY[e]]).toEqual([id, e, true]);
			expect([
				id,
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				(PORT_AUDIO_EVENTS as ReadonlyArray<string>).includes(id),
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
				SFX_FALLBACK[id],
			]).toEqual([id, true, true, true, false, false, undefined]);
		}
	});
});
