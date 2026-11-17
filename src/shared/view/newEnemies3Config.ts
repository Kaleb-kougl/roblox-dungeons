import { JACKAL, MENDER, MORTAR } from "shared/sim";
import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of the fourth endless set (docs/NEW_ENEMIES_3.md NT7; logic in newEnemies3.ts, sprite inputs in
 * newEnemy3Sprites.ts, the per-tick feed in fx/newEnemy3Events.ts). Presentation only: nothing here reaches the sim.
 * Gameplay numbers (the draw, the flight, the link, the pulse, the wind-up, the hop, the stagger) are read from the
 * archetypes' data, never copied here. Placeholder looks; NT8 brings the art, NT13 the Studio check.
 */

/** Sprite inputs of the three (newEnemy3Sprites.ts). */
export const NEW_ENEMY_3_SPRITE_VIEW = {
	/** Move loops play at their authored fps at these ground speeds, world units / s (each archetype's walk speed). */
	mortarMoveRefSpeed: MORTAR.data.speed,
	menderMoveRefSpeed: MENDER.data.speed,
	jackalMoveRefSpeed: JACKAL.data.speed,
	/**
	 * The Mortar's lob: the draw (the bow straight up) stretched over the sim's draw, then the release held this many
	 * ticks into the flight (the `attack` timeline is the draw + this; NT8 measures the release frame).
	 */
	mortarReleaseTicks: 9,
	/**
	 * Animation names (theme contract ENEMY: `crouch` and `hop` are optional; NT8 maps the rigs). The Mender's link and
	 * bolt and the Jackal's lunge play `attack`; the Mender's bolt `attack.2` (absent: `attack`); the Mender's channel
	 * loops `attack`; the Jackal's wind-up `crouch` (absent: `attack`, the swarmer's way), its spooked hop `hop` (absent:
	 * skipped, it plays its move / idle), its stagger and the Mender's flinch `hit` stretched over the sim's timer.
	 */
	anims: { bolt: "attack.2", crouch: "crouch", hop: "hop", stagger: "hit", flinch: "hit" },
} as const;

/** The Mortar's shell in flight (Architecture 4, view-only): a small ball on an arc from its hand to the ring. */
export const SHELL_ARC_VIEW = {
	/** Peak height of the arc above the straight line, tiles (the shell goes up over the walls it fires across). */
	arcTiles: 3,
	/** Its start above the floor (the bow's hand), tiles; it lands on the floor at the ring. */
	handTiles: 0.9,
	/** Its part: a Neon ball this many studs across, in the role. */
	sizeStuds: 0.55,
	role: "enemyBullet" as ColorRole,
	/** Pooled shells (most in flight at once the view draws; the rest fly unseen, their rings still drawn). */
	pool: 16,
	folderName: "KV_NewEnemy3Marks",
	/** The shells' floor discs (BulletRenderController's shell DecalPool: the strike's disc, never its art or scorch). */
	discFolderName: "Shells",
} as const;

/** The Mender's heal tether (Architecture 4): a dashed run of small parts from its hands to the ally, in enemyHeal. */
export const HEAL_TETHER_VIEW = {
	role: "enemyHeal" as ColorRole,
	/** Links in studs (the Chainhook's chain size, thinner). */
	dash: { width: 0.14, height: 0.06, length: 0.45, gap: 0.2 },
	/** The beam at rest; the pulse layer (a second run over it) for pulseSec after each heal. */
	transparency: 0.35,
	pulseTransparency: 0,
	/** Sim seconds the pulse layer shows after a heal pulse. */
	pulseSec: 0.25,
	/** Over the markings, like the Chainhook's chain. */
	liftStuds: 0.2,
	pulseLiftStuds: 0.21,
	/** The tether starts this far out from the Mender's centre toward the ally (its hands; tiles past its radius). */
	handTiles: 0.05,
	/** It ends this far short of the ally's rim (tiles past the ally's radius), so it reads as touching the body. */
	allyGapTiles: 0,
} as const;

/** The `+` over a healed enemy (Architecture 4): a cross in enemyHeal that grows over plusSec (sim seconds). */
export const HEAL_PLUS_VIEW = {
	role: "enemyHeal" as ColorRole,
	/** Seconds each `+` shows (sim time: it freezes with the run). */
	plusSec: 0.5,
	/** Arm length at the start and the end (tiles); it sits this far screen-up of the ally's centre (tiles). */
	fromTiles: 0.18,
	toTiles: 0.4,
	offsetTiles: 0.55,
	dash: { width: 0.12, height: 0.04 },
	transparency: 0,
	liftStuds: 0.22,
	/** At most this many `+` at once (the oldest is reused). */
	max: 12,
} as const;

/** Particle bursts of the set (ParticleController chips; planned in newEnemies3.ts newEnemy3Bursts). */
export const NEW_ENEMY_3_BURSTS = {
	/** A shell landing: a dust burst at the ring (the shrapnel flies from it). */
	impact: { chunks: 3, bits: 10, sparks: 4, startPx: 8, radius: 0.5, speed: 2.4 },
	/** A heal pulse: sparks on the ally, in enemyHeal. */
	heal: { chunks: 0, bits: 5, sparks: 4, startPx: 4, radius: 0.2, speed: 1.2 },
	/** The beam cut: links flying off at the beam's middle, in enemyHeal. */
	snap: { chunks: 2, bits: 8, sparks: 4, startPx: 6, radius: 0.3, speed: 2 },
	/** Seed salts (render RNG), apart from every other burst's (the third set's are 61-66). */
	seedSalt: { impact: 71, heal: 72, snap: 73 },
	roles: {
		dust: "secret.dust" as ColorRole,
		heal: "enemyHeal" as ColorRole,
	},
} as const;

/** Sounds of the set (shared/view/audio AudioCueMapper; the six IDs are NT1's, NT10 picks the clips). */
export const NEW_ENEMY_3_AUDIO = {
	/**
	 * Minimum seconds between two starts of each (SFX_MIN_INTERVAL): two Mortars releasing or landing a moment apart are
	 * one sound; heal pulses of several Menders are a quiet hum, never a buzz; a pack's spooks one yelp.
	 */
	lobMinIntervalSec: 0.12,
	shellMinIntervalSec: 0.1,
	healMinIntervalSec: 0.25,
	spookMinIntervalSec: 0.12,
	/**
	 * The shrapnel bullets one shell's impact fires (the Mortar's ring): they count in enemySpawned on the impact tick but
	 * never play the enemy shot (the shell's own sound is the impact, NT0 finding 3). A full bullet pool fires fewer, so
	 * the skip can then hide another enemy's shot on that frame (the sound is per frame, not per bullet).
	 */
	shrapnelPerShell: MORTAR.data.shrapnel.count,
} as const;
