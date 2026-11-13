/**
 * Secret rooms in the sim (docs/SECRET_ROOMS.md SR3 / SR4, Rules "State"; a Roblox-port feature, no web source). OPT-IN:
 * only a SimConfig with `secrets` creates `SimState.secrets`, and only then does anything here run or the hash grow the
 * appended `secrets` group (after `golden`, last). Without it nothing changes (M1, every golden fixture, the tutorial,
 * every replay that does not set it): a floor's crack pieces (if any) stay inert forever and nothing opens them.
 *
 * Where the secret is (the crack, the chamber, the chest, its tier) is decided when the floor is built (shared/dungeon
 * placeSecret): the sim copies the plan in at floor start (secretsOnFloor, from createSimState after the Goldling and
 * from stepEndless's floor change after goldenOnFloor) and draws NO rng for it. The crack is the floor's breakables
 * pieces `crackSlot .. crackSlot + cells - 1` (BreakableKind.CRACKED_WALL, inert), the chest piece `chestSlot`
 * (BreakableKind.CHEST); the sim moves and blocks on the carved dungeon (shared/run endlessFloorWorld), so the crack's
 * cells are FLOOR held shut by their pieces.
 *
 *   floor start  a plan: HIDDEN with its room, slots, chest centre (world), facing and tier; no plan: NONE. A secret of
 *                the floor before (found or not) is gone; the run counters and the stream carry over.
 *   the open     ./open.ts (SR3): a sword finisher, a Wrecker roll, a heavy arrow or Siege Bolt's slam, a Charger's
 *                charge breaks EVERY crack piece that tick (not a breakables break: no breakable points, loot, smash
 *                proc or Goldling release), HIDDEN -> OPEN, pays SECRET points (combo-neutral), events.opened.
 *   the chest    ./stepSecrets.ts (SR4, after stepGolden): OPEN -> TAKEN when the first living present player (index
 *                order) is within config.reachTiles of the chest's centre; every living present player gets the vault's
 *                shares for its tier (sim/treasure grants.ts grantShares) drawn from THIS state's stream (rngState:
 *                seedToState(seed) XOR SECRETS_SALT), a Legendary's bonus deal into state.treasure.bonusDeals; the
 *                chest's treasure points into SECRET; events.taken.
 * No absolute timers: a frozen draft needs no hold.
 *
 * Events (per tick, unhashed; for the view's SR6): `opened` (tick, how, the credited player, the toast's player, the
 * crack's first slot and centre, points) and `taken` (opener, tier, points, the grants). Knocks are the breakables'
 * per-tick feed (BreakablesState.knockSlots / knockSources / knockPlayers, SR2), present without this state too.
 */
import { gridToWorld, type FloorSecret } from "shared/dungeon";
import { seedToState } from "../rng";
import type { SimState } from "../state";
import { BreakableKind } from "../breakables/breakablesData";
import type { TreasureGrant } from "../treasure/treasure";
import { SECRET_HOW_COUNT, SECRET_UNSET, SECRETS_SALT, SecretStatus, type SecretsConfig } from "./secretsData";

/** SecretEvents.opened: the crack's open, for the view (burst, shout, toast, recap). */
export interface SecretOpened {
	readonly tick: number;
	/** SecretHow. */
	readonly how: number;
	/** The party index credited with it (SECRET_UNSET for a Charger's charge). */
	readonly player: number;
	/** The toast's player: the credited one, or for a Charger the nearest living present player (SECRET_UNSET: none). */
	readonly finder: number;
	/** The crack's first slot in the floor's breakables and the crack's centre (world, between its cells). */
	readonly slot: number;
	readonly x: number;
	readonly z: number;
	/** SECRET points scored by the open (0 without scoring). */
	readonly points: number;
}

/** SecretEvents.taken: the chest's open, for the view (reward cards, sting). */
export interface SecretTaken {
	/** The party index of the player who opened it (for the whole party). */
	readonly opener: number;
	/** VaultTier. */
	readonly tier: number;
	/** SECRET points scored by the chest (0 without scoring). */
	readonly points: number;
	/** One per living present player, index order (sim/treasure TreasureGrant). */
	readonly grants: TreasureGrant[];
}

