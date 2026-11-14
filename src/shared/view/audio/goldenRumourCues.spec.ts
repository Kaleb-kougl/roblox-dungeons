// The Goldling's rumours in the cue mapper (docs/GOLDLING_RUMOURS.md GR6): the two IDs (the theme's port audio events,
// in ALL_SFX / PORT_SFX), plain sfx (no duck, not a jingle), ranked 45 / 66, each falling back to sfx.score.tick while
// silent at the rumour's own volume with the pack's jitter (no hit ladder); the floor cue at floorVolume; the room cue
// at roomVolume inside the Goldling's room and at the teammate volume (and lower rank) from outside it; nothing without
// an edge; and the clock's edges reaching the mapper over a real Goldling floor.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import { buildDevRunConfig, buildEndlessRunConfig } from "shared/run";
import {
	ALL_EVENT_FIELDS,
	EMPTY_INPUT,
	createSimState,
	eventDefault,
	step,
	type SimConfig,
	type SimEvents,
	type SimState,
} from "shared/sim";
import {
	CODEX_AUDIO_IDS,
	GOLDEN_RUMOUR_AUDIO_IDS,
	SILVER_AUDIO_IDS,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	SECRET_AUDIO_IDS,
} from "shared/theme";
import { NO_BOOST_EVENTS } from "shared/view/boosts";
import { FxEventBuffer, NO_BUILD_FX_EVENTS, NO_COMBO_EVENTS, NO_VARIANT_CUES } from "shared/view/fx";
import {
	GOLDEN_VIEW,
	GoldenRumourClock,
	NO_GOLDEN_EVENTS,
	NO_GOLDEN_RUMOUR_CUES,
	goldenRumourInRoom,
	type GoldenRumourCueSource,
} from "shared/view/golden";
import { NO_DAILY_RANK_CUES, NO_NEW_BEST_CUES } from "shared/view/hud";
import { NO_PACT_EVENTS } from "shared/view/pacts";
import { NO_PELLET_EVENTS } from "shared/view/pellets";
import { NO_TREASURE_CUES } from "shared/view/treasure";
import {
	ALL_SFX,
	AUDIO_VIEW,
	AudioCueList,
	AudioCueMapper,
	DUCKING_SFX,
	JINGLE_SFX,
	NO_SYNC_CUES,
	PORT_SFX,
	SFX,
	SFX_FALLBACK,
	SFX_MIN_INTERVAL,
	SFX_PRIORITY,
	TEAMMATE_PRIORITY_DROP,
	type Playable,
} from ".";

const R = GOLDEN_VIEW.rumour;
const RUMOURS = [SFX.goldenRumourFloor, SFX.goldenRumourRoom];

function noEvents(): SimEvents {
	const e = {} as SimEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

const NO_FX = new FxEventBuffer(4);

/** One mapper frame with the rumour edges `rumour`: [id, volume, speed] per cue. */
function frame(
	m: AudioCueMapper,
	now: number,
	s: SimState,
	rumour: GoldenRumourCueSource,
	me = 0,
): Array<[string, number, number]> {
	const out = m.frame(
		now,
		noEvents(),
		NO_FX,
		s,
		me,
		new AudioCueList(),
		NO_BOOST_EVENTS,
		NO_COMBO_EVENTS,
		undefined,
		NO_VARIANT_CUES,
		NO_NEW_BEST_CUES,
		NO_BUILD_FX_EVENTS,
		NO_DAILY_RANK_CUES,
		NO_PELLET_EVENTS,
		NO_SYNC_CUES,
		NO_TREASURE_CUES,
		NO_PACT_EVENTS,
		NO_GOLDEN_EVENTS,
		rumour,
	);
	const list: Array<[string, number, number]> = [];
	for (let i = 0; i < out.size(); i++) list.push([out.id(i), out.volume(i), out.speed(i)]);
	return list;
}

const FLOOR_CUE: GoldenRumourCueSource = { floorCue: true, roomCue: false };
const ROOM_CUE: GoldenRumourCueSource = { floorCue: false, roomCue: true };

/** The first (run seed, floor) from floor 2 whose floor rolled a Goldling. */
function findGoldenFloor(): [number, number] {
	for (let seed = 1; seed <= 60; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let floor = 2; floor <= 4; floor++)
			if (setup.endlessFloor(floor).golden !== undefined) return [seed, floor];
	}
	error("no Goldling floor in run seeds 1-60, floors 2-4", 0);
}

const [SEED, FLOOR] = findGoldenFloor();

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
}

function devRun(): Run {
	const dev = buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true });
	return { config: dev.config, s: createSimState(SEED, dev.spawn!.x, dev.spawn!.z, dev.config) };
}

/** Player 0 onto a floor cell near the middle of the Goldling room (no tick). */
function intoRoom(s: SimState): void {
	const f = s.golden!.floor!;
	let lx = math.floor(f.w / 2);
	const ly = math.floor(f.h / 2);
	while (f.walk[ly * f.w + lx] !== 1) lx = (lx + 1) % f.w;
	const p = s.player;
	p.x = gridToWorld(f.x0 + lx);
	p.z = gridToWorld(f.y0 + ly);
	p.prevX = p.x;
	p.prevZ = p.z;
}

