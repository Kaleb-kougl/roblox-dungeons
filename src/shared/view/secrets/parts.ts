/**
 * A secret room's drawn parts (docs/SECRET_ROOMS.md SR7, Track V2): the pure half of SecretRenderController's crack
 * Part, burst shards, rubble stand-ins and the KV_SecretLabel outlines. Presentation only, every choice a hash of the
 * crack's cell (shared/view/decor decorHash, never math.random), so every co-op client and replay viewer draws the same.
 * Tested headlessly (parts.spec.ts).
 *
 *   secretCrackRect     the crack's cells as one TileRect (its own wall Part: buildWorldSlabs takes it like any wall)
 *   secretFaceName      the crack Part's face toward its room (a Roblox NormalId name: Right +X, Left -X, Back +Z, Front -Z)
 *   secretCrackVariant  which of the overlay art's variants a crack draws (`secret.crack` sprites' idle frames)
 *   secretFrontBox      the front box (where a player stands to open it): crackCells x SECRET.frontDepth in front
 *   secretShardAt       burst shard i's offset from the crack's face centre and its fade, at the burst's progress u
 *   secretRubbleSpots   the fallback rubble's blocks (no `secret.rubble` art) on the opened cells
 *   secretLabelText     KV_SecretLabel's text: news.ts secretDebugLabel plus " charger" when the crack's room plans one
 *                       (the Archer's third key; the Studio check's Charger room)
 *
 * @module
 */
import { SECRET, type ActorSpawn, type FloorSecret } from "shared/dungeon";
import { CHARGER } from "shared/sim";
import { decorHash, decorHash01 } from "../decor/hash";
import type { TileRect } from "../tileMerge";
import { SECRET_VIEW } from "./config";
import { secretDebugLabel } from "./news";
import { secretCrackList, type CellRect, type SecretCells } from "./geometry";

/** The crack's cells as one rectangle (along the wall from its first cell). */
export function secretCrackRect(plan: Readonly<SecretCells>): TileRect {
	const lastX = plan.x + plan.ax * (plan.cells - 1);
	const lastY = plan.y + plan.az * (plan.cells - 1);
	const x = math.min(plan.x, lastX);
	const y = math.min(plan.y, lastY);
	return { x, y, w: math.abs(lastX - plan.x) + 1, h: math.abs(lastY - plan.y) + 1 };
}

/** A box Part's face name. */
export type SecretFaceName = "Right" | "Left" | "Back" | "Front";

/** The face of an axis-aligned Part toward (fx, fz): +X Right, -X Left, +Z Back, -Z Front (Roblox NormalId names). */
export function secretFaceName(fx: number, fz: number): SecretFaceName {
	if (fx > 0) return "Right";
	if (fx < 0) return "Left";
	return fz > 0 ? "Back" : "Front";
}

/** The overlay variant (0 .. variants - 1) of the crack at (x, y): a hash of its first cell; 0 with one or none. */
export function secretCrackVariant(x: number, y: number, variants: number): number {
	if (variants <= 1) return 0;
	return decorHash(x, y, SECRET_VIEW.crack.variantSalt) % variants;
}

/** The front box: the crack's cells and SECRET.frontDepth cells in front of them (+f), inclusive. */
export function secretFrontBox(plan: Readonly<SecretCells>): CellRect {
	const r = secretCrackRect(plan);
	const d = SECRET.frontDepth;
	const x0 = plan.fx < 0 ? r.x - d : plan.fx > 0 ? r.x + 1 : r.x;
	const x1 = plan.fx < 0 ? r.x - 1 : plan.fx > 0 ? r.x + d : r.x + r.w - 1;
	const y0 = plan.fz < 0 ? r.y - d : plan.fz > 0 ? r.y + 1 : r.y;
	const y1 = plan.fz < 0 ? r.y - 1 : plan.fz > 0 ? r.y + d : r.y + r.h - 1;
	return { x0, y0, x1, y1 };
}

