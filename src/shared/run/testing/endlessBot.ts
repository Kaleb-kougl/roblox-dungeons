/**
 * Test support for specs (never imported by the game): the endless-mode walking bot (moved here from
 * run/endless.spec.ts so several specs can share the recorded run) and `recordEndlessRun`, the recorded seed-1337
 * descent: floors 1-4 by the debug skip, floor 5 walked into the boss's arena (Mother Bramble or the Demon Lord: the
 * floor's seeded pick, shared/dungeon bossKindFor), the boss killed (J presses), the
 * stairwell walked, floor 6 walked to its stairwell, floor 7 skipped, ending on floor 8 at Depth 2. M2: every floor
 * change opens a boon draft, which the bot resolves (resolveDraft: the stick on a card for DRAFT_MIN_OPEN_TICKS, then
 * a FIRE press); before skipping the first floor with both a TREASURE and a SHRINE room it walks onto the relic
 * pedestal and into the shrine and accepts the curse (SHRINE_BUTTON).
 *
 * The bot: a BFS distance field over FLOOR tiles to a target tile; each tick steps toward the lowest neighbour.
 */
import {
	Button,
	DEBUG_FLOOR_BUTTON,
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	NO_KIND,
	NO_SELECTION,
	SHRINE_BUTTON,
	SHRINE_RADIUS,
	SOLO_PLAYER,
	draftCardFor,
	isDraftOpen,
	Recorder,
	archetypeAt,
	createSimState,
	hashState,
	step,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
	quantizeAxis,
} from "shared/sim";
import { gridToWorld, pathField, pathStep, worldToGrid, type PathField } from "shared/dungeon";
import { buildEndlessRunConfig, type EndlessRunSetup } from "../endless";

/** A BFS distance field to a target (exported for the party bot): shared/dungeon pathField's. */
export type Field = PathField;

/** The bots' distance field: shared/dungeon pathField (lifted from here, docs/TUTORIAL_ARROW.md A1). */
export const distanceField = pathField;

/** Unit move (dx, dz) toward the field's target from (x, z). */
export function walkDir(f: Field, x: number, z: number): [number, number] {
	const nextCell = pathStep(f, worldToGrid(x), worldToGrid(z));
	const tx = nextCell >= 0 ? gridToWorld(nextCell % f.d.W) : f.tx;
	const tz = nextCell >= 0 ? gridToWorld(math.floor(nextCell / f.d.W)) : f.tz;
	const dx = tx - x;
	const dz = tz - z;
	const len = math.sqrt(dx * dx + dz * dz);
	return len > 1e-9 ? [dx / len, dz / len] : [0, 0];
}

export function frame(mx: number, mz: number, buttons = 0, ax = 0, az = 0): InputFrame {
	// quantizeAxis, as a real client's input goes: it also turns -0 into 0, which the recording codec cannot carry (a
	// -0 the live sim stepped on but the server's decoded segment no longer has once split the hashes)
	return {
		moveX: quantizeAxis(mx),
		moveZ: quantizeAxis(mz),
		aimX: quantizeAxis(ax),
		aimZ: quantizeAxis(az),
		buttons,
	};
}

/** resolveDraft answers at most this many deals of one draft (builds' boss double draft deals 2). */
const RESOLVE_DRAFT_MAX_DEALS = 4;

/**
 * Test-only: closes every open boon draft WITHOUT a pick (state surgery; the game has no way to decline). For specs
 * about other systems that debug-skip floors (the offers' rng draws stay done).
 */
export function dismissDraft(s: SimState): void {
	const r = s.run;
	if (r === undefined) return;
	for (const p of r.players) {
		p.draftOpen = 0;
		p.draftTicks = 0;
		p.draftOffers = [];
		p.draftSelected = NO_SELECTION;
	}
	// Builds (docs/BUILDS.md): no deal left either.
	if (s.builds !== undefined) for (const b of s.builds.players) b.draftsLeft = 0;
}

