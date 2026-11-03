// Pellets on screen against the REAL sim (docs/PELLETS.md PL7): the view was written before the sim's pellet behaviour
// and tested against hand-built events; this drives endless runs with pellets (a dev world in god mode through LiveRun,
// a two-player party through LockstepClient: the run views' own collection paths) and feeds every frame to the view's
// consumers as the client does: the pellet tracker (PelletRenderController), the merged pellet pops
// (ScorePopController), the audio cue mapper (AudioController), the sprite-effect cue mapper (FxSpriteController), the
// room clear sequence and the score roller (RoomClearController). Each frame is checked against the sim's own score
// deltas and pellet state.
//
// Test-only surgery (presentation specs; nothing here is recorded or validated): teleports onto pellets and into rooms,
// kills through SimCtx (scored as kills), enemy bullets fired straight into the pool (still, far from the player), and
// hearts topped up in the party run.
import { describe, expect, it } from "@rbxts/jest-globals";
import { NO_POWER_PELLET } from "shared/dungeon";
import { DEFAULT_LOCKSTEP, LockstepClient, MergedEncoder } from "shared/lockstep";
import { buildDevRunConfig, buildEndlessRunConfig } from "shared/run";
import { frame } from "shared/run/testing";
import { defaultJuiceSettings } from "shared/settings";
import {
	BulletKind,
	Button,
	EMPTY_INPUT,
	NO_KIND,
	PelletPhase,
	PLAYER_SPEED,
	SIM_DT,
	SIM_HZ,
	ScoreSource,
	SimCtx,
	fireBurstRaw,
	packPayload,
	partySize,
	playerAt,
	simWorldConfig,
	swordGuard,
	weaponsAt,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { AudioCueList, AudioCueMapper, SFX } from "shared/view/audio";
import { NO_BOOST_EVENTS } from "shared/view/boosts";
import {
	FX_SPRITE_VIEW,
	FxCueMapper,
	FxEventBuffer,
	NO_BUILD_FX_EVENTS,
	NO_COMBO_EVENTS,
	NO_VARIANT_CUES,
	ROOM_CLEAR,
	RoomClearSequence,
	ScoreRoller,
	roomClearBonus,
	roomClearSegments,
	type RoomClear,
} from "shared/view/fx";
import { NO_DAILY_RANK_CUES, NO_NEW_BEST_CUES } from "shared/view/hud";
import {
	PELLETS_VIEW,
	PelletViewTracker,
	deflectedBullets,
	livePowerPellet,
	mergePelletPops,
	newPelletLook,
	pelletPowerErased,
	type PelletPop,
} from "shared/view/pellets";
import { LiveRun, type RunView } from ".";

const SETTINGS = { ...defaultJuiceSettings(), particles: "high" as const };
const NO_FX = new FxEventBuffer(4);
/** A pellet popped in fully this long after its room went live (the wave plus one pop). */
const POPPED_SEC = PELLETS_VIEW.popIn.waveSec + PELLETS_VIEW.popIn.popSec;
/** Frames run after the last clear so every celebration finishes and releases its bonus. */
const SETTLE_SEC = ROOM_CLEAR.totalSec + 1;
const BONUS_SOURCES = [ScoreSource.ROOMS, ScoreSource.PERFECT, ScoreSource.FAST, ScoreSource.SWEEP];

function cueIds(list: AudioCueList): string[] {
	const out: string[] = [];
	for (let i = 0; i < list.size(); i++) out.push(list.id(i));
	return out;
}

function count<T>(list: ReadonlyArray<T>, item: T): number {
	let n = 0;
	for (const x of list) if (x === item) n++;
	return n;
}

function shields(m: FxCueMapper): number {
	let n = 0;
	for (let i = 0; i < m.cues.count(); i++) if (m.cues.at(i).id === "fx.guard.shield") n++;
	return n;
}

/** What one frame left for the scenario's own checks. */
interface FrameReport {
	readonly eaten: number;
	readonly powerTaken: number;
	readonly powerErased: number;
	readonly audio: string[];
	readonly controlAudio: string[];
	readonly shields: number;
	readonly controlShields: number;
	readonly pops: PelletPop[];
	readonly clears: RoomClear[];
	readonly guardDelta: number;
	readonly deleted: number;
}

/**
 * Feeds a run view's frames to the view's consumers (as the client's controllers do) and checks every frame against the
 * sim. A control audio mapper and fx mapper see the same frames WITHOUT the pellet events (as before the fix), so a
 * scenario can show the check is not vacuous.
 */
class Viewer {
	readonly tracker = new PelletViewTracker();
	readonly audio = new AudioCueMapper();
	readonly controlAudio = new AudioCueMapper();
	readonly fx = new FxCueMapper(() => 1);
	readonly controlFx = new FxCueMapper(() => 1);
	readonly seq = new RoomClearSequence();
	readonly roller = new ScoreRoller();
	private readonly look = newPelletLook();
	private readonly pops: PelletPop[] = [];
	/** Pellet indices taken (this floor), and the per-record pellet points earned since the record went live. */
	readonly taken = new Set<number>();
	readonly recPellets = new Map<number, number>();
	/** Per record: the score points per source before the frame its pellets went live. */
	private readonly atLive = new Map<number, number[]>();
	private readonly totalAtLive = new Map<number, number>();
	private lastChomp = -math.huge;
	/** Bonus points started (sum of roomClearBonus) and released (sum of bonusLanded). */
	started = 0;
	landed = 0;
	readonly clears: RoomClear[] = [];
	frames = 0;

	constructor(readonly run: RunView, readonly localIndex = 0) {
		this.roller.reset(run.state.score!.total);
	}

	/** One frame: `advance` runs the run view's frame (it resets and collects the frame's events). */
	frame(advance: () => void): FrameReport {
		const run = this.run;
		const s = run.state;
		const sc = s.score!;
		const before = [...sc.points];
		const guardsBefore = sc.counts[ScoreSource.GUARD];
		const totalBefore = sc.total;
		advance();
		this.frames++;
		const pellets = run.pellets;
		const now = s.tick / SIM_HZ;
		const dt = SIM_DT;

		// --- the sim's pellet points match the events exactly (eaten points + the power pellet's bullets) ------------
		let eatenPoints = 0;
		for (const e of pellets.eaten) {
			eatenPoints += e.points;
			expect(this.taken.has(e.index)).toBe(false); // each pellet taken once
			this.taken.add(e.index);
			expect(s.pellets!.taken[e.index]).toBe(1);
			expect(e.index).never.toBe(s.pellets!.power); // the power pellet is never an eaten pellet
			const rec = s.pellets!.rec[e.index];
			this.recPellets.set(rec, (this.recPellets.get(rec) ?? 0) + e.points);
		}
		let powerPoints = 0;
		for (const p of pellets.power) {
			powerPoints += p.points;
			const at = s.pellets!.power;
			expect(at).never.toBe(NO_POWER_PELLET);
			expect(s.pellets!.taken[at]).toBe(1);
			expect([p.px, p.pz]).toEqual([s.pellets!.x[at], s.pellets!.z[at]]);
			const rec = s.pellets!.rec[at];
			this.recPellets.set(rec, (this.recPellets.get(rec) ?? 0) + p.points);
		}
		const pelletDelta = sc.points[ScoreSource.PELLETS] - before[ScoreSource.PELLETS];
		expect(pelletDelta).toBe(eatenPoints + powerPoints);

		// --- pops: one per player per frame, every pickup in exactly one, every point once -----------------------------
		mergePelletPops(pellets.eaten, this.pops, pellets.power);
		const players = new Set<number>();
		let popCount = 0;
		let popPoints = 0;
		for (const p of this.pops) {
			expect(players.has(p.player)).toBe(false);
			players.add(p.player);
			let mine = 0;
			for (const e of pellets.eaten) if (e.player === p.player) mine++;
			expect(p.count).toBe(mine);
			popCount += p.count;
			popPoints += p.points;
		}
		expect(popCount).toBe(pellets.eaten.size());
		expect(popPoints).toBe(pelletDelta);

		// --- audio: one chomp per frame at most (one whenever its interval allows), the power sound, no false deflect --
		const list = new AudioCueList();
		const fe = run.frameEvents;
		this.audio.frame(
			now,
			fe,
			NO_FX,
			s,
			this.localIndex,
			list,
			NO_BOOST_EVENTS,
			NO_COMBO_EVENTS,
			undefined,
			NO_VARIANT_CUES,
			NO_NEW_BEST_CUES,
			NO_BUILD_FX_EVENTS,
			NO_DAILY_RANK_CUES,
			pellets,
		);
		const ids = cueIds(list);
		const control = new AudioCueList();
		this.controlAudio.frame(now, fe, NO_FX, s, this.localIndex, control);
		const chomps = count(ids, SFX.pelletEat);
		expect(chomps <= 1).toBe(true);
		if (pellets.eaten.size() > 0 && now - this.lastChomp >= PELLETS_VIEW.audio.eatMinIntervalSec)
			expect(chomps).toBe(1);
		if (pellets.eaten.size() === 0) expect(chomps).toBe(0);
		if (chomps > 0) this.lastChomp = now;
		expect(count(ids, SFX.pelletPower)).toBe(pellets.power.size() > 0 ? 1 : 0);
		const deflected = deflectedBullets(fe.bulletsDeleted, pellets);
		if (deflected === 0) expect(count(ids, SFX.playerDeflect)).toBe(0);
		expect(count(ids, SFX.pelletSweep)).toBe(pellets.swept.size() > 0 ? 1 : 0);

		// --- sprite effects: the guard shield, with and without the pellet events ----------------------------------------
		this.fx.frame({ now, state: s, alpha: 1, events: fe, pellets, fx: NO_FX, settings: SETTINGS });
		this.controlFx.frame({ now, state: s, alpha: 1, events: fe, fx: NO_FX, settings: SETTINGS });

		// --- the tracker: dormant hidden, live shown once popped in, taken hidden, gone hidden after the shrink ----------
		this.tracker.sync(s, pellets);
		for (const e of pellets.live) {
			const r = sc.rooms[e.rec];
			expect(e.tick).toBe(r.engageTick + 1); // the engagement tick (engageTick is the tick before its step)
			this.atLive.set(e.rec, before);
			this.totalAtLive.set(e.rec, totalBefore);
			if (!this.recPellets.has(e.rec)) this.recPellets.set(e.rec, 0);
		}
		const p = s.pellets!;
		for (let i = 0; i < p.x.size(); i++) {
			const rec = p.rec[i];
			const look = this.tracker.look(s, i, now, 1, this.look);
			if (rec < 0) {
				expect(look.shown).toBe(false);
				continue;
			}
			const phase = p.rooms[rec].phase;
			if (p.taken[i] !== 0 || phase === PelletPhase.DORMANT) expect(look.shown).toBe(false);
			else if (phase === PelletPhase.LIVE) {
				const at = this.tracker.liveTime(rec);
				if (at === PelletViewTracker.NOT_SEEN || now - at >= POPPED_SEC) expect(look.shown).toBe(true);
			} else {
				const at = this.tracker.goneTime(rec);
				expect(at).never.toBe(PelletViewTracker.NOT_SEEN);
				if (now - at >= PELLETS_VIEW.shrinkSec) expect(look.shown).toBe(false);
			}
		}

		// --- room clears: the pellet and Sweep numbers, the tally, the bonus held and released once ----------------------
		const clears = run.roomClears;
		this.seq.beginFrame();
		if (clears.engaged > 0) this.seq.collapse();
		let sweepSum = 0;
		for (const c of clears.clears) {
			this.clears.push(c);
			expect(c.rooms).toBe(1); // the scenarios clear one room at a time
			const rec = sc.rooms.findIndex((r) => r.room === c.room);
			expect(p.rooms[rec].phase).toBe(PelletPhase.GONE);
			expect(this.tracker.goneTime(rec)).toBe(c.tick / SIM_HZ);
			sweepSum += c.sweepPoints;
			expect(c.sweepPoints > 0).toBe(p.rooms[rec].swept === 1);
			// pelletPoints: what the room's own pellets (and its power pellet) paid since it went live.
			expect(c.pelletPoints).toBe(this.recPellets.get(rec) ?? 0);
			// killPoints: every other point since the engagement, never the pellets or a bonus.
			const pre = this.atLive.get(rec)!;
			const preTotal = this.totalAtLive.get(rec)!;
			let bonusDelta = 0;
			for (const src of BONUS_SOURCES) bonusDelta += (sc.points[src] ?? 0) - (before[src] ?? 0);
			const pelletsSince = sc.points[ScoreSource.PELLETS] - pre[ScoreSource.PELLETS];
			expect(c.killPoints).toBe(sc.total - preTotal - pelletsSince - bonusDelta);
			expect(roomClearBonus(c)).toBe(bonusDelta);
			// The tally: the Sweep is in the flying bonus exactly once, the pellets are a segment of their own.
			const segments = roomClearSegments(c);
			let flying = 0;
			let sweeps = 0;
			for (const seg of segments) {
				if (seg.kind === "sweep") sweeps++;
				if (seg.kind === "pellets") expect(seg.value).toBe(c.pelletPoints);
				if (seg.kind !== "kills" && seg.kind !== "pellets") flying += seg.value;
			}
			expect(sweeps).toBe(c.sweepPoints > 0 ? 1 : 0);
			expect(flying).toBe(roomClearBonus(c));
			this.seq.start(c, "full", 1);
			expect(this.seq.look.flyPoints).toBe(roomClearBonus(c));
			this.started += roomClearBonus(c);
		}
		expect(sweepSum).toBe(sc.points[ScoreSource.SWEEP] - before[ScoreSource.SWEEP]);
		const look = this.seq.frame(dt);
		this.landed += look.bonusLanded;
		expect(look.held).toBe(this.started - this.landed);
		const shown = this.roller.frame(dt, sc.total, look.held, look.bonusLanded > 0);
		// Never runs ahead: the shown score never includes a bonus (the Sweep included) before it lands.
		expect(shown <= sc.total - (this.started - this.landed)).toBe(true);

		const guardDelta = sc.counts[ScoreSource.GUARD] - guardsBefore;
		return {
			eaten: pellets.eaten.size(),
			powerTaken: pellets.power.size(),
			powerErased: pelletPowerErased(pellets),
			audio: ids,
			controlAudio: cueIds(control),
			shields: shields(this.fx),
			controlShields: shields(this.controlFx),
			pops: [...this.pops],
			clears: [...clears.clears],
			guardDelta,
			deleted: fe.bulletsDeleted,
		};
	}
}

function place(s: SimState, x: number, z: number, i = 0): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
}

