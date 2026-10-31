/**
 * Test support for specs (never imported by the game): time to kill of one endless room enemy (docs/ENEMY_VARIANTS.md
 * EV13 "TTK table"), with or without an elite affix, against a scripted player holding ONE real weapon (the port's
 * sword, or the bow's stream), at a floor's spawn hp.
 *
 * The fight: an open arena (no dungeon, TTK_BOUNDS), the player at the origin, the enemy TTK_START_DISTANCE away
 * (inside every room enemy's aggro range, so it engages on the first tick), god mode (hearts refilled every tick: TTK
 * only; the hits that landed are counted as a pressure measure). Hp: the spawn's hp (with Hulking's x175 % and the
 * Shielded shield, stamped by spawnActor from base hp) times endlessActorHp(1, false, floor, depth), applied to every
 * actor the tick it appears (slimelets and summons too) and to the shield, as an endless spawn on that floor would be.
 * The clock starts at tick 0 (so the sword's approach and every chase after an imp's blink count) and stops when the
 * target is dead: the Ooze and both slimelets; the Summoner (its summons wither with it).
 *
 * Bots: the sword walks to TTK_SWORD_CLOSE of the target (nearest living member of the target set) and holds FIRE
 * whenever it is within the swing's reach (the full combo: swing, swing, finisher); the bow keeps TTK_BOW_DISTANCE and
 * holds FIRE (the stream, 1 damage per arrow, no charged shots). Both aim straight at the target's centre.
 */
import { AffixKind, encounterCost } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	AFFIX_PAR_COST,
	ROOM_PAR_TICKS_PER_COST,
	BOW_DATA,
	Button,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	NO_KIND,
	SIM_HZ,
	SWORD_DATA,
	SimCtx,
	archetypeIndex,
	createSimState,
	endlessActorHp,
	spawnActor,
	step,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "./endlessBot";

export type TtkWeapon = "weapon.sword" | "weapon.bow";

/** One TTK row: an archetype, an affix (AffixKind, 0 none), and Shielded without its refill. */
export interface TtkCase {
	readonly label: string;
	readonly kind: string;
	readonly affix: number;
	readonly noRefill?: boolean;
}

/** A floor's spawn hp: endlessActorHp's floor and Depth (Depth +1 per boss: floors 5, 10, 15 are boss floors). */
export interface TtkFloor {
	readonly floor: number;
	readonly depth: number;
}

/** Floors 1 / 6 / 11 / 20 at the Depth a run that killed every boss on the way has there. */
export const TTK_FLOORS: ReadonlyArray<TtkFloor> = [
	{ floor: 1, depth: 1 },
	{ floor: 6, depth: 2 },
	{ floor: 11, depth: 3 },
	{ floor: 20, depth: 4 },
];

export const TTK_BOUNDS = { minX: -12, maxX: 12, minZ: -12, maxZ: 12 };
export const TTK_START_DISTANCE = 4.5;
/** The sword bot stops walking in at this centre distance (inside the swing's reach). */
export const TTK_SWORD_CLOSE = 1.4;
export const TTK_BOW_DISTANCE = 5;
/** A fight that lasts longer is reported as not killed (-1). */
export const TTK_MAX_SECONDS = 120;

/** The rows the EV13 table prints: the new archetypes, then every affix on the three original room enemies. */
export function ttkCases(): TtkCase[] {
	const out: TtkCase[] = [];
	for (const kind of ["swarmer", "sniper", "bruiser", "imp", "slime", "summoner"])
		out.push({ label: kind === "slime" ? "slime (+2 small)" : kind, kind, affix: AffixKind.NONE });
	for (const kind of ["swarmer", "sniper", "bruiser"]) {
		out.push({ label: `${kind} Hulking`, kind, affix: AffixKind.HULKING });
		out.push({ label: `${kind} Swift`, kind, affix: AffixKind.SWIFT });
		out.push({ label: `${kind} Shielded`, kind, affix: AffixKind.SHIELDED });
		out.push({ label: `${kind} Shielded, no refill`, kind, affix: AffixKind.SHIELDED, noRefill: true });
		out.push({ label: `${kind} Vengeful`, kind, affix: AffixKind.VENGEFUL });
	}
	return out;
}