/** Test-only: debug-skips floors until `floor` (press, release), dismissing each draft (dismissDraft). */
export function skipToFloor(s: SimState, config: Readonly<SimConfig>, floor: number): void {
	while (s.endless!.floor < floor) {
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), config);
		dismissDraft(s);
		step(s, frame(0, 0), config);
	}
}

/** A live endless run that records every frame it steps. */
export class Driver {
	readonly state: SimState;
	readonly recorder: Recorder;
	readonly floorTicks: number[] = [];
	readonly depthTicks: number[] = [];
	readonly stairwellEntries: number[] = [];
	readonly hashes = new Map<number, string>();
	/** Boons taken (Boon indices), in draft order. */
	readonly drafted: number[] = [];
	bossKills = 0;
	maxActors = 0;
	private lastAssist = 0;

	constructor(readonly setup: EndlessRunSetup, readonly seed: number) {
		const spawn = setup.spawn!;
		this.state = createSimState(seed, spawn.x, spawn.z, setup.config);
		this.recorder = new Recorder(seed, spawn.x, spawn.z);
	}

	floor(): number {
		return this.state.endless!.floor;
	}

	world() {
		return this.setup.endlessFloor(this.floor());
	}

	tick(input: InputFrame): void {
		const s = this.state;
		const before = s.endless!.floor;
		const stair = this.world();
		const p = s.player;
		const ddx = p.x - stair.stairX;
		const ddz = p.z - stair.stairZ;
		this.recorder.record(input);
		step(s, input, this.setup.config);
		const e = s.events;
		if (e.floorChanged !== 0) {
			this.floorTicks.push(s.tick);
			// Entered by walking (no debug skip pressed on this tick)?
			if (bit32.band(input.buttons, DEBUG_FLOOR_BUTTON) === 0 || ddx * ddx + ddz * ddz < 4) {
				this.stairwellEntries.push(before);
			}
		}
		if (e.depthChanged !== 0) this.depthTicks.push(s.tick);
		this.bossKills += e.bossDefeated;
		let present = 0;
		for (const a of s.combat.actors) if (a.kind !== NO_KIND) present++;
		if (present > this.maxActors) this.maxActors = present;
		if (s.tick % 97 === 0) this.hashes.set(s.tick, hashState(s));
	}

	/** `buttons` plus a careful player's reflexes: a flask at <= 3 half hearts, an Ember at <= 2 (press edges). */
	assisted(buttons: number): number {
		const p = this.state.player;
		let want = 0;
		if (p.hearts <= 3 && p.flask > 0 && p.flaskTicks === 0) want = bit32.bor(want, Button.FLASK);
		if (p.hearts <= 2 && p.embers > 0) want = bit32.bor(want, Button.EMBER);
		const press = bit32.band(want, bit32.bnot(this.lastAssist));
		this.lastAssist = want;
		return bit32.bor(buttons, press);
	}

	/** Presses DEBUG_FLOOR_BUTTON (one tick down, one up), then resolves the draft that opens. */
	skipFloor(): void {
		this.tick(frame(0, 0, DEBUG_FLOOR_BUTTON));
		this.tick(frame(0, 0));
		this.resolveDraft();
	}

	/**
	 * Resolves an open boon draft: the stick on `column` (left / centre / right; for two cards the centre falls back to
	 * the left one) until the draft has been open DRAFT_MIN_OPEN_TICKS, one FIRE press, then a release. No-op without
	 * an open draft. Builds' boss double draft (docs/BUILDS.md BUD4): a confirm that re-deals (the draft stays open, its
	 * timer back at 0) is answered the same way on the new offers; every pick lands in `drafted`.
	 */
	resolveDraft(column: number = DRAFT_COLUMN_CENTRE): void {
		const p = this.state.run?.players[SOLO_PLAYER];
		if (p === undefined || !isDraftOpen(this.state)) return;
		for (let deal = 0; deal < RESOLVE_DRAFT_MAX_DEALS && p.draftOpen !== 0; deal++) {
			let col = column;
			if (draftCardFor(col, p.draftOffers.size()) < 0) col = DRAFT_COLUMN_LEFT;
			const side = col === DRAFT_COLUMN_RIGHT ? 1 : col === DRAFT_COLUMN_LEFT ? -1 : 0;
			const mx = side * DRAFT_SCREEN_RIGHT_X;
			const mz = side * DRAFT_SCREEN_RIGHT_Z;
			const pick = p.draftOffers[draftCardFor(col, p.draftOffers.size())];
			while (p.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) this.tick(frame(mx, mz));
			this.tick(frame(mx, mz, DRAFT_CONFIRM_BUTTON));
			if (p.draftOpen !== 0 && p.draftTicks !== 0) error("resolveDraft: the confirm did not close the draft", 0);
			this.drafted.push(pick);
			this.tick(frame(0, 0));
		}
		if (p.draftOpen !== 0) error("resolveDraft: the draft was still open after every deal", 0);
	}

