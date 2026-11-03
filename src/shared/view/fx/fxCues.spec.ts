// Sprite-effect cues (docs/FX_AUDIO.md F3) over the recorded seed-1337 endless descent (shared/run/testing
// recordEndlessRun: a relic and a curse on the way, the boss of floor 5 fought with the sword and killed (since the
// seeded boss pick, docs/BOSS_DEMONLORD.md D5, run 1337's floor 5 holds the Demon Lord), floor 6 walked to its
// stairwell): one cue per event where it should be, the budget and the hit-mark rate limit hold, nothing lands on a
// telegraph's first frame, the slam effect only on a charge's impact (his brimstone charge here), the stairwell loop
// follows the open stairwell, the same state-derived cues at 1-5 ticks per frame; plus synthetic frames for the budget
// levels, reduced motion, swings and the guard, splinters, resets, a pack without effect art, and the impact cue of
// each boss (Mother Bramble's slam, the Demon Lord's charge) on a boss spawned into a fresh state.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { accumulateEvents, newFrameEvents, resetFrameEvents, type FrameEvents } from "shared/play";
import type { EndlessRunSetup } from "shared/run";
import { recordEndlessRun, type RecordedEndlessRun } from "shared/run/testing";
import {
	AiState,
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BULLET_Y,
	BossAttack,
	BossState,
	DEFAULT_SIM_CONFIG,
	DEMONLORD_V_AUX_X,
	DEMONLORD_V_AUX_Z,
	DEMONLORD_V_MARK,
	DemonlordAttack,
	DemonlordState,
	EMPTY_INPUT,
	NO_KIND,
	SimCtx,
	SIM_DT,
	SWORD,
	SWORD_V_GUARD,
	SWORD_V_LAST,
	V_AUX_X,
	V_AUX_Z,
	V_MARK,
	archetypeIndex,
	createSimState,
	stepRecorded,
	weaponIndex,
	weaponsAt,
	type SimState,
} from "shared/sim";
import { defaultJuiceSettings, type JuiceSettings } from "shared/settings";
import { FX_IDS, type FxId } from "shared/theme";
import { BULLET_VIEW, MARKING_VIEW } from "../config";
import { DECOR_VIEW, decorInputOfLayout, decorScene, planDecor, type DecorScene } from "../decor";
import { PelletFrameEvents } from "../pellets";
import { FX_SPRITE_VIEW } from "./config";
import type { FxEvent } from "./events";
import { BOSS_IMPACTS, FxCueMapper, fxLabelRotationDeg, type FxCueEventSource } from "./fxCues";
import { HitTracker } from "./tracker";

const SEED = 1337;
/** Every effect lasts this long in these specs (seconds of the effect clock). */
const LIFE = 0.5;
const everyArt = (): number => LIFE;

let recorded: RecordedEndlessRun | undefined;
function run(): RecordedEndlessRun {
	if (recorded === undefined) recorded = recordEndlessRun(SEED);
	return recorded;
}

function sceneCache(setup: EndlessRunSetup): (state: Readonly<SimState>) => DecorScene {
	const scenes = new Map<number, DecorScene>();
	return (state) => {
		const floor = state.endless!.floor;
		let s = scenes.get(floor);
		if (s === undefined) {
			const layout = setup.endlessFloor(floor).layout;
			const input = decorInputOfLayout(layout, state.endless!.depth);
			s = decorScene(input, planDecor(input), layout.bossFloor);
			scenes.set(floor, s);
		}
		return s;
	};
}

interface CueRecord {
	readonly id: FxId;
	readonly tick: number;
	readonly x: number;
	readonly z: number;
	readonly rotationDeg: number;
	readonly floor: number;
}

interface ReplayResult {
	readonly cues: CueRecord[];
	readonly counts: Map<FxId, number>;
	maxLive: number;
	maxPerFrame: number;
	/** Cues landing within telegraphClearTiles of an actor whose telegraph started that frame (must stay 0). */
	onTelegraph: number;
	/**
	 * fx.boss.slam cues not on a charge impact (must stay 0), and the impacts seen by the spec itself: Mother Bramble's
	 * slam and the Demon Lord's charge.
	 */
	slamOff: number;
	slamImpacts: number;
	chargeImpacts: number;
	/** Frames the stairwell loop was active with the stairwell closed, or inactive with it open. */
	loopWrong: number;
	loopFrames: number;
	/**
	 * Frames whose ticks both drank a flask and changed floor: the new floor drops every cue of the old one, by design,
	 * so that flask's cue is never shown.
	 */
	flaskFloorDrops: number;
	readonly mapper: FxCueMapper;
}