export interface TtkResult {
	/** Seconds from tick 0 to the kill; -1: not killed within TTK_MAX_SECONDS. */
	readonly seconds: number;
	/** Hits that landed on the player (god mode). */
	readonly hitsTaken: number;
	/** Spawn hp of the target (after scaling and Hulking) and its shield. */
	readonly hp: number;
	readonly shield: number;
}

/** endlessActorHp's multiplier for a non-boss spawn on `f`. */
export function ttkHpMultiplier(f: TtkFloor): number {
	return endlessActorHp(1, false, f.floor, f.depth);
}

function scaleNewActors(s: SimState, mult: number, seen: Set<number>): void {
	const actors = s.combat.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === NO_KIND || a.alive === 0 || seen.has(a.id)) continue;
		seen.add(a.id);
		a.hp *= mult;
		a.hpMax *= mult;
		const slot = s.affixes?.slots[i];
		if (slot !== undefined && slot.actorId === a.id) {
			slot.shield *= mult;
			slot.shieldMax *= mult;
		}
	}
}

function nearestOf(s: SimState, kinds: ReadonlySet<number>): ActorState | undefined {
	const p = s.player;
	let best: ActorState | undefined;
	let bestD = math.huge;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0 || !kinds.has(a.kind)) continue;
		const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
		if (d < bestD) {
			bestD = d;
			best = a;
		}
	}
	return best;
}

function botFrame(s: SimState, weapon: TtkWeapon, t: ActorState | undefined): InputFrame {
	if (t === undefined) return EMPTY_INPUT;
	const p = s.player;
	const dx = t.x - p.x;
	const dz = t.z - p.z;
	const dist = math.sqrt(dx * dx + dz * dz);
	const ux = dist > 1e-9 ? dx / dist : 1;
	const uz = dist > 1e-9 ? dz / dist : 0;
	if (weapon === "weapon.sword") {
		const walk = dist > TTK_SWORD_CLOSE ? 1 : 0;
		const fire = dist <= SWORD_DATA.reach + t.radius ? Button.FIRE : 0;
		return frame(ux * walk, uz * walk, fire, ux, uz);
	}
	const radial = math.max(-1, math.min(1, (dist - TTK_BOW_DISTANCE) * 0.8));
	return frame(ux * radial, uz * radial, Button.FIRE, ux, uz);
}

/** One fight (see the file comment). `seed` is the run seed (the actors' rng). */
export function ttkFight(c: TtkCase, f: TtkFloor, weapon: TtkWeapon, seed: number): TtkResult {
	const config: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		bounds: TTK_BOUNDS,
		loadout: [weapon, undefined],
		affixes: c.noRefill === true ? { ...AFFIXES_CONFIG, shieldRefillTicks: math.huge } : AFFIXES_CONFIG,
	};
	const s = createSimState(seed, 0, 0, config);
	const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
	const target = spawnActor(ctx, archetypeIndex(c.kind), 0, TTK_START_DISTANCE, c.affix);
	if (target === undefined) error(`ttkFight: could not spawn ${c.kind}`, 0);
	const family = new Set<number>([target.kind]);
	if (c.kind === "slime") family.add(archetypeIndex("slime.small"));
	const mult = ttkHpMultiplier(f);
	const seen = new Set<number>();
	scaleNewActors(s, mult, seen);
	const hp = target.hpMax;
	const shield = s.affixes?.slots[0].shield ?? 0;
	const maxTicks = TTK_MAX_SECONDS * SIM_HZ;
	let hits = 0;
	for (let k = 0; k < maxTicks; k++) {
		const aim = c.kind === "summoner" ? (target.alive !== 0 ? target : undefined) : nearestOf(s, family);
		step(s, botFrame(s, weapon, aim), config);
		s.player.hearts = s.player.heartsMax;
		hits += s.events.playerHits;
		scaleNewActors(s, mult, seen);
		const done = c.kind === "summoner" ? target.alive === 0 : nearestOf(s, family) === undefined;
		if (done) return { seconds: (k + 1) / SIM_HZ, hitsTaken: hits, hp, shield };
	}
	return { seconds: -1, hitsTaken: hits, hp, shield };
}