	/** One SHRINE_BUTTON press (down, then up). */
	pressShrine(): void {
		this.tick(frame(0, 0, SHRINE_BUTTON));
		this.tick(frame(0, 0));
	}

	/** Walks to world (tx, tz) until `done()` or the tick budget runs out; rolls now and then. Returns ticks used. */
	walkTo(tx: number, tz: number, done: () => boolean, maxTicks: number, avoid?: readonly [number, number]): number {
		// round the floor's breakables like a player would (solid decor is already wall in the grid)
		const w = this.world();
		const blocked = new Set<number>();
		for (const b of w.breakables ?? []) blocked.add(b.y * w.dungeon.W + b.x);
		const field = distanceField(w.dungeon, tx, tz, avoid, blocked);
		const startFloor = this.floor();
		let n = 0;
		while (n < maxTicks && !done() && this.state.player.dead === 0 && this.floor() === startFloor) {
			const p = this.state.player;
			const [mx, mz] = walkDir(field, p.x, p.z);
			this.tick(frame(mx, mz, this.assisted(n % 50 === 25 ? Button.ROLL : 0)));
			n++;
		}
		return n;
	}
}

/** The floor's live boss (any `data.boss` archetype: Mother Bramble or the Demon Lord), if present. */
export function bossOf(s: SimState) {
	return s.combat.actors.find((a) => a.kind !== NO_KIND && a.alive !== 0 && archetypeAt(a.kind).data.boss === true);
}

/**
 * Fights the boss: circle-strafes at ~5 units, aims and fires at it, rolls now and then, drinks a flask when hurt,
 * and presses J (DEBUG_BOSS) every 20 ticks. Returns when the boss is dead, the player is dead or time is up.
 */
export function fightBoss(drv: Driver, maxTicks: number): void {
	let n = 0;
	while (n < maxTicks && drv.state.player.dead === 0) {
		if (isDraftOpen(drv.state)) return;
		const boss = bossOf(drv.state);
		if (boss === undefined) return;
		const p = drv.state.player;
		const dx = boss.x - p.x;
		const dz = boss.z - p.z;
		const dist = math.max(1e-6, math.sqrt(dx * dx + dz * dz));
		const ux = dx / dist;
		const uz = dz / dist;
		const radial = dist > 5.5 ? 0.6 : dist < 4.5 ? -0.6 : 0;
		let mx = -uz + ux * radial;
		let mz = ux + uz * radial;
		const len = math.sqrt(mx * mx + mz * mz);
		mx /= len;
		mz /= len;
		let buttons: number = Button.FIRE;
		if (n % 20 === 10) buttons = bit32.bor(buttons, Button.DEBUG_BOSS);
		if (n % 40 === 0) buttons = bit32.bor(buttons, Button.ROLL);
		drv.tick(frame(mx, mz, drv.assisted(buttons), ux, uz));
		n++;
	}
}

/** What recordEndlessRun produced. */
export interface RecordedEndlessRun {
	readonly seed: number;
	readonly setup: EndlessRunSetup;
	readonly drv: Driver;
	readonly recording: Recording;
	readonly finalHash: string;
	/** Depth right after the boss fight. */
	readonly depthAfterBoss: number;
	/** The floor after walking floor 6 to its stairwell (7 when both walks reached a stairwell). */
	readonly afterWalk: number;
	/** Milestones: tick, floor and hearts at each (printed by the spec). */
	readonly log: ReadonlyArray<string>;
	/** The floor where the bot took a relic and a curse (0: no floor among 1-4 has both a treasure and a shrine). */
	readonly relicFloor: number;
}

