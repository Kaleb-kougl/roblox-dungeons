/**
 * The secret room census (docs/SECRET_ROOMS.md SR1, numbers recorded there), shared by its shard specs
 * (secrets.census.<n>.spec.ts): run seeds x floors SECRET_CENSUS.first..last, solo and a party of 3, each floor built as
 * every endless world builds it (vaults, modifiers, secrets; no unlock floors since docs/DAILY.md DSD18). Only the floors
 * whose chance draw hits are built (a miss has no secret by the first rule, which secrets.spec pins), so the candidate
 * set (which never depends on the draw) is sampled on a random quarter of the floors. Tallied per depth band: floors,
 * chance hits, hits with no candidate (the real rate's loss), candidates per hit floor, the picked chamber sizes, tiers,
 * facings, boss floors with a secret, and crack rooms with a planned Charger (the Archer's third key). Test support only.
 *
 * @module
 */
import {
	EncounterRng,
	FLOOR_MODIFIER_WORLD_ALL,
	SECRET,
	buildEndlessFloor,
	floorSeed,
	generateDungeon,
	isBossFloor,
	secretCandidates,
	secretSeed,
	type Dungeon,
	type EndlessFloorLayout,
	type EndlessFloorOptions,
	type ForgeParams,
	type SecretFloorInput,
} from "shared/dungeon";

export const SECRET_CENSUS = {
	/** Run seeds 1..runs over all shards (the plan's 1-60). */
	runs: 60,
	shards: 4,
	first: 2,
	last: 30,
	parties: [1, 3],
	/** Depth bands of the report (first floor of each). */
	bands: [2, 5, 10, 20],
	/** The quick sample without --census: this many run seeds of the shard, floors first..quickLast. */
	quickRuns: 2,
	quickLast: 10,
} as const;

/** The world options every endless world builds with (shared/run endlessRunFloor), secrets on. */
const OPTIONS: EndlessFloorOptions = {
	vaults: true,
	unlockFloors: false,
	modifiers: FLOOR_MODIFIER_WORLD_ALL,
	secrets: true,
};

export interface SecretCensusBand {
	floors: number;
	hits: number;
	/** Hits whose floor has no candidate (no secret). */
	empty: number;
	secrets: number;
	candidates: number;
	minCandidates: number;
	maxCandidates: number;
}

export interface SecretCensus {
	readonly party: number;
	readonly bands: SecretCensusBand[];
	/** Picked chamber sizes, "along x depth" -> count. */
	readonly sizes: Map<string, number>;
	/** VaultTier -> count. */
	readonly tiers: Map<number, number>;
	/** "fx,fz" -> count. */
	readonly facings: Map<string, number>;
	bossFloors: number;
	chargerRooms: number;
	eliteRooms: number;
}

function bandOf(floor: number): number {
	let out = 0;
	for (let i = 0; i < SECRET_CENSUS.bands.size(); i++) if (floor >= SECRET_CENSUS.bands[i]) out = i;
	return out;
}

function bump<K>(m: Map<K, number>, k: K): void {
	m.set(k, (m.get(k) ?? 0) + 1);
}

function inputOf(l: EndlessFloorLayout): SecretFloorInput {
	const pieces = [...(l.breakables ?? [])];
	if (l.secret !== undefined) while (pieces.size() > l.secret.crackSlot) pieces.pop();
	return { ...l, pieces, vault: l.vault, pactAltars: l.pactAltars };
}

