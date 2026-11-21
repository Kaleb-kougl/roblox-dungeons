/**
 * Test support for specs (never imported by the game): a scripted co-op endless run (M4). `PartyDriver` steps a party
 * state with stepParty and records every merged frame (Recorder.recordParty); `recordPartyRun(seed, n)` plays:
 *   floor 1   every player walks the floor to the stairwell (BFS field), each with its own start delay, roll phase and
 *             sword swings at the nearest enemy; the floor ends once every living player stands in the stairwell
 *   floors 2+ player 0's debug skip to floor `bossFloor` (5), the party fights the floor's boss (Mother Mayhem or the
 *            Demon Lord, the seeded pick; player 0 presses J),
 *             then walks to the stairwell; one more skip
 * Players who die on the way stay dead until the next floor (and come back with 1 heart there).
 * M2 (endless runs): every floor change opens a boon draft for every present player and the world stays frozen until
 * all of them confirmed; the bots resolve it (resolveDrafts: each player's stick on their own card for
 * DRAFT_MIN_OPEN_TICKS, then a FIRE press), player i taking the first of their offers no lower-index player took this
 * round (so the party drafts different boons whenever it can).
 *
 * @module
 */
import {
	Button,
	DEBUG_FLOOR_BUTTON,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	EMPTY_INPUT,
	NO_KIND,
	Recorder,
	archetypeAt,
	createSimState,
	hashState,
	isDraftOpen,
	isPartyWiped,
	partySize,
	playerAt,
	stepParty,
	type InputFrame,
	type Recording,
	type SimState,
} from "shared/sim";
import type { CharacterId } from "shared/characters";
import { buildEndlessRunConfig, type EndlessRunSetup } from "../endless";
import { distanceField, frame as rawFrame, walkDir, type Field } from "./endlessBot";

/**
 * endlessBot's frame() with -0 axes normalized to 0, as every real client's quantizeAxis does: the binary codec
 * carries integers, so a -0 axis would not survive a segment's round trip (and a roll direction can keep its sign).
 */
function frame(mx: number, mz: number, buttons = 0, ax = 0, az = 0): InputFrame {
	const f = rawFrame(mx, mz, buttons, ax, az);
	if (f.moveX === 0) f.moveX = 0;
	if (f.moveZ === 0) f.moveZ = 0;
	if (f.aimX === 0) f.aimX = 0;
	if (f.aimZ === 0) f.aimZ = 0;
	return f;
}

/** Ticks between two players' start of walking (player i waits i x this). */
const START_STAGGER_TICKS = 7;
/** Rolls every this many ticks, phase-shifted per player. */
const ROLL_EVERY = 53;
/** Sword swings when an enemy is this close (world units). */
const SWING_RANGE = 2.5;

/** A live party endless run that records every merged frame it steps. */
export class PartyDriver {
	readonly state: SimState;
	readonly recorder: Recorder;
	readonly n: number;
	readonly floorTicks: number[] = [];
	readonly deaths: number[] = [];
	/** Per player: the boons they drafted (Boon indices), in order. */
	readonly drafted: number[][] = [];
	maxActors = 0;
	private readonly prev: number[] = [];

	constructor(readonly setup: EndlessRunSetup, readonly seed: number) {
		const spawn = setup.spawn!;
		this.state = createSimState(seed, spawn.x, spawn.z, setup.config);
		this.recorder = new Recorder(seed, spawn.x, spawn.z);
		this.n = partySize(this.state);
		for (let i = 0; i < this.n; i++) {
			this.prev.push(0);
			this.drafted.push([]);
		}
	}

	floor(): number {
		return this.state.endless!.floor;
	}

	world() {
		return this.setup.endlessFloor(this.floor());
	}

	tick(frames: InputFrame[]): void {
		const s = this.state;
		this.recorder.recordParty(frames);
		stepParty(s, frames, this.setup.config);
		if (s.events.floorChanged !== 0) this.floorTicks.push(s.tick);
		if (s.events.playerDied !== 0) this.deaths.push(s.tick);
		let present = 0;
		for (const a of s.combat.actors) if (a.kind !== NO_KIND) present++;
		if (present > this.maxActors) this.maxActors = present;
	}

