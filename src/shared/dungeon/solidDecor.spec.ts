// Solid decor and room themes on endless floors (ForgeParams.solidDecor, docs/DECOR.md "Solid decor", "Room themes"):
// set pieces become WALL from their own stream, so every other piece of the floor is the option-off one; the floor
// stays one piece, no piece makes a new pinch, nothing but the door braziers stands by a doorway, and M1 and the
// tutorial have none. Kenney decor's pieces (docs/KENNEY_DECOR.md KN5-KN8): library v2, mess halls, store stock.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	RoomType,
	SOLID_DECOR,
	TileType,
	buildEndlessFloor,
	endlessFloorParams,
	generateDungeon,
	tileAt,
	type Dungeon,
	type ForgeParams,
} from "shared/dungeon";

const RUNS = 12;
const FLOORS = 6;

/** Pieces whose (fx, fz) is their long axis, not a facing off a wall: free-standing. */
const AXIS_KINDS = ["studyTable", "display", "fallenShelf"];
/** Free-standing pieces: clearTiles of floor of their room all round, on no carpet, doorTiles from every doorway. */
const FREE_KINDS = ["studyTable", "display", "fallenShelf", "diningTable"];
/** A storeroom's stock (a barrel stack also stands in mess halls). */
const STORE_KINDS = ["barrelStack", "crateStack", "lumber", "barrelHeap", "stockpile"];

interface Pair {
	readonly off: Dungeon;
	readonly on: Dungeon;
}

const onOff: Pair[] = [];
for (let run = 1; run <= RUNS; run++)
	for (let floor = 1; floor <= FLOORS; floor++) {
		const params = endlessFloorParams(run * 7919, floor);
		onOff.push({ off: generateDungeon({ ...params, solidDecor: false }), on: generateDungeon(params) });
	}

/** Every FLOOR cell reachable from the entrance centre over FLOOR (4-neighbour), computed here independently. */
function connected(d: Dungeon): boolean {
	const e = d.rooms[d.entrance];
	const start = e.cy * d.W + e.cx;
	const seen = new Set<number>([start]);
	const queue = [start];
	let head = 0;
	while (head < queue.size()) {
		const c = queue[head++];
		const x = c % d.W;
		const y = (c - x) / d.W;
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			if (tileAt(d, x + dx, y + dy) !== TileType.FLOOR) continue;
			const n = (y + dy) * d.W + x + dx;
			if (seen.has(n)) continue;
			seen.add(n);
			queue.push(n);
		}
	}
	let floor = 0;
	for (const t of d.grid) if (t === TileType.FLOOR) floor++;
	return seen.size() === floor;
}

