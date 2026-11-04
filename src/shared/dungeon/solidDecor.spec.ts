// Solid decor and room themes on endless floors (ForgeParams.solidDecor, docs/DECOR.md "Solid decor", "Room themes"):
// set pieces become WALL from their own stream, so every other piece of the floor is the option-off one; the floor
// stays one piece, no piece makes a new pinch, nothing but the door braziers stands by a doorway, and M1 and the
// tutorial have none.
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
		// (and the solid pillars a reading area cleared, docs/BOOKSHELVES.md: WALL pillar cells of a library on the
		// option-off floor, FLOOR now or under a piece; their props stay in `props`)
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
				expect([cp.x, cp.y, pillar, off.grid[c], themes[off.roomId[c]]]).toEqual([
					cp.x,
					cp.y,
					true,
					TileType.WALL,
					"library",
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
			[RoomType.COMBAT]: ["tomb", "candelabrum", "statue", "bookcase", "table", "chair"],
			[RoomType.ELITE]: ["tomb", "candelabrum", "statue", "bookcase", "table", "chair"],
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
				// flush: every cell behind a wall-attached piece's back row is solid (a chair's facing is toward its table)
				if ((p.fx !== 0 || p.fz !== 0) && p.kind !== "chair") {
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
		for (const k of ["tomb", "candelabrum", "throne", "statue", "brazier", "bookcase", "table", "chair"])
			expect(counts.get(k) ?? 0).toBeGreaterThan(0);
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
							: ["crypt", "hall", "store", "plain", "library"]
						: ["none"];
				if (!want.includes(t)) problems.push(`room ${r.id} ${r.type} theme ${t}`);
			}
			const throne = on.solidDecor.find((p) => p.kind === "throne");
			if (throne !== undefined) thrones++;
			for (const cp of on.carpets ?? []) {
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

	it("sets a reading area in libraries: a 2 x 1 table with a chair right at each end facing it, free-standing, clearing pillars", () => {
		const R = SOLID_DECOR.reading;
		const ct = SOLID_DECOR.clearTiles;
		const dr = SOLID_DECOR.doorTiles;
		const problems: string[] = [];
		let libraries = 0;
		let reading = 0;
		let tables = 0;
		let chairs = 0;
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
			let clearedHere = 0;
			for (const p of pieces) {
				if (p.kind === "table") tables++;
				else if (p.kind === "chair") chairs++;
				else continue;
				if (themes[p.room] !== "library") problems.push(`${p.kind} in a ${themes[p.room]} room`);
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
				const roomTables = own.filter((i) => pieces[i].kind === "table");
				const roomChairs = own.filter((i) => pieces[i].kind === "chair");
				// pieces placed after the reading area (the statue and its candles) stood on open floor then
				const firstAfter = (from: number) => {
					const k = own.findIndex((i) => i > from && pieces[i].kind === "statue");
					return k < 0 ? math.huge : own[k];
				};
				const statueAt = firstAfter(roomTables.size() > 0 ? roomTables[0] : -1);
				const blocked = new Set<number>();
				for (const i of own)
					if (i < statueAt) {
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
				/** Chebyshev, cell to cell, from the line at (x, y) to the room's nearest bookcase. */
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
				const fits = (x: number, y: number, w: number, h: number, own4: Set<number>) => {
					if (nearest(x, y, w, h) > R.maxDist) return false;
					for (let yy = y - ct; yy < y + h + ct; yy++)
						for (let xx = x - ct; xx < x + w + ct; xx++)
							if (!open(xx, yy) && !own4.has(yy * on.W + xx)) return false;
					for (let yy = y - dr; yy < y + h + dr; yy++)
						for (let xx = x - dr; xx < x + w + dr; xx++)
							if (xx >= 0 && yy >= 0 && xx < on.W && yy < on.H && on.doorway[yy * on.W + xx] !== 0)
								return false;
					return true;
				};
				const n = R.tableLength + 2;
				const w = alongX ? n : 1;
				const h = alongX ? 1 : n;
				if (roomTables.size() === 0) {
					// no spot fits: every line of four in the first run's direction lacks its ring or is by a door
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
							if (fits(x, y, w, h, new Set())) spot = `${x},${y}`;
					if (spot !== undefined) problems.push(`library ${r.id}: no reading area, but ${spot} fits`);
					if (roomChairs.size() > 0) problems.push(`library ${r.id}: chairs without a table`);
					continue;
				}
				reading++;
				if (roomTables.size() !== 1 || roomChairs.size() !== 2) {
					problems.push(`library ${r.id}: ${roomTables.size()} tables, ${roomChairs.size()} chairs`);
					continue;
				}
				const t = pieces[roomTables[0]];
				if (t.fx !== 0 || t.fz !== 0) problems.push(`table ${t.x},${t.y} faces ${t.fx},${t.fz}`);
				const tl = alongX ? t.w : t.h;
				if (tl !== R.tableLength || (alongX ? t.h : t.w) !== 1)
					problems.push(`table ${t.x},${t.y} ${t.w} x ${t.h} (first run along ${alongX ? "X" : "Z"})`);
				const ax = alongX ? 1 : 0;
				const az = alongX ? 0 : 1;
				const ends = [
					{ x: t.x - ax, y: t.y - az, fx: ax, fz: az },
					{ x: t.x + ax * tl, y: t.y + az * tl, fx: -ax, fz: -az },
				];
				for (const e of ends) {
					const c = roomChairs.find((i) => pieces[i].x === e.x && pieces[i].y === e.y);
					if (c === undefined) problems.push(`table ${t.x},${t.y}: no chair at ${e.x},${e.y}`);
					else {
						const p = pieces[c];
						if (p.w !== 1 || p.h !== 1 || p.fx !== e.fx || p.fz !== e.fz)
							problems.push(`chair ${p.x},${p.y} ${p.w} x ${p.h} faces ${p.fx},${p.fz}`);
					}
				}
				const x0 = t.x - ax;
				const y0 = t.y - az;
				const own4 = new Set<number>();
				for (let k = 0; k < n; k++) own4.add((y0 + az * k) * on.W + x0 + ax * k);
				if (!fits(x0, y0, w, h, own4))
					problems.push(`reading area ${x0},${y0} without its ring, by a door or too far from the shelves`);
				// exactly the solid pillars under it and its ring were cleared (floor again, unless a later piece of the
				// room, the statue or its candles, stands there now)
				const later = new Set<number>();
				for (const i of own)
					if (i > roomTables[0] && pieces[i].kind !== "chair") {
						const p = pieces[i];
						for (let yy = p.y; yy < p.y + p.h; yy++)
							for (let xx = p.x; xx < p.x + p.w; xx++) {
								later.add(yy * on.W + xx);
								if (cleared.has(yy * on.W + xx)) laterOnCleared++;
							}
					}
				for (let yy = y0 - ct; yy < y0 + h + ct; yy++)
					for (let xx = x0 - ct; xx < x0 + w + ct; xx++) {
						const c = yy * on.W + xx;
						if (!pillarCell.has(c) || off.roomId[c] !== r.id) continue;
						clearedHere++;
						if (!cleared.has(c)) problems.push(`reading area ${x0},${y0}: pillar ${xx},${yy} kept`);
						else if (!own4.has(c) && on.grid[c] !== TileType.FLOOR && !later.has(c))
							problems.push(`cleared pillar ${xx},${yy} not floor`);
					}
				const near = nearest(x0, y0, w, h);
				offs.set(near, (offs.get(near) ?? 0) + 1);
			}
			if (clearedHere !== cleared.size())
				problems.push(`${cleared.size()} pillars cleared, ${clearedHere} in rings`);
		}
		const nf = onOff.size();
		const dist: string[] = [];
		for (let k = 0; k <= R.maxDist; k++) if (offs.has(k)) dist.push(`${k}: ${offs.get(k)}`);
		print(
			`[reading area] ${nf} floors: ${reading} / ${libraries} libraries have one; per floor ` +
				`${string.format("%.2f", tables / nf)} tables, ${string.format("%.2f", chairs / nf)} chairs, ` +
				`${string.format("%.2f", clearedTotal / nf)} pillars cleared (${clearedTotal}); nearest case ` +
				`${dist.join(", ")}; ${laterOnCleared} cleared cells under a later piece`,
		);
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		expect(reading).toBeGreaterThan(0);
		expect(chairs).toBe(tables * 2);
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