	/** Every player idle except player `who`, who sends `buttons` (one tick down, one up). */
	press(who: number, buttons: number): void {
		const f: InputFrame[] = [];
		for (let i = 0; i < this.n; i++) f.push(i === who ? frame(0, 0, buttons) : { ...EMPTY_INPUT });
		this.tick(f);
		const up: InputFrame[] = [];
		for (let i = 0; i < this.n; i++) up.push({ ...EMPTY_INPUT });
		this.tick(up);
	}

	skipFloor(): void {
		this.press(0, DEBUG_FLOOR_BUTTON);
		this.resolveDrafts();
	}

	/**
	 * Resolves every open boon draft (see the file comment): each drafting player holds the stick on their card until
	 * their draft has been open DRAFT_MIN_OPEN_TICKS, presses FIRE once, then releases; then one idle tick. `pick(i,
	 * offers, taken)` chooses player i's offer index (default: the first offer nobody lower took this round). No-op
	 * without an open draft. Builds' boss double draft (docs/BUILDS.md BUD4): a confirm that re-deals (the draft stays
	 * open, its timer back at 0) is answered the same way on the new offers (`taken` empty).
	 */
	resolveDrafts(
		pick: (i: number, offers: ReadonlyArray<number>, taken: ReadonlyArray<number>) => number = firstFree,
	): void {
		const run = this.state.run;
		if (run === undefined || !isDraftOpen(this.state)) return;
		const taken: number[] = [];
		const choice: number[] = [];
		for (let i = 0; i < this.n; i++) {
			const p = run.players[i];
			if (p.draftOpen === 0) {
				choice.push(-1);
				continue;
			}
			const k = pick(i, p.draftOffers, taken);
			choice.push(k);
			taken.push(p.draftOffers[k]);
		}
		const pressed: boolean[] = [];
		for (let i = 0; i < this.n; i++) pressed.push(false);
		for (let guard = 0; guard < DRAFT_MIN_OPEN_TICKS * 8 && isDraftOpen(this.state); guard++) {
			const f: InputFrame[] = [];
			for (let i = 0; i < this.n; i++) {
				const p = run.players[i];
				if (pressed[i] && p.draftOpen !== 0 && p.draftTicks === 0) {
					pressed[i] = false;
					choice[i] = pick(i, p.draftOffers, []);
				}
				if (p.draftOpen === 0 || choice[i] < 0) {
					f.push({ ...EMPTY_INPUT });
					continue;
				}
				const side = cardSide(choice[i], p.draftOffers.size());
				const ready = p.draftTicks + 1 >= DRAFT_MIN_OPEN_TICKS;
				const confirm = ready && !pressed[i];
				if (confirm) {
					pressed[i] = true;
					this.drafted[i].push(p.draftOffers[choice[i]]);
				}
				f.push(
					frame(side * DRAFT_SCREEN_RIGHT_X, side * DRAFT_SCREEN_RIGHT_Z, confirm ? DRAFT_CONFIRM_BUTTON : 0),
				);
			}
			this.tick(f);
		}
		if (isDraftOpen(this.state)) error("resolveDrafts: a confirm did not close a draft", 0);
		const up: InputFrame[] = [];
		for (let i = 0; i < this.n; i++) up.push({ ...EMPTY_INPUT });
		this.tick(up);
	}

	/** Press-edge assist: flask at <= 3 half hearts, Ember at <= 2 (per player). */
	private assisted(i: number, buttons: number): number {
		const p = playerAt(this.state, i);
		let want = 0;
		if (p.hearts <= 3 && p.flask > 0 && p.flaskTicks === 0) want = bit32.bor(want, Button.FLASK);
		if (p.hearts <= 2 && p.embers > 0) want = bit32.bor(want, Button.EMBER);
		const press = bit32.band(want, bit32.bnot(this.prev[i]));
		this.prev[i] = want;
		return bit32.bor(buttons, press);
	}

