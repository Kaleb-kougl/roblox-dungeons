// Grazes and parries' sounds (docs/GRAZE_PARRY.md GP6): the mapper's graze shimmer (the director's cue, exact speed,
// volume, interval, rank), the parry replacing the deflect (fallback while silent, teammate volume, one per frame) and
// an undefined near-miss frame leaving every cue as before.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ALL_EVENT_FIELDS,
	SWORD,
	SWORD_V_GUARD,
	createSimState,
	eventDefault,
	weaponAt,
	weaponsAt,
	type SimEvents,
	type SimState,
	type WeaponSlotState,
} from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { NEAR_MISS_VIEW, NO_COMBO_EVENTS, type NearMissFrame, type ParryCue, type ParryFlash } from "../fx";
import { FxEventBuffer } from "../fx/events";
import { semitonesToSpeed } from "../hud";
import {
	ALL_SFX,
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	COMBO_KILL_PRIORITY,
	DUCKING_SFX,
	JINGLE_SFX,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_PRIORITY,
	TEAMMATE_PRIORITY_DROP,
	type Playable,
} from ".";

type Cue = [string, number, number];

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

const NO_FX = new FxEventBuffer(1);

function solo(): SimState {
	return createSimState(1, 0, 0, { scoring: {} });
}

function duo(): SimState {
	return createSimState(1, 0, 0, { party: { size: 2 }, scoring: { partySize: 2 } });
}

function slotOf(s: SimState, player: number, weaponId: string): WeaponSlotState {
	for (const set of weaponsAt(s, player).sets) if (weaponAt(set.weapon).id === weaponId) return set;
	error(`no ${weaponId} in player ${player}'s loadout`, 0);
}

/** A mapper that has seen `s` once (the watch's baseline frame, no cues). */
function primed(s: SimState, me = 0, playable?: Playable): AudioCueMapper {
	const m = new AudioCueMapper(playable);
	m.frame(0, noEvents(), NO_FX, s, me, new AudioCueList());
	return m;
}

/** One mapper frame with a near-miss frame: [id, volume, speed] triples. */
function run(
	m: AudioCueMapper,
	now: number,
	s: SimState,
	nearMiss: Readonly<NearMissFrame> | undefined,
	e: SimEvents = noEvents(),
	me = 0,
): Cue[] {
	const out = m.frame(now, e, NO_FX, s, me, new AudioCueList(), undefined, NO_COMBO_EVENTS, nearMiss);
	const list: Cue[] = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
	return list;
}

function flash(player: number, grew: boolean): ParryFlash {
	return {
		player,
		count: 1,
		isNew: false,
		grew,
		ageSec: 0.1,
		scale: 1,
		pop: 1,
		fade: 1,
		showCount: false,
		x: 0,
		z: 0,
	};
}

/** A near-miss frame: an optional graze cue (semitones), parry cues, flashes. */
function nearMiss(grazeSemitones?: number, parryCues: ParryCue[] = [], flashes: ParryFlash[] = []): NearMissFrame {
	return {
		grazeSparks: [],
		parryBursts: [],
		grazeCue:
			grazeSemitones === undefined
				? undefined
				: { semitones: grazeSemitones, speed: semitonesToSpeed(grazeSemitones) },
		parryCues,
		flashes,
		freezeMs: 0,
	};
}

/** The parry cue of a guard's first frame (its flash grew too, as the director puts out). */
function parried(player: number, isLocal: boolean, speed = 1): NearMissFrame {
	return nearMiss(undefined, [{ player, local: isLocal, speed }], [flash(player, true)]);
}

const EMPTY = nearMiss();

