/**
 * Sim world units <-> Workspace studs, render interpolation, and the mouse-aim ray onto the floor. Plain numbers, so
 * it is unit-tested headlessly.
 *
 * Sim world: x / z on the ground plane, 1 unit = 1 dungeon tile, floor at y = 0 (shared/dungeon collision.ts). Studs:
 * the same axes scaled by STUDS_PER_TILE and offset by GAME_WORLD.originStuds.
 *
 * @module
 */
import { STUDS_PER_TILE } from "shared/config";
import { GAME_WORLD } from "./config";
import type { Vec3 } from "./iso";

const [OX, OY, OZ] = GAME_WORLD.originStuds;

/** Sim world x -> studs x. */
export function studsX(x: number): number {
	return OX + x * STUDS_PER_TILE;
}

/** Sim world height (tiles above the floor) -> studs y. */
export function studsY(y: number): number {
	return OY + y * STUDS_PER_TILE;
}

/** Sim world z -> studs z. */
export function studsZ(z: number): number {
	return OZ + z * STUDS_PER_TILE;
}

/** Studs x -> sim world x. */
export function simX(studs: number): number {
	return (studs - OX) / STUDS_PER_TILE;
}

/** Studs z -> sim world z. */
export function simZ(studs: number): number {
	return (studs - OZ) / STUDS_PER_TILE;
}

/** The floor's height in studs. */
export function floorStudsY(): number {
	return OY;
}

/** prev -> cur by alpha in [0, 1] (the sim loop's interpolation, as the web views do it). */
export function lerp(prev: number, cur: number, alpha: number): number {
	return prev + (cur - prev) * alpha;
}

/**
 * Where a ray hits the horizontal plane y = planeY: the hit's (x, z), or undefined when the ray is parallel to the
 * plane or points away from it. The mouse aim: camera ray through the pointer, onto the floor.
 */
export function rayHitPlaneY(origin: Vec3, direction: Vec3, planeY: number): readonly [number, number] | undefined {
	const dy = direction[1];
	if (dy === 0 || dy !== dy) {
		return undefined;
	}
	const t = (planeY - origin[1]) / dy;
	if (!(t >= 0) || t === math.huge) {
		return undefined;
	}
	return [origin[0] + direction[0] * t, origin[2] + direction[2] * t];
}

/**
 * The mouse aim vector in sim units: from the player's sim position to where the camera ray through the pointer hits
 * the floor (studs). Undefined when the ray misses the floor plane.
 */
export function pointerAimFromRay(
	origin: Vec3,
	direction: Vec3,
	playerX: number,
	playerZ: number,
): readonly [number, number] | undefined {
	const hit = rayHitPlaneY(origin, direction, floorStudsY());
	if (hit === undefined) {
		return undefined;
	}
	return [simX(hit[0]) - playerX, simZ(hit[1]) - playerZ];
}
