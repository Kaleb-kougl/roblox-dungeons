// A secret room's cells for the world and the minimap (docs/SECRET_ROOMS.md SR7 / SR8) on real secret floors
// (shared/run endlessRunFloor): the ring rectangle holds the crack and the chamber; WorldController's merge grid leaves
// the crack out of every wall rect; the chamber build is the chamber's floor, its own new walls (never the parent's wall
// line) and two torches on its back wall facing in. The minimap: before the open the tiles are the Forge grid's (the
// chamber unknown, the crack a wall: a party standing in the room never sees in), at the open the change makes them the
// carved grid's everywhere and the reveal set shows the whole chamber on the shared fog; the chest's mark appears at
// the open, hollow once taken.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, gridToWorld, tileAt, type EndlessFloorLayout } from "shared/dungeon";
import { endlessRunFloor } from "shared/run";
import { SecretStatus, VaultStatus } from "shared/sim";
import { treasureFloorRole } from "shared/theme";
import { greedyRectsOf } from "../tileMerge";
import { FogState, FogOfWar, MapTile, minimapTiles } from "../minimap";
import { vaultMarkStyle } from "../treasure";
import {
	SECRET_CRACK_CELL,
	applySecretMapChange,
	inCellRect,
	secretChamberBuild,
	secretCrackIndices,
	secretMapChange,
	secretMarkStyle,
	secretRingRect,
	secretWallMergeGrid,
} from ".";

function secretLayouts(n: number): EndlessFloorLayout[] {
	const out: EndlessFloorLayout[] = [];
	for (let run = 1; out.size() < n && run < 200; run++)
		for (let floor = 2; floor <= 6 && out.size() < n; floor++) {
			const layout = endlessRunFloor(run, floor).layout;
			if (layout.secret !== undefined) out.push(layout);
		}
	return out;
}

const LAYOUTS = secretLayouts(6);

describe("secret geometry (docs/SECRET_ROOMS.md SR7)", () => {
	it("the ring holds the crack and the chamber; the merge grid leaves the crack out of every wall rect", () => {
		expect(LAYOUTS.size()).toBe(6);
		for (const layout of LAYOUTS) {
			const plan = layout.secret!;
			const d = layout.dungeon;
			const ring = secretRingRect(plan);
			const crack = secretCrackIndices(plan, d.W);
			for (const c of crack) expect(inCellRect(ring, c % d.W, math.floor(c / d.W))).toBe(true);
			expect([inCellRect(ring, plan.chestX, plan.chestY), inCellRect(ring, plan.x0, plan.y0)]).toEqual([true, true]);
			const grid = secretWallMergeGrid([...d.grid], d.W, plan);
			for (const c of crack) expect([d.grid[c], grid[c]]).toEqual([TileType.WALL, SECRET_CRACK_CELL]);
			const crackSet = new Set(crack);
			for (const r of greedyRectsOf(grid, d.W, d.H, TileType.WALL))
				for (let y = r.y; y < r.y + r.h; y++)
					for (let x = r.x; x < r.x + r.w; x++) expect(crackSet.has(y * d.W + x)).toBe(false);
			// No plan: the grid unchanged.
			const same = [...d.grid];
			expect(secretWallMergeGrid(same, d.W, undefined)).toEqual(d.grid);
		}
	});

	it("the chamber build: its floor, its own walls only, two torches on the back wall facing in", () => {
		for (const layout of LAYOUTS) {
			const plan = layout.secret!;
			const forge = layout.dungeon;
			const carved = plan.dungeon;
			const b = secretChamberBuild(plan, forge, carved);
			expect(b.floor).toEqual({ x: plan.x0, y: plan.y0, w: plan.w, h: plan.h });
			for (let y = plan.y0; y < plan.y0 + plan.h; y++)
				for (let x = plan.x0; x < plan.x0 + plan.w; x++) expect(tileAt(carved, x, y)).toBe(TileType.FLOOR);
			const ring = secretRingRect(plan);
			const wallCells = new Set<number>();
			for (const r of b.walls)
				for (let y = r.y; y < r.y + r.h; y++)
					for (let x = r.x; x < r.x + r.w; x++) {
						expect(wallCells.has(y * forge.W + x)).toBe(false);
						wallCells.add(y * forge.W + x);
					}
			for (let y = ring.y0; y <= ring.y1; y++)
				for (let x = ring.x0; x <= ring.x1; x++) {
					const want = tileAt(carved, x, y) === TileType.WALL && tileAt(forge, x, y) !== TileType.WALL;
					expect([x, y, wallCells.has(y * forge.W + x)]).toEqual([x, y, want]);
				}
			expect(b.torches.size()).toBe(2);
			for (const t of b.torches) {
				expect(tileAt(carved, t.x, t.y)).toBe(TileType.WALL);
				expect(tileAt(carved, t.x + t.fx, t.y + t.fz)).toBe(TileType.FLOOR);
				expect([t.fx, t.fz]).toEqual([plan.fx, plan.fz]);
			}
			expect([b.chestX, b.chestY, b.crack.size()]).toEqual([plan.chestX, plan.chestY, plan.cells]);
		}
	});
});