describe("audio: grazes (docs/GRAZE_PARRY.md GP6)", () => {
	it("a graze cue plays sfx.player.graze at exactly its speed and NEAR_MISS_VIEW.graze.volume", () => {
		const s = solo();
		const m = primed(s);
		expect(run(m, 1, s, nearMiss(0))).toEqual([[SFX.playerGraze, NEAR_MISS_VIEW.graze.volume, 1]]);
		expect(run(m, 2, s, nearMiss(4))).toEqual([
			[SFX.playerGraze, NEAR_MISS_VIEW.graze.volume, semitonesToSpeed(4)],
		]);
		expect(semitonesToSpeed(4) > 1).toBe(true);
	});

	it("only when the frame has a cue (no cue, an empty frame or no frame: nothing)", () => {
		const s = solo();
		const m = primed(s);
		expect(run(m, 1, s, EMPTY)).toEqual([]);
		expect(run(m, 2, s, undefined)).toEqual([]);
		// a teammate's grazes never reach grazeCue (the director's view-player rule): nothing to play
		expect(run(m, 3, s, nearMiss(undefined, [], []))).toEqual([]);
	});

	it("respects its minimum interval (NEAR_MISS_VIEW.graze.minIntervalSec, a pack override wins)", () => {
		const gap = NEAR_MISS_VIEW.graze.minIntervalSec;
		const s = solo();
		const m = primed(s);
		expect(m.intervalOf(SFX.playerGraze)).toBe(gap);
		expect(run(m, 1, s, nearMiss(1)).size()).toBe(1);
		expect(run(m, 1 + gap / 2, s, nearMiss(2))).toEqual([]);
		expect(run(m, 1 + gap * 2, s, nearMiss(3))).toEqual([
			[SFX.playerGraze, NEAR_MISS_VIEW.graze.volume, semitonesToSpeed(3)],
		]);
		m.setMinInterval(SFX.playerGraze, 1);
		expect(run(m, 2, s, nearMiss(0))).toEqual([]);
	});

	it("ranks under the telegraph and the hurt, over enemy shots, on a capped frame", () => {
		const g = SFX_PRIORITY[SFX.playerGraze];
		expect(g < SFX_PRIORITY[SFX.enemyTelegraph]).toBe(true);
		expect(g < SFX_PRIORITY[SFX.playerHurt]).toBe(true);
		expect(g > SFX_PRIORITY[SFX.enemyShoot]).toBe(true);
		expect(g < COMBO_KILL_PRIORITY).toBe(true);

		// 7 candidates for 6 slots: the enemy shot goes, the graze stays
		const s = solo();
		const m = primed(s);
		s.combat.enemySpawned = 0;
		m.frame(0.5, noEvents(), NO_FX, s, 0, new AudioCueList());
		const e = noEvents();
		e.playerHits = 1;
		e.telegraphs = 1;
		e.emberUsed = 1;
		e.rollStarted = 1;
		e.flaskUsed = 1;
		s.combat.enemySpawned = 12;
		const out = run(m, 1, s, nearMiss(2), e).map(([id]) => id);
		expect(out.size()).toBe(AUDIO_VIEW.maxStartsPerFrame);
		expect(out).toContain(SFX.playerGraze);
		expect(out).never.toContain(SFX.enemyShoot);

		// 6 candidates above it: the graze goes, never the hurt or the telegraph
		const busy = noEvents();
		busy.playerHits = 1;
		busy.telegraphs = 1;
		busy.emberUsed = 1;
		busy.rollStarted = 1;
		busy.flaskUsed = 1;
		busy.meleeSwings = 1;
		const s2 = solo();
		const full = run(primed(s2), 1, s2, nearMiss(2), busy).map(([id]) => id);
		expect(full.size()).toBe(AUDIO_VIEW.maxStartsPerFrame);
		for (const id of [SFX.playerHurt, SFX.enemyTelegraph]) expect(full).toContain(id);
		expect(full).never.toContain(SFX.playerGraze);
	});

	it("a silent graze (the placeholder pack) plays nothing, falls back to nothing and takes no cooldown", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		expect(pack.sound(SFX.playerGraze).assetId).toBe(undefined);
		expect(SFX_FALLBACK[SFX.playerGraze]).toBe(undefined);
		const silent = new Set<string>([SFX.playerGraze]);
		const s = solo();
		const m = primed(s, 0, (id) => !silent.has(id));
		expect(run(m, 1, s, nearMiss(3))).toEqual([]);
		silent.clear();
		expect(run(m, 1.01, s, nearMiss(3)).size()).toBe(1);
	});
});

