/**
 * Seed parity beyond the three dungeon fixtures: every game option OFF (the Dungeon Forge demo path, 42 rooms,
 * the leaf guard, the 1- / 2-wide corridor draws), every theme (ancient and grim are in no fixture: graveyards, bones,
 * candles, sarcophagi), decor 0 / 1, and more MVP seeds. Stands in for the web build's forge.parity.test.ts, which
 * compares against a verbatim copy of the original generator that is not ported.
 *
 * The REFERENCE digests were computed by running the web build's own src/dungeon/forge, src/dungeon/collision.ts,
 * src/bullets/encounter.ts + enemyRooms.ts and src/boss/spawn.ts (the web build @ 42897e2, transpiled as-is
 * under Node 25) through the same digest as below: 32-bit FNV-1a over a word stream, integers as (1, value >>> 0),
 * other numbers as (2, float64 high word, low word), booleans (4, 0 / 1), strings (3, UTF-8 length, bytes), absent
 * optional fields 0. One digest per section so a failure points at the stage.
 *
 * Trig: the reference run replaced Math.sin / Math.cos with a correctly rounded double-double sin / cos (the same
 * algorithm as forge/trig.ts), because V8's are not correctly rounded and the port cannot reproduce V8's last bit
 * (see trig.ts). With V8's own trig the web build differs from these digests only where marked: the raw scatter bits
 * sx0 / sy0 of one room (1 ulp), and for seeds 706 and 10186 the whole layout (a 1-ulp difference in a pre-separation
 * room center flips a separation tie; 2 of 20,000 MVP seeds in a Node sweep).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_ENCOUNTER,
	bossDoorSpawn,
	entranceSpawn,
	generateDungeon,
	placeEncounter,
	type Dungeon,
	type ForgeParams,
} from "shared/dungeon";
import { imul } from "shared/jsmath";

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const SECTION_END = 0xffff;
const INT_LIMIT = 2147483648;

class Fnv {
	h = FNV_OFFSET;
	w(x: number): void {
		this.h = imul(bit32.bxor(this.h, x % 4294967296), FNV_PRIME);
	}
	num(x: number | boolean): void {
		if (typeIs(x, "boolean")) {
			this.w(4);
			this.w(x ? 1 : 0);
			return;
		}
		if (math.floor(x) === x && math.abs(x) < INT_LIMIT) {
			this.w(1);
			this.w(x < 0 ? x + 4294967296 : x);
			return;
		}
		const [hi, lo] = string.unpack(">I4I4", string.pack(">d", x));
		this.w(2);
		this.w(hi as number);
		this.w(lo as number);
	}
	str(s: string): void {
		this.w(3);
		this.w(s.size());
		for (let i = 1; i <= s.size(); i++) this.w(string.byte(s, i)[0]);
	}
	opt(v: unknown): void {
		if (v === undefined) this.w(0);
		else if (typeIs(v, "string")) this.str(v);
		else this.num(v as number | boolean);
	}
	hex(): string {
		return string.format("%08x", this.h);
	}
}

function fields(h: Fnv, obj: object, keys: ReadonlyArray<string>): void {
	const o = obj as unknown as Record<string, unknown>;
	for (const k of keys) h.opt(o[k]);
}

function digest(d: Dungeon): Record<string, string> {
	const out: Record<string, string> = {};
	let h = new Fnv();
	for (const v of [d.W, d.H, d.seed, d.entrance, d.boss, d.maxDepth, d.maxBfs, d.valid]) h.num(v);
	for (const arr of [d.grid, d.roomId, d.corridor, d.doorway, d.bfs, d.lakeMask]) {
		h.w(arr.size());
		for (const v of arr) h.num(v);
	}
	out.layout = h.hex();
	h = new Fnv();
	for (const r of d.rooms)
		fields(h, r, [
			"id",
			"cx",
			"cy",
			"w",
			"h",
			"arch",
			"shape",
			"type",
			"depth",
			"difficulty",
			"degree",
			"lake",
			"grave",
		]);
	out.rooms = h.hex();
	h = new Fnv();
	for (const r of d.rooms) {
		h.num(r.sx0);
		h.num(r.sy0);
	}
	out.scatter = h.hex();
	h = new Fnv();
	for (const e of d.edges) fields(h, e, ["a", "b", "isLoop", "isCritical"]);
	out.graph = h.hex();
	h = new Fnv();
	for (const p of d.props) fields(h, p, ["kind", "x", "y", "rot", "scale", "roomId", "dx", "dy", "v", "ice"]);
	h.w(SECTION_END);
	for (const s of d.spawns) fields(h, s, ["x", "y", "tier", "roomId"]);
	h.w(SECTION_END);
	for (const t of d.torches) fields(h, t, ["x", "y", "dx", "dy"]);
	h.w(SECTION_END);
	for (const c of d.pools) fields(h, c, ["x", "y"]);
	for (const c of d.lakeCells) fields(h, c, ["x", "y"]);
	h.w(SECTION_END);
	for (const a of d.arches) fields(h, a, ["x", "y", "px", "py", "len"]);
	out.decor = h.hex();
	h = new Fnv();
	h.str(d.name);
	h.str(d.params.themeKey);
	fields(h, d.stats, ["rooms", "edges", "loops", "critLen", "floorTiles", "reach", "attempts"]);
	out.meta = h.hex();
	h = new Fnv();
	const e = placeEncounter(d, DEFAULT_ENCOUNTER);
	for (const s of e.spawns) {
		h.str(s.kind);
		h.num(s.x);
		h.num(s.z);
	}
	for (const r of e.rooms)
		fields(h, r, ["id", "type", "depth", "cx", "cz", "minX", "maxX", "minZ", "maxZ", "floorTiles"]);
	h.num(e.entranceRoom);
	h.num(e.bossRoom);
	const sp = entranceSpawn(d);
	h.num(sp.x);
	h.num(sp.z);
	const bd = bossDoorSpawn(d);
	if (bd) {
		h.num(bd.x);
		h.num(bd.z);
	} else h.w(0);
	out.encounter = h.hex();
	return out;
}

const REFERENCE: ReadonlyArray<[ForgeParams, string, Record<string, string>]> = [
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 0,
		},
		"molten",
		{
			layout: "b065f2d7",
			rooms: "57d0eca8",
			scatter: "90f86b8c",
			graph: "27db226a",
			decor: "8424b120",
			meta: "d7d5b4dd",
			encounter: "d7d603e6",
		},
	],
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 3,
		},
		"ancient",
		{
			layout: "0ffcda32",
			rooms: "16d47b86",
			scatter: "1c2cc697",
			graph: "7029ec68",
			decor: "e295060e",
			meta: "9a217a33",
			encounter: "b61a9340",
		},
	],
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 5,
		},
		"verdant",
		{
			layout: "80906cf3",
			rooms: "bd861118",
			scatter: "a61cf70e",
			graph: "b1030333",
			decor: "8d36df10",
			meta: "10798499", // check-asset-ids: allow (hash digest)
			encounter: "ad2a6232",
		},
	], // V8 trig differs: scatter
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 11,
		},
		"grim",
		{
			layout: "e3db4ddb",
			rooms: "0b09f4ea",
			scatter: "aec4386d",
			graph: "6fb7d26c",
			decor: "6eb0e3fa",
			meta: "b04798c1",
			encounter: "0835ff06",
		},
	],
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 12,
		},
		"grim",
		{
			layout: "a9f913c3",
			rooms: "39b6fb03",
			scatter: "3153ed43",
			graph: "3ab47fa2",
			decor: "f43a16bc",
			meta: "d2549e1a",
			encounter: "4846374e",
		},
	],
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 13,
		},
		"frost",
		{
			layout: "bb094e66",
			rooms: "ef948c24",
			scatter: "687cd282",
			graph: "1997e127",
			decor: "ddb5c9e3",
			meta: "92ff6c30",
			encounter: "1a496bd8",
		},
	],
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 16,
		},
		"ancient",
		{
			layout: "6659ac2b",
			rooms: "014dfb0d",
			scatter: "d87cb76c",
			graph: "9a0ded5d",
			decor: "7a1f409a",
			meta: "c334b0d3",
			encounter: "9c7447e5",
		},
	], // V8 trig differs: scatter
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 99,
		},
		"frost",
		{
			layout: "9adde106",
			rooms: "5bfa4d53",
			scatter: "59a54ec1",
			graph: "fc127b89",
			decor: "2c8b5c51",
			meta: "56e0902e",
			encounter: "2a3e96b4",
		},
	],
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 706,
		},
		"grim",
		{
			layout: "07d969c4",
			rooms: "bae9f317",
			scatter: "398042a1",
			graph: "f774d29a",
			decor: "9754949b",
			meta: "b0baca64",
			encounter: "f2f29c88",
		},
	], // V8 trig differs: layout, rooms, scatter, graph, decor, meta, encounter
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 2024,
		},
		"frost",
		{
			layout: "61a07e53",
			rooms: "3de7d879",
			scatter: "a2981452",
			graph: "174a5255",
			decor: "25a877ab",
			meta: "c02902f5",
			encounter: "15ee3363",
		},
	], // V8 trig differs: scatter
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 10186,
		},
		"frost",
		{
			layout: "c1d966ce",
			rooms: "e24e2643",
			scatter: "9f946c7e",
			graph: "6c1552e4",
			decor: "150f5000",
			meta: "541903d0",
			encounter: "d6e04007",
		},
	], // V8 trig differs: layout, rooms, graph, decor, meta, encounter
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 2147483648,
		},
		"verdant",
		{
			layout: "d2bdb5b0",
			rooms: "11520ebb",
			scatter: "2c1d7a5d",
			graph: "67328cbd",
			decor: "782dcdc9",
			meta: "2d784242",
			encounter: "2aed7796",
		},
	], // V8 trig differs: scatter
	[
		{
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: 8,
			corridorWidth: 3,
			treasureCap: 2,
			shrineCap: 1,
			seed: 4294967295,
		},
		"verdant",
		{
			layout: "42d48f82",
			rooms: "a6bbc3c3",
			scatter: "d2fb399a",
			graph: "ddff7d35",
			decor: "34c5654c",
			meta: "12a67a93",
			encounter: "8218ca53",
		},
	],
	[
		{ roomCount: 42, loopChance: 0.15, decorDensity: 0.6, themeKey: "auto", seed: 1 },
		"molten",
		{
			layout: "fae4bc81",
			rooms: "4c74edbc",
			scatter: "35493c37",
			graph: "9191c57a",
			decor: "df110bcd",
			meta: "f249b28f",
			encounter: "03872b2a",
		},
	], // V8 trig differs: scatter
	[
		{ roomCount: 42, loopChance: 0.15, decorDensity: 0.6, themeKey: "auto", seed: 2 },
		"molten",
		{
			layout: "f88fd7e4",
			rooms: "3480825e",
			scatter: "7ad9fa8e",
			graph: "f2ddb6c1",
			decor: "dda1c2c4",
			meta: "7470fdeb",
			encounter: "8d1d443f",
		},
	],
	[
		{ roomCount: 42, loopChance: 0.15, decorDensity: 0.6, themeKey: "auto", seed: 3 },
		"ancient",
		{
			layout: "46da804a",
			rooms: "0ef237ed",
			scatter: "231933c6",
			graph: "43d011a8",
			decor: "483833c6",
			meta: "8b04de33",
			encounter: "75f25202",
		},
	], // V8 trig differs: scatter
	[
		{ roomCount: 42, loopChance: 0.15, decorDensity: 0.6, themeKey: "auto", seed: 11 },
		"grim",
		{
			layout: "8f38fb82",
			rooms: "fbeedaf7",
			scatter: "a1f95a8c",
			graph: "babe83b7",
			decor: "4723f53c",
			meta: "cf15dcce",
			encounter: "ed0a132e",
		},
	], // V8 trig differs: scatter
	[
		{ roomCount: 42, loopChance: 0.15, decorDensity: 0.6, themeKey: "auto", seed: 13 },
		"frost",
		{
			layout: "69e129ca",
			rooms: "afada369",
			scatter: "296f22bc",
			graph: "bcfbe657",
			decor: "a19c24c9",
			meta: "00854d89",
			encounter: "552797b1",
		},
	], // V8 trig differs: scatter
	[
		{ roomCount: 42, loopChance: 0.15, decorDensity: 0.6, themeKey: "auto", seed: 42 },
		"molten",
		{
			layout: "6b8f63a6",
			rooms: "417a807a",
			scatter: "c6c814dc",
			graph: "8cc46fda",
			decor: "a6c6ba3b",
			meta: "ac4840f6",
			encounter: "4860c76c",
		},
	], // V8 trig differs: scatter
	[
		{ roomCount: 42, loopChance: 0.15, decorDensity: 0.6, themeKey: "auto", seed: 1337 },
		"frost",
		{
			layout: "58e8cf26",
			rooms: "169daf7d",
			scatter: "a8560f7b",
			graph: "8f92394a",
			decor: "872246cb",
			meta: "1e3ebd8a",
			encounter: "776c7cb8",
		},
	],
	[
		{ seed: 77, roomCount: 24, loopChance: 0.2, decorDensity: 1, themeKey: "ancient" },
		"ancient",
		{
			layout: "02fe57f8",
			rooms: "f9cf327e",
			scatter: "fb77bc72",
			graph: "a24bfd10",
			decor: "072312dc",
			meta: "827d23b0",
			encounter: "1b718860",
		},
	], // V8 trig differs: scatter
	[
		{ seed: 3, roomCount: 12, loopChance: 0.5, decorDensity: 0, themeKey: "ancient" },
		"ancient",
		{
			layout: "ada31942",
			rooms: "0f3af7b9",
			scatter: "1c2cc697",
			graph: "c04bc961",
			decor: "86aa9acd",
			meta: "0d70df30",
			encounter: "701ba61c",
		},
	],
	[
		{ seed: 77, roomCount: 24, loopChance: 0.2, decorDensity: 1, themeKey: "molten" },
		"molten",
		{
			layout: "c8249b94",
			rooms: "f9cf327e",
			scatter: "fb77bc72",
			graph: "a24bfd10",
			decor: "88f435ef",
			meta: "71978c6b",
			encounter: "ccad240e",
		},
	], // V8 trig differs: scatter
	[
		{ seed: 3, roomCount: 12, loopChance: 0.5, decorDensity: 0, themeKey: "molten" },
		"molten",
		{
			layout: "04f06657",
			rooms: "0f3af7b9",
			scatter: "1c2cc697",
			graph: "c04bc961",
			decor: "78ab52ab",
			meta: "8d545817",
			encounter: "91678c38",
		},
	],
	[
		{ seed: 77, roomCount: 24, loopChance: 0.2, decorDensity: 1, themeKey: "frost" },
		"frost",
		{
			layout: "701f5b03",
			rooms: "12b19d18",
			scatter: "fb77bc72",
			graph: "a24bfd10",
			decor: "a8e0fcfe",
			meta: "2a157d31",
			encounter: "1b718860",
		},
	], // V8 trig differs: scatter
	[
		{ seed: 3, roomCount: 12, loopChance: 0.5, decorDensity: 0, themeKey: "frost" },
		"frost",
		{
			layout: "339d3d22",
			rooms: "ae5b1629",
			scatter: "1c2cc697",
			graph: "c04bc961",
			decor: "1c240585",
			meta: "09b76a1f",
			encounter: "701ba61c",
		},
	],
	[
		{ seed: 77, roomCount: 24, loopChance: 0.2, decorDensity: 1, themeKey: "grim" },
		"grim",
		{
			layout: "6e655a01",
			rooms: "220f4b59",
			scatter: "fb77bc72",
			graph: "a24bfd10",
			decor: "c8d00593",
			meta: "e69f6b95",
			encounter: "445b4e6d",
		},
	], // V8 trig differs: scatter
	[
		{ seed: 3, roomCount: 12, loopChance: 0.5, decorDensity: 0, themeKey: "grim" },
		"grim",
		{
			layout: "224a5ac2",
			rooms: "b55b19c8",
			scatter: "1c2cc697",
			graph: "c04bc961",
			decor: "fa1a8d65",
			meta: "1f892f4b",
			encounter: "0f8967cb",
		},
	],
	[
		{ seed: 77, roomCount: 24, loopChance: 0.2, decorDensity: 1, themeKey: "verdant" },
		"verdant",
		{
			layout: "9daf63b2",
			rooms: "f9cf327e",
			scatter: "fb77bc72",
			graph: "a24bfd10",
			decor: "ac6abf0a",
			meta: "5dd47dd3",
			encounter: "9f73cba1",
		},
	], // V8 trig differs: scatter
	[
		{ seed: 3, roomCount: 12, loopChance: 0.5, decorDensity: 0, themeKey: "verdant" },
		"verdant",
		{
			layout: "efd3242f",
			rooms: "0f3af7b9",
			scatter: "1c2cc697",
			graph: "c04bc961",
			decor: "c13f31ae",
			meta: "1b76a721",
			encounter: "8bc58bc8",
		},
	],
];

describe("Dungeon Forge seed parity: web-build digests (demo path, every theme, more MVP seeds)", () => {
	REFERENCE.forEach(([params, theme, want], i) => {
		it(`case ${i}: seed ${params.seed}, ${params.roomCount} rooms, theme ${
			params.themeKey ?? "auto"
		} -> ${theme}`, () => {
			const d = generateDungeon(params);
			expect(d.params.themeKey).toBe(theme);
			expect(digest(d)).toEqual(want);
		});
	});
});
