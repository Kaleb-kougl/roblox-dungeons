import { BULWARK, CHAINHOOK, PYREKEEPER, SNATCHER } from "shared/sim";
import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of the third endless set (docs/NEW_ENEMIES_2.md NX7; logic in newEnemies2.ts, sprite inputs in
 * newEnemy2Sprites.ts, the per-tick feed in fx/newEnemy2Events.ts). Presentation only: nothing here reaches the sim.
 * Gameplay numbers (the shield's cone and cover, aim / drag ticks, the stomach, the light telegraph) are read from the
 * archetypes' data, never copied here. Placeholder looks: NX8 brings the art, NX13 the Studio check.
 */

/** Sprite inputs of the five (newEnemy2Sprites.ts). */
export const NEW_ENEMY_2_SPRITE_VIEW = {
	/** Move loops play at their authored fps at these ground speeds, world units / s (each archetype's walk speed). */
	bulwarkMoveRefSpeed: BULWARK.data.speed,
	chainhookMoveRefSpeed: CHAINHOOK.data.speed,
	snatcherMoveRefSpeed: SNATCHER.data.speed,
	pyrekeeperMoveRefSpeed: PYREKEEPER.data.speed,
	/**
	 * Animation names (theme contract ENEMY: `block` is optional; NX8 maps the rigs): the Shieldwall holds `block` while
	 * it guards standing (absent: idle) and plays `hit` (TakeDamage) stretched over the whole stagger (slowed).
	 */
	anims: { block: "block", stagger: "hit" },
} as const;

/** The Shieldwall's guard arc (docs/NEW_ENEMIES_2.md Architecture 4): a faint dashed arc in front of a guarding one. */
export const GUARD_VIEW = {
	/**
	 * The arc's radius: the body's radius plus this, tiles (just outside the body; the cover reach is the sim's). It
	 * spans the shield's front cone (BULWARK.data.frontCos, ~140 degrees).
	 */
	marginTiles: 0.18,
	role: "enemyGuard" as ColorRole,
	/** Dash sizes in studs (the aura ring's convention). */
	dash: { width: 0.14, height: 0.03, length: 0.45, gap: 0.2 },
	/** Faint: the facing should read at a glance without competing with bullets. */
	transparency: 0.45,
	/** Over the aura / affix rings (0.119 / 0.12), under every marking. */
	liftStuds: 0.125,
	folderName: "KV_NewEnemy2Marks",
} as const;

/** The Chainhook's chain (Architecture 4): a dashed run of small parts from it to the flying hook, then to the hooked. */
export const CHAIN_VIEW = {
	/** The chain draws in enemyOutline (no new role, Architecture 3) unless NX8 shows it needs one. */
	role: "enemyOutline" as ColorRole,
	/** Links in studs. */
	dash: { width: 0.16, height: 0.08, length: 0.5, gap: 0.25 },
	transparency: 0,
	/** Over the markings (MARKING_VIEW.liftTiles), so it reads over the aim line it replaces. */
	liftStuds: 0.2,
	/** The chain starts this far out from the Chainhook's centre toward the hook (its hand; tiles past its radius). */
	handTiles: 0.05,
	/** The hook's placeholder wedge (BulletRenderController): its length, x the enemy ball's diameter. */
	hookLengthScale: 1.6,
} as const;

/** The Snatcher's belly (Architecture 4): pips for its carried pellets, a pulse while it swallows. */
export const BELLY_VIEW = {
	/** One pip per carried pellet up to the sim's stomach (5): slots evenly spaced on a ring round it. */
	pips: SNATCHER.data.stomach,
	/** The ring's radius: the body's radius plus this, tiles. */
	marginTiles: 0.12,
	/** Each pip is a small cross of two strokes this long (tiles), in the pellet's colour. */
	pipTiles: 0.12,
	role: "pellet.normal" as ColorRole,
	/** Stroke cross-section in studs. */
	dash: { width: 0.1, height: 0.04 },
	transparency: 0.1,
	liftStuds: 0.16,
	/** The swallow telegraph: the pips pulse out to radius x (1 + pulseAmp) this many times a second. */
	pulseHz: 4,
	pulseAmp: 0.6,
} as const;

/** The Pyre-keeper's torch (Architecture 4, view-only): a small flame flying from it to the landing cell. */
export const TORCH_VIEW = {
	/** The flight's last share of the light telegraph (the torch lands as the pyre spawns). */
	flightShare: 0.6,
	/** Peak height of the arc above the floor, tiles. */
	arcTiles: 1.4,
	/** Its part: a Neon cube this many studs a side, in DECOR_FX_TINT.flame. */
	sizeStuds: 0.45,
	role: "decor.fx.flame" as ColorRole,
} as const;

/** The pyre's flame and glow (Architecture 4): the decor brazier's look in placeholder terms (the art is NX8's). */
export const PYRE_FLAME_VIEW = {
	/** A Neon cube over the bowl, this many studs a side at full flame, in DECOR_FX_TINT.flame. */
	sizeStuds: 0.9,
	/** Its centre above the floor, tiles. */
	heightTiles: 0.55,
	role: "decor.fx.flame" as ColorRole,
	/** The flicker: size x (1 + amp x noise), noise a sum of sines at these frequencies (Hz), phased per actor id. */
	flickerAmp: 0.18,
	flickerHz: [5.3, 8.9] as ReadonlyArray<number>,
	/** While it lights (the sim's 0.5 s lighting) the flame grows from this share of its size. */
	lightingFrom: 0.25,
	/** The glow: a PointLight per lit pyre (range in tiles, brightness: DECOR_LIGHTS' torch values, never over max). */
	lightRangeTiles: 4,
	lightBrightness: 0.8,
	/** Pooled flames (most pyres alive at once on a floor the view keeps lit; more are drawn without a flame). */
	pool: 12,
} as const;

/** The pellets a dead Snatcher puts back (docs/NEW_ENEMIES_2.md Architecture 4): each flies from its corpse home. */
export const PELLET_RETURN_VIEW = {
	/** The flight's length (sim seconds) and its hop (tiles, at the middle). Reduced motion: no flight. */
	flySec: 0.35,
	hopTiles: 0.6,
} as const;

/** Particle bursts of the set (ParticleController chips; planned in newEnemies2.ts newEnemy2Bursts). */
export const NEW_ENEMY_2_BURSTS = {
	/** A blocked hit: sparks in enemyGuard. */
	block: { chunks: 0, bits: 4, sparks: 6, startPx: 5, radius: 0.15, speed: 2.2 },
	/** A guard break: a larger burst in enemyGuard at the Shieldwall. */
	guardBreak: { chunks: 3, bits: 10, sparks: 10, startPx: 8, radius: 0.4, speed: 2.6 },
	/** The chain snapping (a break, not an arrival or a timeout): links flying off at the chain's middle. */
	snap: { chunks: 2, bits: 8, sparks: 4, startPx: 6, radius: 0.3, speed: 2 },
	/** A pellet stolen: a gulp at the pellet's cell, in its colour. */
	gulp: { chunks: 0, bits: 5, sparks: 2, startPx: 4, radius: 0.12, speed: 1.4 },
	/** A swallowed pellet: a fizzle on its cell. */
	fizzle: { chunks: 0, bits: 6, sparks: 0, startPx: 4, radius: 0.15, speed: 0.8 },
	/** A pyre gone out (withered or killed): a puff in DECOR_FX_TINT.flame. */
	puff: { chunks: 1, bits: 8, sparks: 3, startPx: 6, radius: 0.35, speed: 1.6 },
	/** Seed salts (render RNG), apart from every other burst's. */
	seedSalt: { block: 61, guardBreak: 62, snap: 63, gulp: 64, fizzle: 65, puff: 66 },
	roles: {
		guard: "enemyGuard" as ColorRole,
		chain: "enemyOutline" as ColorRole,
		pellet: "pellet.normal" as ColorRole,
		flame: "decor.fx.flame" as ColorRole,
	},
} as const;

/** Sounds of the set (shared/view/audio AudioCueMapper): the snatch is the pellet chomp's clip pitched down (NX1). */
export const NEW_ENEMY_2_AUDIO = {
	/** Playback speed of sfx.enemy.snatch (and of its fallback, sfx.pellet.eat): a fifth down. */
	snatchSpeed: 0.67,
} as const;