/** Damage per second of the weapon used flat out on one target: the sword's full combo, or the bow's stream. */
export function ttkIdealDps(weapon: TtkWeapon): number {
	if (weapon === "weapon.bow") return (BOW_DATA.damage * SIM_HZ) / BOW_DATA.streamTicks;
	const d = SWORD_DATA;
	const cycle = 2 * d.swingRecoveryTicks + d.finisherWindupTicks + d.finisherRecoveryTicks;
	return ((2 * d.damage + d.finisherDamage) * SIM_HZ) / cycle;
}

/** One printed row: per TTK_FLOORS entry, the mean TTK over the seeds (-1 if any fight was not won) and the hits. */
export interface TtkRow {
	readonly ttkCase: TtkCase;
	readonly seconds: number[];
	readonly hitsTaken: number[];
	readonly hp: number[];
	readonly shield: number[];
}

/** Every case of `cases` at every TTK_FLOORS entry with `weapon`, over run seeds `seeds`. */
export function ttkRows(cases: ReadonlyArray<TtkCase>, weapon: TtkWeapon, seeds: ReadonlyArray<number>): TtkRow[] {
	const rows: TtkRow[] = [];
	for (const c of cases) {
		const row: TtkRow = { ttkCase: c, seconds: [], hitsTaken: [], hp: [], shield: [] };
		for (const f of TTK_FLOORS) {
			let sum = 0;
			let hits = 0;
			let failed = false;
			let hp = 0;
			let shield = 0;
			for (const seed of seeds) {
				const r = ttkFight(c, f, weapon, seed);
				if (r.seconds < 0) failed = true;
				sum += r.seconds;
				hits += r.hitsTaken;
				hp = r.hp;
				shield = r.shield;
			}
			row.seconds.push(failed ? -1 : sum / seeds.size());
			row.hitsTaken.push(hits / seeds.size());
			row.hp.push(hp);
			row.shield.push(shield);
		}
		rows.push(row);
	}
	return rows;
}

/** Par time (s) a planned member of this case adds to its room: ROOM_PAR_TICKS_PER_COST x (cost + AFFIX_PAR_COST). */
export function ttkParSeconds(c: TtkCase): number {
	const cost = encounterCost(c.kind) + (c.affix !== AffixKind.NONE ? AFFIX_PAR_COST : 0);
	return (ROOM_PAR_TICKS_PER_COST * cost) / SIM_HZ;
}

const f1 = (x: number) => (x < 0 ? "> " + TTK_MAX_SECONDS : string.format("%.1f", x));

/** The table header (Markdown). */
export function ttkHeader(): string {
	const floors = TTK_FLOORS.map((f) => `f${f.floor} (d${f.depth})`).join(" | ");
	return `| enemy | hp f1 / f20 | par share s | ${floors} | hits taken f20 |`;
}

/** One row as Markdown: TTK seconds per floor. */
export function formatTtkRow(row: TtkRow): string {
	const last = TTK_FLOORS.size() - 1;
	const shield =
		row.shield[0] > 0
			? ` (+${string.format("%.1f", row.shield[0])} / +${string.format("%.1f", row.shield[last])} shield)`
			: "";
	return (
		`| ${row.ttkCase.label} | ${string.format("%.1f", row.hp[0])} / ${string.format(
			"%.1f",
			row.hp[last],
		)}${shield} | ` +
		`${string.format("%.1f", ttkParSeconds(row.ttkCase))} | ${row.seconds.map(f1).join(" | ")} | ` +
		`${string.format("%.1f", row.hitsTaken[last])} |`
	);
}
