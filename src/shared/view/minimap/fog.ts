/**
 * Minimap fog of war (docs/MINIMAP.md §3, task M3): which map cells the party has seen (REMEMBERED) and sees now
 * (IN_SIGHT), the frontier, and the dirty list the painter consumes. Pure and view-side: it reads sim state (late
 * attach) but never feeds `step()` (MD1). Roblox-port feature, no web source.
 *
 * Sources: `update(sources)` takes one entry per party slot (index = player index), the caller's interpolated world
 * position of a LIVING player, or `false` for a dead / absent one (`false`, not `undefined`, so the Luau array stays
 * dense; entries past the end are absent too). Each slot remembers its last tile and the cells it lit:
 *   - a slot whose tile did not change costs nothing;
 *   - a slot that moved re-casts sight from its new tile (Shadowcaster, MINIMAP_VIEW.sightTiles); cells it no longer
 *     lights and no other slot lights go IN_SIGHT -> REMEMBERED; newly lit cells go IN_SIGHT;
 *   - a jump of 2..teleportTiles tiles (Chebyshev; several ticks in one frame, a roll) also casts from every open tile
 *     on the tile line between the two (those cells become at least REMEMBERED), so nothing is skipped; a longer jump
 *     (floor change, respawn) or a slot that just appeared skips the line;
 *   - a slot that went `false` drops its lit cells (dead players are not sources; MD3).
 * A source whose tile is room floor (MinimapTiles.room, the roomIdAt test) reveals that whole room (its cells and wall
 * ring) once; so does every room on a filled tile line.
 *
 * Frontier: an open (FLOOR / POOL) cell that is not UNKNOWN with an UNKNOWN open 4-neighbour; recomputed only around
 * cells that left UNKNOWN. Dirty: a cell whose state or frontier flag changed since the last drainDirty.
 */
import { worldToGrid, type WorldXZ } from "shared/dungeon";
import { NO_KIND, archetypeAt, type SimState } from "shared/sim";
import { MINIMAP_VIEW } from "./config";
import { Shadowcaster } from "./sight";
import { MAP_NO_CELL, MapTile, type MinimapTiles } from "./tiles";

/** A map cell's fog state. */
export const FogState = { UNKNOWN: 0, REMEMBERED: 1, IN_SIGHT: 2 } as const;
export type FogState = (typeof FogState)[keyof typeof FogState];

/** One party slot's sight source: a living player's world position, or false (dead / absent). */
export type FogSource = WorldXZ | false;

/** FogOfWar options (tests; the game uses the MINIMAP_VIEW defaults). */
export interface FogOptions {
	/** Sight radius, tiles (default MINIMAP_VIEW.sightTiles). */
	readonly sightTiles?: number;
	/** Longest jump filled by the tile line, tiles (default MINIMAP_VIEW.teleportTiles). */
	readonly teleportTiles?: number;
}

/** What the painter reads (FogOfWar implements it). */
export interface MinimapFogView {
	state(cell: number): number;
	isFrontier(cell: number): boolean;
}

const DIRS_4: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

function isOpenTile(t: number): boolean {
	return t === MapTile.FLOOR || t === MapTile.POOL;
}

export class FogOfWar implements MinimapFogView {
	private readonly fog: number[] = [];
	private readonly frontier: boolean[] = [];
	/** Per cell: how many slots light it now. */
	private readonly litCount: number[] = [];
	private readonly dirtyFlag: boolean[] = [];
	private dirty: number[] = [];
	/** The array drainDirty returned last (reused as the next dirty list). */
	private spare: number[] = [];
	private readonly roomShown: boolean[] = [];
	/** Per slot: last tile (MAP_NO_CELL: absent) and the cells it lights. */
	private readonly lastTile: number[] = [];
	private readonly lit: number[][] = [];
	/** Cells whose lit count changed this update (settled at its end). */
	private readonly touched: number[] = [];
	private readonly touchedFlag: boolean[] = [];
	/** Cells that left UNKNOWN since the last frontier pass. */
	private readonly revealed: number[] = [];
	private readonly caster = new Shadowcaster();
	private litTarget: number[] = [];
	private readonly sightTiles: number;
	private readonly teleportTiles: number;

	private readonly onLit = (cell: number) => {
		this.litTarget.push(cell);
		this.litCount[cell]++;
		this.touch(cell);
	};

	private readonly onSeen = (cell: number) => {
		if (this.fog[cell] === FogState.UNKNOWN) this.setState(cell, FogState.REMEMBERED);
	};