describe("audio: parries (docs/GRAZE_PARRY.md GP6)", () => {
	it("a parry replaces the frame's deflect, at the cue's exact speed", () => {
		const s = solo();
		const m = primed(s);
		const e = noEvents();
		e.bulletsDeleted = 1;
		expect(run(m, 1, s, parried(0, true), e)).toEqual([[SFX.playerParry, 1, 1]]);
		const big = semitonesToSpeed(NEAR_MISS_VIEW.parry.bigSemitones);
		e.bulletsDeleted = 5;
		expect(run(m, 2, s, parried(0, true, big), e)).toEqual([[SFX.playerParry, 1, big]]);
	});

	it("a later erase of the same guard (its flash grew, no new cue) plays neither the deflect nor the parry", () => {
		const s = solo();
		const m = primed(s);
		const e = noEvents();
		e.bulletsDeleted = 1;
		expect(run(m, 1, s, nearMiss(undefined, [], [flash(0, true)]), e)).toEqual([]);
		// a flash that did not grow (the guard erased nothing this frame): the deletes were a swing's
		expect(run(m, 2, s, nearMiss(undefined, [], [flash(0, false)]), e)).toEqual([[SFX.playerDeflect, 1, 0]]);
	});

	it("a swing delete with no parry still plays the deflect (with or without a near-miss frame)", () => {
		const s = solo();
		const m = primed(s);
		const e = noEvents();
		e.bulletsDeleted = 2;
		expect(run(m, 1, s, EMPTY, e)).toEqual([[SFX.playerDeflect, 1, 0]]);
		expect(run(m, 2, s, undefined, e)).toEqual([[SFX.playerDeflect, 1, 0]]);
	});

	it("a silent parry falls back to the deflect: the guard sounds exactly as before", () => {
		expect(SFX_FALLBACK[SFX.playerParry]).toBe(SFX.playerDeflect);
		const noParry: Playable = (id) => id !== SFX.playerParry;
		const e = noEvents();
		e.bulletsDeleted = 3;
		const s = solo();
		const today = run(primed(s, 0, noParry), 1, s, undefined, e);
		expect(today).toEqual([[SFX.playerDeflect, 1, 0]]);
		const big = semitonesToSpeed(NEAR_MISS_VIEW.parry.bigSemitones);
		expect(run(primed(s, 0, noParry), 1, s, parried(0, true, big), e)).toEqual(today);
		expect(new AudioCueMapper(noParry).resolve(SFX.playerParry)).toBe(SFX.playerDeflect);
		// co-op too: today's attribution guess (no local guard: the teammate's quiet deflect)
		const p = duo();
		const coopToday = run(primed(p, 0, noParry), 1, p, undefined, e);
		expect(coopToday).toEqual([[SFX.playerDeflect, AUDIO_VIEW.teammateVolume, 0]]);
		expect(run(primed(p, 0, noParry), 1, p, parried(1, false), e)).toEqual(coopToday);
	});

	it("a teammate's parry is quieter and ranked lower; it replaces only the teammate's deflect", () => {
		const p = duo();
		const m = primed(p, 0);
		const e = noEvents();
		e.bulletsDeleted = 2;
		// no local guard: the deletes are the teammate's; their parry plays at teammate volume, no deflect
		expect(run(m, 1, p, parried(1, false), e)).toEqual([[SFX.playerParry, AUDIO_VIEW.teammateVolume, 1]]);
		// the local guard is up but only the teammate parried: the local deflect stays
		slotOf(p, 0, SWORD.id).v[SWORD_V_GUARD] = 10;
		expect(run(m, 2, p, parried(1, false), e)).toEqual([
			[SFX.playerDeflect, 1, 0],
			[SFX.playerParry, AUDIO_VIEW.teammateVolume, 1],
		]);
		// the local guard parried: its parry at full volume, no deflect
		expect(run(m, 3, p, parried(0, true), e)).toEqual([[SFX.playerParry, 1, 1]]);
		// as player 1 (or spectating them), the same guard is the local one
		const m1 = primed(p, 1);
		expect(run(m1, 1, p, parried(1, true), noEvents(), 1)).toEqual([[SFX.playerParry, 1, 1]]);
		expect(TEAMMATE_PRIORITY_DROP > 0).toBe(true);
	});

	it("at most one parry cue per frame: the local guard's wins over a teammate's (then the bigger guard)", () => {
		const big = semitonesToSpeed(NEAR_MISS_VIEW.parry.bigSemitones);
		const p = createSimState(1, 0, 0, { party: { size: 3 }, scoring: { partySize: 3 } });
		const m = primed(p, 0);
		const both = nearMiss(
			undefined,
			[
				{ player: 0, local: true, speed: 1 },
				{ player: 1, local: false, speed: big },
			],
			[flash(0, true), flash(1, true)],
		);
		expect(run(m, 1, p, both)).toEqual([[SFX.playerParry, 1, 1]]);
		const teammates = nearMiss(
			undefined,
			[
				{ player: 1, local: false, speed: 1 },
				{ player: 2, local: false, speed: big },
			],
			[flash(1, true), flash(2, true)],
		);
		expect(run(m, 2, p, teammates)).toEqual([[SFX.playerParry, AUDIO_VIEW.teammateVolume, big]]);
	});

	it("ranks over the kill ladder and the deflect, under the hurt and the telegraph", () => {
		const r = SFX_PRIORITY[SFX.playerParry];
		expect(r > COMBO_KILL_PRIORITY).toBe(true);
		expect(r > SFX_PRIORITY[SFX.playerDeflect]).toBe(true);
		expect(r < SFX_PRIORITY[SFX.enemyTelegraph]).toBe(true);
		expect(r < SFX_PRIORITY[SFX.playerHurt]).toBe(true);
	});
});

describe("audio: graze and parry IDs", () => {
	it("are the theme's port audio events, in ALL_SFX and PORT_SFX, neither a jingle nor ducking", () => {
		expect([SFX.playerGraze, SFX.playerParry]).toEqual(["sfx.player.graze", "sfx.player.parry"]);
		for (const id of [SFX.playerGraze, SFX.playerParry]) {
			expect([
				id,
				ALL_SFX.includes(id),
				PORT_SFX.includes(id),
				JINGLE_SFX.includes(id),
				DUCKING_SFX.includes(id),
			]).toEqual([id, true, true, false, false]);
		}
	});

	it("an undefined near-miss frame changes nothing (the same cues as a frame without the argument)", () => {
		const e = noEvents();
		e.bulletsDeleted = 1;
		e.meleeSwings = 1;
		e.playerHits = 1;
		const a = solo();
		const b = solo();
		const withArg = run(primed(a), 1, a, undefined, e);
		const out = primed(b).frame(1, e, NO_FX, b, 0, new AudioCueList());
		const without: Cue[] = [];
		for (let i = 0; i < out.size(); i++) without.push([out.id(i), out.volume(i), out.speed(i)]);
		expect(withArg).toEqual(without);
		expect(withArg.map(([id]) => id)).toEqual([SFX.playerHurt, SFX.playerSwing, SFX.playerDeflect]);
	});
});