/** Per-tick secret events for presentation. Cleared every tick; NOT hashed. */
export interface SecretEvents {
	opened: SecretOpened | undefined;
	taken: SecretTaken | undefined;
}

/** SimState.secrets: plain numbers, every field but `config` and `events` hashed. */
export interface SecretsState {
	readonly config: Readonly<SecretsConfig>;
	/** The secrets' stream (mulberry32 word): an RngHolder for the chest's draws. */
	rngState: number;
	/** SecretStatus. */
	status: number;
	/** The crack's encounter room id, its first breakables slot and cell count, the chest's slot. */
	room: number;
	crackSlot: number;
	cells: number;
	chestSlot: number;
	/** The crack's first cell and its direction along the wall (grid), for the open's events. */
	crackX: number;
	crackY: number;
	ax: number;
	az: number;
	/** The chest's centre (world) and facing (toward the crack: its boosts land in front, the vault's offsets). */
	x: number;
	z: number;
	fx: number;
	fz: number;
	/** VaultTier. */
	tier: number;
	/** state.tick the crack opened, SECRET_UNSET before. */
	openTick: number;
	/** The party index credited with the open (SECRET_UNSET for a Charger or before). */
	openedBy: number;
	/** SecretHow, SECRET_UNSET before. */
	openHow: number;
	/** The party index who opened the chest, SECRET_UNSET before. */
	takenBy: number;
	/** Run counters: cracks opened, chests taken, opens by SecretHow (SECRET_HOW_COUNT entries). */
	found: number;
	taken: number;
	byHow: number[];
	/** Not hashed. */
	events: SecretEvents;
}

/** The run's secret tally for the recap (docs/SECRET_ROOMS.md Design 9). */
export interface SecretsRunSummary {
	readonly found: number;
	readonly taken: number;
	/** Opens by SecretHow. */
	readonly byHow: ReadonlyArray<number>;
}

function emptyEvents(): SecretEvents {
	return { opened: undefined, taken: undefined };
}

/** The secrets stream's first word for a run seeded `seed` (seedToState(seed) XOR SECRETS_SALT). */
export function secretsSeedState(seed: number): number {
	return bit32.bxor(seedToState(seed), SECRETS_SALT);
}

function resetFloor(sc: SecretsState): void {
	sc.status = SecretStatus.NONE;
	sc.room = SECRET_UNSET;
	sc.crackSlot = SECRET_UNSET;
	sc.cells = 0;
	sc.chestSlot = SECRET_UNSET;
	sc.crackX = 0;
	sc.crackY = 0;
	sc.ax = 0;
	sc.az = 0;
	sc.x = 0;
	sc.z = 0;
	sc.fx = 0;
	sc.fz = 0;
	sc.tier = SECRET_UNSET;
	sc.openTick = SECRET_UNSET;
	sc.openedBy = SECRET_UNSET;
	sc.openHow = SECRET_UNSET;
	sc.takenBy = SECRET_UNSET;
}

/** Secrets state at run start: no secret yet (secretsOnFloor fills it). No rng. */
export function createSecretsState(config: Readonly<SecretsConfig>, seed: number): SecretsState {
	const byHow: number[] = [];
	for (let k = 0; k < SECRET_HOW_COUNT; k++) byHow.push(0);
	const sc: SecretsState = {
		config,
		rngState: secretsSeedState(seed),
		status: SecretStatus.NONE,
		room: SECRET_UNSET,
		crackSlot: SECRET_UNSET,
		cells: 0,
		chestSlot: SECRET_UNSET,
		crackX: 0,
		crackY: 0,
		ax: 0,
		az: 0,
		x: 0,
		z: 0,
		fx: 0,
		fz: 0,
		tier: SECRET_UNSET,
		openTick: SECRET_UNSET,
		openedBy: SECRET_UNSET,
		openHow: SECRET_UNSET,
		takenBy: SECRET_UNSET,
		found: 0,
		taken: 0,
		byHow,
		events: emptyEvents(),
	};
	return sc;
}

/**
 * A new floor (createSimState after the Goldling, stepEndless after goldenOnFloor): the floor's secret `plan` (absent:
 * none) replaces the last floor's (see the file comment). No-op without state.secrets. With breakables, throws when the
 * plan's slots are not its crack pieces and chest on their cells (floor data out of step); without breakables the
 * secret is NONE (nothing could block or open it). No rng.
 */