function replay(
	r: RecordedEndlessRun,
	ticksPerFrame: (frameNo: number) => number,
	settings: Readonly<JuiceSettings> = { ...defaultJuiceSettings(), particles: "high" },
): ReplayResult {
	const setup = r.setup;
	const state = createSimState(r.seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	const sceneOf = sceneCache(setup);
	const tracker = new HitTracker();
	const mapper = new FxCueMapper(everyArt);
	const events: FrameEvents = newFrameEvents();
	const bramble = archetypeIndex(BOSS_ACT1_ID);
	const demon = archetypeIndex(BOSS_DEMONLORD_ID);
	const prevAi: number[] = [];
	const prevMark: number[] = [];
	const res: ReplayResult = {
		cues: [],
		counts: new Map(),
		maxLive: 0,
		maxPerFrame: 0,
		onTelegraph: 0,
		slamOff: 0,
		slamImpacts: 0,
		chargeImpacts: 0,
		loopWrong: 0,
		loopFrames: 0,
		flaskFloorDrops: 0,
		mapper,
	};
	const total = r.recording.frames.size();
	let t = 0;
	let frameNo = 0;
	let now = 0;
	while (t < total) {
		const k = math.max(1, ticksPerFrame(frameNo));
		resetFrameEvents(events);
		const floorBefore = state.endless!.floor;
		const flaskBefore = state.player.flask;
		let ran = 0;
		while (ran < k && t < total) {
			stepRecorded(state, r.recording, t, setup.config);
			accumulateEvents(events, state.events);
			t++;
			ran++;
		}
		now += ran * SIM_DT;
		if (state.endless!.floor !== floorBefore && state.player.flask < flaskBefore) res.flaskFloorDrops++;
		tracker.update(state, 1, setup.config.encounter);
		const scene = sceneOf(state);
		const n = mapper.frame({ now, state, alpha: 1, events, fx: tracker.events, settings, spots: scene });
		// independent checks
		const starts: Array<[number, number, number]> = [];
		let impactThisFrame = false;
		state.combat.actors.forEach((a, i) => {
			const alive = a.alive !== 0 && a.kind >= 0;
			if (alive && a.aiState === AiState.TELEGRAPH && prevAi[i] !== AiState.TELEGRAPH) {
				starts.push([a.x, a.z, a.radius + FX_SPRITE_VIEW.telegraphClearTiles]);
			}
			const slam = alive && a.kind === bramble && a.attack === BossAttack.SLAM;
			const charge = alive && a.kind === demon && a.attack === DemonlordAttack.CHARGE;
			const mark = slam ? a.v[V_MARK] : charge ? a.v[DEMONLORD_V_MARK] : 0;
			const active = slam ? a.aiState === BossState.ACTIVE : a.aiState === DemonlordState.ACTIVE;
			if (mark > 0 && (prevMark[i] ?? 0) === 0 && active) {
				impactThisFrame = true;
				if (slam) res.slamImpacts++;
				else res.chargeImpacts++;
			}
			prevAi[i] = alive ? a.aiState : AiState.IDLE;
			prevMark[i] = mark;
		});
		for (let i = 0; i < n; i++) {
			const c = mapper.cues.at(i);
			res.cues.push({
				id: c.id,
				tick: state.tick,
				x: c.x,
				z: c.z,
				rotationDeg: c.rotationDeg,
				floor: state.endless!.floor,
			});
			res.counts.set(c.id, (res.counts.get(c.id) ?? 0) + 1);
			for (const [x, z, rad] of starts) {
				if ((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) <= rad * rad) res.onTelegraph++;
			}
			if (c.id === "fx.boss.slam" && !impactThisFrame) res.slamOff++;
		}
		res.maxPerFrame = math.max(res.maxPerFrame, n);
		res.maxLive = math.max(res.maxLive, mapper.liveCount());
		const open = state.endless!.stairsOpen === 1 && scene.stairwell !== undefined;
		if (mapper.loop.active !== open) res.loopWrong++;
		if (mapper.loop.active) res.loopFrames++;
		frameNo++;
	}
	return res;
}

let oneTick: ReplayResult | undefined;
function census(): ReplayResult {
	if (oneTick === undefined) oneTick = replay(run(), () => 1);
	return oneTick;
}

describe("FxCueMapper over the recorded endless run", () => {
	it("cues the run's events", () => {
		const c = census();
		const count = (id: FxId) => c.counts.get(id) ?? 0;
		print(
			`fx cues: ${FX_IDS.map((id) => `${id}=${count(id)}`).join(" ")}; slam impacts ${c.slamImpacts}, charge ` +
				`impacts ${c.chargeImpacts}`,
		);
		// one kill: three staggered explosions
		expect(count("fx.boss.death")).toBe(FX_SPRITE_VIEW.bossDeathBursts.size());
		// the relic and the curse of the relic floor
		expect(run().relicFloor).never.toBe(0);
		expect(count("fx.relic.take")).toBe(1);
		expect(count("fx.shrine.use")).toBe(1);
		// rolls, sword swings, hits and kills on the way
		expect(count("fx.roll.dust")).toBeGreaterThan(0);
		expect(count("fx.swing.1")).toBeGreaterThan(0);
		expect(count("fx.hit.light") + count("fx.hit.heavy")).toBeGreaterThan(0);
		expect(count("fx.death.puff")).toBeGreaterThan(0);
		// phases 2 and 3 (never the fight's start)
		expect(count("fx.boss.phase")).toBeGreaterThan(0);
		expect(count("fx.boss.phase")).toBeLessThan(3);
	});

	it("puts the relic and shrine cues on their spots, on the relic floor", () => {
		const c = census();
		for (const cue of c.cues) {
			if (cue.id === "fx.relic.take" || cue.id === "fx.shrine.use") expect(cue.floor).toBe(run().relicFloor);
		}
	});

	it("holds the budget and never sits on a telegraph's first frame", () => {
		const c = census();
		expect(c.maxLive).toBeLessThanOrEqual(FX_SPRITE_VIEW.maxSprites.high);
		expect(c.maxPerFrame).toBeLessThanOrEqual(FX_SPRITE_VIEW.maxSprites.high);
		expect(c.onTelegraph).toBe(0);
	});

	it("shows the slam only on a charge's impact, never during its telegraph", () => {
		const c = census();
		expect(c.slamOff).toBe(0);
		// (the recorded bot ends floor 5's fight with debug presses: his phase-2 charge never lands in this run, so
		// the impact cue itself is checked on spawned bosses below)
		expect(c.counts.get("fx.boss.slam") ?? 0).toBe(c.slamImpacts + c.chargeImpacts);
	});

	it("loops the stairwell exactly while it is open", () => {
		const c = census();
		expect(c.loopWrong).toBe(0);
		expect(c.loopFrames).toBeGreaterThan(0);
	});

	it("rate-limits hit marks per actor", () => {
		const c = census();
		const last = new Map<string, number>();
		const minTicks = FX_SPRITE_VIEW.hitMarkMinSec / SIM_DT;
		let close = 0;
		for (const cue of c.cues) {
			if (cue.id !== "fx.hit.light" && cue.id !== "fx.hit.heavy") continue;
			// positions identify the actor well enough at one tick per frame: same spot within a tick's walk
			const key = `${math.floor(cue.x)}:${math.floor(cue.z)}`;
			const prev = last.get(key);
			if (prev !== undefined && cue.tick - prev < minTicks - 1e-9 && cue.tick !== prev) close++;
			last.set(key, cue.tick);
		}
		expect(close).toBe(0);
	});

	it("gives the same state-derived cues at 1-5 ticks per frame", () => {
		const paced = replay(run(), (n) => 1 + (n % 5));
		const one = census();
		// (not fx.shrine.use: the bot presses the shrine and debug-skips the floor within 5 ticks, and a frame that changes
		// floor drops every cue of the old floor, by design)
		let short = 0;
		for (const id of [
			"fx.boss.death",
			"fx.relic.take",
			"fx.boss.phase",
			"fx.boss.slam",
			"fx.flask",
			"fx.ember.ring",
		] as FxId[]) {
			const p = paced.counts.get(id) ?? 0;
			const o = one.counts.get(id) ?? 0;
			expect([id, p <= o]).toEqual([id, true]);
			short += o - p;
		}
		// A cue landing on a telegraph's first frame is dropped by design (FX_SPRITE_VIEW.telegraphClearTiles), and a
		// frame of several ticks can hold a telegraph start the 1-tick replay sees a tick apart: since the endless room
		// pool's new kinds (docs/ENEMY_VARIANTS.md EV5) the bot drinks its flask on floor 5 beside a swarmer whose lunge
		// telegraph starts inside the same paced frame. And a frame that drinks a flask and changes floor drops that
		// flask's cue with the old floor's (the recorded run has one since the room themes, docs/DECOR.md "Room
		// themes"). Every missing cue must be one of those drops.
		const telegraphDrops = math.max(0, paced.mapper.stats.telegraph - one.mapper.stats.telegraph);
		expect(short <= telegraphDrops + paced.flaskFloorDrops - one.flaskFloorDrops).toBe(true);
		expect(paced.onTelegraph).toBe(0);
		expect(paced.loopWrong).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------
// Synthetic frames

/** A hand-filled FX event list. */
class Events implements FxCueEventSource {
	readonly list: Array<Pick<FxEvent, "type" | "slot" | "actorId" | "x" | "z" | "heavy" | "boss" | "phase" | "tick">> =
		[];
	count(): number {
		return this.list.size();
	}
	at(i: number) {
		return this.list[i];
	}
	hit(slot: number, actorId: number, tick: number, heavy = false): void {
		this.list.push({ type: "hit", slot, actorId, x: slot, z: 0, heavy, boss: false, phase: 0, tick });
	}
}

const NO_EVENTS = { bulletsDeleted: 0 };

function juice(particles: JuiceSettings["particles"], reducedMotion = false): JuiceSettings {
	return { ...defaultJuiceSettings(), particles, reducedMotion };
}

/** A fresh solo state (no endless floor) and a mapper that adopted it. */
function fresh(durationOf: (id: FxId) => number | undefined = everyArt) {
	const state = createSimState(1, 0, 0);
	const mapper = new FxCueMapper(durationOf);
	mapper.frame({ now: 0, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings: juice("high") });
	return { state, mapper };
}

describe("FxCueMapper budget", () => {
	const levels: Array<[JuiceSettings, number]> = [
		[juice("off"), 0],
		[juice("low"), FX_SPRITE_VIEW.maxSprites.low],
		[juice("normal"), FX_SPRITE_VIEW.maxSprites.normal],
		[juice("high"), FX_SPRITE_VIEW.maxSprites.high],
		// reduced motion: one level lower
		[juice("high", true), FX_SPRITE_VIEW.maxSprites.normal],
		[juice("normal", true), FX_SPRITE_VIEW.maxSprites.low],
	];
	for (const [settings, want] of levels) {
		it(`caps live effects at ${want} for ${settings.particles}${
			settings.reducedMotion ? " + reduced motion" : ""
		}`, () => {
			const { state, mapper } = fresh();
			const ev = new Events();
			for (let i = 0; i < 100; i++) ev.hit(i, i + 1, 1);
			state.tick += 1;
			expect(mapper.frame({ now: 0.01, state, alpha: 1, events: NO_EVENTS, fx: ev, settings })).toBe(want);
			expect(mapper.liveCount()).toBe(want);
			// a frame later the budget is still full; once they expire it frees up
			const ev2 = new Events();
			for (let i = 0; i < 100; i++) ev2.hit(i, i + 1, 2);
			state.tick += 1;
			expect(mapper.frame({ now: 0.3, state, alpha: 1, events: NO_EVENTS, fx: ev2, settings })).toBe(0);
			state.tick += 1;
			const ev3 = new Events();
			for (let i = 0; i < 100; i++) ev3.hit(i, i + 1, 3);
			expect(mapper.frame({ now: 0.02 + LIFE, state, alpha: 1, events: NO_EVENTS, fx: ev3, settings })).toBe(
				want,
			);
		});
	}

	it("rate-limits one actor's hit marks to hitMarkMinSec", () => {
		const { state, mapper } = fresh();
		let shown = 0;
		const frames = 60;
		for (let f = 1; f <= frames; f++) {
			const ev = new Events();
			ev.hit(3, 9, f);
			state.tick += 1;
			shown += mapper.frame({
				now: f * SIM_DT,
				state,
				alpha: 1,
				events: NO_EVENTS,
				fx: ev,
				settings: juice("high"),
			});
		}
		const period = math.ceil(FX_SPRITE_VIEW.hitMarkMinSec / SIM_DT - 1e-9);
		expect(shown).toBe(math.floor((frames - 1) / period) + 1);
		expect(mapper.stats.rateLimited).toBe(frames - shown);
	});

	it("cues nothing a pack has no art for", () => {
		const { state, mapper } = fresh(() => undefined);
		const ev = new Events();
		ev.hit(0, 1, 1);
		state.tick += 1;
		state.player.embers -= 1;
		mapper.breakableSplinter(1, 2);
		expect(mapper.frame({ now: 0.1, state, alpha: 1, events: NO_EVENTS, fx: ev, settings: juice("high") })).toBe(0);
	});
});

describe("FxCueMapper sources (synthetic)", () => {
	const settings = juice("high");
	const sword = weaponIndex(SWORD.id);

	it("swings: the sword slot's last swing picks the trail, turned to the swing direction", () => {
		const { state, mapper } = fresh();
		const w = state.combat.weapons;
		expect(w.sets[0].weapon).toBe(sword);
		const seen: Array<[FxId, number]> = [];
		for (const last of [1, 2, 3]) {
			state.tick += 1;
			w.swingTick = state.tick - 1;
			w.swingX = 2;
			w.swingZ = 3;
			w.swingDirX = 1;
			w.swingDirZ = 0;
			w.swingRadius = 2;
			w.sets[0].v[SWORD_V_LAST] = last;
			expect(
				mapper.frame({ now: state.tick, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings }),
			).toBe(1);
			const c = mapper.cues.at(0);
			seen.push([c.id, c.rotationDeg]);
			expect(c.x).toBe(2 + 2 * FX_SPRITE_VIEW.swingAheadFraction);
			expect(c.z).toBe(3);
		}
		expect(seen.map(([id]) => id)).toEqual(["fx.swing.1", "fx.swing.2", "fx.swing.3"]);
		// the same direction, the same turn; a different direction turns it
		expect(seen[0][1]).toBe(seen[2][1]);
		state.tick += 1;
		w.swingTick = state.tick - 1;
		w.swingDirX = 0;
		w.swingDirZ = 1;
		mapper.frame({ now: state.tick, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		expect(mapper.cues.at(0).rotationDeg).never.toBe(seen[0][1]);
		// no new swing: nothing
		state.tick += 1;
		expect(mapper.frame({ now: state.tick, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(
			0,
		);
	});

	it("a swing toward the screen's bottom keeps the slash art as drawn (it faces swingArtHeadingDeg)", () => {
		const { state, mapper } = fresh();
		const w = state.combat.weapons;
		// screen down in sim ground terms at the game camera: (sin yaw, cos yaw)
		const yaw = math.rad(CAMERA_YAW_DEG);
		state.tick += 1;
		w.swingTick = state.tick - 1;
		w.swingDirX = math.sin(yaw);
		w.swingDirZ = math.cos(yaw);
		w.swingRadius = 1;
		mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		expect(FX_SPRITE_VIEW.swingArtHeadingDeg).toBe(270);
		const r = mapper.cues.at(0).rotationDeg;
		expect(math.min(r, 360 - r)).toBeLessThan(1e-6);
	});

	it("a screen-left swing turns the slash a quarter turn clockwise; the floor canvas adds its own turn", () => {
		const { state, mapper } = fresh();
		const w = state.combat.weapons;
		// screen left in sim ground terms at the game camera: minus the camera's right (cos yaw, -sin yaw)
		const yaw = math.rad(CAMERA_YAW_DEG);
		state.tick += 1;
		w.swingTick = state.tick - 1;
		w.swingDirX = -math.cos(yaw);
		w.swingDirZ = math.sin(yaw);
		w.swingRadius = 1;
		mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		const r = mapper.cues.at(0).rotationDeg;
		expect(r).toBeCloseTo(90, 6);
		expect(fxLabelRotationDeg(r, "billboard")).toBe(r);
		expect(fxLabelRotationDeg(r, "floor")).toBeCloseTo(90 + FX_SPRITE_VIEW.floorCanvasTurnDeg, 6);
	});

	it("fxLabelRotationDeg: floor adds the canvas turn, wrapped to [0, 360); billboard unchanged", () => {
		expect(FX_SPRITE_VIEW.floorCanvasTurnDeg).toBe(90);
		expect(fxLabelRotationDeg(0, "floor")).toBe(90);
		expect(fxLabelRotationDeg(300, "floor")).toBe(30);
		expect(fxLabelRotationDeg(270, "floor")).toBe(0);
		expect(fxLabelRotationDeg(300, "billboard")).toBe(300);
	});

	/**
	 * A boss spawned into a fresh state (no recording: any boss, whatever a seed's floors pick), its impact attack run
	 * by hand: nothing while it winds up (a splinter on its target is dropped that frame) or charges, one fx.boss.slam
	 * on the impact tick at the boss, nothing after.
	 */
	function impactCue(
		bossId: string,
		attack: number,
		active: number,
		markSlot: number,
		auxX: number,
		auxZ: number,
	): void {
		const state = createSimState(1, 0, 0);
		const ctx = new SimCtx().bind(state, DEFAULT_SIM_CONFIG, EMPTY_INPUT);
		const boss = ctx.spawnActor(bossId, 2, 3)!;
		expect(boss).never.toBe(undefined);
		const mapper = new FxCueMapper(everyArt);
		let tick = state.tick;
		const frameAt = (now: number) => {
			state.tick = ++tick;
			return mapper.frame({ now, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		};
		boss.aiState = AiState.IDLE;
		boss.attack = 0;
		frameAt(1);
		// the telegraph starts: its target is locked in v[AUX]; a splinter there is dropped this frame
		boss.aiState = AiState.TELEGRAPH;
		boss.attack = attack;
		boss.v[markSlot] = 0;
		boss.v[auxX] = boss.x + 6;
		boss.v[auxZ] = boss.z;
		mapper.breakableSplinter(boss.x + 6, boss.z);
		expect(frameAt(2)).toBe(0);
		expect(mapper.stats.telegraph).toBe(1);
		// the charge (ACTIVE, no impact yet): nothing
		boss.aiState = active;
		expect(frameAt(3)).toBe(0);
		// the impact
		boss.v[markSlot] = 7;
		expect(frameAt(4)).toBe(1);
		const c = mapper.cues.at(0);
		expect([c.id, c.x, c.z]).toEqual(["fx.boss.slam", boss.x, boss.z]);
		// after it: nothing more for this charge
		expect(frameAt(5)).toBe(0);
	}

	it("Mother Bramble's slam: nothing during its telegraph or charge, one cue on the impact at the boss", () => {
		impactCue(BOSS_ACT1_ID, BossAttack.SLAM, BossState.ACTIVE, V_MARK, V_AUX_X, V_AUX_Z);
	});

	it("the Demon Lord's charge: nothing during its telegraph or run, one cue on the impact at the boss", () => {
		impactCue(
			BOSS_DEMONLORD_ID,
			DemonlordAttack.CHARGE,
			DemonlordState.ACTIVE,
			DEMONLORD_V_MARK,
			DEMONLORD_V_AUX_X,
			DEMONLORD_V_AUX_Z,
		);
	});

	it("BOSS_IMPACTS names both bosses' charge attacks by the sim's own constants", () => {
		expect(BOSS_IMPACTS.map((r) => [r.bossId, r.attack, r.markSlot, r.targetXSlot, r.targetZSlot])).toEqual([
			[BOSS_ACT1_ID, BossAttack.SLAM, V_MARK, V_AUX_X, V_AUX_Z],
			[BOSS_DEMONLORD_ID, DemonlordAttack.CHARGE, DEMONLORD_V_MARK, DEMONLORD_V_AUX_X, DEMONLORD_V_AUX_Z],
		]);
	});

	it("a boss's other attacks cue nothing on their v[MARK] slot (the Demon Lord's hellfire)", () => {
		const state = createSimState(1, 0, 0);
		const ctx = new SimCtx().bind(state, DEFAULT_SIM_CONFIG, EMPTY_INPUT);
		const boss = ctx.spawnActor(BOSS_DEMONLORD_ID, 2, 3)!;
		const mapper = new FxCueMapper(everyArt);
		mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		state.tick += 1;
		boss.aiState = DemonlordState.ACTIVE;
		boss.attack = DemonlordAttack.HELLFIRE;
		boss.v[DEMONLORD_V_MARK] = 3;
		expect(mapper.frame({ now: 2, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(0);
	});

	it("guard: once when it goes up, again on a deflect (rate-limited), never while down", () => {
		const { state, mapper } = fresh();
		const slot = state.combat.weapons.sets[0];
		const step = (guard: number, deleted: number, now: number) => {
			state.tick += 1;
			slot.v[SWORD_V_GUARD] = guard;
			return mapper.frame({
				now,
				state,
				alpha: 1,
				events: { bulletsDeleted: deleted },
				fx: new Events(),
				settings,
			});
		};
		expect(step(10, 0, 1)).toBe(1);
		expect(mapper.cues.at(0).id).toBe("fx.guard.shield");
		expect(step(9, 0, 1.01)).toBe(0);
		expect(step(8, 3, 1.02)).toBe(0); // deflect inside guardMinSec of the raise
		expect(step(7, 3, 1 + 2 * FX_SPRITE_VIEW.guardMinSec)).toBe(1);
		expect(step(0, 3, 2)).toBe(0);
	});

	it("a power pellet's erases (docs/PELLETS.md PL4, in bulletsDeleted) never re-flash the shield", () => {
		const { state, mapper } = fresh();
		const slot = state.combat.weapons.sets[0];
		const pellets = new PelletFrameEvents();
		const step = (deleted: number, power: number, now: number) => {
			state.tick += 1;
			slot.v[SWORD_V_GUARD] = 10;
			pellets.reset();
			const x: number[] = [];
			for (let i = 0; i < power; i++) x.push(i);
			if (power > 0)
				pellets.power.push({ player: 0, px: 0, pz: 0, x, z: x, points: 5 * power, tick: state.tick });
			mapper.frame({
				now,
				state,
				alpha: 1,
				events: { bulletsDeleted: deleted },
				pellets,
				fx: new Events(),
				settings,
			});
			let n = 0;
			for (let i = 0; i < mapper.cues.count(); i++) if (mapper.cues.at(i).id === "fx.guard.shield") n++;
			return n;
		};
		const gap = 2 * FX_SPRITE_VIEW.guardMinSec;
		expect(step(0, 0, 1)).toBe(1); // the raise
		expect(step(3, 3, 1 + gap)).toBe(0); // every delete the power pellet's
		expect(step(4, 3, 1 + 2 * gap)).toBe(1); // one more: the guard's
	});

	it("co-op: a deflect re-flashes the shield only on the one player who could have made it", () => {
		const state = createSimState(1, 0, 0, { party: { size: 2 } });
		const mapper = new FxCueMapper(everyArt);
		mapper.frame({ now: 0, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		const guard0 = weaponsAt(state, 0).sets[0];
		const guard1 = weaponsAt(state, 1).sets[0];
		const shields = (now: number, deleted: number): number => {
			state.tick += 1;
			mapper.frame({ now, state, alpha: 1, events: { bulletsDeleted: deleted }, fx: new Events(), settings });
			let n = 0;
			for (let i = 0; i < mapper.cues.count(); i++) if (mapper.cues.at(i).id === "fx.guard.shield") n++;
			return n;
		};
		const gap = 2 * FX_SPRITE_VIEW.guardMinSec;
		// both raise their guards: one shield each
		guard0.v[SWORD_V_GUARD] = 10;
		guard1.v[SWORD_V_GUARD] = 10;
		expect(shields(1, 0)).toBe(2);
		// both up: the summed deletes could be either player's, so neither re-flashes
		expect(shields(1 + gap, 3)).toBe(0);
		// player 1's guard just dropped: it was up last frame, still ambiguous
		guard1.v[SWORD_V_GUARD] = 0;
		expect(shields(1 + 2 * gap, 3)).toBe(0);
		// now only player 0 could have deleted them
		expect(shields(1 + 3 * gap, 3)).toBe(1);
		// player 1 swings (swings delete bullets too): ambiguous again; the swing has its own effect
		weaponsAt(state, 1).swingTick = state.tick + 1;
		expect(shields(1 + 4 * gap, 3)).toBe(0);
		expect(mapper.cues.count()).toBe(1);
		expect(shields(1 + 5 * gap, 3)).toBe(1);
		// a teammate alone behind a guard gets the re-flash too (no one else could have)
		guard0.v[SWORD_V_GUARD] = 0;
		guard1.v[SWORD_V_GUARD] = 10;
		expect(shields(1 + 6 * gap, 0)).toBe(1); // the raise
		expect(shields(1 + 7 * gap, 3)).toBe(1);
	});

	it("flask, Ember and roll from the player's counters", () => {
		const { state, mapper } = fresh();
		const p = state.player;
		state.tick += 1;
		p.flask -= 1;
		p.embers -= 1;
		p.rollTicks = 10;
		mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		const ids: FxId[] = [];
		for (let i = 0; i < mapper.cues.count(); i++) ids.push(mapper.cues.at(i).id);
		expect(ids).toEqual(["fx.ember.ring", "fx.flask", "fx.roll.dust"]);
		// the roll counting down is not a new roll
		state.tick += 1;
		p.rollTicks = 9;
		expect(mapper.frame({ now: 1.1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(0);
	});

	it("splinters from the breakable renderer, on the next frame", () => {
		const { state, mapper } = fresh();
		mapper.breakableSplinter(4, 5);
		state.tick += 1;
		expect(mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(1);
		const c = mapper.cues.at(0);
		expect([c.id, c.x, c.z]).toEqual(["fx.breakable.splinter", 4, 5]);
		state.tick += 1;
		expect(mapper.frame({ now: 1.1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(0);
	});

	it("boost pickups from the boost drop renderer, on the next frame, at most boostCollectQueue (docs/BOOSTS.md B6)", () => {
		const { state, mapper } = fresh();
		mapper.boostCollect(2, 3);
		state.tick += 1;
		expect(mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(1);
		const c = mapper.cues.at(0);
		expect([c.id, c.x, c.z]).toEqual(["fx.boost.collect", 2, 3]);
		state.tick += 1;
		expect(mapper.frame({ now: 1.1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(0);
		for (let i = 0; i < FX_SPRITE_VIEW.boostCollectQueue + 3; i++) mapper.boostCollect(i * 3, 0);
		state.tick += 1;
		expect(mapper.frame({ now: 5, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings })).toBe(
			FX_SPRITE_VIEW.boostCollectQueue,
		);
	});

	it("staggers the boss death and drops what is pending on a reset", () => {
		const { state, mapper } = fresh();
		const ev = new Events();
		ev.list.push({
			type: "bossDefeated",
			slot: 0,
			actorId: 5,
			x: 1,
			z: 1,
			heavy: false,
			boss: true,
			phase: 0,
			tick: 1,
		});
		state.tick += 1;
		expect(mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: ev, settings })).toBe(1);
		state.tick += 1;
		const reset = new Events();
		reset.list.push({
			type: "reset",
			slot: -1,
			actorId: 0,
			x: 0,
			z: 0,
			heavy: false,
			boss: false,
			phase: 0,
			tick: 0,
		});
		mapper.frame({ now: 1.05, state, alpha: 1, events: NO_EVENTS, fx: reset, settings });
		expect(mapper.dropAll).toBe(true);
		expect(mapper.liveCount()).toBe(0);
		let later = 0;
		for (let f = 1; f <= 60; f++) {
			state.tick += 1;
			later += mapper.frame({
				now: 1.05 + f * SIM_DT,
				state,
				alpha: 1,
				events: NO_EVENTS,
				fx: new Events(),
				settings,
			});
		}
		expect(later).toBe(0);
		expect(mapper.dropAll).toBe(false);
	});

	it("a new state (restart) drops everything and adopts it silently", () => {
		const { state, mapper } = fresh();
		state.tick += 1;
		state.player.embers -= 1;
		mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		expect(mapper.liveCount()).toBe(1);
		const restarted = createSimState(2, 0, 0);
		restarted.player.embers -= 1;
		expect(
			mapper.frame({ now: 1.1, state: restarted, alpha: 1, events: NO_EVENTS, fx: new Events(), settings }),
		).toBe(0);
		expect(mapper.dropAll).toBe(true);
		expect(mapper.liveCount()).toBe(0);
	});

	it("drops cues on an actor on the frame its telegraph starts", () => {
		// a state with a live actor: the recorded run up to its first spawn
		const r = run();
		const state = createSimState(r.seed, r.setup.spawn!.x, r.setup.spawn!.z, r.setup.config);
		let t = 0;
		const live = () => state.combat.actors.findIndex((x) => x.kind !== NO_KIND && x.alive !== 0);
		while (live() < 0) stepRecorded(state, r.recording, t++, r.setup.config);
		const slot = live();
		const a = state.combat.actors[slot];
		const mapper = new FxCueMapper(everyArt);
		a.aiState = AiState.IDLE;
		mapper.frame({ now: 1, state, alpha: 1, events: NO_EVENTS, fx: new Events(), settings });
		a.aiState = AiState.TELEGRAPH;
		const ev = new Events();
		ev.list.push({
			type: "hit",
			slot,
			actorId: a.id,
			x: a.x,
			z: a.z,
			heavy: false,
			boss: false,
			phase: 0,
			tick: 2,
		});
		state.tick += 1;
		expect(mapper.frame({ now: 1.1, state, alpha: 1, events: NO_EVENTS, fx: ev, settings })).toBe(0);
		expect(mapper.stats.telegraph).toBe(1);
		// the next frame of the same telegraph: allowed
		const ev2 = new Events();
		ev2.list.push({
			type: "hit",
			slot,
			actorId: a.id,
			x: a.x,
			z: a.z,
			heavy: false,
			boss: false,
			phase: 0,
			tick: 3,
		});
		state.tick += 1;
		expect(mapper.frame({ now: 1.5, state, alpha: 1, events: NO_EVENTS, fx: ev2, settings })).toBe(1);
	});
});

describe("FX_SPRITE_VIEW placement", () => {
	it("floor effects sit above the decor flats and under every floor marking and bullet", () => {
		const V = FX_SPRITE_VIEW;
		const lowest = V.liftStuds - V.thicknessStuds;
		const highest = V.liftStuds + (V.layers - 1) * V.layerStepStuds;
		expect(lowest).toBeGreaterThan(DECOR_VIEW.flatLiftStuds);
		expect(highest).toBeLessThan(MARKING_VIEW.liftTiles * STUDS_PER_TILE);
		expect(highest).toBeLessThan((BULLET_Y - BULLET_VIEW.enemyDrawRadius) * STUDS_PER_TILE);
	});

	it("one frame can hold the largest budget", () => {
		for (const level of ["off", "low", "normal", "high"] as const) {
			expect(FX_SPRITE_VIEW.maxSprites[level]).toBeLessThanOrEqual(FX_SPRITE_VIEW.cueCapacity);
		}
	});
});
