// A secret room's drawn parts (docs/SECRET_ROOMS.md SR7, Track V2): the crack Part's rect and face, the overlay
// variant, the front box (KV_SecretLabel), the burst shards and the fallback rubble, by hand and on real secret floors.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SECRET, TileType, VaultTier, tileAt, type FloorSecret } from "shared/dungeon";
import { CHARGER, SecretStatus } from "shared/sim";
import { endlessRunFloor } from "shared/run";
import {
	SECRET_VIEW,
	inCellRect,
	newSecretShardLook,
	secretCrackList,
	secretCrackRect,
	secretCrackVariant,
	secretFaceName,
	secretFrontBox,
	secretLabelText,
	secretRoomPlansCharger,
	secretRubbleSpots,
	secretShardAt,
	type SecretCells,
} from ".";

/** A crack of 2 cells at (10, 5) along +X facing +Z (its room below it), a 4 x 3 chamber behind. */
const ALONG_X: SecretCells = {
	x: 10,
	y: 5,
	fx: 0,
	fz: 1,
	ax: 1,
	az: 0,
	cells: 2,
	x0: 9,
	y0: 1,
	w: 4,
	h: 3,
	along: 4,
	chestX: 10,
	chestY: 1,
};

/** The same turned: along +Z facing +X. */
const ALONG_Z: SecretCells = {
	x: 5,
	y: 10,
	fx: 1,
	fz: 0,
	ax: 0,
	az: 1,
	cells: 2,
	x0: 1,
	y0: 9,
	w: 3,
	h: 4,
	along: 4,
	chestX: 1,
	chestY: 10,
};

function realSecrets(n: number): FloorSecret[] {
	const out: FloorSecret[] = [];
	for (let run = 1; out.size() < n && run < 200; run++)
		for (let floor = 2; floor <= 6 && out.size() < n; floor++) {
			const s = endlessRunFloor(run, floor).layout.secret;
			if (s !== undefined) out.push(s);
		}
	return out;
}

describe("secret parts (docs/SECRET_ROOMS.md SR7)", () => {
	it("the crack rect covers exactly its cells, either way along", () => {
		expect(secretCrackRect(ALONG_X)).toEqual({ x: 10, y: 5, w: 2, h: 1 });
		expect(secretCrackRect(ALONG_Z)).toEqual({ x: 5, y: 10, w: 1, h: 2 });
	});

	it("the face toward the room", () => {
		expect([secretFaceName(1, 0), secretFaceName(-1, 0), secretFaceName(0, 1), secretFaceName(0, -1)]).toEqual([
			"Right",
			"Left",
			"Back",
			"Front",
		]);
	});

	it("the overlay variant is in range, fixed by the cell, 0 with one variant", () => {
		for (let x = 0; x < 20; x++) {
			const v = secretCrackVariant(x, 7, 3);
			expect(v >= 0 && v < 3 && v === math.floor(v)).toBe(true);
			expect(secretCrackVariant(x, 7, 3)).toBe(v);
			expect(secretCrackVariant(x, 7, 1)).toBe(0);
			expect(secretCrackVariant(x, 7, 0)).toBe(0);
		}
	});

	it("the front box is the cells in front of the crack, SECRET.frontDepth deep", () => {
		const d = SECRET.frontDepth;
		expect(secretFrontBox(ALONG_X)).toEqual({ x0: 10, y0: 6, x1: 11, y1: 5 + d });
		expect(secretFrontBox(ALONG_Z)).toEqual({ x0: 6, y0: 10, x1: 5 + d, y1: 11 });
		expect(secretFrontBox({ ...ALONG_X, fz: -1 })).toEqual({ x0: 10, y0: 5 - d, x1: 11, y1: 4 });
	});

	it("on real floors: the front box is FLOOR of the crack's room, the crack rect its cells", () => {
		const secrets = realSecrets(4);
		expect(secrets.size()).toBe(4);
		for (const s of secrets) {
			const box = secretFrontBox(s);
			for (let y = box.y0; y <= box.y1; y++)
				for (let x = box.x0; x <= box.x1; x++) expect(tileAt(s.dungeon, x, y)).toBe(TileType.FLOOR);
			const r = secretCrackRect(s);
			expect(r.w * r.h).toBe(s.cells);
			const ring = { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 };
			for (const c of secretCrackList(s)) expect(inCellRect(ring, c.x, c.y)).toBe(true);
		}
	});

	it("a shard starts on the face, flies out into the room, stays above the floor and fades out", () => {
		const n = SECRET_VIEW.burst.shards;
		const look = newSecretShardLook();
		for (let i = 0; i < n; i++) {
			secretShardAt(i, n, 0, 10, 5, look);
			// on the face (a left-fanned shard's along may be -0)
			expect([math.abs(look.along), look.out, look.up, look.transparency]).toEqual([0, 0, 0, 0]);
			secretShardAt(i, n, 0.3, 10, 5, look);
			expect(look.out > 0).toBe(true);
			expect(look.up >= 0).toBe(true);
			expect(look.transparency).toBe(0);
			secretShardAt(i, n, 1, 10, 5, look);
			expect(look.up >= 0).toBe(true);
			expect(look.transparency).toBe(1);
		}
		// fanned: the first and the last shard fly to opposite sides
		const a = secretShardAt(0, n, 0.5, 10, 5, newSecretShardLook()).along;
		const b = secretShardAt(n - 1, n, 0.5, 10, 5, newSecretShardLook()).along;
		expect(a < 0 && b > 0).toBe(true);
	});

	it("the fallback rubble: fallbackPieces blocks per cell, inside their cells, the same every call", () => {
		const R = SECRET_VIEW.rubble;
		const spots = secretRubbleSpots(ALONG_X);
		expect(spots.size()).toBe(R.fallbackPieces * ALONG_X.cells);
		for (let k = 0; k < spots.size(); k++) {
			const s = spots[k];
			const cell = secretCrackList(ALONG_X)[math.floor(k / R.fallbackPieces)];
			expect(math.abs(s.x - cell.x) <= R.spreadShare / 2).toBe(true);
			expect(math.abs(s.z - cell.y) <= R.spreadShare / 2).toBe(true);
			expect(s.sizeStuds >= R.fallbackStuds * R.minScale && s.sizeStuds <= R.fallbackStuds).toBe(true);
		}
		expect(secretRubbleSpots(ALONG_X)).toEqual(spots);
	});
});

describe("KV_SecretLabel's text (docs/SECRET_ROOMS.md Design 12)", () => {
	it("the tier, status and size, and whether the crack's room plans a Charger", () => {
		const spawns = [[{ kind: "swarmer", x: 0, z: 0 }], [{ kind: CHARGER.id, x: 1, z: 1 }]];
		expect([
			secretRoomPlansCharger(spawns, 0),
			secretRoomPlansCharger(spawns, 1),
			secretRoomPlansCharger(spawns, 5),
		]).toEqual([false, true, false]);
		const plan = { tier: VaultTier.LEGENDARY, along: 5, depth: 4 };
		expect(secretLabelText(plan, SecretStatus.HIDDEN, false)).toBe("legendary hidden 5x4");
		expect(secretLabelText(plan, SecretStatus.OPEN, true)).toBe("legendary open 5x4 charger");
	});
});
