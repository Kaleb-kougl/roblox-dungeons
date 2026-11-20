/**
 * Test support for specs (never imported by the game): the endless-mode walking bot (moved here from
 * run/endless.spec.ts so several specs can share the recorded run) and `recordEndlessRun`, the recorded seed-1337
 * descent: floors 1-4 by the debug skip, floor 5 walked into the boss's arena (Mother Mayhem or the Demon Lord: the
 * floor's seeded pick, shared/dungeon bossKindFor), the boss killed (J presses), the
 * stairwell walked, floor 6 walked to its stairwell, floor 7 skipped, ending on floor 8 at Depth 2. M2: every floor
 * change opens a boon draft, which the bot resolves (resolveDraft: the stick on a card for DRAFT_MIN_OPEN_TICKS, then
 * a FIRE press); before skipping the first floor with both a TREASURE and a SHRINE room it walks onto the relic
 * pedestal and into the shrine and accepts the curse (SHRINE_BUTTON). Pacts (docs/FORTUNE.md PS5: endless worlds have
 * them): on a shrine floor with pact altars the classic shrine is off, so it walks onto the Pact of Greed's altar instead
 * (the curse it shows, then the Legendary deal, resolved like a draft), then onto the Horde's and takes it too (it lapses
 * at the floor skip: no room is entered after it).
 *
 * The bot: a BFS distance field over FLOOR tiles to a target tile; each tick steps toward the lowest neighbour.
 *
 * Treasure rooms (docs/TREASURE.md TR5): `Driver.openVault` detours into the floor's vault room (walks to the chest's
 * front, which engages the room), fights its members with the sword (the nearest one; a flask when hurt) and walks onto
 * the unlocked chest to open it, returning what happened (VaultVisit). recordEndlessRun does not call it: its descent
 * is unchanged (a vault room it crosses on the way engages and fights like any room).
 *
 * @module
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
	PactKind,
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
	TREASURE_UNSET,
	VaultStatus,
	type ActorState,
} from "shared/sim";
import {
	bulletBlocker,
	gridToWorld,
	lineOfSight,
	pathField,
	pathStep,
	worldToGrid,
	type PathField,
} from "shared/dungeon";
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

/**
 * Spec support. Builds one input frame for a bot from a move vector, buttons and an aim vector. The axes are quantized
 * as a real client's input is, which also turns -0 into 0 (the recording codec cannot carry -0). Every bot in this
 * directory makes its frames here, so what a bot steps on is what a recording of it replays.
 */
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

/** walkTo: ticks under a move input without moving (more than WALK_STUCK_EPS) before the bot attacks its way on. */
const WALK_STUCK_TICKS = 20;
/** walkTo: ticks of attacking (FIRE held, aimed along the walk) once stuck. */
const WALK_STUCK_ATTACK_TICKS = 30;
/** walkTo: a tick that moves the player less than this (|dx| + |dz|, world units) counts as not moving. */
const WALK_STUCK_EPS = 1e-3;
/** openVault: the walk to the vault room, the fight, and the walk onto the unlocked chest (ticks). */
const VAULT_WALK_TICKS = 4000;
const VAULT_FIGHT_TICKS = 3600;
const VAULT_OPEN_TICKS = 600;
/** openVault: sword reach for the fight (world units: the bot stops and swings inside it). */
const VAULT_MELEE_RANGE = 1.2;
/** openVault: the chest's front cells the bot walks to (2: engage the room; 1: open it). */
const VAULT_APPROACH_CELLS = 2;
const VAULT_OPEN_CELLS = 1;

