/**
 * Test support for specs (never imported by the game): the rollback spike's noisy party bot (docs/ROLLBACK_SPIKE.md
 * Design 4, task R2), a rough stand-in for people with a mouse, built on partyBot's PartyDriver. `recordNoisyPartyRun`
 * plays partyBot's script (floor 1 walked to the stairwell fighting on the way; debug skips to floor 5; the boss
 * fought; its stairwell) with three kinds of noise every bot input lacks:
 *   - the aim DRIFTS every tick: the bot's aim (the nearest enemy, else the walk) plus a sideways sway that random-walks
 *     each tick, so no two consecutive frames aim alike (a mouse moves the aim almost every tick);
 *   - attacks are TAPPED: one-tick FIRE presses a random 3-9 ticks apart while an enemy is near (never held);
 *   - random ROLLS: a ROLL press with a small chance per tick.
 * Like partyBot it drinks a flask / fires an Ember when low (press edges), so the party survives floor 1.
 * Deterministic: the noise comes from one shared/sim Rng seeded from the run seed, drawn in player order every tick, and
 * the frames are quantized like a real client's. Drafts are resolved by PartyDriver.resolveDrafts (no noise there).
 */
import {
	Button,
	EMPTY_INPUT,
	NO_KIND,
	Rng,
	archetypeAt,
	isPartyWiped,
	playerAt,
	type InputFrame,
	hashState,
} from "shared/sim";
import { buildEndlessRunConfig } from "../endless";
import { distanceField, frame, walkDir, type Field } from "./endlessBot";
import { PartyDriver, type RecordedPartyRun } from "./partyBot";

/** The noise's tunables (a bot's knobs, not game data). */
export const NOISY_BOT = {
	/** Salt XOR-ed into the run seed for the noise stream. */
	salt: 0x5bd1e995,
	/** The aim's sideways sway: a random walk of at most this per tick, clamped to +- maxSway (unit-vector units). */
	swayStep: 0.12,
	maxSway: 0.7,
	/** Tapped attacks: FIRE for one tick, then this many ticks (inclusive range) before the next tap. */
	tapGapMin: 2,
	tapGapMax: 6,
	/** Attacks while the nearest enemy is this close (world units; partyBot swings at 2.5). */
	attackRange: 2.5,
	/** Aims at the nearest enemy within this (world units), else along the walk. */
	aimRange: 6,
	/** Press-edge assists (as partyBot): a flask at <= this many half hearts, an Ember at <= this many. */
	flaskAtHalfHearts: 3,
	emberAtHalfHearts: 2,
	/** A roll press per tick with this chance. */
	rollChance: 1 / 70,
	/** Player i starts walking i x this many ticks after the others (as partyBot). */
	startStagger: 7,
	/** The boss fight: player 0 presses the debug boss hit every this many ticks (as partyBot, keeps fights short). */
	debugBossEvery: 20,
	/** The boss fight: each player circles at this radius + (index mod 3). */
	ringBase: 4,
} as const;

export interface NoisyPartyScript {
	/** Ticks to walk floor 1 (default 2400). */
	readonly walkTicks?: number;
	/** Fight the floor 5 boss (default true) and for at most this many ticks (default 3000). */
	readonly boss?: boolean;
	readonly bossTicks?: number;
}

/** Per-player noise state. */
class Noise {
	private readonly rng: Rng;
	private readonly sway: number[] = [];
	private readonly tapIn: number[] = [];
	private readonly assist: number[] = [];

	constructor(seed: number, n: number) {
		this.rng = new Rng(bit32.bxor(seed, NOISY_BOT.salt));
		for (let i = 0; i < n; i++) {
			this.sway.push(0);
			this.tapIn.push(0);
			this.assist.push(0);
		}
	}

	/** Player i's drifting aim around the unit direction (bx, bz). */
	aim(i: number, bx: number, bz: number): [number, number] {
		const step = (this.rng.next() * 2 - 1) * NOISY_BOT.swayStep;
		this.sway[i] = math.clamp(this.sway[i] + step, -NOISY_BOT.maxSway, NOISY_BOT.maxSway);
		const s = this.sway[i];
		const ax = bx - bz * s;
		const az = bz + bx * s;
		const len = math.sqrt(ax * ax + az * az);
		return len > 1e-9 ? [ax / len, az / len] : [bx, bz];
	}

	/** A tapped FIRE this tick (only when `wants`). */
	tap(i: number, wants: boolean): boolean {
		if (this.tapIn[i] > 0) this.tapIn[i] -= 1;
		if (!wants || this.tapIn[i] > 0) return false;
		this.tapIn[i] = this.rng.int(NOISY_BOT.tapGapMin, NOISY_BOT.tapGapMax);
		return true;
	}

	/** Press-edge flask / Ember when player i is low (partyBot's assist). */
	assisted(drv: PartyDriver, i: number, buttons: number): number {
		const p = playerAt(drv.state, i);
		let want = 0;
		if (p.hearts <= NOISY_BOT.flaskAtHalfHearts && p.flask > 0 && p.flaskTicks === 0) want = Button.FLASK;
		if (p.hearts <= NOISY_BOT.emberAtHalfHearts && p.embers > 0) want = bit32.bor(want, Button.EMBER);
		const press = bit32.band(want, bit32.bnot(this.assist[i]));
		this.assist[i] = want;
		return bit32.bor(buttons, press);
	}

	roll(): boolean {
		return this.rng.next() < NOISY_BOT.rollChance;
	}
}