	constructor(readonly tiles: MinimapTiles, options?: FogOptions) {
		this.sightTiles = options?.sightTiles ?? MINIMAP_VIEW.sightTiles;
		this.teleportTiles = options?.teleportTiles ?? MINIMAP_VIEW.teleportTiles;
		const n = tiles.W * tiles.H;
		for (let i = 0; i < n; i++) {
			this.fog.push(FogState.UNKNOWN);
			this.frontier.push(false);
			this.litCount.push(0);
			this.dirtyFlag.push(false);
			this.touchedFlag.push(false);
		}
		for (let r = 0; r < tiles.roomCells.size(); r++) this.roomShown.push(false);
	}

	/** One update from the party's sources (see the file comment). Marks changed cells dirty. */
	update(sources: ReadonlyArray<FogSource>): void {
		const slots = math.max(sources.size(), this.lastTile.size());
		for (let i = 0; i < slots; i++) {
			while (this.lastTile.size() <= i) {
				this.lastTile.push(MAP_NO_CELL);
				this.lit.push([]);
			}
			const src = i < sources.size() ? sources[i] : false;
			const now = src === false ? MAP_NO_CELL : this.cellOf(src);
			const before = this.lastTile[i];
			if (now === before) continue;
			const lit = this.lit[i];
			for (const c of lit) {
				this.litCount[c]--;
				this.touch(c);
			}
			lit.clear();
			if (now !== MAP_NO_CELL) {
				if (before !== MAP_NO_CELL) this.fillLine(before, now);
				this.litTarget = lit;
				this.caster.cast(
					this.tiles,
					now % this.tiles.W,
					math.floor(now / this.tiles.W),
					this.sightTiles,
					this.onLit,
				);
				this.revealRoomAt(now);
			}
			this.lastTile[i] = now;
		}
		this.settle();
		this.updateFrontier();
	}

	/**
	 * Reveals `cells` (cell indices) as REMEMBERED (IN_SIGHT where lit): a secret room's chamber, ring and crack at its
	 * open (docs/SECRET_ROOMS.md SR8, shared/view/secrets secretMapChange's `reveal`), on the shared party map whoever
	 * opened it. Cells already known are unchanged; the frontier follows.
	 */
	revealCells(cells: ReadonlyArray<number>): void {
		for (const c of cells) {
			if (c < 0 || c >= this.fog.size()) continue;
			if (this.fog[c] === FogState.UNKNOWN)
				this.setState(c, this.litCount[c] > 0 ? FogState.IN_SIGHT : FogState.REMEMBERED);
		}
		this.updateFrontier();
	}

	/** Reveals the whole room (its cells and wall ring) as REMEMBERED (IN_SIGHT where lit), once per room. */
	revealRoom(room: number): void {
		this.revealRoomCells(room);
		this.updateFrontier();
	}

	/**
	 * Late attach (a co-op client joining a run in progress, a run started at tick > 0): reveals every room with
	 * `endless.roomsEntered[r] === 1`, every scored room with `engageTick >= 0`, and the boss room (MinimapTiles.bossRoom)
	 * once a boss is awake (phase > 0). Corridors are not recovered (MD10). `state` must be on this fog's floor.
	 */
	seedFromState(state: Readonly<SimState>): void {
		const e = state.endless;
		if (e !== undefined) {
			const entered = e.roomsEntered;
			for (let r = 0; r < entered.size(); r++) if (entered[r] === 1) this.revealRoomCells(r);
		}
		const score = state.score;
		if (score !== undefined) for (const rec of score.rooms) if (rec.engageTick >= 0) this.revealRoomCells(rec.room);
		for (const a of state.combat.actors) {
			if (a.kind === NO_KIND || a.phase <= 0 || archetypeAt(a.kind).data.boss !== true) continue;
			this.revealRoomCells(this.tiles.bossRoom);
			break;
		}
		this.updateFrontier();
	}

	/** Back to a fresh fog (everything UNKNOWN, no sources); every cell that changes is marked dirty. */
	reset(): void {
		const n = this.fog.size();
		for (let c = 0; c < n; c++) {
			if (this.fog[c] !== FogState.UNKNOWN || this.frontier[c]) this.markDirty(c);
			this.fog[c] = FogState.UNKNOWN;
			this.frontier[c] = false;
			this.litCount[c] = 0;
		}
		for (let r = 0; r < this.roomShown.size(); r++) this.roomShown[r] = false;
		for (let i = 0; i < this.lastTile.size(); i++) {
			this.lastTile[i] = MAP_NO_CELL;
			this.lit[i].clear();
		}
		this.revealed.clear();
	}

	/** The cell's FogState. */
	state(cell: number): number {
		return this.fog[cell];
	}

	isFrontier(cell: number): boolean {
		return this.frontier[cell];
	}

	/** True once the room was revealed (entered, seeded or revealRoom). */
	roomRevealed(room: number): boolean {
		return this.roomShown[room] === true;
	}

