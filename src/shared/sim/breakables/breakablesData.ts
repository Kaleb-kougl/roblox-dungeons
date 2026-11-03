/**
 * Breakable clutter tunables in the sim (docs/DECOR.md D4, B3 / B4). Data only: breakables.ts reads it, nothing is
 * inline in the logic. Placement numbers are shared/dungeon breakablesData.ts (BREAKABLE); score points are
 * score/scoreData.ts (BREAKABLE_POINTS).
 *
 * Toughness (B4) in hits, derived from the real damage numbers: a piece has hp = its arrow hits x the bow's stream
 * arrow damage, a player bullet deals its payload damage, a sword swing its base damage, an enemy bullet 1 /
 * ENEMY_BULLETS_PER_ARROW of an arrow. With the bow's 1, the sword's 3 (finisher 6) and the heavy arrow's 4:
 *
 *            sword   arrows  enemy bullets   heavy arrow / finisher
 *   barrel   1       2       4               1
 *   crate    2       4       8               1
 *
 * (breakables.spec.ts checks this table against SWORD_DATA / BOW_DATA.) Boons that scale damage (Sharpened) do not
 * apply: the pieces take the base numbers.
 */
import { TILE_SIZE } from "../units";
import { BOW_DATA } from "../combat/weapons/defs/bow";

/**
 * Kind index of a piece (shared/dungeon BREAKABLE_PIECE_KINDS order: the clutter BREAKABLE_KINDS, then the vault's
 * chest, docs/TREASURE.md correction 2). Hashed. The CHEST is unbreakable (breakables.ts damageBreakable).
 */
export const BreakableKind = { BARREL: 0, CRATE: 1, CHEST: 2 } as const;
export type BreakableKindId = (typeof BreakableKind)[keyof typeof BreakableKind];

/** What dealt a piece's damage (presentation and scoring: only players' breaks score). */
export const BreakableSource = { MELEE: 0, PLAYER_BULLET: 1, ENEMY_BULLET: 2, SLAM: 3 } as const;
export type BreakableSourceId = (typeof BreakableSource)[keyof typeof BreakableSource];

/** B4: bow stream arrows that break a piece, by kind (barrel 2, crate 4). */
export const BREAKABLE_ARROW_HITS: ReadonlyArray<number> = [2, 4];
/** B4: an enemy bullet does this fraction of an arrow (barrel 4 bullets, crate 8). */
export const ENEMY_BULLETS_PER_ARROW = 2;

/** hp per kind: arrow hits x the arrow's damage. */
export const BREAKABLE_HP: ReadonlyArray<number> = BREAKABLE_ARROW_HITS.map((n) => n * BOW_DATA.damage);
/** Damage one enemy bullet deals to a piece. */
export const BREAKABLE_ENEMY_BULLET_DAMAGE = BOW_DATA.damage / ENEMY_BULLETS_PER_ARROW;
/** Melee: a piece is a circle of this radius round its cell centre (the half tile its square fills). */
export const BREAKABLE_HIT_RADIUS = 0.5 * TILE_SIZE;
/**
 * Mother Bramble's slam breaks every piece whose cell centre lies within this of her centre at impact. Nearly dormant
 * in real play: boss rooms get no pieces (shared/dungeon BREAKABLE.roomTypes), so the radius (which ignores walls) only
 * reaches a piece in a placed room that touches the boss room (measured: 1 of 240 boss floors, run seeds 1-60 x floors
 * 5-20, e.g. run 36 floor 5). Kept: harmless, and the specs cover it.
 */
export const BREAKABLE_SLAM_RADIUS = 3 * TILE_SIZE;
/** brokenTick of an intact piece. */
export const NOT_BROKEN = -1;