/** The nearest live actor to player i within `range`: its unit direction, else undefined. */
function enemyDir(drv: PartyDriver, i: number, range: number): [number, number] | undefined {
	const p = playerAt(drv.state, i);
	let best: [number, number] | undefined;
	let bestD2 = range * range;
	for (const a of drv.state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const dx = a.x - p.x;
		const dz = a.z - p.z;
		const d2 = dx * dx + dz * dz;
		if (d2 < bestD2 && d2 > 1e-9) {
			bestD2 = d2;
			const d = math.sqrt(d2);
			best = [dx / d, dz / d];
		}
	}
	return best;
}

/** One player's noisy walking frame toward the field target. */
function walkFrame(drv: PartyDriver, noise: Noise, i: number, field: Field, t: number): InputFrame {
	const p = playerAt(drv.state, i);
	if (p.dead !== 0 || t < i * NOISY_BOT.startStagger) return { ...EMPTY_INPUT };
	const [mx, mz] = walkDir(field, p.x, p.z);
	const near = enemyDir(drv, i, NOISY_BOT.attackRange);
	const seen = near ?? enemyDir(drv, i, NOISY_BOT.aimRange);
	const base: [number, number] = seen ?? (mx !== 0 || mz !== 0 ? [mx, mz] : [p.faceX, p.faceZ]);
	const [ax, az] = noise.aim(i, base[0], base[1]);
	let buttons = noise.roll() ? Button.ROLL : 0;
	if (noise.tap(i, near !== undefined)) buttons = bit32.bor(buttons, Button.FIRE);
	return frame(mx, mz, noise.assisted(drv, i, buttons), ax, az);
}

/** Everyone walks (noisily) to world (tx, tz) until the floor changes, the party is down, `done` or the budget. */
function walkAll(drv: PartyDriver, noise: Noise, tx: number, tz: number, maxTicks: number, done = () => false): void {
	const field = distanceField(drv.world().dungeon, tx, tz);
	const startFloor = drv.floor();
	let t = 0;
	while (t < maxTicks && !done() && !isPartyWiped(drv.state) && drv.floor() === startFloor) {
		const f: InputFrame[] = [];
		for (let i = 0; i < drv.n; i++) f.push(walkFrame(drv, noise, i, field, t));
		drv.tick(f);
		t++;
	}
	drv.resolveDrafts();
}

/** The party circles the boss with drifting aim, tapped attacks and random rolls (partyBot's fightBoss, noisy). */
function fightBoss(drv: PartyDriver, noise: Noise, maxTicks: number): void {
	let t = 0;
	while (t < maxTicks && !isPartyWiped(drv.state)) {
		const boss = drv.state.combat.actors.find(
			(a) => a.kind !== NO_KIND && a.alive !== 0 && archetypeAt(a.kind).data.boss === true,
		);
		if (boss === undefined) return;
		const f: InputFrame[] = [];
		for (let i = 0; i < drv.n; i++) {
			const p = playerAt(drv.state, i);
			if (p.dead !== 0) {
				f.push({ ...EMPTY_INPUT });
				continue;
			}
			const dx = boss.x - p.x;
			const dz = boss.z - p.z;
			const d = math.max(1e-6, math.sqrt(dx * dx + dz * dz));
			const ux = dx / d;
			const uz = dz / d;
			const ring = NOISY_BOT.ringBase + (i % 3);
			const radial = d > ring + 0.5 ? 0.6 : d < ring - 0.5 ? -0.6 : 0;
			const side = i % 2 === 0 ? 1 : -1;
			let mx = -uz * side + ux * radial;
			let mz = ux * side + uz * radial;
			const len = math.sqrt(mx * mx + mz * mz);
			mx /= len;
			mz /= len;
			const [ax, az] = noise.aim(i, ux, uz);
			let buttons = noise.roll() ? Button.ROLL : 0;
			if (noise.tap(i, true)) buttons = bit32.bor(buttons, Button.FIRE);
			if (i === 0 && t % NOISY_BOT.debugBossEvery === NOISY_BOT.debugBossEvery / 2) {
				buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
			}
			f.push(frame(mx, mz, noise.assisted(drv, i, buttons), ax, az));
		}
		drv.tick(f);
		t++;
	}
}

/** Plays and records the noisy run in the file comment for a party of `n` on `seed`. */
export function recordNoisyPartyRun(seed: number, n: number, plan: NoisyPartyScript = {}): RecordedPartyRun {
	const setup = buildEndlessRunConfig(seed, n);
	const drv = new PartyDriver(setup, seed);
	const noise = new Noise(seed, n);
	const log: string[] = [];
	const note = (what: string) => {
		let hearts = "";
		for (let i = 0; i < n; i++) hearts += `${i > 0 ? "," : ""}${playerAt(drv.state, i).hearts}`;
		log.push(`${what}: tick ${drv.state.tick} floor ${drv.floor()} hearts ${hearts}`);
	};
	const w1 = drv.world();
	walkAll(drv, noise, w1.stairX, w1.stairZ, plan.walkTicks ?? 2400);
	note("floor 1 walked");
	if (drv.floor() === 1 && !isPartyWiped(drv.state)) drv.skipFloor();
	if (plan.boss !== false) {
		while (drv.floor() < 5 && !isPartyWiped(drv.state)) drv.skipFloor();
		const w5 = drv.world();
		walkAll(drv, noise, w5.stairX, w5.stairZ, 2500, () => drv.state.combat.actors.some((a) => a.phase > 0));
		note("boss engaged");
		fightBoss(drv, noise, plan.bossTicks ?? 3000);
		note("boss fight over");
		walkAll(drv, noise, w5.stairX, w5.stairZ, 1200);
		note("floor 5 done");
	}
	if (!isPartyWiped(drv.state)) drv.skipFloor();
	note("end");
	return { seed, n, setup, drv, recording: drv.recorder.getRecording(), finalHash: hashState(drv.state), log };
}
