// The audio layer's pure logic (docs/FX_AUDIO.md A3): sim events and state -> sound cues (cooldowns, the per-frame cap
// and priorities, the co-op split, the new port cues), the music and ambience choice, the per-start choices (variants,
// pitch, duck), the mixing volumes, every ID it can play existing in the placeholder pack, and the combo's sounds
// (docs/COMBO.md CB4: the kill pitch ladder, the tier sting, the break).
import { describe, expect, it } from "@rbxts/jest-globals";
import { accumulateEvents, newFrameEvents, resetFrameEvents, type FrameEvents } from "shared/play";
import { recordEndlessRun } from "shared/run/testing";
import { defaultAudioSettings } from "shared/settings";
import {
	ALL_EVENT_FIELDS,
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BOW,
	BOW_DATA,
	BOW_V_CHARGE,
	Button,
	COMBO_MIN,
	EMPTY_INPUT,
	SWORD,
	SWORD_FINISHER,
	SWORD_V_GUARD,
	SWORD_V_LAST,
	archetypeIndex,
	createSimState,
	eventDefault,
	playerAt,
	stepRecorded,
	stepParty,
	weaponAt,
	weaponsAt,
	type InputFrame,
	type SimEvents,
	type SimState,
	type WeaponSlotState,
} from "shared/sim";
import { AMBIENCE_IDS, AUDIO_EVENTS, PLACEHOLDER_MANIFEST, ThemePack, slotFor } from "shared/theme";
import { BoostFrameEvents } from "../boosts";
import { NO_COMBO_EVENTS, type ComboCut, type ComboFrameSource, type ComboReset } from "../fx";
import { FxEventBuffer, type FxEventType } from "../fx/events";
import { COMBO_VIEW, KILL_PITCH, killPitchSpeed, semitonesToSpeed, tierStingSpeed } from "../hud";
import {
	ALL_SFX,
	AUDIO_VIEW,
	COMBO_KILL_PRIORITY,
	BOSS_TAUNT_IDS,
	AudioCueList,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	MUSIC,
	MusicDuck,
	PitchJitter,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_PRIORITY,
	SIM_EVENT_SOUNDS,
	VariantPicker,
	allAudioIds,
	ambienceFor,
	musicFor,
	musicPlace,
	soundGroupVolume,
	type FxEventSource,
	type SfxId,
} from ".";

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

function fxOf(types: Array<[FxEventType, boolean?, number?]>): FxEventSource {
	const buf = new FxEventBuffer(16);
	for (const [t, boss, phase] of types) {
		const e = buf.emit(t, 0)!;
		e.boss = boss === true;
		e.phase = phase ?? 0;
	}
	return buf;
}

const NO_FX = fxOf([]);

/** A solo run's state (the default loadout: the sword in set 0, the bow in set 1). */
function solo(): SimState {
	return createSimState(1, 0, 0);
}

/** A party of `size`. */
function party(size: number): SimState {
	return createSimState(1, 0, 0, { party: { size } });
}

const DUO = { party: { size: 2 } };

/** One mapper frame: the cue IDs. */
function ids(m: AudioCueMapper, now: number, e: SimEvents, fx: FxEventSource, s: SimState, me = 0): string[] {
	return m.frame(now, e, fx, s, me, new AudioCueList()).toIds();
}

/** One mapper frame: [id, volume] pairs. */
function cues(m: AudioCueMapper, now: number, e: SimEvents, s: SimState, me = 0): Array<[string, number]> {
	const out = m.frame(now, e, NO_FX, s, me, new AudioCueList());
	const list: Array<[string, number]> = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i)]);
	return list;
}

/** A mapper that has seen `s` once (the watch's baseline frame, no cues). */
function primed(s: SimState, me = 0): AudioCueMapper {
	const m = new AudioCueMapper();
	m.frame(0, noEvents(), NO_FX, s, me, new AudioCueList());
	return m;
}

function slotOf(s: SimState, player: number, weaponId: string): WeaponSlotState {
	for (const set of weaponsAt(s, player).sets) if (weaponAt(set.weapon).id === weaponId) return set;
	error(`no ${weaponId} in player ${player}'s loadout`, 0);
}

function quietPack(warnings: string[]): ThemePack {
	return new ThemePack(PLACEHOLDER_MANIFEST, { warn: (msg) => warnings.push(msg) });
}