/** The census over run seeds firstRun..lastRun, floors SECRET_CENSUS.first..`last`, for a party of `party`. */
export function secretCensus(
	firstRun: number,
	lastRun: number,
	party: number,
	last: number = SECRET_CENSUS.last,
	dungeons: Map<string, Dungeon> = new Map(),
): SecretCensus {
	const dungeonFor = (params: ForgeParams): Dungeon => {
		const key = `${params.seed}/${params.roomCount}`;
		let d = dungeons.get(key);
		if (d === undefined) {
			d = generateDungeon(params);
			dungeons.set(key, d);
		}
		return d;
	};
	const c: SecretCensus = {
		party,
		bands: SECRET_CENSUS.bands.map(() => ({
			floors: 0,
			hits: 0,
			empty: 0,
			secrets: 0,
			candidates: 0,
			minCandidates: math.huge,
			maxCandidates: 0,
		})),
		sizes: new Map(),
		tiers: new Map(),
		facings: new Map(),
		bossFloors: 0,
		chargerRooms: 0,
		eliteRooms: 0,
	};
	for (let run = firstRun; run <= lastRun; run++)
		for (let floor = SECRET_CENSUS.first; floor <= last; floor++) {
			const band = c.bands[bandOf(floor)];
			band.floors++;
			const hit = new EncounterRng(secretSeed(floorSeed(run, floor))).int(0, SECRET.percentRange - 1);
			if (hit >= SECRET.chancePercent) continue;
			band.hits++;
			const l = buildEndlessFloor(run, floor, dungeonFor, party, OPTIONS);
			const n = secretCandidates(inputOf(l)).size();
			band.candidates += n;
			band.minCandidates = math.min(band.minCandidates, n);
			band.maxCandidates = math.max(band.maxCandidates, n);
			const s = l.secret;
			if (s === undefined) {
				if (n !== 0)
					error(`secret census: run ${run} floor ${floor}: a hit with ${n} candidates placed none`, 0);
				band.empty++;
				continue;
			}
			band.secrets++;
			bump(c.sizes, `${s.along}x${s.depth}`);
			bump(c.tiers, s.tier);
			bump(c.facings, `${s.fx},${s.fz}`);
			if (isBossFloor(floor)) c.bossFloors++;
			if (l.encounter.rooms[s.room].type === "elite") c.eliteRooms++;
			for (const sp of l.roomSpawns[s.room] ?? [])
				if (sp.kind === "charger") {
					c.chargerRooms++;
					break;
				}
		}
	return c;
}

function pct(n: number, of: number): string {
	return of > 0 ? string.format("%.1f", (n * 100) / of) : "-";
}

function mapLine<K>(m: Map<K, number>): string {
	const parts: string[] = [];
	for (const [k, v] of m) parts.push(`${tostring(k)} ${v}`);
	parts.sort();
	return parts.join(", ");
}

/** The census as printable lines (a raw line per band for summing shards). */
export function secretCensusLines(c: SecretCensus, label: string): string[] {
	const out: string[] = [];
	let floors = 0;
	let hits = 0;
	let secrets = 0;
	for (let i = 0; i < c.bands.size(); i++) {
		const b = c.bands[i];
		floors += b.floors;
		hits += b.hits;
		secrets += b.secrets;
		const from = SECRET_CENSUS.bands[i];
		out.push(
			`[secrets] ${label} party ${c.party} floors ${from}+: ${b.floors} floors, hits ${b.hits} (${pct(
				b.hits,
				b.floors,
			)} %), no candidate ${b.empty}, secrets ${b.secrets} (${pct(
				b.secrets,
				b.floors,
			)} % of floors), candidates/hit ${b.hits > 0 ? string.format("%.1f", b.candidates / b.hits) : "-"} (min ${
				b.hits > 0 ? b.minCandidates : "-"
			}, max ${b.maxCandidates})`,
		);
		out.push(
			`[secrets:raw] ${label} p${c.party} b${from} ${b.floors} ${b.hits} ${b.empty} ${b.secrets} ${
				b.candidates
			} ${b.hits > 0 ? b.minCandidates : -1} ${b.maxCandidates}`,
		);
	}
	out.push(
		`[secrets] ${label} party ${c.party} all: ${floors} floors, ${secrets} secrets (${pct(
			secrets,
			floors,
		)} %), ${pct(secrets, hits)} % of hits; sizes ${mapLine(c.sizes)}; tiers ${mapLine(c.tiers)}; facings ${mapLine(
			c.facings,
		)}; boss floors ${c.bossFloors}; elite rooms ${c.eliteRooms}; Charger rooms ${c.chargerRooms} (${pct(
			c.chargerRooms,
			secrets,
		)} %)`,
	);
	return out;
}

/** Secret floors over every band. */
export function secretCensusTotals(c: SecretCensus): { floors: number; hits: number; empty: number; secrets: number } {
	let floors = 0;
	let hits = 0;
	let empty = 0;
	let secrets = 0;
	for (const b of c.bands) {
		floors += b.floors;
		hits += b.hits;
		empty += b.empty;
		secrets += b.secrets;
	}
	return { floors, hits, empty, secrets };
}
