/**
 * Build effect bullets on screen (docs/BUILDS.md BU8): which look a player bullet is drawn with, by its payload kind
 * (the sim's BulletKind BURST / SHARD / SPARK_BOLT; every other kind is the weapon's bolt, heavy by draw scale as
 * before), whether its look has a trail, which pool draws it (embers go to the floor decal pool while
 * BUILD_BULLET_VIEW.ember.decal is on) and an ember decal's pop-in / fade-out. Pure; BulletRenderController applies it.
 */
import { BulletKind, BulletPayload } from "shared/sim";
import { BUILD_BULLET_IDS } from "shared/theme";
import { BULLET_VIEW } from "./config";
import { BUILD_BULLET_VIEW } from "./buildBulletsConfig";
import { isEmberPayload } from "./fx/buildFxEvents";

/** A player bullet's look (index into PLAYER_BULLET_LOOK_IDS). */
export const PlayerBulletLook = {
	BASIC: 0,
	HEAVY: 1,
	BURST: 2,
	SHARD: 3,
	BOLT: 4,
	EMBER: 5,
} as const;
export type PlayerBulletLookId = (typeof PlayerBulletLook)[keyof typeof PlayerBulletLook];

/** The theme visual of each look (PlayerBulletLook order). */
export const PLAYER_BULLET_LOOK_IDS: ReadonlyArray<string> = [
	BULLET_VIEW.playerVisualId,
	BULLET_VIEW.heavyVisualId,
	BUILD_BULLET_IDS[0],
	BUILD_BULLET_IDS[1],
	BUILD_BULLET_IDS[3],
	BUILD_BULLET_IDS[2],
];

/** Looks drawn with a trail (burst and shard bolts). */
const TRAILED: ReadonlyArray<PlayerBulletLookId> = [PlayerBulletLook.BURST, PlayerBulletLook.SHARD];

/**
 * The look of a player bullet with `payload` at draw scale `scale`: burst / shard / bolt by kind; an ember (only when
 * the decal pool is off) the ember look; anything else the weapon's bolt, heavy above BULLET_VIEW.heavyScaleThreshold.
 */
export function playerBulletLookOf(payload: number, scale: number): PlayerBulletLookId {
	const kind = BulletPayload.get(payload, "kind");
	if (kind === BulletKind.BURST) return PlayerBulletLook.BURST;
	if (kind === BulletKind.SHARD) return PlayerBulletLook.SHARD;
	if (kind === BulletKind.SPARK_BOLT) return PlayerBulletLook.BOLT;
	if (kind === BulletKind.EMBER) return PlayerBulletLook.EMBER;
	return scale > BULLET_VIEW.heavyScaleThreshold ? PlayerBulletLook.HEAVY : PlayerBulletLook.BASIC;
}

/** True when a look draws a trail behind the bolt (before the setting: buildTrailsOn). */
export function lookHasTrail(look: PlayerBulletLookId): boolean {
	return TRAILED.includes(look);
}

/** Which player bullet pool draws `payload`: embers go to the decal pool while the decal look is on. */
export function playerBulletPool(payload: number, decal: boolean = BUILD_BULLET_VIEW.ember.decal): "ember" | "player" {
	return decal && isEmberPayload(payload) ? "ember" : "player";
}

/** An ember decal's look this frame (drawn scale 0..1, transparency 0 opaque .. 1 gone). */
export interface EmberLook {
	scale: number;
	transparency: number;
}

/**
 * An ember with `lifeLeft` of its `totalLife` seconds (bullet time): pops in (scale 0 -> 1) over ember.popSec and fades
 * out over its last ember.fadeSec, like the goo decal. Writes `out` and returns it.
 */
export function emberDecalLook(lifeLeft: number, totalLife: number, out: EmberLook): EmberLook {
	const e = BUILD_BULLET_VIEW.ember;
	const age = totalLife - lifeLeft;
	out.scale = e.popSec > 0 ? math.clamp(age / e.popSec, 0, 1) : 1;
	out.transparency = e.fadeSec > 0 ? 1 - math.clamp(lifeLeft / e.fadeSec, 0, 1) : 0;
	return out;
}