describe("audio: sim events -> sound IDs", () => {
	it("maps every sim event in the table when its frame total is > 0", () => {
		for (const [field, id] of SIM_EVENT_SOUNDS) {
			const e = noEvents();
			e[field] = 2;
			expect([field, ids(new AudioCueMapper(), 0, e, NO_FX, solo())]).toEqual([field, [id]]);
		}
		expect(ids(new AudioCueMapper(), 0, noEvents(), NO_FX, solo())).toEqual([]);
	});

	it("maps the endless-floor events: stairwell open, a new floor, depth up", () => {
		const rows = new Map<string, string>();
		for (const [field, id] of SIM_EVENT_SOUNDS) rows.set(field, id);
		expect(rows.get("stairwellOpened")).toBe(SFX.stairwellOpen);
		expect(rows.get("floorChanged")).toBe(SFX.floorEnter);
		expect(rows.get("depthChanged")).toBe(SFX.depthUp);
	});

	it("maps tracker events: hits, non-boss kills, boss phases 2+, the boss death", () => {
		const fx = fxOf([["hit"], ["killed"], ["killed", true], ["bossPhase", true, 1], ["bossDefeated", true]]);
		expect(ids(new AudioCueMapper(), 0, noEvents(), fx, solo())).toEqual([
			SFX.enemyHurt,
			SFX.enemyDeath,
			SFX.bossDeath,
		]);
		expect(ids(new AudioCueMapper(), 0, noEvents(), fxOf([["bossPhase", true, 2]]), solo())).toEqual([
			SFX.bossRoar,
		]);
	});

	it("a taunting boss's phase change plays the taunt (the Demon Lord), Mother Bramble's the roar", () => {
		expect([...BOSS_TAUNT_IDS]).toEqual([BOSS_DEMONLORD_ID]);
		const phase = (bossId: string, p: number) => {
			const buf = new FxEventBuffer(4);
			const e = buf.emit("bossPhase", 0)!;
			e.boss = true;
			e.phase = p;
			e.kind = archetypeIndex(bossId);
			return buf;
		};
		expect(ids(new AudioCueMapper(), 0, noEvents(), phase(BOSS_DEMONLORD_ID, 2), solo())).toEqual([SFX.bossTaunt]);
		expect(ids(new AudioCueMapper(), 0, noEvents(), phase(BOSS_DEMONLORD_ID, 3), solo())).toEqual([SFX.bossTaunt]);
		expect(ids(new AudioCueMapper(), 0, noEvents(), phase(BOSS_ACT1_ID, 2), solo())).toEqual([SFX.bossRoar]);
		// the fight's start is the engage roar (SIM_EVENT_SOUNDS bossEngaged), for any boss
		expect(ids(new AudioCueMapper(), 0, noEvents(), phase(BOSS_DEMONLORD_ID, 1), solo())).toEqual([]);
		const engaged = noEvents();
		engaged.bossEngaged = 1;
		expect(ids(new AudioCueMapper(), 0, engaged, NO_FX, solo())).toEqual([SFX.bossRoar]);
		// a silent taunt (every bundled pack until D7 picks a clip) is the roar
		const m = new AudioCueMapper((id) => id !== SFX.bossTaunt);
		expect(ids(m, 0, noEvents(), phase(BOSS_DEMONLORD_ID, 2), solo())).toEqual([SFX.bossRoar]);
		expect(SFX_FALLBACK[SFX.bossTaunt]).toBe(SFX.bossRoar);
		expect(SFX_PRIORITY[SFX.bossTaunt]).toBe(SFX_PRIORITY[SFX.bossRoar]);
		expect(PORT_SFX).toContain(SFX.bossTaunt);
	});

	it("plays each sound once per frame and respects its minimum interval", () => {
		const s = solo();
		const m = new AudioCueMapper();
		const fx = fxOf([["hit"], ["hit"], ["hit"]]);
		expect(ids(m, 0, noEvents(), fx, s)).toEqual([SFX.enemyHurt]);
		expect(ids(m, 0.02, noEvents(), fx, s)).toEqual([]); // inside the 0.05 s gap
		expect(ids(m, 0.06, noEvents(), fx, s)).toEqual([SFX.enemyHurt]);
		const e = noEvents();
		e.emberUsed = 1;
		expect(ids(m, 0.07, e, NO_FX, s)).toEqual([SFX.ember]);
		expect(ids(m, 0.071, e, NO_FX, s)).toEqual([SFX.ember]); // no interval: every frame it happens
	});

	it("a pack's minInterval overrides the default; clearing it restores the default", () => {
		const s = solo();
		const m = new AudioCueMapper();
		const fx = fxOf([["hit"]]);
		m.setMinInterval(SFX.enemyHurt, 0.5);
		expect(m.intervalOf(SFX.enemyHurt)).toBe(0.5);
		expect(ids(m, 0, noEvents(), fx, s)).toEqual([SFX.enemyHurt]);
		expect(ids(m, 0.2, noEvents(), fx, s)).toEqual([]);
		m.setMinInterval(SFX.enemyHurt, undefined);
		expect(ids(m, 0.2, noEvents(), fx, s)).toEqual([SFX.enemyHurt]);
		m.setMinInterval(SFX.ember, 1);
		const e = noEvents();
		e.emberUsed = 1;
		expect(ids(m, 1, e, NO_FX, s)).toEqual([SFX.ember]);
		expect(ids(m, 1.5, e, NO_FX, s)).toEqual([]);
	});

	it("breakables: a break plays sfx.breakable.break, hits that did not break sfx.breakable.hit", () => {
		const s = solo();
		const e = noEvents();
		e.breakableHits = 3;
		expect(ids(new AudioCueMapper(), 0, e, NO_FX, s)).toEqual([SFX.breakableHit]);
		e.breakablesBroken = 3; // every hit broke a piece: only the break
		expect(ids(new AudioCueMapper(), 0, e, NO_FX, s)).toEqual([SFX.breakableBreak]);
		e.breakableHits = 5;
		expect(ids(new AudioCueMapper(), 0, e, NO_FX, s)).toEqual([SFX.breakableBreak, SFX.breakableHit]);
		const m = new AudioCueMapper();
		const hit = noEvents();
		hit.breakableHits = 1;
		expect(ids(m, 0, hit, NO_FX, s)).toEqual([SFX.breakableHit]);
		expect(ids(m, 0.03, hit, NO_FX, s)).toEqual([]); // inside its minimum interval
	});

	it("enemy shots come from the spawn counter's growth (never on the first frame or after a reset)", () => {
		const s = solo();
		const m = new AudioCueMapper();
		const at = (now: number, spawned: number, fx: FxEventSource = NO_FX) => {
			s.combat.enemySpawned = spawned;
			return ids(m, now, noEvents(), fx, s);
		};
		expect(at(0, 40)).toEqual([]);
		expect(at(1, 40)).toEqual([]);
		expect(at(2, 52)).toEqual([SFX.enemyShoot]);
		expect(at(3, 0, fxOf([["reset"]]))).toEqual([]);
		expect(at(4, 3)).toEqual([SFX.enemyShoot]);
	});

	it("solo: the sword's finisher swing plays sfx.player.finisher instead of the swing", () => {
		const s = solo();
		const m = primed(s);
		const sword = slotOf(s, 0, SWORD.id);
		const e = noEvents();
		e.meleeSwings = 1;
		const w = weaponsAt(s, 0);
		w.swingTick = 10;
		sword.v[SWORD_V_LAST] = 1;
		expect(ids(m, 1, e, NO_FX, s)).toEqual([SFX.playerSwing]);
		w.swingTick = 30;
		sword.v[SWORD_V_LAST] = SWORD_FINISHER;
		expect(ids(m, 2, e, NO_FX, s)).toEqual([SFX.playerFinisher]);
		// a silent finisher falls back to the swing (the controller plays SFX_FALLBACK)
		expect(SFX_FALLBACK[SFX.playerFinisher]).toBe(SFX.playerSwing);
	});

	it("the bow's charge reaching full plays sfx.player.charged once, for the local player only", () => {
		const s = party(2);
		const m = primed(s, 0);
		const mine = slotOf(s, 0, BOW.id);
		const theirs = slotOf(s, 1, BOW.id);
		mine.v[BOW_V_CHARGE] = BOW_DATA.chargeTicks - 1;
		expect(ids(m, 1, noEvents(), NO_FX, s)).toEqual([]);
		mine.v[BOW_V_CHARGE] = BOW_DATA.chargeTicks;
		expect(ids(m, 2, noEvents(), NO_FX, s)).toEqual([SFX.playerCharged]);
		expect(ids(m, 3, noEvents(), NO_FX, s)).toEqual([]); // held at full: once
		theirs.v[BOW_V_CHARGE] = BOW_DATA.chargeTicks;
		expect(ids(m, 4, noEvents(), NO_FX, s)).toEqual([]);
		mine.v[BOW_V_CHARGE] = 0;
		expect(ids(m, 5, noEvents(), NO_FX, s)).toEqual([]);
		mine.v[BOW_V_CHARGE] = BOW_DATA.chargeTicks;
		expect(ids(m, 6, noEvents(), NO_FX, s)).toEqual([SFX.playerCharged]);
	});

	it("the run over (every player dead) plays the game-over jingle once", () => {
		const s = solo();
		const m = primed(s);
		const e = noEvents();
		e.playerDied = 1;
		e.playerHits = 1;
		s.player.dead = 1;
		expect(ids(m, 1, e, NO_FX, s)).toEqual([SFX.playerDeath, SFX.playerHurt, SFX.gameOver]);
		expect(ids(m, 2, noEvents(), NO_FX, s)).toEqual([]);

		const p = party(2);
		const pm = primed(p);
		playerAt(p, 1).dead = 1;
		expect(ids(pm, 1, noEvents(), NO_FX, p)).never.toContain(SFX.gameOver);
		playerAt(p, 0).dead = 1;
		expect(ids(pm, 2, noEvents(), NO_FX, p)).toContain(SFX.gameOver);
	});

	it("room cleared, relic taken and shrine used come from state, once each, never across a floor change", () => {
		const s = solo();
		const fake = s as unknown as {
			endless?: { floor: number };
			score?: { combo: number; rooms: Array<{ cleared: number }> };
			run?: { pedestalTaken: number[]; shrineUsed: number };
		};
		fake.endless = { floor: 3 };
		fake.score = { combo: COMBO_MIN, rooms: [{ cleared: 0 }, { cleared: 0 }] }; // the kill ladder reads combo
		fake.run = { pedestalTaken: [0, 0], shrineUsed: 0 };
		const m = primed(s);
		fake.score.rooms[1].cleared = 1;
		expect(ids(m, 1, noEvents(), NO_FX, s)).toEqual([SFX.roomClear]);
		fake.run.pedestalTaken[0] = 1;
		fake.run.shrineUsed = 1;
		expect(ids(m, 2, noEvents(), NO_FX, s)).toEqual([SFX.relicTake, SFX.shrineUse]);
		expect(ids(m, 3, noEvents(), NO_FX, s)).toEqual([]);
		// the next floor brings new records: its first frame is a baseline for them
		fake.endless.floor = 4;
		fake.score.rooms = [{ cleared: 1 }];
		fake.run = { pedestalTaken: [1], shrineUsed: 1 };
		expect(ids(m, 4, noEvents(), NO_FX, s)).toEqual([]);
	});

	it("a new run's state is a baseline: nothing fires from the difference", () => {
		const a = solo();
		const m = primed(a);
		const b = solo();
		playerAt(b, 0).hurtTicks = 30;
		playerAt(b, 0).rollTicks = 10;
		weaponsAt(b, 0).swingTick = 5;
		expect(m.watch.hurtEdge[0]).toBe(false);
		m.frame(1, noEvents(), NO_FX, b, 0, new AudioCueList());
		expect([m.watch.hurtEdge[0], m.watch.rollEdge[0], m.watch.swingEdge[0]]).toEqual([false, false, 0]);
	});
});