/** Every living member of score record k, killed through SimCtx (scored as kills). Returns how many. */
function killRoom(s: SimState, config: Readonly<SimConfig>, k: number): number {
	const rec = s.score!.rooms[k];
	const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
	let n = 0;
	for (let m = 0; m < rec.memberSlots.size(); m++) {
		const a: ActorState | undefined = s.combat.actors[rec.memberSlots[m]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) {
			ctx.killActor(a);
			n++;
		}
	}
	return n;
}

/** Regular pellet indices of record k (the power pellet left out). */
function regular(s: SimState, k: number): number[] {
	const p = s.pellets!;
	const r = p.rooms[k];
	const out: number[] = [];
	for (let i = r.first; i < r.first + r.span; i++) if (i !== p.power) out.push(i);
	return out;
}

/** A still enemy bullet at (x, z) (life long enough for the scenario). */
function stillBullet(s: SimState, x: number, z: number): void {
	const spawned = fireBurstRaw(
		s.combat.enemyBullets,
		1,
		x,
		z,
		1,
		0,
		1,
		0,
		0.001,
		600,
		packPayload(1, BulletKind.ENEMY, 0),
	);
	expect(spawned).toBe(1);
}

/** A run seed and floor whose floor has a power pellet in a room with at least 4 other pellets. */
function powerFloor(): [number, number] {
	for (let seed = 1; seed <= 80; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let f = 2; f <= 4; f++) {
			const pellets = setup.endlessFloor(f).pellets!;
			if (pellets.power === NO_POWER_PELLET) continue;
			let mates = 0;
			for (let i = 0; i < pellets.room.size(); i++)
				if (i !== pellets.power && pellets.room[i] === pellets.room[pellets.power]) mates++;
			if (mates >= 4) return [seed, f];
		}
	}
	error("no run seed in 1-80 has a power pellet on floors 2-4 with 4 room mates", 0);
}