describe("audio: the Goldling's rumours (docs/GOLDLING_RUMOURS.md GR6)", () => {
	it("the IDs: the theme's two rumours, last in PORT_AUDIO_EVENTS before the Codex's, in ALL_SFX and PORT_SFX, required", () => {
		expect([...RUMOURS]).toEqual(["sfx.golden.rumour.floor", "sfx.golden.rumour.room"]);
		expect([...RUMOURS]).toEqual([...GOLDEN_RUMOUR_AUDIO_IDS]);
		// claude/codex-plan.md CX5's sound comes after them (codex.spec.ts), then docs/SECRET_ROOMS.md SR10's three and
		// docs/SILVER.md SV7's four
		const n = PORT_AUDIO_EVENTS.size() - CODEX_AUDIO_IDS.size() - SECRET_AUDIO_IDS.size() - SILVER_AUDIO_IDS.size();
		expect([PORT_AUDIO_EVENTS[n - 2], PORT_AUDIO_EVENTS[n - 1]]).toEqual([...RUMOURS]);
		for (const id of RUMOURS) {
			expect([id, ALL_SFX.includes(id), PORT_SFX.includes(id), REQUIRED_ASSET_IDS.includes(id)]).toEqual([
				id,
				true,
				true,
				true,
			]);
		}
	});

	it("ranked 45 / 66; plain sfx: not a jingle, no music duck, no interval of their own", () => {
		expect([SFX_PRIORITY[SFX.goldenRumourFloor], SFX_PRIORITY[SFX.goldenRumourRoom]]).toEqual([45, 66]);
		for (const id of RUMOURS) {
			expect([id, JINGLE_SFX.includes(id), DUCKING_SFX.includes(id)]).toEqual([id, false, false]);
			expect([id, (SFX_MIN_INTERVAL as Readonly<Record<string, number>>)[id]]).toEqual([id, undefined]);
		}
		// under the Goldling's appearance and the floor enter, over the breakables' hit and the enemy shot
		expect(SFX_PRIORITY[SFX.goldenRumourRoom] < SFX_PRIORITY[SFX.goldenAppear]).toBe(true);
		expect(SFX_PRIORITY[SFX.goldenRumourFloor] < SFX_PRIORITY[SFX.goldenRumourRoom]).toBe(true);
	});

	it("the floor cue at floorVolume, the pack's jitter; nothing without an edge", () => {
		const s = createSimState(1, 0, 0);
		expect(frame(new AudioCueMapper(), 0, s, FLOOR_CUE)).toEqual([[SFX.goldenRumourFloor, R.floorVolume, 0]]);
		expect(frame(new AudioCueMapper(), 0, s, NO_GOLDEN_RUMOUR_CUES)).toEqual([]);
		// the mapper's default: no rumour
		const out = new AudioCueMapper().frame(0, noEvents(), NO_FX, s, 0, new AudioCueList());
		expect(out.size()).toBe(0);
	});

	it("the room cue: roomVolume inside the Goldling's room, the teammate volume (and lower rank) outside", () => {
		const r = devRun();
		// outside (at the spawn): a teammate engaged it
		expect(goldenRumourInRoom(r.s, 0)).toBe(false);
		expect(frame(new AudioCueMapper(), 0, r.s, ROOM_CUE)).toEqual([
			[SFX.goldenRumourRoom, R.roomVolume * AUDIO_VIEW.teammateVolume, 0],
		]);
		intoRoom(r.s);
		expect(goldenRumourInRoom(r.s, 0)).toBe(true);
		expect(frame(new AudioCueMapper(), 0, r.s, ROOM_CUE)).toEqual([[SFX.goldenRumourRoom, R.roomVolume, 0]]);
		expect(TEAMMATE_PRIORITY_DROP > 0).toBe(true);
	});

	it("silent: each plays sfx.score.tick at the rumour's volume with the pack's jitter; with the tick silent, nothing", () => {
		const s = createSimState(1, 0, 0);
		for (const id of RUMOURS) expect([id, SFX_FALLBACK[id]]).toEqual([id, SFX.scoreTick]);
		const noRumours: Playable = (id) => !(RUMOURS as ReadonlyArray<string>).includes(id);
		expect(frame(new AudioCueMapper(noRumours), 0, s, FLOOR_CUE)).toEqual([[SFX.scoreTick, R.floorVolume, 0]]);
		const r = devRun();
		intoRoom(r.s);
		expect(frame(new AudioCueMapper(noRumours), 0, r.s, ROOM_CUE)).toEqual([[SFX.scoreTick, R.roomVolume, 0]]);
		const noCoins: Playable = (id) => noRumours(id) && id !== SFX.scoreTick;
		expect(frame(new AudioCueMapper(noCoins), 0, s, FLOOR_CUE)).toEqual([]);
		expect(frame(new AudioCueMapper(noCoins), 0, r.s, ROOM_CUE)).toEqual([]);
	});

	it("the clock's edges over a real Goldling floor: the floor cue once after floorDelaySec, the room cue on entry", () => {
		const r = devRun();
		const m = new AudioCueMapper();
		const c = new GoldenRumourClock();
		const dt = 0.25;
		const heard: Array<[number, string]> = [];
		let now = 0;
		for (let k = 0; k < 12; k++) {
			c.step(r.s, dt);
			for (const [id] of frame(m, now, r.s, c)) heard.push([k, id]);
			now += dt;
		}
		const floorAt = R.floorDelaySec / dt - 1;
		expect(heard).toEqual([[floorAt, SFX.goldenRumourFloor]]);
		intoRoom(r.s);
		step(r.s, EMPTY_INPUT, r.config); // the room engages
		c.step(r.s, dt);
		expect(frame(m, now, r.s, c)).toEqual([[SFX.goldenRumourRoom, R.roomVolume, 0]]);
		c.step(r.s, dt);
		expect(frame(m, now + dt, r.s, c)).toEqual([]);
	});
});