/** Treasure-room pedestal and shrine centres of the driver's current floor (the first of each), if any. */
function pedestalAndShrine(drv: Driver): { pedestal?: [number, number]; shrine?: [number, number] } {
	const rooms = drv.world().config.encounter?.rooms ?? [];
	const t = rooms.find((r) => r.type === "treasure");
	const sh = rooms.find((r) => r.type === "shrine");
	return {
		pedestal: t !== undefined ? [t.cx, t.cz] : undefined,
		shrine: sh !== undefined ? [sh.cx, sh.cz] : undefined,
	};
}

/** Walks onto the floor's first pedestal (a relic), then into the shrine and accepts its curse. */
function takeRelicAndCurse(drv: Driver, note: (what: string) => void): void {
	const { pedestal, shrine } = pedestalAndShrine(drv);
	const run = drv.state.run!;
	const me = run.players[SOLO_PLAYER];
	const w = drv.world();
	const stair: [number, number] = [w.stairX, w.stairZ]; // open on floors 1-4: walking into it would end the floor
	if (pedestal !== undefined) {
		const before = me.relics.size();
		drv.walkTo(pedestal[0], pedestal[1], () => me.relics.size() > before, 3000, stair);
		note("relic");
	}
	if (shrine !== undefined) {
		const p = drv.state.player;
		const near = () => {
			const dx = p.x - shrine[0];
			const dz = p.z - shrine[1];
			return dx * dx + dz * dz < SHRINE_RADIUS * SHRINE_RADIUS * 0.25;
		};
		drv.walkTo(shrine[0], shrine[1], near, 3000, stair);
		if (near()) drv.pressShrine();
		note("curse");
	}
}

/** Plays and records the descent described in the file comment on `seed` (the specs use 1337). */
export function recordEndlessRun(seed = 1337): RecordedEndlessRun {
	const setup = buildEndlessRunConfig(seed);
	const drv = new Driver(setup, seed);
	const log: string[] = [];
	const note = (what: string) =>
		log.push(`${what}: tick ${drv.state.tick} floor ${drv.floor()} hearts ${drv.state.player.hearts}`);
	// Floors 1-4: the debug skip; on the first of them with a treasure and a shrine room, a relic and a curse first.
	let relicFloor = 0;
	while (drv.floor() < 5 && drv.state.player.dead === 0) {
		const here = pedestalAndShrine(drv);
		if (relicFloor === 0 && here.pedestal !== undefined && here.shrine !== undefined) {
			relicFloor = drv.floor();
			takeRelicAndCurse(drv, note);
		}
		drv.skipFloor();
	}
	// Floor 5: walk into the boss's arena (rooms on the way spawn their enemies as the bot passes), kill the boss
	// (J), then walk onto the stairwell where she stood.
	const w5 = drv.world();
	drv.walkTo(w5.stairX, w5.stairZ, () => drv.state.combat.actors.some((a) => a.phase > 0), 3000);
	note("engaged");
	fightBoss(drv, 4000);
	note("fight over");
	const depthAfterBoss = drv.state.endless!.depth;
	drv.walkTo(w5.stairX, w5.stairZ, () => false, 1200);
	drv.resolveDraft();
	note("floor 5 done");
	// Floor 6: walk the whole floor to its stairwell.
	const w6 = drv.world();
	drv.walkTo(w6.stairX, w6.stairZ, () => false, 4000);
	drv.resolveDraft();
	note("floor 6 done");
	const afterWalk = drv.floor();
	// Floor 7: the debug skip, to floor 8.
	while (drv.floor() < 8 && drv.state.player.dead === 0) drv.skipFloor();
	const recording = drv.recorder.getRecording();
	const finalHash = hashState(drv.state);

	return { seed, setup, drv, recording, finalHash, depthAfterBoss, afterWalk, log, relicFloor };
}