describe("audio: boost drops (docs/BOOSTS.md B7)", () => {
	/** One mapper frame with `b` as the frame's boost events: [id, volume] pairs. */
	function boostCues(m: AudioCueMapper, now: number, s: SimState, b: BoostFrameEvents, me = 0) {
		const out = m.frame(now, noEvents(), NO_FX, s, me, new AudioCueList(), b);
		const list: Array<[string, number]> = [];
		for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i)]);
		return list;
	}

	it("solo: a landing, a pickup, the boost running out and an Aegis break each play their sound", () => {
		const s = solo();
		const b = new BoostFrameEvents();
		b.dropped.push({ slot: 0, kind: 0, x: 1, z: 2 }, { slot: 1, kind: 2, x: 3, z: 4 });
		expect(boostCues(new AudioCueMapper(), 0, s, b)).toEqual([[SFX.boostDrop, 1]]);
		b.reset();
		b.collected.push({ player: 0, kind: 1, slot: 0, x: 1, z: 2 });
		b.ended.push({ player: 0, kind: 3 });
		b.aegisBroke.push(0);
		expect(boostCues(new AudioCueMapper(), 0, s, b)).toEqual([
			[SFX.boostCollect, 1],
			[SFX.boostAegisBreak, 1],
			[SFX.boostExpire, 1],
		]);
		// no events (the default): nothing
		expect(ids(new AudioCueMapper(), 0, noEvents(), NO_FX, s)).toEqual([]);
	});

	it("co-op: a teammate's pickup and Aegis break are quiet; only the local player's boost running out plays", () => {
		const s = party(2);
		const m = primed(s, 0);
		const b = new BoostFrameEvents();
		b.collected.push({ player: 1, kind: 0, slot: 0, x: 1, z: 2 });
		b.aegisBroke.push(1);
		b.ended.push({ player: 1, kind: 0 });
		expect(boostCues(m, 1, s, b)).toEqual([
			[SFX.boostCollect, AUDIO_VIEW.teammateVolume],
			[SFX.boostAegisBreak, AUDIO_VIEW.teammateVolume],
		]);
		// as player 1 the same frame is loud, and the end is theirs
		expect(boostCues(primed(s, 1), 1, s, b, 1)).toEqual([
			[SFX.boostCollect, 1],
			[SFX.boostAegisBreak, 1],
			[SFX.boostExpire, 1],
		]);
	});

	it("the boost IDs are the theme's port audio events (lowercase aegisbreak), ranked, in ALL_SFX and PORT_SFX", () => {
		const ids4 = [SFX.boostDrop, SFX.boostCollect, SFX.boostExpire, SFX.boostAegisBreak];
		expect(ids4).toEqual(["sfx.boost.drop", "sfx.boost.collect", "sfx.boost.expire", "sfx.boost.aegisbreak"]);
		for (const id of ids4) {
			expect([id, ALL_SFX.includes(id), PORT_SFX.includes(id), SFX_PRIORITY[id] > 0]).toEqual([
				id,
				true,
				true,
				true,
			]);
		}
	});
});

describe("audio: per-frame cap and priorities", () => {
	it("a busy frame keeps the highest-priority cues (hurt, telegraph, Ember first; enemy shots and hits last)", () => {
		const s = solo();
		const m = primed(s);
		s.combat.enemySpawned = 0;
		m.frame(0.5, noEvents(), NO_FX, s, 0, new AudioCueList());
		const e = noEvents();
		e.playerHits = 1;
		e.telegraphs = 1;
		e.emberUsed = 1;
		e.shotsFired = 1;
		e.meleeSwings = 1;
		e.rollStarted = 1;
		e.breakableHits = 1;
		s.combat.enemySpawned = 12;
		const fx = fxOf([["hit"], ["killed"]]);
		const out = ids(m, 1, e, fx, s);
		expect(out.size()).toBe(AUDIO_VIEW.maxStartsPerFrame);
		for (const id of [SFX.playerHurt, SFX.enemyTelegraph, SFX.ember]) expect(out).toContain(id);
		for (const id of [SFX.enemyShoot, SFX.enemyHurt, SFX.breakableHit]) expect(out).never.toContain(id);
		// the dropped cues were not started: their cooldowns did not run, so the next frame may play them
		s.combat.enemySpawned = 24;
		expect(ids(m, 1.01, noEvents(), fxOf([["hit"]]), s)).toEqual([SFX.enemyHurt, SFX.enemyShoot]);
	});

	it("ranks every sound effect, the player's hurt over everything an enemy does", () => {
		for (const id of ALL_SFX) expect([id, SFX_PRIORITY[id] !== undefined]).toEqual([id, true]);
		for (const id of [SFX.enemyShoot, SFX.enemyHurt, SFX.enemyDeath, SFX.enemyTelegraph]) {
			expect([id, SFX_PRIORITY[SFX.playerHurt] > SFX_PRIORITY[id]]).toEqual([id, true]);
		}
		expect(SFX_PRIORITY[SFX.enemyShoot]).toBe(math.min(...ALL_SFX.map((id) => SFX_PRIORITY[id])));
	});

	it("never starts more than the cap over a whole recorded endless run (1 and 3 ticks per frame)", () => {
		for (const ticks of [1, 3]) {
			const r = replayRecorded(ticks);
			expect([ticks, r.overCap]).toEqual([ticks, 0]);
			expect([ticks, r.quiet]).toEqual([ticks, 0]); // solo: every cue at full volume
			expect([ticks, r.count(SFX.floorEnter), r.count(SFX.stairwellOpen), r.count(SFX.depthUp)]).toEqual([
				ticks,
				r.floors,
				r.stairs,
				r.depth,
			]);
			expect([ticks, r.depth > 0, r.floors > 0]).toEqual([ticks, true, true]);
			expect([ticks, r.count(SFX.gameOver)]).toEqual([ticks, r.dead ? 1 : 0]);
		}
	});

	it("plays the bot's relic and curse once each over the recorded run (1 tick per frame)", () => {
		// (At 3 ticks per frame the bot's floor skip lands in the shrine press's frame: an edge on the old floor in
		// the frame the floor changes is not seen, which a player walking to the stairwell never hits.)
		const r = replayRecorded(1);
		if (r.relicFloor > 0) {
			expect([r.count(SFX.relicTake), r.count(SFX.shrineUse)]).toEqual([1, 1]);
		}
	});
});