describe("the secret on the minimap (docs/SECRET_ROOMS.md SR8)", () => {
	it("unknown before the open; the open makes the tiles the carved grid's and reveals the chamber whole", () => {
		for (const layout of LAYOUTS) {
			const plan = layout.secret!;
			const tiles = minimapTiles(layout.dungeon, layout.stairwell);
			const W = tiles.W;
			const chest = plan.chestY * W + plan.chestX;
			expect(tiles.tile[chest]).toBe(MapTile.NONE);
			const fog = new FogOfWar(tiles);
			// A source in the crack's room, right in front of the crack: the room is revealed, the chamber is not.
			const front = { x: gridToWorld(plan.x) + plan.fx, z: gridToWorld(plan.y) + plan.fz };
			fog.update([front]);
			for (let y = plan.y0; y < plan.y0 + plan.h; y++)
				for (let x = plan.x0; x < plan.x0 + plan.w; x++) expect(fog.state(y * W + x)).toBe(FogState.UNKNOWN);
			const change = secretMapChange(tiles, plan);
			expect(change.cells.size()).toBeGreaterThan(0);
			const repaint = applySecretMapChange(tiles, change);
			expect(repaint).toEqual(change.cells);
			const carved = minimapTiles(plan.dungeon, layout.stairwell);
			let diffs = 0;
			for (let c = 0; c < W * tiles.H; c++) if (tiles.tile[c] !== carved.tile[c]) diffs++;
			expect(diffs).toBe(0);
			expect(secretMapChange(tiles, plan).cells.size()).toBe(0); // applied: nothing more
			fog.revealCells(change.reveal);
			for (let y = plan.y0; y < plan.y0 + plan.h; y++)
				for (let x = plan.x0; x < plan.x0 + plan.w; x++) expect(fog.state(y * W + x)).never.toBe(FogState.UNKNOWN);
			for (const c of secretCrackIndices(plan, W)) {
				expect(tiles.tile[c]).toBe(MapTile.FLOOR);
				expect(change.reveal.includes(c)).toBe(true);
			}
		}
	});

	it("the chest's mark: none while hidden, filled in the tier's floor role once open, hollow once taken", () => {
		const tier = 2;
		expect(secretMarkStyle(SecretStatus.NONE, tier)).toBe(undefined);
		expect(secretMarkStyle(SecretStatus.HIDDEN, tier)).toBe(undefined);
		expect(secretMarkStyle(SecretStatus.OPEN, tier)).toEqual({ role: treasureFloorRole(tier), style: "fill" });
		expect(secretMarkStyle(SecretStatus.TAKEN, tier)).toEqual({ role: treasureFloorRole(tier), style: "hollow" });
		// The vault's look.
		expect(secretMarkStyle(SecretStatus.OPEN, tier)).toEqual(vaultMarkStyle(VaultStatus.SEALED, tier, true));
	});
});