describe("solidDecor (Forge option)", () => {
	it("is on for endless floors only: M1 and the tutorial's Forge params leave it off", () => {
		expect(endlessFloorParams(1337, 1).solidDecor).toBe(true);
		expect((KALEB_VALE_MVP_PARAMS as ForgeParams).solidDecor).toBe(undefined);
		expect(generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 }).solidDecor).toEqual([]);
	});

	it("changes nothing but its own cells: props, spawns, torches, rooms, the name and every other cell match", () => {
		// (and the solid pillars a free-standing piece cleared, docs/BOOKSHELVES.md, docs/KENNEY_DECOR.md: WALL pillar
		// cells of a library or a mess hall on the option-off floor, FLOOR now or under a piece; their props stay in
		// `props`)
		let pieces = 0;
		for (const { off, on } of onOff) {
			expect(on.name).toBe(off.name);
			expect(on.props).toEqual(off.props);
			expect(on.spawns).toEqual(off.spawns);
			expect(on.torches).toEqual(off.torches);
			expect(on.rooms).toEqual(off.rooms);
			const own = new Set<number>();
			for (const p of on.solidDecor)
				for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) own.add(y * on.W + x);
			const themes = on.roomThemes ?? [];
			for (const cp of on.clearedPillars ?? []) {
				const c = cp.y * on.W + cp.x;
				const pillar = off.props.some((pr) => pr.kind === "pillar" && pr.x === cp.x && pr.y === cp.y);
				const theme = themes[off.roomId[c]];
				expect([cp.x, cp.y, pillar, off.grid[c], theme === "library" || theme === "mess"]).toEqual([
					cp.x,
					cp.y,
					true,
					TileType.WALL,
					true,
				]);
				if (!own.has(c)) expect([cp.x, cp.y, on.grid[c]]).toEqual([cp.x, cp.y, TileType.FLOOR]);
				own.add(c);
			}
			let other = 0;
			for (let c = 0; c < on.grid.size(); c++) if (!own.has(c) && on.grid[c] !== off.grid[c]) other++;
			expect(other).toBe(0);
			pieces += on.solidDecor.size();
		}
		expect(pieces).toBeGreaterThan(onOff.size()); // a few per floor
	});

	it("walls only open floor of each piece's own room, by theme, and leaves the floor in one piece", () => {
		const problems: string[] = [];
		const kindsByType: Record<string, ReadonlyArray<string>> = {
			[RoomType.BOSS]: ["throne", "candelabrum", "brazier"],
			[RoomType.ENTRANCE]: ["brazier"],
			[RoomType.SHRINE]: ["statue", "candelabrum"],
			[RoomType.COMBAT]: [
				"tomb",
				"candelabrum",
				"statue",
				"bookcase",
				"studyTable",
				"display",
				"lectern",
				"fallenShelf",
				"diningTable",
				...STORE_KINDS,
			],
			[RoomType.ELITE]: [
				"tomb",
				"candelabrum",
				"statue",
				"bookcase",
				"studyTable",
				"display",
				"lectern",
				"fallenShelf",
				"diningTable",
				...STORE_KINDS,
			],
		};
		const counts = new Map<string, number>();
		for (const { off, on } of onOff) {
			// a reading area may stand on solid pillars it cleared (docs/BOOKSHELVES.md)
			const cleared = new Set<number>();
			for (const cp of on.clearedPillars ?? []) cleared.add(cp.y * on.W + cp.x);
			expect(on.valid).toBe(true);
			expect(connected(on)).toBe(true);
			expect(on.stats.reach).toBe(on.stats.floorTiles);
			expect((on.roomThemes ?? []).size()).toBe(on.rooms.size());
			// the re-flood never fires (it would take every piece back, keeping the themes)
			expect(on.solidDecor.size()).toBeGreaterThan(0);
			for (const p of on.solidDecor) {
				const room = on.rooms[p.room];
				counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
				if (!(kindsByType[room.type] ?? []).includes(p.kind)) problems.push(`${p.kind} in ${room.type}`);
				for (let y = p.y; y < p.y + p.h; y++)
					for (let x = p.x; x < p.x + p.w; x++) {
						const c = y * on.W + x;
						if ((off.grid[c] !== TileType.FLOOR && !cleared.has(c)) || off.roomId[c] !== p.room)
							problems.push(`${x},${y} not floor`);
						if (on.grid[c] !== TileType.WALL) problems.push(`${x},${y} not walled`);
					}
				// near a doorway: only the door braziers, which flank an opening (a doorway cell diagonal to them)
				const dr = p.kind === "brazier" ? 0 : SOLID_DECOR.doorTiles;
				for (let y = p.y - dr; y < p.y + p.h + dr; y++)
					for (let x = p.x - dr; x < p.x + p.w + dr; x++)
						if (x >= 0 && y >= 0 && x < on.W && y < on.H && on.doorway[y * on.W + x] !== 0)
							problems.push(`${p.kind} ${x},${y} doorway`);
				if (p.kind === "brazier") {
					let flank = false;
					for (let y = p.y - 1; y <= p.y + 1; y++)
						for (let x = p.x - 1; x <= p.x + 1; x++) if (on.doorway[y * on.W + x] !== 0) flank = true;
					if (!flank) problems.push(`brazier ${p.x},${p.y} flanks no doorway`);
				}
				// flush: every cell behind a wall-attached piece's back row is solid (a study table's, display case's or
				// toppled case's (fx, fz) is its long axis)
				if ((p.fx !== 0 || p.fz !== 0) && !AXIS_KINDS.includes(p.kind)) {
					const n = p.fx !== 0 ? p.h : p.w;
					for (let k = 0; k < n; k++) {
						const bx = p.fx === 1 ? p.x - 1 : p.fx === -1 ? p.x + p.w : p.x + k;
						const by = p.fx !== 0 ? p.y + k : p.fz === 1 ? p.y - 1 : p.y + p.h;
						if (tileAt(on, bx, by) === TileType.FLOOR) problems.push(`${p.kind} ${p.x},${p.y} not flush`);
					}
				}
			}
		}
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		const line: string[] = [];
		counts.forEach((v, k) => line.push(`${k} ${string.format("%.1f", v / onOff.size())}`));
		print(`[solid decor] ${onOff.size()} floors, per floor: ${line.join(", ")}`);
		for (const k of [
			"tomb",
			"candelabrum",
			"throne",
			"statue",
			"brazier",
			"bookcase",
			"studyTable",
			"display",
			"lectern",
			"fallenShelf",
			"diningTable",
			...STORE_KINDS,
		])
			expect([k, (counts.get(k) ?? 0) > 0]).toEqual([k, true]);
		// the reading line is gone (docs/KENNEY_DECOR.md KND12)
		expect([counts.get("table") ?? 0, counts.get("chair") ?? 0]).toEqual([0, 0]);
	});

	it("makes no new pinch: a floor cell walled in on two opposite sides by a piece was not so before", () => {
		// (the one exception by design: a free-standing tomb's candle stands one floor cell past its ends)
		const problems: string[] = [];
		for (const { off, on } of onOff) {
			const pieceAt = new Map<number, number>();
			on.solidDecor.forEach((p, i) => {
				for (let y = p.y; y < p.y + p.h; y++)
					for (let x = p.x; x < p.x + p.w; x++) pieceAt.set(y * on.W + x, i);
			});
			const freeCandle = (c: number | undefined) => {
				if (c === undefined) return false;
				const p = on.solidDecor[c];
				return p.kind === "candelabrum" && p.fx === 0 && p.fz === 0;
			};
			const tomb = (c: number | undefined) => c !== undefined && on.solidDecor[c].kind === "tomb";
			for (let y = 1; y < on.H - 1; y++)
				for (let x = 1; x < on.W - 1; x++) {
					const c = y * on.W + x;
					if (on.grid[c] !== TileType.FLOOR) continue;
					for (const [dx, dy] of [
						[1, 0],
						[0, 1],
					]) {
						const a = c - dy * on.W - dx;
						const b = c + dy * on.W + dx;
						if (on.grid[a] === TileType.FLOOR || on.grid[b] === TileType.FLOOR) continue;
						if (off.grid[a] !== TileType.FLOOR && off.grid[b] !== TileType.FLOOR) continue; // pinched already
						const pa = pieceAt.get(a);
						const pb = pieceAt.get(b);
						if (pa === undefined && pb === undefined) continue;
						if ((freeCandle(pa) && tomb(pb)) || (freeCandle(pb) && tomb(pa))) continue;
						problems.push(`${x},${y}`);
					}
				}
		}
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
	});

	it("gives every room a theme by its type; the boss room's carpet lies on its floor in front of the throne", () => {
		const problems: string[] = [];
		let thrones = 0;
		let carpets = 0;
		let runners = 0;
		for (const { on } of onOff) {
			const themes = on.roomThemes ?? [];
			for (const r of on.rooms) {
				const t = themes[r.id];
				const want =
					r.id === on.boss
						? ["throne"]
						: r.type === RoomType.ENTRANCE
						? ["entrance"]
						: r.type === RoomType.SHRINE
						? ["shrine"]
						: r.type === RoomType.COMBAT || r.type === RoomType.ELITE
						? r.lake === true
							? ["none"]
							: r.grave === true
							? ["crypt"]
							: ["crypt", "hall", "store", "plain", "library", "mess"]
						: ["none"];
				if (!want.includes(t)) problems.push(`room ${r.id} ${r.type} theme ${t}`);
			}
			const throne = on.solidDecor.find((p) => p.kind === "throne");
			if (throne !== undefined) thrones++;
			for (const cp of on.carpets ?? []) {
				// a library's runner (1 wide): the library case checks it
				if (math.min(cp.w, cp.h) === 1 && themes[cp.room] === "library") {
					runners++;
					continue;
				}
				carpets++;
				if (throne === undefined || cp.room !== throne.room) problems.push("carpet without its throne");
				if (cp.fx !== throne?.fx || cp.fz !== throne?.fz) problems.push("carpet not along the throne's facing");
				for (let y = cp.y; y < cp.y + cp.h; y++)
					for (let x = cp.x; x < cp.x + cp.w; x++) {
						const c = y * on.W + x;
						if (on.grid[c] !== TileType.FLOOR || on.roomId[c] !== cp.room)
							problems.push(`carpet ${x},${y}`);
					}
				if ((cp.fx !== 0 ? cp.w : cp.h) % 2 !== 0) problems.push("carpet of odd length");
			}
		}
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		// every boss room of the census fits its throne
		expect(thrones).toBe(onOff.size());
		expect(carpets).toBe(thrones);
		expect(runners).toBeGreaterThan(0);
	});

	it("stands bookcases 1 x 1 on far walls only, in library and hall rooms, nothing walkable behind, no torch or banner behind", () => {
		const problems: string[] = [];
		let libraries = 0;
		let libraryCases = 0;
		let hallCases = 0;
		let runs = 0;
		for (const { on } of onOff) {
			const themes = on.roomThemes ?? [];
			const hung = new Set<number>();
			for (const t of on.torches) hung.add(t.y * on.W + t.x);
			for (const p of on.props) if (p.kind === "banner") hung.add(p.y * on.W + p.x);
			const caseAt = new Set<number>();
			for (const p of on.solidDecor) {
				if (p.kind !== "bookcase") continue;
				caseAt.add(p.y * on.W + p.x);
				const theme = themes[p.room];
				if (theme === "library") libraryCases++;
				else if (theme === "hall") hallCases++;
				else problems.push(`bookcase in a ${theme} room`);
				if (p.w !== 1 || p.h !== 1) problems.push(`bookcase ${p.w} x ${p.h}`);
				if (!((p.fx === 1 && p.fz === 0) || (p.fx === 0 && p.fz === 1)))
					problems.push(`bookcase ${p.x},${p.y} faces ${p.fx},${p.fz}`);
				for (let d = 1; d <= SOLID_DECOR.bookcase.backTiles; d++) {
					const t = tileAt(on, p.x - p.fx * d, p.y - p.fz * d);
					if (t === TileType.FLOOR || t === TileType.POOL)
						problems.push(`bookcase ${p.x},${p.y} floor behind`);
				}
				if (hung.has((p.y - p.fz) * on.W + p.x - p.fx))
					problems.push(`bookcase ${p.x},${p.y} hides a wall piece`);
			}
			// a run: a case with no case right before it along its wall
			for (const p of on.solidDecor) {
				if (p.kind !== "bookcase") continue;
				const px = p.fx !== 0 ? p.x : p.x - 1;
				const py = p.fx !== 0 ? p.y - 1 : p.y;
				if (!caseAt.has(py * on.W + px)) runs++;
			}
			for (const r of on.rooms)
				if (themes[r.id] === "library") {
					libraries++;
					// a room where no run fits is dressed as plain instead: every library has its shelves
					if (!on.solidDecor.some((p) => p.kind === "bookcase" && p.room === r.id))
						problems.push(`library ${r.id} without a bookcase`);
				}
		}
		const n = onOff.size();
		print(
			`[bookcases] ${n} floors, per floor: ${string.format("%.2f", libraries / n)} libraries, ` +
				`${string.format("%.1f", libraryCases / n)} library cases, ${string.format(
					"%.1f",
					hallCases / n,
				)} hall ` +
				`cases, ${string.format("%.1f", runs / n)} runs (${string.format(
					"%.1f",
					(libraryCases + hallCases) / math.max(runs, 1),
				)} cases a run)`,
		);
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		expect(libraryCases).toBeGreaterThan(0);
		expect(hallCases).toBeGreaterThan(0);
	});

	it("sets a reading area in libraries: a 2 x 2 study table along the first run, free-standing, clearing pillars", () => {
		const R = SOLID_DECOR.reading;
		const ct = SOLID_DECOR.clearTiles;
		const dr = SOLID_DECOR.doorTiles;
		const problems: string[] = [];
		let libraries = 0;
		let reading = 0;
		let clearedTotal = 0;
		let laterOnCleared = 0;
		const offs = new Map<number, number>();
		for (const { off, on } of onOff) {
			const themes = on.roomThemes ?? [];
			const pieces = on.solidDecor;
			const pillarCell = new Set<number>();
			for (const pr of off.props)
				if (pr.kind === "pillar" && off.grid[pr.y * off.W + pr.x] === TileType.WALL)
					pillarCell.add(pr.y * off.W + pr.x);
			const cleared = new Set<number>();
			for (const cp of on.clearedPillars ?? []) cleared.add(cp.y * on.W + cp.x);
			clearedTotal += cleared.size();
			for (const p of pieces) {
				if (p.kind === "table" || p.kind === "chair") problems.push(`${p.kind}: the reading line is gone`);
				if (p.kind === "studyTable" && themes[p.room] !== "library")
					problems.push(`study table in a ${themes[p.room]} room`);
			}
			for (const r of on.rooms) {
				if (themes[r.id] !== "library") continue;
				libraries++;
				const own: number[] = [];
				pieces.forEach((p, i) => {
					if (p.room === r.id) own.push(i);
				});
				const firstCase = own.find((i) => pieces[i].kind === "bookcase");
				if (firstCase === undefined) continue; // checked by the bookcase case
				// the first run's wall direction: a case facing +X stands on a wall along Z
				const alongX = pieces[firstCase].fx === 0;
				// the reading area is placed right after the runs (bookcases and their candles); a second study table
				// comes after the lectern
				const afterRuns = own.find((i) => pieces[i].kind !== "bookcase" && pieces[i].kind !== "candelabrum");
				const tableIdx =
					afterRuns !== undefined && pieces[afterRuns].kind === "studyTable" ? afterRuns : undefined;
				const readingAt = afterRuns ?? math.huge;
				const blocked = new Set<number>();
				for (const i of own)
					if (i < readingAt) {
						const p = pieces[i];
						for (let y = p.y; y < p.y + p.h; y++)
							for (let x = p.x; x < p.x + p.w; x++) blocked.add(y * on.W + x);
					}
				// open: floor of the room before the reading area, or one of its solid pillars (clearable)
				const open = (x: number, y: number) =>
					x >= 0 &&
					y >= 0 &&
					x < on.W &&
					y < on.H &&
					(off.grid[y * on.W + x] === TileType.FLOOR || pillarCell.has(y * on.W + x)) &&
					off.roomId[y * on.W + x] === r.id &&
					!blocked.has(y * on.W + x);
				/** Chebyshev, cell to cell, from the table at (x, y) to the room's nearest bookcase. */
				const nearest = (x: number, y: number, w: number, h: number) => {
					let near = math.huge;
					for (const i of own) {
						const p = pieces[i];
						if (p.kind !== "bookcase") continue;
						const d = math.max(
							math.max(x - p.x, p.x - (x + w - 1), 0),
							math.max(y - p.y, p.y - (y + h - 1), 0),
						);
						near = math.min(near, d);
					}
					return near;
				};
				const n = R.tableSize;
				const fits = (x: number, y: number, own4: Set<number>) => {
					if (nearest(x, y, n, n) > R.maxDist) return false;
					for (let yy = y - ct; yy < y + n + ct; yy++)
						for (let xx = x - ct; xx < x + n + ct; xx++)
							if (!open(xx, yy) && !own4.has(yy * on.W + xx)) return false;
					for (let yy = y - dr; yy < y + n + dr; yy++)
						for (let xx = x - dr; xx < x + n + dr; xx++)
							if (xx >= 0 && yy >= 0 && xx < on.W && yy < on.H && on.doorway[yy * on.W + xx] !== 0)
								return false;
					return true;
				};
				if (tableIdx === undefined) {
					// no spot fits: every 2 x 2 spot lacks its ring, is by a door or too far from the shelves
					let [bx0, by0, bx1, by1] = [on.W, on.H, -1, -1];
					for (let c = 0; c < on.grid.size(); c++)
						if (off.roomId[c] === r.id) {
							const x = c % on.W;
							const y = (c - x) / on.W;
							bx0 = math.min(bx0, x);
							by0 = math.min(by0, y);
							bx1 = math.max(bx1, x);
							by1 = math.max(by1, y);
						}
					let spot: string | undefined;
					for (let y = by0; y <= by1 && spot === undefined; y++)
						for (let x = bx0; x <= bx1 && spot === undefined; x++)
							if (fits(x, y, new Set())) spot = `${x},${y}`;
					if (spot !== undefined) problems.push(`library ${r.id}: no reading area, but ${spot} fits`);
					continue;
				}
				reading++;
				const t = pieces[tableIdx];
				if (t.w !== n || t.h !== n) problems.push(`study table ${t.x},${t.y} ${t.w} x ${t.h}`);
				if (t.fx !== (alongX ? 1 : 0) || t.fz !== (alongX ? 0 : 1))
					problems.push(
						`study table ${t.x},${t.y} along ${t.fx},${t.fz} (first run along ${alongX ? "X" : "Z"})`,
					);
				const own4 = new Set<number>();
				for (let yy = t.y; yy < t.y + n; yy++) for (let xx = t.x; xx < t.x + n; xx++) own4.add(yy * on.W + xx);
				if (!fits(t.x, t.y, own4))
					problems.push(`reading area ${t.x},${t.y} without its ring, by a door or too far from the shelves`);
				// exactly the solid pillars under it and its ring were cleared (floor again, unless a later piece of the
				// room stands there now)
				const later = new Set<number>();
				for (const i of own)
					if (i > tableIdx) {
						const p = pieces[i];
						for (let yy = p.y; yy < p.y + p.h; yy++)
							for (let xx = p.x; xx < p.x + p.w; xx++) {
								later.add(yy * on.W + xx);
								if (cleared.has(yy * on.W + xx)) laterOnCleared++;
							}
					}
				for (let yy = t.y - ct; yy < t.y + n + ct; yy++)
					for (let xx = t.x - ct; xx < t.x + n + ct; xx++) {
						const c = yy * on.W + xx;
						if (!pillarCell.has(c) || off.roomId[c] !== r.id) continue;
						if (!cleared.has(c)) problems.push(`reading area ${t.x},${t.y}: pillar ${xx},${yy} kept`);
						else if (!own4.has(c) && on.grid[c] !== TileType.FLOOR && !later.has(c))
							problems.push(`cleared pillar ${xx},${yy} not floor`);
					}
				const near = nearest(t.x, t.y, n, n);
				offs.set(near, (offs.get(near) ?? 0) + 1);
			}
		}
		const nf = onOff.size();
		const dist: string[] = [];
		for (let k = 0; k <= R.maxDist; k++) if (offs.has(k)) dist.push(`${k}: ${offs.get(k)}`);
		print(
			`[reading area] ${nf} floors: ${reading} / ${libraries} libraries have one; per floor ` +
				`${string.format("%.2f", clearedTotal / nf)} pillars cleared (${clearedTotal}); nearest case ` +
				`${dist.join(", ")}; ${laterOnCleared} cleared cells under a later piece`,
		);
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		expect(reading).toBeGreaterThan(0);
	});

	it("keeps every free-standing piece clear: its ring floor of its room, on no carpet, away from doorways", () => {
		const ct = SOLID_DECOR.clearTiles;
		const dr = SOLID_DECOR.doorTiles;
		const problems: string[] = [];
		let cleared = 0;
		let underPiece = 0;
		for (const { on } of onOff) {
			// every cleared pillar lies under a free-standing piece or in its ring
			for (const cp of on.clearedPillars ?? []) {
				cleared++;
				const by = on.solidDecor.find(
					(p) =>
						FREE_KINDS.includes(p.kind) &&
						cp.x >= p.x - ct &&
						cp.x < p.x + p.w + ct &&
						cp.y >= p.y - ct &&
						cp.y < p.y + p.h + ct,
				);
				if (by === undefined) problems.push(`cleared pillar ${cp.x},${cp.y} by no free-standing piece`);
				else if (cp.x >= by.x && cp.x < by.x + by.w && cp.y >= by.y && cp.y < by.y + by.h) underPiece++;
			}
			const carpet = new Set<number>();
			for (const c of on.carpets ?? [])
				for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) carpet.add(y * on.W + x);
			for (const p of on.solidDecor) {
				if (!FREE_KINDS.includes(p.kind)) continue;
				const long = p.fx !== 0 ? p.w : p.fz !== 0 ? p.h : 1;
				if (AXIS_KINDS.includes(p.kind) && math.abs(p.fx) + math.abs(p.fz) !== 1)
					problems.push(`${p.kind} ${p.x},${p.y} axis ${p.fx},${p.fz}`);
				if (p.kind !== "studyTable" && long !== math.max(p.w, p.h))
					problems.push(`${p.kind} ${p.x},${p.y} ${p.w} x ${p.h} along ${p.fx},${p.fz}`);
				for (let y = p.y - ct; y < p.y + p.h + ct; y++)
					for (let x = p.x - ct; x < p.x + p.w + ct; x++) {
						const inside = x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h;
						if (inside) {
							if (carpet.has(y * on.W + x)) problems.push(`${p.kind} ${p.x},${p.y} on a carpet`);
						} else if (tileAt(on, x, y) !== TileType.FLOOR || on.roomId[y * on.W + x] !== p.room)
							problems.push(`${p.kind} ${p.x},${p.y}: ring cell ${x},${y}`);
					}
				for (let y = p.y - dr; y < p.y + p.h + dr; y++)
					for (let x = p.x - dr; x < p.x + p.w + dr; x++)
						if (x >= 0 && y >= 0 && x < on.W && y < on.H && on.doorway[y * on.W + x] !== 0)
							problems.push(`${p.kind} ${p.x},${p.y} by a doorway`);
			}
		}
		print(
			`[free-standing] ${onOff.size()} floors: ${cleared} solid pillars cleared ` +
				`(${string.format("%.2f", cleared / onOff.size())} a floor, ${underPiece} under a piece)`,
		);
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
	});

	it("dresses libraries (v2): a lectern at the head of its runner, display cases, a second study table, a toppled case", () => {
		const RN = SOLID_DECOR.runner;
		const D = SOLID_DECOR.display;
		const F = SOLID_DECOR.fallenShelf;
		const R = SOLID_DECOR.reading;
		const dr = SOLID_DECOR.doorTiles;
		const problems: string[] = [];
		let libraries = 0;
		let lecterns = 0;
		let runnerTiles = 0;
		let displays = 0;
		let displaysWanted = 0;
		let displaysBeside = 0;
		let seconds = 0;
		let bigWithRunner = 0;
		let fallen = 0;
		let pieceTiles = 0;
		for (const { off, on } of onOff) {
			const themes = on.roomThemes ?? [];
			const tiles = new Array<number>(on.rooms.size(), 0);
			for (let c = 0; c < off.grid.size(); c++)
				if (off.grid[c] === TileType.FLOOR && off.roomId[c] >= 0 && off.roomId[c] < tiles.size())
					tiles[off.roomId[c]]++;
			for (const p of on.solidDecor)
				if (["lectern", "display", "fallenShelf"].includes(p.kind) && themes[p.room] !== "library")
					problems.push(`${p.kind} in a ${themes[p.room]} room`);
			for (const r of on.rooms) {
				if (themes[r.id] !== "library") continue;
				libraries++;
				const own = on.solidDecor.filter((p) => p.room === r.id);
				for (const p of own) pieceTiles += p.w * p.h;
				const ls = own.filter((p) => p.kind === "lectern");
				const runnersHere = (on.carpets ?? []).filter((c) => c.room === r.id);
				if (ls.size() > 1 || runnersHere.size() !== ls.size())
					problems.push(`library ${r.id}: ${ls.size()} lecterns, ${runnersHere.size()} runners`);
				const runner = runnersHere[0];
				if (ls.size() === 1 && runner !== undefined) {
					lecterns++;
					const l = ls[0];
					const alongX = r.w >= r.h;
					if (l.w !== 1 || l.h !== 1 || math.abs(l.fx) + math.abs(l.fz) !== 1 || (alongX ? l.fz : l.fx) !== 0)
						problems.push(`lectern ${l.x},${l.y} ${l.w} x ${l.h} faces ${l.fx},${l.fz}`);
					if (runner.fx !== l.fx || runner.fz !== l.fz) problems.push(`runner not along its lectern`);
					const len = runner.fx !== 0 ? runner.w : runner.h;
					if ((runner.fx !== 0 ? runner.h : runner.w) !== 1)
						problems.push(`runner ${runner.w} x ${runner.h}`);
					if (
						len % RN.segment !== 0 ||
						len < RN.minSegments * RN.segment ||
						len > RN.maxSegments * RN.segment
					)
						problems.push(`runner of length ${len}`);
					runnerTiles += len;
					// its head is the cell right in front of the lectern
					const hx = l.fx === -1 ? runner.x + runner.w - 1 : runner.x;
					const hy = l.fz === -1 ? runner.y + runner.h - 1 : runner.y;
					if (hx !== l.x + l.fx || hy !== l.y + l.fz)
						problems.push(`runner head ${hx},${hy} off its lectern`);
					for (let y = runner.y; y < runner.y + runner.h; y++)
						for (let x = runner.x; x < runner.x + runner.w; x++) {
							const c = y * on.W + x;
							if (on.grid[c] !== TileType.FLOOR || on.roomId[c] !== r.id)
								problems.push(`runner ${x},${y}`);
							for (let yy = y - dr; yy <= y + dr; yy++)
								for (let xx = x - dr; xx <= x + dr; xx++)
									if (
										xx >= 0 &&
										yy >= 0 &&
										xx < on.W &&
										yy < on.H &&
										on.doorway[yy * on.W + xx] !== 0
									)
										problems.push(`runner ${x},${y} by a doorway`);
						}
				}
				// display cases by size, beside the runner where they fit there
				const want = tiles[r.id] >= D.twoTiles ? 2 : tiles[r.id] >= D.oneTiles ? 1 : 0;
				const ds = own.filter((p) => p.kind === "display");
				displaysWanted += want;
				displays += ds.size();
				if (ds.size() > want)
					problems.push(`library ${r.id}: ${ds.size()} display cases (${tiles[r.id]} tiles)`);
				for (const p of ds) {
					if (math.max(p.w, p.h) !== D.length || math.min(p.w, p.h) !== 1)
						problems.push(`display ${p.x},${p.y} ${p.w} x ${p.h}`);
					if (runner !== undefined) {
						const g = math.max(
							p.x - (runner.x + runner.w - 1),
							runner.x - (p.x + p.w - 1),
							p.y - (runner.y + runner.h - 1),
							runner.y - (p.y + p.h - 1),
							0,
						);
						if (g >= D.besideMin && g <= D.besideMax && (runner.fx !== 0) === (p.fx !== 0))
							displaysBeside++;
					}
				}
				// a second study table: big rooms with a runner only, beside it, along it
				const big = tiles[r.id] >= SOLID_DECOR.bigRoomTiles;
				if (big && runner !== undefined) bigWithRunner++;
				const sts = own.filter((p) => p.kind === "studyTable");
				const lecternIdx = on.solidDecor.findIndex((p) => p.room === r.id && p.kind === "lectern");
				const second = on.solidDecor.filter(
					(p, i) => p.room === r.id && p.kind === "studyTable" && lecternIdx >= 0 && i > lecternIdx,
				);
				if (sts.size() > 2 || second.size() > 1) problems.push(`library ${r.id}: ${sts.size()} study tables`);
				for (const p of second) {
					seconds++;
					if (!big || runner === undefined) problems.push(`second study table in a small room`);
					else {
						const g = math.max(
							p.x - (runner.x + runner.w - 1),
							runner.x - (p.x + p.w - 1),
							p.y - (runner.y + runner.h - 1),
							runner.y - (p.y + p.h - 1),
							0,
						);
						if (g < R.besideMin || g > R.besideMax || (runner.fx !== 0) !== (p.fx !== 0))
							problems.push(`second study table ${p.x},${p.y} not beside the runner (${g})`);
					}
				}
				// a toppled case near a run
				const fs = own.filter((p) => p.kind === "fallenShelf");
				if (fs.size() > 1) problems.push(`library ${r.id}: ${fs.size()} toppled cases`);
				for (const p of fs) {
					fallen++;
					if (math.max(p.w, p.h) !== F.length || math.min(p.w, p.h) !== 1)
						problems.push(`toppled case ${p.x},${p.y} ${p.w} x ${p.h}`);
					let near = math.huge;
					for (const c of own)
						if (c.kind === "bookcase")
							near = math.min(
								near,
								math.max(c.x - (p.x + p.w - 1), p.x - c.x, c.y - (p.y + p.h - 1), p.y - c.y, 0),
							);
					if (near > F.maxDist) problems.push(`toppled case ${p.x},${p.y} ${near} from the shelves`);
				}
				if (own.some((p) => p.kind === "statue"))
					problems.push(`library ${r.id}: a statue (the lectern took it)`);
			}
		}
		const nf = onOff.size();
		print(
			`[library] ${nf} floors: ${libraries} libraries; ${lecterns} lecterns with a runner (` +
				`${string.format("%.1f", runnerTiles / math.max(lecterns, 1))} tiles long); display cases ` +
				`${displays} / ${displaysWanted} wanted (${displaysBeside} beside a runner); second study tables ` +
				`${seconds} / ${bigWithRunner} big rooms with a runner; toppled cases ${fallen} ` +
				`(${string.format("%.0f", (100 * fallen) / math.max(libraries, 1))} %); ` +
				`${string.format("%.1f", pieceTiles / math.max(libraries, 1))} solid tiles a library`,
		);
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		expect(lecterns).toBeGreaterThan(0);
		expect(displays).toBeGreaterThan(0);
		expect(fallen).toBeGreaterThan(0);
	});

	it("furnishes mess halls: barrel stacks flush on the walls, dining tables free-standing at least tableSpacing apart", () => {
		const M = SOLID_DECOR.mess;
		const problems: string[] = [];
		let rooms = 0;
		let tables = 0;
		let stacks = 0;
		let lost = 0;
		let lostMax = 0;
		let openBefore = 0;
		let minTables = math.huge;
		let maxTables = 0;
		/** Spawn-grade tiles: FLOOR of the room with all 8 neighbours FLOOR (enemyRooms isOpenTile). */
		const openTiles = (d: Dungeon, rid: number) => {
			let n = 0;
			for (let y = 1; y < d.H - 1; y++)
				for (let x = 1; x < d.W - 1; x++) {
					if (d.grid[y * d.W + x] !== TileType.FLOOR || d.roomId[y * d.W + x] !== rid) continue;
					let ok = true;
					for (let oy = -1; oy <= 1 && ok; oy++)
						for (let ox = -1; ox <= 1 && ok; ox++)
							if (d.grid[(y + oy) * d.W + x + ox] !== TileType.FLOOR) ok = false;
					if (ok) n++;
				}
			return n;
		};
		for (const { off, on } of onOff) {
			const themes = on.roomThemes ?? [];
			const tiles = new Array<number>(on.rooms.size(), 0);
			for (let c = 0; c < off.grid.size(); c++)
				if (off.grid[c] === TileType.FLOOR && off.roomId[c] >= 0 && off.roomId[c] < tiles.size())
					tiles[off.roomId[c]]++;
			for (const p of on.solidDecor) {
				if (p.kind === "diningTable" && themes[p.room] !== "mess")
					problems.push(`dining table in a ${themes[p.room]} room`);
				if (p.kind === "barrelStack" && themes[p.room] !== "mess" && themes[p.room] !== "store")
					problems.push(`barrel stack in a ${themes[p.room]} room`);
			}
			for (const r of on.rooms) {
				if (themes[r.id] !== "mess") continue;
				rooms++;
				const own = on.solidDecor.filter((p) => p.room === r.id);
				if (own.size() === 0) problems.push(`mess ${r.id} with nothing in it`);
				const big = tiles[r.id] >= SOLID_DECOR.bigRoomTiles;
				const ts = own.filter((p) => p.kind === "diningTable");
				const ss = own.filter((p) => p.kind === "barrelStack");
				for (const p of own)
					if (p.kind !== "diningTable" && p.kind !== "barrelStack") problems.push(`${p.kind} in a mess hall`);
				if (ts.size() > (big ? M.bigTablesMax : M.tablesMax))
					problems.push(`mess ${r.id}: ${ts.size()} tables`);
				if (ss.size() > M.stacksMax) problems.push(`mess ${r.id}: ${ss.size()} barrel stacks`);
				for (const p of ts) {
					if (p.w !== 1 || p.h !== 1 || p.fx !== 0 || p.fz !== 0) problems.push(`dining table ${p.x},${p.y}`);
					for (const q of ts)
						if (q !== p && math.max(math.abs(q.x - p.x), math.abs(q.y - p.y)) < M.tableSpacing)
							problems.push(`dining tables ${p.x},${p.y} and ${q.x},${q.y} too close`);
				}
				for (const p of ss)
					if (
						math.max(p.w, p.h) !== M.stackLength ||
						math.min(p.w, p.h) !== 1 ||
						math.abs(p.fx) + math.abs(p.fz) !== 1
					)
						problems.push(`barrel stack ${p.x},${p.y} ${p.w} x ${p.h} faces ${p.fx},${p.fz}`);
				tables += ts.size();
				stacks += ss.size();
				minTables = math.min(minTables, ts.size());
				maxTables = math.max(maxTables, ts.size());
				const before = openTiles(off, r.id);
				const l = before - openTiles(on, r.id);
				openBefore += before;
				lost += l;
				lostMax = math.max(lostMax, l);
			}
		}
		const nf = onOff.size();
		const nr = math.max(rooms, 1);
		print(
			`[mess] ${nf} floors: ${rooms} mess halls (${string.format("%.2f", rooms / nf)} a floor); dining tables ` +
				`${string.format("%.1f", tables / nr)} a room (${minTables}-${maxTables}), barrel stacks ` +
				`${string.format("%.1f", stacks / nr)}; spawn tiles lost ${string.format("%.1f", lost / nr)} a room ` +
				`(max ${lostMax}) of ${string.format("%.0f", openBefore / nr)}`,
		);
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		expect(rooms).toBeGreaterThan(0);
		expect(tables).toBeGreaterThan(rooms * 2);
	});

	it("stocks storerooms: solid stock in corners first, then along the walls; a stockpile in big ones", () => {
		const S = SOLID_DECOR.store;
		const problems: string[] = [];
		let rooms = 0;
		let pieces = 0;
		let corners = 0;
		let stockpiles = 0;
		let bigRooms = 0;
		const byKind = new Map<string, number>();
		for (const { off, on } of onOff) {
			const themes = on.roomThemes ?? [];
			const tiles = new Array<number>(on.rooms.size(), 0);
			for (let c = 0; c < off.grid.size(); c++)
				if (off.grid[c] === TileType.FLOOR && off.roomId[c] >= 0 && off.roomId[c] < tiles.size())
					tiles[off.roomId[c]]++;
			for (const p of on.solidDecor)
				if (STORE_KINDS.includes(p.kind) && p.kind !== "barrelStack" && themes[p.room] !== "store")
					problems.push(`${p.kind} in a ${themes[p.room]} room`);
			const solidAt = (x: number, y: number) => tileAt(on, x, y) !== TileType.FLOOR;
			/** The whole line of cells beside the piece on side (dx, dy) is solid. */
			const walled = (p: (typeof on.solidDecor)[number], dx: number, dy: number) => {
				if (dx !== 0) {
					const x = dx < 0 ? p.x - 1 : p.x + p.w;
					for (let y = p.y; y < p.y + p.h; y++) if (!solidAt(x, y)) return false;
				} else {
					const y = dy < 0 ? p.y - 1 : p.y + p.h;
					for (let x = p.x; x < p.x + p.w; x++) if (!solidAt(x, y)) return false;
				}
				return true;
			};
			for (const r of on.rooms) {
				if (themes[r.id] !== "store") continue;
				rooms++;
				const big = tiles[r.id] >= SOLID_DECOR.bigRoomTiles;
				if (big) bigRooms++;
				const own = on.solidDecor.filter((p) => p.room === r.id);
				const sp = own.filter((p) => p.kind === "stockpile");
				if (sp.size() > 1 || (sp.size() > 0 && !big)) problems.push(`store ${r.id}: ${sp.size()} stockpiles`);
				if (own.size() - sp.size() > S.piecesMax) problems.push(`store ${r.id}: ${own.size()} pieces`);
				for (const p of own) {
					if (!STORE_KINDS.includes(p.kind)) problems.push(`${p.kind} in a storeroom`);
					pieces++;
					byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
					const want =
						p.kind === "stockpile"
							? [S.stockpileSize, S.stockpileSize]
							: p.kind === "barrelStack"
							? [S.stackLength, 1]
							: [1, 1];
					if (math.max(p.w, p.h) !== want[0] || math.min(p.w, p.h) !== want[1])
						problems.push(`${p.kind} ${p.x},${p.y} ${p.w} x ${p.h}`);
					if (math.abs(p.fx) + math.abs(p.fz) !== 1)
						problems.push(`${p.kind} ${p.x},${p.y} faces ${p.fx},${p.fz}`);
					// a corner: walled behind and at one end
					const corner =
						walled(p, -p.fx, -p.fz) &&
						(p.fx !== 0 ? walled(p, 0, -1) || walled(p, 0, 1) : walled(p, -1, 0) || walled(p, 1, 0));
					if (corner) corners++;
					if (p.kind === "stockpile") {
						stockpiles++;
						if (!corner) problems.push(`stockpile ${p.x},${p.y} not in a corner`);
						// nothing walkable behind a far-wall side
						for (const [dx, dy] of [
							[-1, 0],
							[0, -1],
						])
							if (walled(p, dx, dy))
								for (let d = 1; d <= SOLID_DECOR.bookcase.backTiles; d++) {
									const len = dx !== 0 ? p.h : p.w;
									for (let k = 0; k < len; k++) {
										const t = tileAt(
											on,
											dx !== 0 ? p.x - d : p.x + k,
											dx !== 0 ? p.y + k : p.y - d,
										);
										if (t === TileType.FLOOR || t === TileType.POOL)
											problems.push(`stockpile ${p.x},${p.y}: floor behind`);
									}
								}
					}
				}
			}
		}
		const nf = onOff.size();
		const kinds: string[] = [];
		byKind.forEach((v, k) => kinds.push(`${k} ${v}`));
		print(
			`[store] ${nf} floors: ${rooms} storerooms (${string.format("%.2f", rooms / nf)} a floor), ` +
				`${string.format("%.1f", pieces / math.max(rooms, 1))} stock pieces a room (${kinds.join(", ")}); ` +
				`${corners} / ${pieces} in corners; stockpiles ${stockpiles} / ${bigRooms} big storerooms`,
		);
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		expect(rooms).toBeGreaterThan(0);
		expect(pieces).toBeGreaterThanOrEqual(rooms);
	});

	it("reaches the endless layout: no room spawn, breakable or party spawn stands on a solid cell", () => {
		for (let run = 1; run <= 6; run++)
			for (let floor = 1; floor <= 6; floor++) {
				const layout = buildEndlessFloor(run * 104729, floor, generateDungeon);
				const d = layout.dungeon;
				const solid = new Set<string>();
				for (const p of d.solidDecor)
					for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) solid.add(`${x},${y}`);
				for (const tiles of layout.roomSpawnTiles)
					for (const t of tiles)
						expect([`${t.x},${t.z}`, solid.has(`${t.x},${t.z}`)]).toEqual([`${t.x},${t.z}`, false]);
				for (const b of layout.breakables ?? []) expect(solid.has(`${b.x},${b.y}`)).toBe(false);
			}
	});
});