interface ReplayCounts {
	readonly relicFloor: number;
	readonly floors: number;
	readonly stairs: number;
	readonly depth: number;
	readonly dead: boolean;
	readonly overCap: number;
	readonly quiet: number;
	/** Frames that started more than one JINGLE_SFX cue (must stay 0). */
	readonly jingleFrames: number;
	readonly count: (id: string) => number;
}

const replays = new Map<number, ReplayCounts>();

/** The recorded endless run (seed 1337) through the mapper at `ticks` sim ticks per frame, frames 1 s apart. */
function replayRecorded(ticks: number): ReplayCounts {
	const cached = replays.get(ticks);
	if (cached !== undefined) return cached;
	const r = recordEndlessRun(1337);
	const setup = r.setup;
	const state = createSimState(r.seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	const m = new AudioCueMapper();
	const events: FrameEvents = newFrameEvents();
	const out = new AudioCueList();
	const counts = new Map<string, number>();
	const total = r.recording.frames.size();
	let floors = 0;
	let stairs = 0;
	let depth = 0;
	let overCap = 0;
	let quiet = 0;
	let jingleFrames = 0;
	let t = 0;
	let frame = 0;
	while (t < total) {
		resetFrameEvents(events);
		for (let k = 0; k < ticks && t < total; k++) {
			stepRecorded(state, r.recording, t, setup.config);
			accumulateEvents(events, state.events);
			if (state.events.floorChanged > 0) floors++;
			if (state.events.stairwellOpened > 0) stairs++;
			if (state.events.depthChanged > 0) depth++;
			t++;
		}
		out.clear();
		// frames 1 s apart: no cooldown hides a once-per-floor cue
		m.frame(frame, events, NO_FX, state, 0, out);
		if (out.size() > AUDIO_VIEW.maxStartsPerFrame) overCap++;
		let jingles = 0;
		for (let i = 0; i < out.size(); i++) if ((JINGLE_SFX as ReadonlyArray<string>).includes(out.id(i))) jingles++;
		if (jingles > 1) jingleFrames++;
		for (let i = 0; i < out.size(); i++) {
			counts.set(out.id(i), (counts.get(out.id(i)) ?? 0) + 1);
			if (out.volume(i) !== 1) quiet++;
		}
		frame++;
	}
	const result: ReplayCounts = {
		relicFloor: r.relicFloor,
		floors,
		stairs,
		depth,
		dead: state.player.dead !== 0,
		overCap,
		quiet,
		jingleFrames,
		count: (id) => counts.get(id) ?? 0,
	};
	replays.set(ticks, result);
	return result;
}

describe("audio: co-op split (X4)", () => {
	it("a teammate's hit is quiet, the local player's loud; both in one frame is one loud cue", () => {
		const s = party(2);
		const m = primed(s, 0);
		const e = noEvents();
		e.playerHits = 1;
		playerAt(s, 1).hurtTicks = 45;
		expect(cues(m, 1, e, s)).toEqual([[SFX.playerHurt, AUDIO_VIEW.teammateVolume]]);
		playerAt(s, 0).hurtTicks = 45;
		expect(cues(m, 2, e, s)).toEqual([[SFX.playerHurt, 1]]);
		// both at once (the teammate's invulnerability restarted too)
		playerAt(s, 0).hurtTicks = 0;
		playerAt(s, 1).hurtTicks = 0;
		m.frame(3, noEvents(), NO_FX, s, 0, new AudioCueList());
		playerAt(s, 0).hurtTicks = 45;
		playerAt(s, 1).hurtTicks = 45;
		expect(cues(m, 4, e, s)).toEqual([[SFX.playerHurt, 1]]);
	});

	it("follows the local index: as player 1, player 0's roll is the teammate's", () => {
		const s = party(3);
		const m = primed(s, 1);
		playerAt(s, 0).rollTicks = 21;
		playerAt(s, 1).flaskTicks = 30;
		const e = noEvents();
		e.rollStarted = 1;
		e.flaskUsed = 1;
		expect(cues(m, 1, e, s, 1)).toEqual([
			[SFX.playerRoll, AUDIO_VIEW.teammateVolume],
			[SFX.playerFlask, 1],
		]);
	});

	it("a teammate's death is quiet; one who left the run makes no sound", () => {
		const s = party(3);
		const m = primed(s, 0);
		playerAt(s, 1).dead = 1;
		expect(cues(m, 1, noEvents(), s)).toEqual([
			[SFX.playerDeath, AUDIO_VIEW.teammateVolume],
			[SFX.playerHurt, AUDIO_VIEW.teammateVolume],
		]);
		s.party!.left[2] = 1;
		playerAt(s, 2).dead = 1;
		expect(cues(m, 2, noEvents(), s)).toEqual([]);
	});

	it("teammates' shots and swaps are not played; the local player's are", () => {
		const s = party(2);
		const m = primed(s, 0);
		const e = noEvents();
		e.shotsFired = 1;
		e.weaponSwapped = 1;
		slotOf(s, 1, BOW.id).cooldown = BOW_DATA.cooldownTicks;
		weaponsAt(s, 1).activeSet = 1;
		expect(cues(m, 1, e, s)).toEqual([]);
		slotOf(s, 0, BOW.id).cooldown = BOW_DATA.cooldownTicks;
		weaponsAt(s, 0).activeSet = 1;
		expect(cues(m, 2, e, s)).toEqual([
			[SFX.playerSwap, 1],
			[SFX.playerShoot, 1],
		]);
	});

	it("a teammate's finisher and swing are quiet", () => {
		const s = party(2);
		const m = primed(s, 0);
		const e = noEvents();
		e.meleeSwings = 1;
		weaponsAt(s, 1).swingTick = 7;
		slotOf(s, 1, SWORD.id).v[SWORD_V_LAST] = SWORD_FINISHER;
		expect(cues(m, 1, e, s)).toEqual([[SFX.playerFinisher, AUDIO_VIEW.teammateVolume]]);
		weaponsAt(s, 1).swingTick = 20;
		slotOf(s, 1, SWORD.id).v[SWORD_V_LAST] = 1;
		expect(cues(m, 2, e, s)).toEqual([[SFX.playerSwing, AUDIO_VIEW.teammateVolume]]);
	});

	it("attributes a real stepped roll to the player who pressed it", () => {
		const s = party(2);
		const m = primed(s, 0);
		const press: InputFrame = { ...EMPTY_INPUT, moveX: 1000, buttons: Button.ROLL };
		stepParty(s, [EMPTY_INPUT, press], DUO);
		expect(s.events.rollStarted).toBe(1);
		expect(cues(m, 1, s.events, s)).toEqual([[SFX.playerRoll, AUDIO_VIEW.teammateVolume]]);
		const s2 = party(2);
		const m2 = primed(s2, 0);
		stepParty(s2, [press, EMPTY_INPUT], DUO);
		expect(cues(m2, 1, s2.events, s2)).toEqual([[SFX.playerRoll, 1]]);
	});

	it("a new local index (spectating) rebaselines only its shot / charge reads, not the frame's other cues", () => {
		const s = party(2);
		const m = primed(s, 0);
		// Player 1 fired and fully charged the bow before the switch; player 0's slots are idle.
		const bow = slotOf(s, 1, BOW.id);
		bow.cooldown = BOW_DATA.cooldownTicks;
		bow.v[BOW_V_CHARGE] = BOW_DATA.chargeTicks;
		playerAt(s, 1).rollTicks = 21;
		const e = noEvents();
		e.shotsFired = 1;
		e.rollStarted = 1;
		// The switch frame: no stale shot or charge, but the watched player's roll still plays (loud).
		expect(cues(m, 1, e, s, 1)).toEqual([[SFX.playerRoll, 1]]);
		// The next frame on the same index: a new shot is an edge again.
		bow.cooldown = 0;
		cues(m, 2, noEvents(), s, 1);
		bow.cooldown = BOW_DATA.cooldownTicks;
		const shot = noEvents();
		shot.shotsFired = 1;
		expect(cues(m, 3, shot, s, 1)).toEqual([[SFX.playerShoot, 1]]);
	});

	it("a teammate's cue ranks below the local player's same sound in a busy frame", () => {
		const s = party(2);
		const m = primed(s, 0);
		const e = noEvents();
		e.telegraphs = 1;
		e.emberUsed = 1;
		e.bulletsDeleted = 1;
		e.bossEngaged = 1;
		e.bossDefeated = 1;
		e.stairwellOpened = 1;
		slotOf(s, 0, SWORD.id).v[SWORD_V_GUARD] = 10; // the deflect is the local player's
		playerAt(s, 1).hurtTicks = 45;
		const out = cues(m, 1, e, s).map(([id]) => id);
		expect(out.size()).toBe(AUDIO_VIEW.maxStartsPerFrame);
		expect(out).never.toContain(SFX.playerHurt);
	});
});

describe("audio: co-op deflects", () => {
	it("the summed deflect is loud when the local player's guard is (or was) up or they swung, else a teammate's", () => {
		const s = party(2);
		const m = primed(s, 0);
		const e = noEvents();
		e.bulletsDeleted = 2;
		// nobody local could have: a teammate's deflect (quiet)
		slotOf(s, 1, SWORD.id).v[SWORD_V_GUARD] = 10;
		expect(cues(m, 1, e, s)).toEqual([[SFX.playerDeflect, AUDIO_VIEW.teammateVolume]]);
		// the local guard is up
		slotOf(s, 0, SWORD.id).v[SWORD_V_GUARD] = 10;
		expect(cues(m, 2, e, s)).toEqual([[SFX.playerDeflect, 1]]);
		// it dropped this frame (it swept until then): still the local player's
		slotOf(s, 0, SWORD.id).v[SWORD_V_GUARD] = 0;
		expect(cues(m, 3, e, s)).toEqual([[SFX.playerDeflect, 1]]);
		expect(cues(m, 4, e, s)).toEqual([[SFX.playerDeflect, AUDIO_VIEW.teammateVolume]]);
		// a local swing deletes bullets too (the swing plays as well)
		weaponsAt(s, 0).swingTick = 40;
		e.meleeSwings = 1;
		expect(cues(m, 5, e, s)).toEqual([
			[SFX.playerSwing, 1],
			[SFX.playerDeflect, 1],
		]);
		expect(m.watch.mayDeflect[0]).toBe(true);
	});

	it("solo is unchanged: every deflect is the player's", () => {
		const s = solo();
		const m = primed(s);
		const e = noEvents();
		e.bulletsDeleted = 1;
		expect(cues(m, 1, e, s)).toEqual([[SFX.playerDeflect, 1]]);
	});
});

describe("audio: one jingle per frame", () => {
	it("an endless boss kill plays the depth jingle, not the victory over it; M1's boss kill keeps the victory", () => {
		const e = noEvents();
		e.bossDefeated = 1;
		e.stairwellOpened = 1;
		e.depthChanged = 1;
		expect(ids(new AudioCueMapper(), 0, e, NO_FX, solo())).toEqual([SFX.stairwellOpen, SFX.depthUp]);
		const m1 = noEvents();
		m1.bossDefeated = 1;
		expect(ids(new AudioCueMapper(), 0, m1, NO_FX, solo())).toEqual([SFX.victory]);
		// a pack without the depth jingle plays the victory there
		const noDepth = new AudioCueMapper((id) => id !== SFX.depthUp);
		expect(ids(noDepth, 0, e, NO_FX, solo())).toEqual([SFX.victory, SFX.stairwellOpen]);
	});

	it("keeps the highest-priority jingle of the frame (the run over, then depth, victory, room, shrine)", () => {
		const s = solo();
		const fake = s as unknown as {
			endless?: { floor: number };
			score?: { combo: number; rooms: Array<{ cleared: number }> };
			run?: { pedestalTaken: number[]; shrineUsed: number };
		};
		fake.endless = { floor: 3 };
		fake.score = { combo: COMBO_MIN, rooms: [{ cleared: 0 }] };
		fake.run = { pedestalTaken: [0], shrineUsed: 0 };
		const m = primed(s);
		fake.score.rooms[0].cleared = 1;
		fake.run.shrineUsed = 1;
		fake.run.pedestalTaken[0] = 1;
		// room clear and shrine are both jingles: the room's; the relic is no jingle and plays too
		expect(ids(m, 1, noEvents(), NO_FX, s)).toEqual([SFX.roomClear, SFX.relicTake]);
		const order = [SFX.gameOver, SFX.depthUp, SFX.victory, SFX.roomClear, SFX.shrineUse];
		expect(JINGLE_SFX).toEqual(order);
		for (let i = 1; i < order.size(); i++) {
			expect([order[i], SFX_PRIORITY[order[i - 1]] >= SFX_PRIORITY[order[i]]]).toEqual([order[i], true]);
		}
		expect(JINGLE_SFX).never.toContain(SFX.relicTake);
		// every jingle ducks the music
		for (const id of JINGLE_SFX) expect(DUCKING_SFX).toContain(id);
	});

	it("never starts two jingles in a frame over the recorded endless run", () => {
		const r = replayRecorded(1);
		expect(r.jingleFrames).toBe(0);
		expect(r.count(SFX.depthUp)).toBe(r.depth);
	});
});

describe("audio: silent IDs (playable)", () => {
	it("a silent ID never takes a cap slot or a cooldown; its fallback plays when that one can", () => {
		const silent = new Set<string>([SFX.playerHurt, SFX.enemyTelegraph, SFX.ember, SFX.enemyHurt]);
		const s = solo();
		const m = new AudioCueMapper((id) => !silent.has(id));
		m.frame(0, noEvents(), NO_FX, s, 0, new AudioCueList());
		s.combat.enemySpawned = 0;
		m.frame(0.5, noEvents(), NO_FX, s, 0, new AudioCueList());
		const e = noEvents();
		e.playerHits = 1;
		e.telegraphs = 1;
		e.emberUsed = 1;
		e.shotsFired = 1;
		e.meleeSwings = 1;
		e.rollStarted = 1;
		e.breakableHits = 1;
		s.combat.enemySpawned = 12;
		const out = ids(m, 1, e, fxOf([["hit"], ["killed"]]), s);
		// 4 of the 10 candidates are silent: the other 6 fit the cap, the enemy shot among them
		expect(out).toEqual([
			SFX.playerRoll,
			SFX.playerShoot,
			SFX.playerSwing,
			SFX.enemyDeath,
			SFX.breakableHit,
			SFX.enemyShoot,
		]);
		// the silent hit started no cooldown: once it has a clip it plays inside its interval
		silent.delete(SFX.enemyHurt);
		expect(ids(m, 1.01, noEvents(), fxOf([["hit"]]), s)).toEqual([SFX.enemyHurt]);
	});

	it("falls back: a silent finisher is the swing, a silent back the click; a silent focus move stays silent", () => {
		expect(SFX_FALLBACK[SFX.playerFinisher]).toBe(SFX.playerSwing);
		expect(SFX_FALLBACK[SFX.uiBack]).toBe(SFX.uiClick);
		expect(SFX_FALLBACK[SFX.uiMove]).toBe(undefined);
		const m = new AudioCueMapper((id) => id !== SFX.playerFinisher && id !== SFX.uiBack && id !== SFX.uiMove);
		expect([m.resolve(SFX.playerFinisher), m.resolve(SFX.uiBack), m.resolve(SFX.uiMove)]).toEqual([
			SFX.playerSwing,
			SFX.uiClick,
			undefined,
		]);
		expect(m.resolve(SFX.uiConfirm)).toBe(SFX.uiConfirm);
		// the menu path: a silent focus move is never a start (no cooldown either)
		expect(m.uiCue(0, SFX.uiMove)).toBe(false);
		expect(m.uiCue(0, SFX.uiBack)).toBe(true);
		// the frame path: the finisher swing cues the plain swing
		const s = solo();
		const fm = new AudioCueMapper((id) => id !== SFX.playerFinisher);
		fm.frame(0, noEvents(), NO_FX, s, 0, new AudioCueList());
		const e = noEvents();
		e.meleeSwings = 1;
		weaponsAt(s, 0).swingTick = 30;
		slotOf(s, 0, SWORD.id).v[SWORD_V_LAST] = SWORD_FINISHER;
		expect(ids(fm, 1, e, NO_FX, s)).toEqual([SFX.playerSwing]);
		// no clip at all: nothing
		const none = new AudioCueMapper(() => false);
		none.frame(0, noEvents(), NO_FX, s, 0, new AudioCueList());
		weaponsAt(s, 0).swingTick = 60;
		expect(ids(none, 1, e, NO_FX, s)).toEqual([]);
		expect(none.resolve(SFX.uiBack)).toBe(undefined);
	});
});

describe("audio: menu sounds", () => {
	it("gamepad focus moves are rate-limited (uiCue)", () => {
		const m = new AudioCueMapper();
		expect(m.uiCue(0, SFX.uiMove)).toBe(true);
		expect(m.uiCue(0.03, SFX.uiMove)).toBe(false);
		expect(m.uiCue(0.1, SFX.uiMove)).toBe(true);
		expect(m.uiCue(0.1, SFX.uiBack)).toBe(true);
		expect(m.uiCue(0.1, SFX.uiBack)).toBe(true); // no interval
	});
});

describe("audio: variants, pitch and the music duck", () => {
	it("picks variants round-robin per ID", () => {
		const v = new VariantPicker();
		const seq: number[] = [];
		for (let i = 0; i < 7; i++) seq.push(v.pick(SFX.enemyHurt, 3));
		expect(seq).toEqual([0, 1, 2, 0, 1, 2, 0]);
		expect(v.pick(SFX.enemyDeath, 2)).toBe(0); // its own counter
		expect(v.pick(SFX.playerHurt, 1)).toBe(0);
		expect(v.pick(SFX.playerHurt, 0)).toBe(0);
		v.reset();
		expect(v.pick(SFX.enemyHurt, 3)).toBe(0);
	});

	it("jitters pitch inside the range, deterministically per seed, 1 without a range", () => {
		const a = new PitchJitter(7);
		const b = new PitchJitter(7);
		for (let i = 0; i < 50; i++) {
			const x = a.speed([0.9, 1.1]);
			expect(x).toBe(b.speed([0.9, 1.1]));
			expect(x >= 0.9 && x <= 1.1).toBe(true);
		}
		expect(new PitchJitter(7).unit()).never.toBe(new PitchJitter(8).unit());
		expect(a.speed(undefined)).toBe(1);
		expect(new PitchJitter(0).unit() >= 0).toBe(true);
	});

	it("ducks the music to AUDIO_VIEW.duck.level while a jingle plays, then releases", () => {
		const D = AUDIO_VIEW.duck;
		const d = new MusicDuck();
		expect(d.level(0, 0.1)).toBe(1);
		d.trigger(0, 1);
		expect(d.level(0, D.attackSec)).toBeCloseTo(D.level, 6);
		expect(d.level(0.5, 0.1)).toBeCloseTo(D.level, 6);
		expect(d.level(1, D.releaseSec / 2)).toBeCloseTo(D.level + (1 - D.level) / 2, 6);
		expect(d.level(1.5, D.releaseSec)).toBe(1);
		for (const id of [SFX.victory, SFX.depthUp, SFX.gameOver, SFX.ember]) expect(DUCKING_SFX).toContain(id);
	});
});

describe("audio: music and ambience", () => {
	it("music: the floor's biome, the boss track during the fight, silence after a death", () => {
		expect(musicFor({ outcome: "playing", bossVisible: false, biome: 1 })).toBe("music.biome.1");
		expect(musicFor({ outcome: "playing", bossVisible: true, biome: 1 })).toBe(MUSIC.boss);
		expect(musicFor({ outcome: "victory", bossVisible: false, biome: 3 })).toBe("music.biome.3");
		expect(musicFor({ outcome: "dead", bossVisible: true, biome: 1 })).toBe(undefined);
		expect(musicFor({ outcome: "playing", bossVisible: false, biome: 0 })).toBe(undefined);
	});

	it("music: the tutorial's track (its biome track while silent), the menu, the lobby (the menu's while silent)", () => {
		const run = { outcome: "playing", bossVisible: false, biome: 1 } as const;
		expect(musicFor({ ...run, tutorial: true })).toBe(MUSIC.tutorial);
		expect(musicFor({ ...run, tutorial: true }, (id) => id !== MUSIC.tutorial)).toBe("music.biome.1");
		expect(musicFor({ ...run, place: "menu" })).toBe(MUSIC.menu);
		expect(musicFor({ ...run, place: "lobby" })).toBe(MUSIC.lobby);
		expect(musicFor({ ...run, place: "lobby" }, (id) => id !== MUSIC.lobby)).toBe(MUSIC.menu);
		expect(musicFor({ ...run, place: "none" })).toBe(undefined);
		expect(musicFor({ ...run, outcome: "dead", place: "menu" })).toBe(MUSIC.menu);
		expect([musicPlace(true, "main"), musicPlace(false, "main"), musicPlace(false, "lobbies")]).toEqual([
			"run",
			"menu",
			"menu",
		]);
		expect([musicPlace(false, "lobby"), musicPlace(false, "none")]).toEqual(["lobby", "none"]);
	});

	it("ambience: the floor's amb.b<n> during a run, none in menus or after a death", () => {
		for (let b = 1; b <= 5; b++) {
			expect(ambienceFor({ outcome: "playing", bossVisible: b === 2, biome: b })).toBe(AMBIENCE_IDS[b - 1]);
		}
		expect(ambienceFor({ outcome: "dead", bossVisible: false, biome: 1 })).toBe(undefined);
		expect(ambienceFor({ outcome: "playing", bossVisible: false, biome: 0 })).toBe(undefined);
		expect(ambienceFor({ outcome: "playing", bossVisible: false, biome: 2, place: "menu" })).toBe(undefined);
	});

	it("the audio settings scale the SoundGroups (master x group, whole percents)", () => {
		const full = defaultAudioSettings();
		expect(soundGroupVolume("sfx", full)).toBe(AUDIO_VIEW.groupVolume.sfx * AUDIO_VIEW.masterVolume);
		expect(soundGroupVolume("music", full)).toBe(AUDIO_VIEW.groupVolume.music * AUDIO_VIEW.masterVolume);
		expect(soundGroupVolume("music", { master: 50, music: 50, sfx: 100 })).toBe(
			(AUDIO_VIEW.groupVolume.music * AUDIO_VIEW.masterVolume * 50 * 50) / 10000,
		);
		expect(soundGroupVolume("sfx", { master: 100, music: 0, sfx: 30 })).toBe(
			(AUDIO_VIEW.groupVolume.sfx * AUDIO_VIEW.masterVolume * 30) / 100,
		);
		expect(soundGroupVolume("sfx", { master: 0, music: 100, sfx: 100 })).toBe(0);
	});

	it("every sound ID the audio layer uses exists in the placeholder pack, in the right SoundGroup, silent today", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const all = allAudioIds();
		expect(all.size()).toBe(ALL_SFX.size() + 4 + 5 + AMBIENCE_IDS.size());
		for (const id of all) {
			expect([id, pack.has(id)]).toEqual([id, true]);
			const ref = pack.sound(id);
			expect([id, ref.group]).toEqual([id, slotFor(id)!.soundGroup]);
			expect([id, ref.assetId]).toEqual([id, undefined]);
		}
		// The contract's own audio events are all played except loot (no loot in M1).
		const contract = new Set<string>(AUDIO_EVENTS);
		for (const id of PORT_SFX) expect([id, contract.has(id)]).toEqual([id, false]);
		const unused = AUDIO_EVENTS.filter((id) => !all.includes(id));
		expect(unused).toEqual(["sfx.loot.drop", "sfx.loot.rare"]);
		expect(warnings).toEqual([]);
		const fallback = SFX_FALLBACK as Readonly<Record<string, SfxId>>;
		for (const id of ALL_SFX) if (fallback[id] !== undefined) expect(ALL_SFX).toContain(fallback[id]);
	});
});