export function secretsOnFloor(state: SimState, plan: FloorSecret | undefined): void {
	const sc = state.secrets;
	if (sc === undefined) return;
	resetFloor(sc);
	const b = state.breakables;
	if (plan === undefined || b === undefined) return;
	for (let c = 0; c < plan.cells; c++) {
		const p = b.pieces[plan.crackSlot + c];
		const x = plan.x + plan.ax * c;
		const y = plan.y + plan.az * c;
		if (p === undefined || p.kind !== BreakableKind.CRACKED_WALL || p.x !== x || p.y !== y)
			error(`secrets: breakables slot ${plan.crackSlot + c} is not the crack at (${x}, ${y})`, 0);
	}
	const chest = b.pieces[plan.chestSlot];
	if (chest === undefined || chest.kind !== BreakableKind.CHEST || chest.x !== plan.chestX || chest.y !== plan.chestY)
		error(`secrets: breakables slot ${plan.chestSlot} is not the chest at (${plan.chestX}, ${plan.chestY})`, 0);
	sc.status = SecretStatus.HIDDEN;
	sc.room = plan.room;
	sc.crackSlot = plan.crackSlot;
	sc.cells = plan.cells;
	sc.chestSlot = plan.chestSlot;
	sc.crackX = plan.x;
	sc.crackY = plan.y;
	sc.ax = plan.ax;
	sc.az = plan.az;
	sc.x = gridToWorld(plan.chestX);
	sc.z = gridToWorld(plan.chestY);
	sc.fx = plan.fx;
	sc.fz = plan.fz;
	sc.tier = plan.tier;
}

/** Start of every tick (step.ts, after clearEvents). */
export function clearSecretsEvents(sc: SecretsState): void {
	sc.events.opened = undefined;
	sc.events.taken = undefined;
}

export function cloneSecretsState(sc: Readonly<SecretsState>): SecretsState {
	const e = sc.events;
	const t = e.taken;
	return {
		...sc,
		byHow: [...sc.byHow],
		events: {
			opened: e.opened !== undefined ? { ...e.opened } : undefined,
			taken:
				t !== undefined
					? {
							...t,
							grants: t.grants.map((g) => ({ ...g, boosts: [...g.boosts], slots: [...g.slots] })),
					  }
					: undefined,
		},
	};
}

/** The run's secret tally (zeros without secrets). */
export function secretsRunSummary(state: Readonly<SimState>): SecretsRunSummary {
	const sc = state.secrets;
	if (sc === undefined) return { found: 0, taken: 0, byHow: [0, 0, 0, 0] };
	return { found: sc.found, taken: sc.taken, byHow: [...sc.byHow] };
}

// ---------------------------------------------------------------------------------------------
// Hash: the `secrets` group, appended after `golden` (last) only when state.secrets exists.

/** Hashed scalars, in order (dump names `secrets.<name>`); then byHow's length and values. Append only. */
export const SECRETS_HASH_FIELDS = [
	"rngState",
	"status",
	"room",
	"crackSlot",
	"cells",
	"chestSlot",
	"crackX",
	"crackY",
	"ax",
	"az",
	"x",
	"z",
	"fx",
	"fz",
	"tier",
	"openTick",
	"openedBy",
	"openHow",
	"takenBy",
	"found",
	"taken",
] as const;

export function writeSecretsHash(sc: Readonly<SecretsState>, out: number[]): void {
	for (const f of SECRETS_HASH_FIELDS) out.push(sc[f]);
	out.push(sc.byHow.size());
	for (const v of sc.byHow) out.push(v);
}

/** Dump names for writeSecretsHash, same order (`secrets.status`, `secrets.byHow[2]`, ...). */
export function secretsHashNames(sc: Readonly<SecretsState>, out: string[]): void {
	for (const f of SECRETS_HASH_FIELDS) out.push(`secrets.${f}`);
	out.push("secrets.byHow.length");
	for (let i = 0; i < sc.byHow.size(); i++) out.push(`secrets.byHow[${i}]`);
}