	/** The nearest live actor to player i within `range`: its unit direction, else undefined. */
	private enemyDir(i: number, range: number): [number, number] | undefined {
		const p = playerAt(this.state, i);
		let best: [number, number] | undefined;
		let bestD2 = range * range;
		for (const a of this.state.combat.actors) {
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

	/** One player's walking frame toward the field target, swinging at near enemies. */
	private walkFrame(i: number, field: Field, t: number): InputFrame {
		const p = playerAt(this.state, i);
		if (p.dead !== 0 || t < i * START_STAGGER_TICKS) return { ...EMPTY_INPUT };
		const [mx, mz] = walkDir(field, p.x, p.z);
		const enemy = this.enemyDir(i, SWING_RANGE);
		let buttons = (t + i * 11) % ROLL_EVERY === 0 ? Button.ROLL : 0;
		if (enemy !== undefined) buttons = bit32.bor(buttons, t % 2 === 0 ? Button.FIRE : 0);
		const aim = enemy ?? [0, 0];
		return frame(mx, mz, this.assisted(i, buttons), aim[0], aim[1]);
	}

	/** Everyone walks to world (tx, tz) until the floor changes, the party is down or the budget runs out. */
	walkAll(tx: number, tz: number, maxTicks: number, done: () => boolean = () => false): number {
		const field = distanceField(this.world().dungeon, tx, tz);
		const startFloor = this.floor();
		let t = 0;
		while (t < maxTicks && !done() && !isPartyWiped(this.state) && this.floor() === startFloor) {
			const f: InputFrame[] = [];
			for (let i = 0; i < this.n; i++) f.push(this.walkFrame(i, field, t));
			this.tick(f);
			t++;
		}
		this.resolveDrafts(); // the stairwell ended the floor
		return t;
	}

	/**
	 * Player `who` alone walks to world (tx, tz) (swinging at near enemies; the others idle) until `done()`, the floor
	 * changes, they die or the budget runs out. `avoid`: a point whose surroundings the path keeps out of (the open
	 * stairwell, which would end the floor). Returns ticks used.
	 */
	walkOne(
		who: number,
		tx: number,
		tz: number,
		done: () => boolean,
		maxTicks: number,
		avoid?: readonly [number, number],
	): number {
		const field = distanceField(this.world().dungeon, tx, tz, avoid);
		const startFloor = this.floor();
		let t = 0;
		while (t < maxTicks && !done() && playerAt(this.state, who).dead === 0 && this.floor() === startFloor) {
			const f: InputFrame[] = [];
			for (let i = 0; i < this.n; i++)
				f.push(i === who ? this.walkFrame(i, field, t + i * START_STAGGER_TICKS) : { ...EMPTY_INPUT });
			this.tick(f);
			t++;
		}
		return t;
	}

	/** The party circles the boss and swings / fires at it; player 0 presses J every 20 ticks. */
	fightBoss(maxTicks: number): void {
		let t = 0;
		while (t < maxTicks && !isPartyWiped(this.state)) {
			// Any live boss (data.boss): Mother Mayhem or the Demon Lord.
			const boss = this.state.combat.actors.find(
				(a) => a.kind !== NO_KIND && a.alive !== 0 && archetypeAt(a.kind).data.boss === true,
			);
			if (boss === undefined) return;
			const f: InputFrame[] = [];
			for (let i = 0; i < this.n; i++) {
				const p = playerAt(this.state, i);
				if (p.dead !== 0) {
					f.push({ ...EMPTY_INPUT });
					continue;
				}
				const dx = boss.x - p.x;
				const dz = boss.z - p.z;
				const dist = math.max(1e-6, math.sqrt(dx * dx + dz * dz));
				const ux = dx / dist;
				const uz = dz / dist;
				const ring = 4 + (i % 3);
				const radial = dist > ring + 0.5 ? 0.6 : dist < ring - 0.5 ? -0.6 : 0;
				const side = i % 2 === 0 ? 1 : -1;
				let mx = -uz * side + ux * radial;
				let mz = ux * side + uz * radial;
				const len = math.sqrt(mx * mx + mz * mz);
				mx /= len;
				mz /= len;
				let buttons: number = Button.FIRE;
				if (i === 0 && t % 20 === 10) buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
				if ((t + i * 13) % 40 === 0) buttons = bit32.bor(buttons, Button.ROLL);
				f.push(frame(mx, mz, this.assisted(i, buttons), ux, uz));
			}
			this.tick(f);
			t++;
		}
	}
}

/** The first of `offers` not in `taken` (index), else 0. */
function firstFree(_i: number, offers: ReadonlyArray<number>, taken: ReadonlyArray<number>): number {
	for (let k = 0; k < offers.size(); k++) if (!taken.includes(offers[k])) return k;
	return 0;
}

/** Screen-horizontal stick side (-1 / 0 / +1) that selects offer `k` of `count` (progression draftCardFor). */
function cardSide(k: number, count: number): number {
	if (count >= DRAFT_OFFER_COUNT) {
		const column = k;
		return column === DRAFT_COLUMN_RIGHT ? 1 : column === DRAFT_COLUMN_LEFT ? -1 : 0;
	}
	if (count === 2) return k === 0 ? -1 : 1;
	return 0;
}

/** What recordPartyRun produced. */
export interface RecordedPartyRun {
	readonly seed: number;
	readonly n: number;
	readonly setup: EndlessRunSetup;
	readonly drv: PartyDriver;
	readonly recording: Recording;
	readonly finalHash: string;
	readonly log: ReadonlyArray<string>;
}

/**
 * Spec support. Optional changes to the scripted party run `recordPartyRun` plays. Absent fields give the run the older
 * specs pin.
 */
export interface PartyRunScript {
	/** Ticks to walk floor 1 (default 2400). */
	readonly walkTicks?: number;
	/** Fight the floor 5 boss (default true). */
	readonly boss?: boolean;
	/**
	 * docs/ARCHER.md AR4: the players' characters (buildEndlessRunConfig's `characters`). Absent: no characters (both
	 * weapons, no traits), the run every older spec pins.
	 */
	readonly characters?: ReadonlyArray<CharacterId>;
}

/** Plays and records the run in the file comment for a party of `n` on `seed`. */
export function recordPartyRun(seed: number, n: number, plan: PartyRunScript = {}): RecordedPartyRun {
	const setup =
		plan.characters !== undefined
			? buildEndlessRunConfig(seed, n, { characters: plan.characters })
			: buildEndlessRunConfig(seed, n);
	const drv = new PartyDriver(setup, seed);
	const log: string[] = [];
	const note = (what: string) => {
		let hearts = "";
		for (let i = 0; i < n; i++) hearts += `${i > 0 ? "," : ""}${playerAt(drv.state, i).hearts}`;
		log.push(`${what}: tick ${drv.state.tick} floor ${drv.floor()} hearts ${hearts}`);
	};
	const w1 = drv.world();
	drv.walkAll(w1.stairX, w1.stairZ, plan.walkTicks ?? 2400);
	note("floor 1 walked");
	if (drv.floor() === 1 && !isPartyWiped(drv.state)) drv.skipFloor();
	if (plan.boss !== false) {
		while (drv.floor() < 5 && !isPartyWiped(drv.state)) drv.skipFloor();
		const w5 = drv.world();
		drv.walkAll(w5.stairX, w5.stairZ, 2500, () => drv.state.combat.actors.some((a) => a.phase > 0));
		note("boss engaged");
		drv.fightBoss(3000);
		note("boss fight over");
		drv.walkAll(w5.stairX, w5.stairZ, 1200);
		note("floor 5 done");
	}
	if (!isPartyWiped(drv.state)) drv.skipFloor();
	note("end");
	return {
		seed,
		n,
		setup,
		drv,
		recording: drv.recorder.getRecording(),
		finalHash: hashState(drv.state),
		log,
	};
}