describe("pellets on screen against the real sim (solo LiveRun, dev world in god mode)", () => {
	const [seed, floor] = powerFloor();
	const dev = buildDevRunConfig(seed, { startFloor: floor, invulnerable: true });
	const config = dev.config;
	const run = new LiveRun({ seed, spawnX: dev.spawn!.x, spawnZ: dev.spawn!.z, config, atBossDoor: false });
	const s = run.state;
	const v = new Viewer(run);
	const p = s.pellets!;
	const powerRec = p.rec[p.power];
	/** Frames of 1, 2 and 3 ticks in turn (a rendered frame runs several ticks; at most one pickup each here). */
	let turn = 0;
	const step = (input: InputFrame = EMPTY_INPUT, ticks?: number): FrameReport => {
		const k = ticks ?? 1 + (turn++ % 3);
		return v.frame(() => {
			run.frame(k * SIM_DT, input);
		});
	};
	/** Single-tick frames until record k's pellets go live (at most `max`). */
	const engage = (k: number, at: number, max = 30): void => {
		place(s, p.x[at], p.z[at]);
		for (let n = 0; n < max && p.rooms[k].phase === PelletPhase.DORMANT; n++) step(EMPTY_INPUT, 1);
	};

	// The sweep room: the first record with 6+ regular pellets that is not the power pellet's.
	let sweepRec = -1;
	for (let k = 0; k < p.rooms.size(); k++) {
		if (k !== powerRec && p.rooms[k].count >= 6 && p.rooms[k].phase === PelletPhase.DORMANT) {
			sweepRec = k;
			break;
		}
	}
	const sweepList = sweepRec >= 0 ? regular(s, sweepRec) : [];
	print(`[pellets view] seed ${seed} floor ${floor}: sweep record ${sweepRec}, power record ${powerRec}`);

	// A few idle frames at the spawn first: the room clear tracker takes its baseline on the run's first tick, so a
	// room engaged ON that tick would have no known engagement total (only a teleport can do that).
	for (let n = 0; n < 5; n++) step(EMPTY_INPUT, 1);

	// --- Room 1: engage, every pellet taken (one per frame), the room killed: a Sweep -----------------------------------
	const dormantHidden = sweepList.size() > 0 && !v.tracker.look(s, sweepList[0], 0, 1, newPelletLook()).shown;
	if (sweepRec >= 0) engage(sweepRec, sweepList[0]);
	const liveAfterEngage = sweepRec >= 0 && p.rooms[sweepRec].phase === PelletPhase.LIVE;
	let eatenFrames = 0;
	let eatenTotal = 0;
	for (const i of sweepList) {
		place(s, p.x[i], p.z[i]);
		const r = step();
		if (r.eaten > 0) eatenFrames++;
		eatenTotal += r.eaten;
		step(EMPTY_INPUT, 2); // a frame with no pickup in between
	}
	const leftBeforeKill = sweepRec >= 0 ? p.rooms[sweepRec].left : -1;
	let sweepClear: RoomClear | undefined;
	for (let n = 0; n < 20 && sweepClear === undefined; n++) {
		killRoom(s, config, sweepRec);
		const r = step(EMPTY_INPUT, 1);
		if (r.clears.size() > 0) sweepClear = r.clears[0];
	}
	// Shrink and celebration frames.
	for (let n = 0; n < SETTLE_SEC * SIM_HZ; n++) step(EMPTY_INPUT, 1);

	it("the sweep room engaged (dormant pellets hidden before), went live, and every pellet was eaten one per frame", () => {
		expect(sweepRec >= 0).toBe(true);
		expect(dormantHidden).toBe(true);
		expect(liveAfterEngage).toBe(true);
		expect(eatenTotal).toBe(sweepList.size());
		expect(eatenFrames).toBe(sweepList.size());
		expect(leftBeforeKill).toBe(0);
		expect(p.rooms[sweepRec].phase).toBe(PelletPhase.GONE);
		expect(p.rooms[sweepRec].swept).toBe(1);
	});

	it("its clear carries the Sweep (the SWEEP delta), the room's pellet points, kill points without either", () => {
		expect(sweepClear).never.toBe(undefined);
		const c = sweepClear!;
		expect(c.sweepPoints > 0).toBe(true);
		expect(c.pelletPoints > 0).toBe(true);
		expect(c.killPoints > 0).toBe(true);
		// (the exact equalities are checked on the frame by the Viewer)
	});

	it("every bonus started was released exactly once and the shown score caught up", () => {
		expect(v.started > 0).toBe(true);
		expect(v.landed).toBe(v.started);
		expect(v.seq.look.held).toBe(0);
		expect(v.roller.shown).toBe(s.score!.total);
		// After the shrink every pellet of the cleared room is hidden.
		const look = newPelletLook();
		for (const i of sweepList) expect(v.tracker.look(s, i, s.tick / SIM_HZ, 1, look).shown).toBe(false);
	});

	// --- Room 2: the power pellet with the guard up and bullets on screen ------------------------------------------------
	const at = p.power;
	const mates = regular(s, powerRec);
	engage(powerRec, mates[0]);
	const powerLive = p.rooms[powerRec].phase === PelletPhase.LIVE;
	// Wait out the pop-in so the power pellet is surely drawn, then check the sighting rule.
	for (let n = 0; n < POPPED_SEC * SIM_HZ + 1; n++) step(EMPTY_INPUT, 1);
	const sightedBefore = livePowerPellet(s) === at;
	const shownBefore = v.tracker.look(s, at, s.tick / SIM_HZ, 1, newPelletLook()).shown;
	// Raise the guard (ALT), then wait past guardMinSec with it still up.
	const sword = weaponsAt(s, 0);
	const raise = step(frame(0, 0, Button.ALT), 1);
	const guardUp = swordGuard(sword.sets[sword.activeSet]) > 0;
	const waitTicks = math.ceil(FX_SPRITE_VIEW.guardMinSec * SIM_HZ) + 1;
	for (let n = 0; n < waitTicks; n++) step(EMPTY_INPUT, 1);
	const guardStillUp = swordGuard(sword.sets[sword.activeSet]) > 0;
	// Bullets on screen: still, on other pellets of the room (floor cells), out of the guard's reach.
	let placed = 0;
	for (const i of mates) {
		const dx = p.x[i] - p.x[at];
		const dz = p.z[i] - p.z[at];
		if (dx * dx + dz * dz >= 9 && placed < 4) {
			stillBullet(s, p.x[i], p.z[i]);
			placed++;
		}
	}
	place(s, p.x[at], p.z[at]);
	const power = step(EMPTY_INPUT, 1);
	const powerEvent = run.pellets.power[0];
	const takenAfter = p.taken[at];
	const sightedAfter = livePowerPellet(s);
	const shownAfter = v.tracker.look(s, at, s.tick / SIM_HZ, 1, newPelletLook()).shown;
	print(
		`[pellets view] power: ${placed} bullets placed, ${power.powerErased} erased, deleted ${power.deleted}, ` +
			`guard ${guardUp}/${guardStillUp}, audio [${power.audio.join(", ")}], control [${power.controlAudio.join(
				", ",
			)}], shields ${power.shields} (control ${power.controlShields}), raise shields ${raise.shields}`,
	);

	it("the power pellet: live, drawn and sighted before; taken in one power event, no eaten pellet; hidden after", () => {
		expect(powerLive).toBe(true);
		expect(shownBefore).toBe(true);
		expect(sightedBefore).toBe(true);
		expect(power.powerTaken).toBe(1);
		expect(power.eaten).toBe(0);
		expect(takenAfter).toBe(1);
		expect(sightedAfter).toBe(-1);
		expect(shownAfter).toBe(false);
	});

	it("the erased count matches: every deleted bullet of the frame was the power pellet's (at least those placed)", () => {
		expect(placed > 0).toBe(true);
		expect(power.powerErased >= placed).toBe(true);
		expect(power.powerErased).toBe(powerEvent.x.size());
		expect(power.deleted).toBe(power.powerErased);
		expect(power.guardDelta).toBe(0);
		expect(power.pops.size()).toBe(1);
		expect(power.pops[0].points).toBe(powerEvent.points);
		expect(powerEvent.points > 0).toBe(true);
	});

	it("no deflect cue and no guard shield for it (the control mappers without the pellet events would)", () => {
		expect(guardUp).toBe(true);
		expect(guardStillUp).toBe(true);
		expect(raise.shields).toBe(1); // the raise itself
		expect(count(power.audio, SFX.pelletPower)).toBe(1);
		expect(count(power.audio, SFX.playerDeflect)).toBe(0);
		expect(power.shields).toBe(0);
		// Not vacuous: the same frame read the old way (every deleted bullet a deflect) plays and flashes both.
		expect(count(power.controlAudio, SFX.playerDeflect)).toBe(1);
		expect(power.controlShields).toBe(1);
	});

	// Finish the power room for its clear (pellet points include the power pellet's bullets).
	let powerClear: RoomClear | undefined;
	for (let n = 0; n < 20 && powerClear === undefined; n++) {
		killRoom(s, config, powerRec);
		const r = step(EMPTY_INPUT, 1);
		if (r.clears.size() > 0) powerClear = r.clears[0];
	}
	for (let n = 0; n < SETTLE_SEC * SIM_HZ; n++) step(EMPTY_INPUT, 1);

	it("the power room's clear: no Sweep (pellets left), its pellet points include the power pellet's, bonus once", () => {
		expect(powerClear).never.toBe(undefined);
		expect(powerClear!.sweepPoints).toBe(0);
		// The power pellet's bullets plus the pellet the engaging teleport stood on (and any other taken there).
		expect(powerClear!.pelletPoints).toBe(v.recPellets.get(powerRec));
		expect(powerClear!.pelletPoints > powerEvent.points).toBe(true);
		expect(v.landed).toBe(v.started);
		expect(v.roller.shown).toBe(s.score!.total);
		print(`[pellets view] solo: ${v.frames} frames checked, ${v.clears.size()} clears`);
	});
});

