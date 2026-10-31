import { IMP, SLIME, SLIME_SMALL, SUMMONER } from "shared/sim";
import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of the enemy variants (docs/ENEMY_VARIANTS.md EV9; logic in variants.ts and the sprite inputs
 * in sprites.ts). Presentation only: nothing here reaches the sim. Gameplay timings (telegraphs, the Vengeful delay,
 * puddle lives) are read from the sim's data, never copied here.
 */

/** Sprite inputs of the new archetypes (sprites.ts impSpriteInput / slimeSpriteInputOf / summonerSpriteInput). */
export const VARIANT_SPRITE_VIEW = {
	/** Move loops play at their authored fps at these ground speeds, world units / s (each archetype's walk speed). */
	impMoveRefSpeed: IMP.data.speed,
	slimeMoveRefSpeed: SLIME.data.speed,
	slimeSmallMoveRefSpeed: SLIME_SMALL.data.speed,
	summonerMoveRefSpeed: SUMMONER.data.speed,
	/**
	 * The summoner's animations: the summon cast (a named attack; `attack` when the set lacks it) and the panic ring.
	 * Tune by eye once its set lands (EV10).
	 */
	summonerAnims: { cast: "attack.2", panic: "attack" },
	/**
	 * Archetypes that share a sprite set with a bigger sibling and are drawn at their data.spriteScale on the sprite path
	 * too (`slime.small` wears `enemy.slime` at 0.6x). Every other sprite set is drawn at its own size (the bruiser's and
	 * the bosses' spriteScale size their placeholders only).
	 */
	spriteScaledIds: [SLIME_SMALL.id] as ReadonlyArray<string>,
} as const;

/**
 * Frame marks inside the new archetypes' attack animations (fractions of the frame count, like SPRITE_ANIM_MARKS):
 * placeholder halves until the art is measured (EV10).
 */
export const VARIANT_ANIM_MARKS = {
	/** The imp's `attack`: the crouch [0, land) over the blink wind-up, the landing / throw [land, 1] over the aim. */
	imp: { land: 0.5 },
} as const;

/** Elite affix looks (EVD12: a floor ring, the sprite rim's tint, the name chip, never a Highlight). */
export const AFFIX_VIEW = {
	/** The floor ring: its radius is the actor's (Hulking included) plus this margin, tiles. */
	ringMarginTiles: 0.2,
	/** The ring's pieces: fixed-size Parts of this width / height (studs), each at most `lengthTiles` of the circle. */
	ringDash: { width: 0.18, height: 0.03 },
	/** Longest piece of the ring, tiles (the dash length: pieces never leave a gap). */
	ringPieceTiles: 0.25,
	/** At least this many pieces per ring (small actors stay round). */
	ringMinPieces: 10,
	/**
	 * The ring's bottom above the floor, studs: over the sprite effects (top 0.074) and the goo decals (top 0.11), its top
	 * (0.15) under every telegraph and weapon marking (MARKING_VIEW.liftTiles x STUDS_PER_TILE = 0.16).
	 */
	ringLiftStuds: 0.12,
	ringTransparency: 0.15,
	folderName: "KV_AffixRings",
	/** Hulking's draw scale (radius / data radius) is snapped to steps of this (few pool keys; 1.2 stays 1.2). */
	scaleStep: 0.05,
	/** The affix name chip above the health bar: text height and minimum width, render px; gap above the bar's top. */
	chipPx: 5,
	chipMinWidthPx: 26,
	chipGapPx: 1,
	/** The shield segment: a row this many px tall on top of the bar's plate. */
	shieldRowPx: 1,
	/** A shield hit flashes the body in `enemyShield` for this many sim ticks (the hit flash's length). */
	shieldFlashTicks: 6,
	/**
	 * Vengeful corpse (EVD16): it stays opaque while armed and fades over the last `vengefulFadeTicks` of its held
	 * corpse time (the ring fires as it fades). Its pulse: the `telegraph` look, ACTOR_VIEW.telegraphPulseTicks on / off.
	 */
	vengefulFadeTicks: 8,
	vengefulPulseRole: "telegraph" as ColorRole,
} as const;

/** The Ooze's goo puddles (EVD5): drawn from BulletRenderController's goo pool as flat floor decals. */
export const GOO_VIEW = {
	/**
	 * The decal look on (the fallback, docs/ENEMY_VARIANTS.md Risks: false draws goo with the normal enemy bullet look
	 * from the normal pool; no sim change).
	 */
	decal: true,
	/** Pops in (scale 0 -> 1) over its first this many seconds of bullet time, ... */
	popSec: 0.1,
	/** ... and fades out over its last this many seconds. */
	fadeSec: 0.5,
	/**
	 * The disc's thickness and its bottom above the floor, studs: over the sprite effects (FX_SPRITE_VIEW top 0.074: goo
	 * hurts, an effect never hides it), under the affix rings and every marking (0.16) and every bullet (BULLET_Y).
	 */
	thicknessStuds: 0.03,
	liftStuds: 0.08,
	/** Quantum of the drawn scale and transparency writes (Size / Transparency written only on a change). */
	quantum: 0.1,
	folderName: "KV_Goo",
} as const;

/** The imp's blink (EV9): a puff at the spot it leaves and the spot it lands on (a chip burst in its colour). */
export const BLINK_VIEW = {
	puff: { chunks: 0, bits: 6, sparks: 4, startPx: 6, radius: 0.3, speed: 0.6 },
	/** Seed salt of the two puffs (render RNG). */
	seedSalt: 41,
} as const;