	/** Cells whose state or frontier flag changed since the last drain, in the order they changed (a reused array: read
	 * it before the next drainDirty). */
	drainDirty(): ReadonlyArray<number> {
		const out = this.dirty;
		for (const c of out) this.dirtyFlag[c] = false;
		const reuse = this.spare;
		reuse.clear();
		this.dirty = reuse;
		this.spare = out;
		return out;
	}

	// ---------------------------------------------------------------------------------------------

	/** The grid cell of a world point, MAP_NO_CELL off the grid. */
	private cellOf(p: WorldXZ): number {
		const gx = worldToGrid(p.x);
		const gy = worldToGrid(p.z);
		const t = this.tiles;
		if (gx < 0 || gy < 0 || gx >= t.W || gy >= t.H) return MAP_NO_CELL;
		return gy * t.W + gx;
	}

	/** Casts from every open tile strictly between `from` and `to` on their tile line (Bresenham), if not a teleport. */
	private fillLine(from: number, to: number): void {
		const W = this.tiles.W;
		let x = from % W;
		let y = math.floor(from / W);
		const x1 = to % W;
		const y1 = math.floor(to / W);
		const dx = math.abs(x1 - x);
		const dy = math.abs(y1 - y);
		const steps = math.max(dx, dy);
		if (steps <= 1 || steps > this.teleportTiles) return;
		const sx = x1 > x ? 1 : -1;
		const sy = y1 > y ? 1 : -1;
		let err = dx - dy;
		for (;;) {
			const e2 = 2 * err;
			if (e2 > -dy) {
				err -= dy;
				x += sx;
			}
			if (e2 < dx) {
				err += dx;
				y += sy;
			}
			if (x === x1 && y === y1) break;
			const c = y * W + x;
			if (!isOpenTile(this.tiles.tile[c])) continue;
			this.caster.cast(this.tiles, x, y, this.sightTiles, this.onSeen);
			this.revealRoomAt(c);
		}
	}

	private revealRoomAt(cell: number): void {
		const room = this.tiles.room[cell];
		if (room !== MAP_NO_CELL) this.revealRoomCells(room);
	}

	private revealRoomCells(room: number): void {
		if (room < 0 || room >= this.roomShown.size() || this.roomShown[room]) return;
		this.roomShown[room] = true;
		for (const c of this.tiles.roomCells[room]) {
			if (this.fog[c] === FogState.UNKNOWN)
				this.setState(c, this.litCount[c] > 0 ? FogState.IN_SIGHT : FogState.REMEMBERED);
		}
	}

	private touch(cell: number): void {
		if (this.touchedFlag[cell]) return;
		this.touchedFlag[cell] = true;
		this.touched.push(cell);
	}

	/** Every touched cell to IN_SIGHT (lit) or, lit before, REMEMBERED. */
	private settle(): void {
		for (const c of this.touched) {
			this.touchedFlag[c] = false;
			const s =
				this.litCount[c] > 0
					? FogState.IN_SIGHT
					: this.fog[c] === FogState.UNKNOWN
					? FogState.UNKNOWN
					: FogState.REMEMBERED;
			if (s !== this.fog[c]) this.setState(c, s);
		}
		this.touched.clear();
	}

	private setState(cell: number, s: number): void {
		if (this.fog[cell] === FogState.UNKNOWN && s !== FogState.UNKNOWN) this.revealed.push(cell);
		this.fog[cell] = s;
		this.markDirty(cell);
	}

	private markDirty(cell: number): void {
		if (this.dirtyFlag[cell]) return;
		this.dirtyFlag[cell] = true;
		this.dirty.push(cell);
	}

	/** Recomputes the frontier flag of every cell that left UNKNOWN and of its 4-neighbours. */
	private updateFrontier(): void {
		const W = this.tiles.W;
		const H = this.tiles.H;
		for (const c of this.revealed) {
			this.refreshFrontier(c);
			const x = c % W;
			const y = math.floor(c / W);
			for (const [dx, dy] of DIRS_4) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx >= 0 && ny >= 0 && nx < W && ny < H) this.refreshFrontier(ny * W + nx);
			}
		}
		this.revealed.clear();
	}

	private refreshFrontier(cell: number): void {
		const tiles = this.tiles;
		let f = false;
		if (isOpenTile(tiles.tile[cell]) && this.fog[cell] !== FogState.UNKNOWN) {
			const W = tiles.W;
			const x = cell % W;
			const y = math.floor(cell / W);
			for (const [dx, dy] of DIRS_4) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= W || ny >= tiles.H) continue;
				const j = ny * W + nx;
				if (isOpenTile(tiles.tile[j]) && this.fog[j] === FogState.UNKNOWN) {
					f = true;
					break;
				}
			}
		}
		if (f !== this.frontier[cell]) {
			this.frontier[cell] = f;
			this.markDirty(cell);
		}
	}
}