describe("audio: the combo (docs/COMBO.md CB4)", () => {
	/** A scored run's state (the combo lives in state.score); a party of `size` shares it. */
	function scored(size = 1): SimState {
		return createSimState(1, 0, 0, size > 1 ? { party: { size }, scoring: { partySize: size } } : { scoring: {} });
	}

	/** One frame's combo events (the parts the mapper reads: start, peak, a streak end). */
	function comboFrame(startCombo: number, peak: number, endCombo = peak, ended?: ComboReset): ComboFrameSource {
		const cuts: ComboCut[] = [];
		return { ticks: 1, startCombo, endCombo, peak, kills: 0, grazes: 0, cuts, ended };
	}

	/** A streak end: the timer reset `lost` (tenths), during a fight (a break) or not (a lapse). */
	function streakEnd(lost: number, fight: boolean): ComboFrameSource {
		return comboFrame(lost, lost, COMBO_MIN, { lost, peak: lost, fight });
	}

	/** One mapper frame: [id, volume, speed] triples. */
	function comboCues(
		m: AudioCueMapper,
		now: number,
		s: SimState,
		fx: FxEventSource = NO_FX,
		combo: ComboFrameSource = NO_COMBO_EVENTS,
		e: SimEvents = noEvents(),
	): Array<[string, number, number]> {
		const out = m.frame(now, e, fx, s, 0, new AudioCueList(), undefined, combo);
		const list: Array<[string, number, number]> = [];
		for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
		return list;
	}

	const KILL = fxOf([["killed"]]);

	it("a kill per frame climbs in speed with the combo (no pack jitter: an exact speed)", () => {
		const s = scored();
		const m = primed(s);
		let last = 1;
		for (let c = 11; c <= 50; c++) {
			s.score!.combo = c;
			const out = comboCues(m, c, s, KILL);
			expect([c, out]).toEqual([c, [[SFX.enemyDeath, 1, killPitchSpeed(c)]]]);
			expect([c, out[0][2] > last]).toEqual([c, true]);
			last = out[0][2];
		}
		// +5 semitones at x2, +12 (an octave) at x5
		s.score!.combo = 20;
		expect(comboCues(m, 100, s, KILL)[0][2]).toBe(semitonesToSpeed(5));
		s.score!.combo = 50;
		expect(comboCues(m, 101, s, KILL)[0][2]).toBe(semitonesToSpeed(KILL_PITCH.maxSemitones));
		expect(semitonesToSpeed(KILL_PITCH.maxSemitones)).toBe(2);
	});

	it("three kills on one frame are one cue at the frame's final pitch", () => {
		const s = scored();
		const m = primed(s);
		s.score!.combo = 23; // 20 + three kills
		expect(comboCues(m, 1, s, fxOf([["killed"], ["killed"], ["killed"]]), comboFrame(20, 23))).toEqual([
			[SFX.enemyDeath, 1, killPitchSpeed(23)],
		]);
	});

	it("at x1.0 and in an unscored run the kill is today's cue (speed 0: the pack's jitter)", () => {
		const u = solo();
		expect(comboCues(primed(u), 1, u, KILL)).toEqual([[SFX.enemyDeath, 1, 0]]);
		const s = scored();
		expect(s.score!.combo).toBe(COMBO_MIN);
		expect(comboCues(primed(s), 1, s, KILL)).toEqual([[SFX.enemyDeath, 1, 0]]);
		// the other cues carry no speed either
		const e = noEvents();
		e.meleeSwings = 1;
		s.score!.combo = 30;
		expect(comboCues(primed(s), 2, s, NO_FX, NO_COMBO_EVENTS, e)).toEqual([[SFX.playerSwing, 1, 0]]);
	});

	it("a teammate's kill climbs the party's ladder (one combo, full volume)", () => {
		const p = scored(2);
		const m = primed(p);
		p.score!.combo = 25;
		expect(comboCues(m, 1, p, KILL)).toEqual([[SFX.enemyDeath, 1, killPitchSpeed(25)]]);
	});

	it("a hit cut plays no sound of its own and lowers the next kill's pitch", () => {
		const s = scored();
		const m = primed(s);
		s.score!.combo = 30;
		const high = comboCues(m, 1, s, KILL)[0][2];
		expect(high).toBe(killPitchSpeed(30));
		// the cut frame: the hurt sound only (CD4)
		s.score!.combo = 15;
		const hit = noEvents();
		hit.playerHits = 1;
		const cut: ComboFrameSource = { ...comboFrame(30, 30, 15), cuts: [{ before: 30, after: 15 }] };
		expect(comboCues(m, 2, s, NO_FX, cut, hit)).toEqual([[SFX.playerHurt, 1, 0]]);
		const low = comboCues(m, 3, s, KILL);
		expect(low).toEqual([[SFX.enemyDeath, 1, killPitchSpeed(15)]]);
		expect(low[0][2] < high).toBe(true);
	});

	it("after a streak end the next kill is unladdered", () => {
		const s = scored();
		const m = primed(s);
		s.score!.combo = 34;
		expect(comboCues(m, 1, s, KILL)[0][2]).toBe(killPitchSpeed(34));
		s.score!.combo = COMBO_MIN;
		expect(comboCues(m, 2, s, NO_FX, streakEnd(34, false))).toEqual([]);
		expect(comboCues(m, 3, s, KILL)).toEqual([[SFX.enemyDeath, 1, 0]]);
	});

	it("a boss kill keeps sfx.boss.death, unladdered", () => {
		const s = scored();
		const m = primed(s);
		s.score!.combo = 40;
		expect(
			comboCues(
				m,
				1,
				s,
				fxOf([
					["killed", true],
					["bossDefeated", true],
				]),
			),
		).toEqual([[SFX.bossDeath, 1, 0]]);
	});

	it("in a streak the kill outranks a swing on a capped frame; at x1.0 the swing wins", () => {
		const busy = noEvents();
		// five cues above both (hurt 95, telegraph 90, Ember 88, flask 60, roll 58), then the swing (54) and the kill
		busy.playerHits = 1;
		busy.telegraphs = 1;
		busy.emberUsed = 1;
		busy.flaskUsed = 1;
		busy.rollStarted = 1;
		busy.meleeSwings = 1;
		const s = scored();
		s.score!.combo = 25;
		const streak = comboCues(primed(s), 1, s, KILL, NO_COMBO_EVENTS, busy).map(([id]) => id);
		expect(streak.size()).toBe(AUDIO_VIEW.maxStartsPerFrame);
		expect(streak).toContain(SFX.enemyDeath);
		expect(streak).never.toContain(SFX.playerSwing);
		s.score!.combo = COMBO_MIN;
		const plain = comboCues(primed(s), 1, s, KILL, NO_COMBO_EVENTS, busy).map(([id]) => id);
		expect(plain).toContain(SFX.playerSwing);
		expect(plain).never.toContain(SFX.enemyDeath);
		const u = solo();
		const unscored = comboCues(primed(u), 1, u, KILL, NO_COMBO_EVENTS, busy).map(([id]) => id);
		expect(unscored).never.toContain(SFX.enemyDeath);
	});

	it("the tier sting: once per crossing at the tier's speed, again after re-earning, never inside 0.5 s", () => {
		const s = scored();
		const m = primed(s);
		expect(comboCues(m, 1, s, NO_FX, comboFrame(18, 19))).toEqual([]);
		expect(comboCues(m, 2, s, NO_FX, comboFrame(19, 20))).toEqual([[SFX.comboTier, 1, tierStingSpeed(1)]]);
		expect(comboCues(m, 3, s, NO_FX, comboFrame(20, 21))).toEqual([]); // the same tier
		expect(comboCues(m, 4, s, NO_FX, comboFrame(29, 30))).toEqual([[SFX.comboTier, 1, tierStingSpeed(2)]]);
		expect([tierStingSpeed(1), tierStingSpeed(2), tierStingSpeed(3), tierStingSpeed(4)]).toEqual([
			semitonesToSpeed(0),
			semitonesToSpeed(3),
			semitonesToSpeed(5),
			semitonesToSpeed(7),
		]);
		// cut below x2, re-earned 0.3 s later: inside the interval, no sting
		expect(comboCues(m, 4.1, s, NO_FX, comboFrame(30, 30, 15))).toEqual([]);
		expect(comboCues(m, 4.3, s, NO_FX, comboFrame(19, 20))).toEqual([]);
		// cut and re-earned after the interval: the sting again (re-earning is a reward)
		expect(comboCues(m, 4.6, s, NO_FX, comboFrame(20, 20, 15))).toEqual([]);
		expect(comboCues(m, 5, s, NO_FX, comboFrame(19, 20))).toEqual([[SFX.comboTier, 1, tierStingSpeed(1)]]);
		// a frame that jumps two tiers stings once, at the higher one; crossing and cut in one frame still stings
		expect(comboCues(m, 6, s, NO_FX, comboFrame(29, 41))).toEqual([[SFX.comboTier, 1, tierStingSpeed(3)]]);
		expect(comboCues(m, 7, s, NO_FX, comboFrame(49, 50, 25))).toEqual([[SFX.comboTier, 1, tierStingSpeed(4)]]);
		// no tick: nothing moved
		expect(comboCues(m, 8, s, NO_FX, NO_COMBO_EVENTS)).toEqual([]);
	});

	it("a break during a fight: the shatter at full volume, a small one (below x2) at smallBreakVolume", () => {
		const s = scored();
		const m = primed(s);
		expect(comboCues(m, 1, s, NO_FX, streakEnd(34, true))).toEqual([[SFX.comboBreak, 1, 0]]);
		expect(comboCues(m, 2, s, NO_FX, streakEnd(COMBO_VIEW.smallBreakBelow, true))).toEqual([
			[SFX.comboBreak, 1, 0],
		]);
		expect(comboCues(m, 3, s, NO_FX, streakEnd(COMBO_VIEW.smallBreakBelow - 1, true))).toEqual([
			[SFX.comboBreak, COMBO_VIEW.smallBreakVolume, 0],
		]);
		expect(comboCues(m, 4, s, NO_FX, streakEnd(14, true))).toEqual([[SFX.comboBreak, 0.5, 0]]);
		// inside its 0.5 s interval: dropped
		expect(comboCues(m, 4.2, s, NO_FX, streakEnd(34, true))).toEqual([]);
	});

	it("a lapse (no fight on) is silent", () => {
		const s = scored();
		const m = primed(s);
		expect(comboCues(m, 1, s, NO_FX, streakEnd(34, false))).toEqual([]);
		expect(comboCues(m, 2, s, NO_FX, streakEnd(14, false))).toEqual([]);
	});

	it("silent combo IDs (the placeholder pack) produce nothing and take no cooldown", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		expect([pack.sound(SFX.comboTier).assetId, pack.sound(SFX.comboBreak).assetId]).toEqual([undefined, undefined]);
		const s = scored();
		const placeholder = new AudioCueMapper((id) => pack.sound(id).assetId !== undefined);
		placeholder.frame(0, noEvents(), NO_FX, s, 0, new AudioCueList());
		expect(comboCues(placeholder, 1, s, NO_FX, comboFrame(19, 20))).toEqual([]);
		expect(comboCues(placeholder, 2, s, NO_FX, streakEnd(34, true))).toEqual([]);
		// silent while the rest plays: nothing, and no cooldown started (a clip appearing plays at once)
		const silent = new Set<string>([SFX.comboTier, SFX.comboBreak]);
		const m = new AudioCueMapper((id) => !silent.has(id));
		m.frame(0, noEvents(), NO_FX, s, 0, new AudioCueList());
		expect(comboCues(m, 1, s, NO_FX, comboFrame(19, 20))).toEqual([]);
		expect(comboCues(m, 1, s, NO_FX, streakEnd(34, true))).toEqual([]);
		silent.clear();
		expect(comboCues(m, 1.1, s, NO_FX, comboFrame(19, 20))).toEqual([[SFX.comboTier, 1, tierStingSpeed(1)]]);
		expect(comboCues(m, 1.1, s, NO_FX, streakEnd(34, true))).toEqual([[SFX.comboBreak, 1, 0]]);
		expect(warnings).toEqual([]);
	});

	it("the combo IDs: port audio events, ranked, 0.5 s apart, neither a jingle nor ducking", () => {
		expect([SFX.comboTier, SFX.comboBreak]).toEqual(["sfx.combo.tier", "sfx.combo.break"]);
		for (const id of [SFX.comboTier, SFX.comboBreak]) {
			expect([
				id,
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
			]).toEqual([id, true, true, false, false]);
			expect([id, new AudioCueMapper().intervalOf(id)]).toEqual([id, 0.5]);
			expect([id, SFX_FALLBACK[id]]).toEqual([id, undefined]);
		}
		expect([SFX_PRIORITY[SFX.comboTier], SFX_PRIORITY[SFX.comboBreak]]).toEqual([65, 73]);
		// the kill in a streak: over swings and shots, under the player's own hurt and the telegraph
		expect(COMBO_KILL_PRIORITY).toBe(55);
		for (const id of [SFX.playerSwing, SFX.playerShoot, SFX.playerDeflect, SFX.enemyDeath]) {
			expect([id, COMBO_KILL_PRIORITY > SFX_PRIORITY[id]]).toEqual([id, true]);
		}
		expect(COMBO_KILL_PRIORITY < SFX_PRIORITY[SFX.playerHurt]).toBe(true);
	});

	it("AudioCueList: a cue's speed defaults to 0 and is reset on reuse", () => {
		const list = new AudioCueList();
		list.push(SFX.enemyDeath, 1, 1.5);
		list.push(SFX.enemyHurt, 0.5);
		expect([list.speed(0), list.speed(1)]).toEqual([1.5, 0]);
		list.clear();
		list.push(SFX.enemyDeath, 1);
		expect([list.size(), list.speed(0)]).toEqual([1, 0]);
	});
});