describe("pellets on screen against the real sim (two-player party, LockstepClient)", () => {
	const seed = 4242;
	const setup = buildEndlessRunConfig(seed, 2);
	// A pump steps every queued tick (up to 60): a long frame, as a client catching up, crossing several pellets.
	const c = new LockstepClient({
		runId: "pellets-view",
		seed,
		spawn: setup.spawn!,
		config: setup.config,
		players: 2,
		localIndex: 0,
		tunables: { ...DEFAULT_LOCKSTEP, maxCatchup: 60 },
	});
	const s = c.state;
	const enc = new MergedEncoder(2);
	const v = new Viewer(c, 0);
	const p = s.pellets!;
	let fed = 0;
	/** One frame of `ticks` ticks with player 0's input `input` (player 1 idle), hearts topped up first. */
	const pump = (ticks: number, input: InputFrame = EMPTY_INPUT): FrameReport => {
		for (let i = 0; i < partySize(s); i++) {
			const pl = playerAt(s, i);
			if (pl.dead === 0) pl.hearts = pl.heartsMax;
		}
		const frames: InputFrame[][] = [];
		for (let t = 0; t < ticks; t++) frames.push([input, EMPTY_INPUT]);
		expect(c.receive(fed, enc.encode(frames))).toBe(true);
		fed += ticks;
		return v.frame(() => {
			const r = c.pump(ticks * SIM_DT, () => EMPTY_INPUT);
			expect(r.stepped).toBe(ticks);
		});
	};

	// A record with 8+ regular pellets and no power pellet, and in it a pair of pellets 2-3 apart on an open line.
	let rec = -1;
	let a = -1;
	let b = -1;
	const move = simWorldConfig(s, setup.config).moveResolver!;
	const open = (x: number, z: number, tx: number, tz: number): boolean => {
		const n = 20;
		let px = x;
		let pz = z;
		for (let k = 0; k < n; k++) {
			const at = move(px, pz, (tx - x) / n, (tz - z) / n);
			px = at.x;
			pz = at.z;
		}
		return math.abs(px - tx) < 1e-6 && math.abs(pz - tz) < 1e-6;
	};
	for (let k = 0; k < p.rooms.size() && rec < 0; k++) {
		const r = p.rooms[k];
		if (r.count < 8 || (p.power !== NO_POWER_PELLET && p.rec[p.power] === k)) continue;
		const list = regular(s, k);
		for (let i = 2; i < list.size() && rec < 0; i++) {
			for (let j = i + 1; j < list.size(); j++) {
				const dx = p.x[list[j]] - p.x[list[i]];
				const dz = p.z[list[j]] - p.z[list[i]];
				const d = math.sqrt(dx * dx + dz * dz);
				if (d >= 1.5 && d <= 3 && open(p.x[list[i]], p.z[list[i]], p.x[list[j]], p.z[list[j]])) {
					rec = k;
					a = list[i];
					b = list[j];
					break;
				}
			}
		}
	}
	const list = rec >= 0 ? regular(s, rec) : [];
	for (let n = 0; n < 5; n++) pump(1); // idle first (the room clear baseline, as in the solo run)
	// Engage: player 0 on the record's first pellet, single-tick frames until live.
	if (rec >= 0) {
		place(s, p.x[list[0]], p.z[list[0]]);
		for (let n = 0; n < 30 && p.rooms[rec].phase === PelletPhase.DORMANT; n++) pump(1);
	}
	const live = rec >= 0 && p.rooms[rec].phase === PelletPhase.LIVE;
	// Both players on a pellet each, one tick: two pickups on one frame, one pop each, one chomp.
	if (live) {
		place(s, p.x[list[0]], p.z[list[0]], 0);
		place(s, p.x[list[1]], p.z[list[1]], 1);
	}
	const both = live ? pump(1) : undefined;
	for (let n = 0; n < 6; n++) pump(1);
	// Player 0 walks from pellet a to pellet b in ONE long frame: two pickups merge into one pop.
	let walk: FrameReport | undefined;
	if (live) {
		place(s, p.x[a], p.z[a], 0);
		const dx = p.x[b] - p.x[a];
		const dz = p.z[b] - p.z[a];
		const d = math.sqrt(dx * dx + dz * dz);
		const ticks = math.ceil(d / (PLAYER_SPEED * SIM_DT)) + 4;
		walk = pump(ticks, frame(dx / d, dz / d));
	}
	print(
		`[pellets view] party: record ${rec}, pellets ${list.size()}, pair ${a} -> ${b}; both ${both?.eaten} eaten ` +
			`(${both?.pops.size()} pops, [${both?.audio.join(", ")}]); walk ${walk?.eaten} eaten (${walk?.pops
				.map((x) => `${x.player}:${x.count}/${x.points}`)
				.join(" ")})`,
	);

	it("the record went live for both views of the party", () => {
		expect(rec >= 0).toBe(true);
		expect(live).toBe(true);
	});

	it("two players taking a pellet on the same tick: two pops (one each), one chomp at full volume", () => {
		expect(both!.eaten).toBe(2);
		expect(both!.pops.map((x) => [x.player, x.count])).toEqual([
			[0, 1],
			[1, 1],
		]);
		expect(count(both!.audio, SFX.pelletEat)).toBe(1);
	});

	it("one player crossing two pellets in one frame: one merged pop with both, one chomp", () => {
		expect(walk!.eaten >= 2).toBe(true);
		expect(walk!.pops.size()).toBe(1);
		expect(walk!.pops[0].player).toBe(0);
		expect(walk!.pops[0].count).toBe(walk!.eaten);
		expect(count(walk!.audio, SFX.pelletEat) <= 1).toBe(true);
		expect(p.taken[a]).toBe(1);
		expect(p.taken[b]).toBe(1);
	});
});