/** What Driver.openVault saw on one floor's vault. */
export interface VaultVisit {
	readonly floor: number;
	readonly lock: number;
	readonly startTier: number;
	/** The tier at the end (after any crack). */
	readonly tier: number;
	/** Its room engaged / cleared, the chest opened, the lock kept (never cracked). */
	readonly engaged: boolean;
	readonly cleared: boolean;
	readonly opened: boolean;
	readonly kept: boolean;
	/** Ticks from the engagement to the clear (-1 if not cleared in the fight loop); the room's par. */
	readonly clearTicks: number;
	readonly parTicks: number;
	/** The bot died on the way or in the fight. */
	readonly died: boolean;
}

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
	/** Called after every step with the input (census specs' observers, e.g. docs/SILVER.md SV1). */
	onStep: ((s: SimState, input: InputFrame) => void) | undefined;
	/** Boons taken (Boon indices), in draft order. */
	readonly drafted: number[] = [];
	bossKills = 0;
	maxActors = 0;
	private lastAssist = 0;

	/**
	 * `immortal` (census specs only, never a replay path): hearts topped up before every tick, so a long census never
	 * ends in a death. Off by default: every recorded run is honest.
	 */
	constructor(readonly setup: EndlessRunSetup, readonly seed: number, readonly immortal = false) {
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
		if (this.immortal) p.hearts = p.heartsMax;
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
		this.onStep?.(s, input);
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

	/**
	 * Walks to world (tx, tz) until `done()` or the tick budget runs out; rolls now and then. Returns ticks used. The
	 * distance field only knows the grid, so a body in the way (an intact breakable, an enemy) can pin the bot against
	 * it: after WALK_STUCK_TICKS without moving it attacks along its walk for WALK_STUCK_ATTACK_TICKS, as a player would
	 * (a walk that never stalls plays exactly as before).
	 */
	walkTo(tx: number, tz: number, done: () => boolean, maxTicks: number, avoid?: readonly [number, number]): number {
		// round the floor's breakables like a player would (solid decor is already wall in the grid)
		const w = this.world();
		const blocked = new Set<number>();
		for (const b of w.breakables ?? []) blocked.add(b.y * w.dungeon.W + b.x);
		const field = distanceField(w.dungeon, tx, tz, avoid, blocked);
		const startFloor = this.floor();
		let n = 0;
		let lastX = this.state.player.x;
		let lastZ = this.state.player.z;
		let still = 0;
		let attack = 0;
		while (n < maxTicks && !done() && this.state.player.dead === 0 && this.floor() === startFloor) {
			const p = this.state.player;
			const [mx, mz] = walkDir(field, p.x, p.z);
			if (still >= WALK_STUCK_TICKS) {
				attack = WALK_STUCK_ATTACK_TICKS;
				still = 0;
			}
			let buttons: number = n % 50 === 25 ? Button.ROLL : 0;
			const attacking = attack > 0;
			if (attacking) {
				buttons = bit32.bor(buttons, Button.FIRE);
				attack--;
			}
			this.tick(frame(mx, mz, this.assisted(buttons), attacking ? mx : 0, attacking ? mz : 0));
			const moved = math.abs(p.x - lastX) + math.abs(p.z - lastZ) > WALK_STUCK_EPS;
			still = moved || (mx === 0 && mz === 0) ? 0 : still + 1;
			lastX = p.x;
			lastZ = p.z;
			n++;
		}
		return n;
	}

	/** The living members of the vault room's score record. */
	private vaultMembers(): ActorState[] {
		const s = this.state;
		const t = s.treasure!;
		const r = s.score!.rooms[t.record];
		const out: ActorState[] = [];
		if (r === undefined) return out;
		for (let k = 0; k < r.memberSlots.size(); k++) {
			const a: ActorState | undefined = s.combat.actors[r.memberSlots[k]];
			if (a !== undefined && a.kind !== NO_KIND && a.id === r.memberIds[k] && a.alive !== 0) out.push(a);
		}
		return out;
	}

	/**
	 * Detours into the floor's vault room, fights it and opens the chest (see the file comment). Undefined without a
	 * vault on this floor (or without treasure state). Honest input only (recorded; a flask when hurt); the open
	 * stairwell is avoided on the way.
	 */
	openVault(fightTicks = VAULT_FIGHT_TICKS): VaultVisit | undefined {
		const s = this.state;
		const t = s.treasure;
		if (t === undefined || t.status === VaultStatus.NONE) return undefined;
		const floor = this.floor();
		const w = this.world();
		const stair: [number, number] = [w.stairX, w.stairZ];
		const front = (cells: number): [number, number] => [t.x + t.fx * cells, t.z + t.fz * cells];
		const [ex, ez] = front(VAULT_APPROACH_CELLS);
		this.walkTo(ex, ez, () => t.status !== VaultStatus.SEALED, VAULT_WALK_TICKS, stair);
		const r = s.score!.rooms[t.record];
		const engaged = t.status !== VaultStatus.SEALED;
		// The fight: the nearest living member, straight at it in sight, else along the grid; swing in reach.
		const blocked = bulletBlocker(w.dungeon);
		const fields = new Map<number, Field>();
		const fieldTo = (x: number, z: number): Field => {
			const gx = worldToGrid(x);
			const gz = worldToGrid(z);
			const key = gz * w.dungeon.W + gx;
			let f = fields.get(key);
			if (f === undefined) {
				f = distanceField(w.dungeon, gridToWorld(gx), gridToWorld(gz));
				fields.set(key, f);
			}
			return f;
		};
		let clearAt = -1;
		for (let n = 0; engaged && n < fightTicks && r.cleared === 0; n++) {
			if (s.player.dead !== 0 || this.floor() !== floor) break;
			const p = s.player;
			let best: ActorState | undefined;
			let bestD = math.huge;
			for (const a of this.vaultMembers()) {
				const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
				if (d < bestD) {
					bestD = d;
					best = a;
				}
			}
			if (best === undefined) {
				this.tick(frame(0, 0, this.assisted(0)));
				if (r.cleared !== 0) clearAt = s.tick - 1;
				continue;
			}
			const len = math.max(1e-9, math.sqrt(bestD));
			const ax = (best.x - p.x) / len;
			const az = (best.z - p.z) / len;
			let move: [number, number] = [0, 0];
			if (bestD > VAULT_MELEE_RANGE * VAULT_MELEE_RANGE)
				move = lineOfSight(blocked, p.x, p.z, best.x, best.z)
					? [ax, az]
					: walkDir(fieldTo(best.x, best.z), p.x, p.z);
			this.tick(frame(move[0], move[1], this.assisted(Button.FIRE), ax, az));
			if (r.cleared !== 0) clearAt = s.tick - 1;
		}
		const cleared = r.cleared !== 0;
		const clearTicks = clearAt >= 0 ? clearAt - r.engageTick : -1;
		if (cleared && t.status === VaultStatus.UNLOCKED) {
			const [ox, oz] = front(VAULT_OPEN_CELLS);
			this.walkTo(ox, oz, () => t.status === VaultStatus.OPENED, VAULT_OPEN_TICKS, stair);
		}
		return {
			floor,
			lock: t.lock,
			startTier: t.startTier,
			tier: t.tier,
			engaged,
			cleared,
			opened: t.status === VaultStatus.OPENED,
			kept: engaged && t.crackTick === TREASURE_UNSET,
			clearTicks,
			parTicks: r.parTicks,
			died: s.player.dead !== 0,
		};
	}
}

/** The floor's live boss (any `data.boss` archetype: Mother Mayhem or the Demon Lord), if present. */
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

/**
 * Walks onto the floor's first pedestal (a relic), then into the shrine and accepts its curse; on a floor with pact
 * altars, takes Greed (the curse and its deal) and the Horde instead.
 */
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
	const altars = drv.state.pacts !== undefined ? w.pactAltars : undefined;
	if (altars !== undefined) {
		// Pacts: Greed (its curse and the Legendary deal), then the Horde.
		for (const kind of [PactKind.GREED, PactKind.HORDE]) {
			const a = altars.altars[kind];
			const p = drv.state.player;
			const near = () => {
				const dx = p.x - a.x;
				const dz = p.z - a.z;
				return dx * dx + dz * dz < SHRINE_RADIUS * SHRINE_RADIUS * 0.25;
			};
			drv.walkTo(a.x, a.z, near, 3000, stair);
			if (near()) drv.pressShrine();
			drv.resolveDraft();
		}
		note("curse");
	} else if (shrine !== undefined) {
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