/** One burst shard's place this frame: tiles from the crack face's centre (along, out into the room, up) and its fade. */
export interface SecretShardLook {
	along: number;
	out: number;
	up: number;
	/** 0 (fully drawn) .. 1 (gone). */
	transparency: number;
}

/** A shard look to reuse (secretShardAt writes it). */
export function newSecretShardLook(): SecretShardLook {
	return { along: 0, out: 0, up: 0, transparency: 1 };
}

/**
 * Shard `i` of `n` at the burst's progress `u` (0 .. 1 over SECRET_VIEW.burst.sec), for the crack at (x, y): fanned
 * over burst.spreadDeg round the face's normal by its index (with a hashed jitter), flying at burst.speedTiles, rising
 * burst.riseTiles and falling under burst.gravityTiles, its height held at or above the floor; fading in the last
 * part (burst.fadeFrom on). Writes and returns `out`.
 */
export function secretShardAt(
	i: number,
	n: number,
	u: number,
	x: number,
	y: number,
	out: SecretShardLook,
): SecretShardLook {
	const B = SECRET_VIEW.burst;
	const jitter = decorHash01(x, y * n + i, B.seedSalt) - 0.5;
	const share = n > 1 ? i / (n - 1) - 0.5 : 0;
	const angle = math.rad((share + jitter / math.max(1, n)) * B.spreadDeg);
	const t = math.clamp(u, 0, 1) * B.sec;
	const speed = B.speedTiles * (1 + jitter * B.speedJitter);
	out.along = math.sin(angle) * speed * t;
	out.out = math.cos(angle) * speed * t;
	out.up = math.max(0, B.riseTiles * (1 + jitter * B.speedJitter) * t - (B.gravityTiles * t * t) / 2);
	out.transparency = u < B.fadeFrom ? 0 : math.clamp((u - B.fadeFrom) / (1 - B.fadeFrom), 0, 1);
	return out;
}

/** A fallback rubble block: its world centre (x, z), side and height in studs. */
export interface SecretRubbleSpot {
	readonly x: number;
	readonly z: number;
	readonly sizeStuds: number;
	readonly heightStuds: number;
}

/**
 * The fallback rubble (no `secret.rubble` art): SECRET_VIEW.rubble.fallbackPieces blocks per crack cell, each at a
 * hashed offset inside its cell (world units: a cell is 1 tile round its centre), side and height scaled by hash.
 */
export function secretRubbleSpots(plan: Readonly<SecretCells>): SecretRubbleSpot[] {
	const R = SECRET_VIEW.rubble;
	const out: SecretRubbleSpot[] = [];
	for (const c of secretCrackList(plan)) {
		for (let k = 0; k < R.fallbackPieces; k++) {
			const key = (c.y * R.fallbackPieces + k) * 2;
			const ox = decorHash01(c.x, key, R.seedSalt) - 0.5;
			const oz = decorHash01(c.x, key + 1, R.seedSalt) - 0.5;
			const s = R.minScale + (1 - R.minScale) * decorHash01(c.y, key, R.seedSalt);
			out.push({
				x: c.x + ox * R.spreadShare,
				z: c.y + oz * R.spreadShare,
				sizeStuds: R.fallbackStuds * s,
				heightStuds: R.fallbackHeightStuds * s,
			});
		}
	}
	return out;
}

/** Does room `room` plan a Charger among its deferred spawns (EndlessFloorWorld.roomSpawns)? */
export function secretRoomPlansCharger(roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>, room: number): boolean {
	const spawns = roomSpawns[room];
	if (spawns === undefined) return false;
	for (const s of spawns) if (s.kind === CHARGER.id) return true;
	return false;
}

/** KV_SecretLabel's text (developer English): secretDebugLabel, then " charger" when the crack's room plans one. */
export function secretLabelText(
	plan: Readonly<Pick<FloorSecret, "tier" | "along" | "depth">>,
	status: number,
	charger: boolean,
): string {
	return charger ? `${secretDebugLabel(plan, status)} charger` : secretDebugLabel(plan, status);
}
