import { BOSS_ACT1_DATA, BRUISER, DEMONLORD_DATA, HURT_INVULN_TICKS, PLAYER_SPEED, SNIPER, SWARMER } from "shared/sim";
import type { ColorRole } from "shared/theme";
import type { TopFaceUV } from "./floorTexture";

/**
 * Presentation tunables for the client's game views (task 8): camera rig, world placement, draw sizes, pools and
 * timings of the placeholder renderers. Presentation only: nothing here reaches the sim (gameplay numbers live in
 * shared/sim data), so changing a value here can never change a replay.
 *
 * Sources (project-kaleb-vale @ 42897e2) are named per value; values without a source are Roblox-port choices.
 */

/** Iso camera rig (spike B, docs/SPIKES.md). Yaw / pitch / view height come from shared/config view.ts. */
export const GAME_CAMERA = {
	/** Vertical field of view, degrees: the spike's chosen narrow FOV (7) passes for an orthographic camera. */
	fovDeg: 7,
	/** Follow damping time constant, seconds. The web IsoCamera's damp lambda 6 (1/s) -> tau = 1/6 s. */
	followTauSec: 1 / 6,
	/** Snap the camera to this many render texels (1 = the web build's texel grid; 0 = off). */
	snapTexels: 1,
	/** Frames longer than this (seconds) are clamped for the follow (web IsoCamera: min(delta, 0.1)). */
	maxFollowDtSec: 0.1,
} as const;

/** Where the dungeon sits in Workspace and how tall its pieces are. */
export const GAME_WORLD = {
	/**
	 * Studs position of sim world (0, 0, 0) (floor level). Raised clear of a template Baseplate (its top is y = 0),
	 * so floors never z-fight it and the default character, if one spawns, stays out of view under the backdrop.
	 */
	originStuds: [0, 64, 0] as readonly [number, number, number],
	/** Wall height in tiles (web DungeonFloor wallHeight = 1). */
	wallHeightTiles: 1,
	/** Pool tops sit this far below the floor, tiles (web DungeonFloor POOL_SINK). */
	poolSinkTiles: 0.18,
	/** Pool slab thickness, tiles (web DungeonFloor FLOOR_THICKNESS). */
	poolThicknessTiles: 0.1,
	// The backdrop's depth under the floor is the abyss's: voidDecor VOID.abyssDepthTiles (docs/VOID_DECOR.md VD3).
	/** Backdrop thickness, tiles. */
	backdropThicknessTiles: 0.25,
	/**
	 * The backdrop extends this far past the dungeon on every side, tiles: past the screen corners' reach on its plane
	 * (shared/view portrait backdropReachTiles: 23.7 for a 21:9 landscape, 26.8 upright at PORTRAIT.maxAspect with the
	 * lift; docs/PORTRAIT.md PT4, was 24).
	 */
	backdropMarginTiles: 28,
	/**
	 * How a floor Texture's U / V map to world axes on a Top face (floorTexture.ts). Assumed: U along +X, V along +Z,
	 * OffsetStuds added. Check in Studio (S0 / S5): if slab joins show seams, flip the sign that is wrong.
	 */
	floorTextureUV: { uAxis: "x", uSign: 1, vSign: 1, offsetSign: 1 } as TopFaceUV,
	folderName: "KV_World",
} as const;

/** Bullets (web src/bullets/BulletsView.tsx). Sizes are presentation only; hitboxes live in shared/sim. */
export const BULLET_VIEW = {
	/** Drawn enemy bullet radius, tiles (web ENEMY_BULLET_DRAW_RADIUS). */
	enemyDrawRadius: 0.17,
	/** Drawn player arrow half-length, tiles (web PLAYER_BULLET_DRAW_RADIUS). */
	playerDrawHalfLength: 0.3,
	/** Logical IDs of the placeholders. */
	enemyVisualId: "bullet.enemy.small",
	playerVisualId: "bullet.player.basic",
	heavyVisualId: "bullet.player.heavy",
	/** Player bullets whose draw scale exceeds this use the heavy visual. */
	heavyScaleThreshold: 1,
	/** Sizes are written only when they change by more than this fraction (fade shrink is quantized). */
	sizeQuantum: 0.125,
	/** Unused pool parts are parked here (studs, far below the world). */
	parkedStuds: [0, -10000, 0] as readonly [number, number, number],
	folderName: "KV_Bullets",
	profileLabel: "KV Bullets",
} as const;

/** Actors and the player (web src/sim/PlayerView.tsx, src/bullets/ActorsView.tsx). */
export const ACTOR_VIEW = {
	/** Theme asset shown for the player until class selection exists (web PLAYER_SPRITE_ID). */
	playerVisualId: "class.vanguard",
	/**
	 * The ring under each player (a logical image ID): drawn instead of the facing pip when the pack has it as an image
	 * and draws the player as a sprite set (the 8-way sprite shows the facing).
	 */
	ringVisualId: "ui.ring.player",
	/** Facing pip on the floor in front of the player (a logical UI ID; presentation only). */
	facingPipVisualId: "ui.cursor",
	/** Pip distance ahead of the player's center, tiles. */
	facingPipDistance: 0.75,
	/** Post-hit blink: visible / hidden for this many sim ticks each (web BLINK_TICKS). */
	blinkTicks: 4,
	/** Telegraph tint pulses on and off every this many sim ticks (web TELEGRAPH_PULSE_TICKS). */
	telegraphPulseTicks: 4,
	/** Bosses are drawn at least this many sprite pixels wide (web BOSS_MIN_DRAW_PX). */
	bossMinDrawPx: 40,
	/** Placeholder lift above the floor, studs (keeps bases off the floor slab). */
	liftStuds: 0.02,
	/**
	 * Colour roles of the actor looks (placeholders: Part colour; sprites: ImageColor3, which multiplies, so a tint, never
	 * a white flash). flash: hit flash; telegraph: wind-up pulse; iframes: dodge i-frames; dead: the dead player.
	 */
	lookRoles: {
		flash: "damageNumber",
		telegraph: "telegraph",
		iframes: "playerBullet",
		dead: "uiTextDim",
	} as { readonly [K in "flash" | "telegraph" | "iframes" | "dead"]: ColorRole },
	folderName: "KV_Actors",
} as const;

/**
 * Floor markings (telegraphs, weapon arcs, the arena seal): dashed lines of fixed-size Parts, moved with one
 * BulkMoveTo per layer. Telegraph dashes use the theme's TELEGRAPH_VISUAL; the other layers' dash specs are here.
 */
export const MARKING_VIEW = {
	/** Height of floor markings above the floor, tiles (web FX_Y / LINE_Y). */
	liftTiles: 0.04,
	/** Longest straight piece an arc is cut into, tiles (web LineBatch.arc: 0.35). */
	arcStepTiles: 0.35,
	/** Weapon arcs: dash width / height / length and gap, studs (denser than telegraph dashes). */
	weaponDash: { width: 0.2, height: 0.12, length: 0.5, gap: 0.25 },
	/** Arena seal: a translucent fence of taller dashes, studs. */
	sealDash: { width: 0.4, height: 2, length: 1.5, gap: 0.5 },
	/** Transparency of the dim telegraph layer and of the seal fence. */
	dimTransparency: 0.55,
	sealTransparency: 0.35,
	folderName: "KV_Markings",
} as const;

/** Telegraph previews (web src/bullets/ActorsView.tsx ActorFx, src/boss/BossView.tsx). */
export const TELEGRAPH_VIEW = {
	/** Fan lanes / spiral arms are drawn this long, tiles (web LANE_LENGTH, ARM_LENGTH). */
	laneLength: 7,
	armLength: 5,
	/** The last ticks of a wind-up blink (web BLINK_TICKS) and the blink period, ticks. */
	blinkTicks: 12,
	blinkPeriodTicks: 3,
	/** A wind-up switches from the dim to the bright layer past this fraction (web: brightness 0.45 -> 1.2). */
	brightFrom: 0.5,
	/** Ring previews: radii past the boss's body, tiles (web BossView ringArcs calls). */
	ringOffset: 0.9,
	ringOffsetOuter: 1.6,
	doubleRingOffsetOuter: 2,
	/** Gap-edge ticks: half length, tiles. */
	tickHalf: 0.5,
	/** Spiral arrow head: turn (radians), barb angle offset (radians) and length (tiles). */
	spiralHeadTurn: 0.35,
	spiralBarbAngle: math.pi / 2 + 2.4,
	spiralBarbLength: 0.5,
	/** Slam shockwave previews: radii past the body, tiles. */
	slamOffset: 1,
	slamOffsetSecond: 1.8,
	/** Roar flash: radius at the end of the roar, tiles (web ROAR_RADIUS), and the inner ring's fraction. */
	roarRadius: 7,
	roarStart: 0.5,
	roarInner: 0.7,
	/** The Demon Lord's summon preview: a ring this big (radius, tiles) on each add's landing spot. */
	summonSpotRadius: 0.5,
	/** Generic wind-up ring around an actor without its own preview, tiles past its body. */
	genericRingOffset: 0.4,
} as const;

/** Weapon visuals (web src/bullets/WeaponView.tsx). */
export const WEAPON_VIEW = {
	/**
	 * Sim ticks a combo swing / the finisher stays visible (web SWING_SHOW_TICKS 8, FINISHER_SHOW_TICKS 12), 20%
	 * slower like the retuned sword (SWORD_DATA), rounded to whole ticks.
	 */
	swingShowTicks: 10,
	finisherShowTicks: 14,
	/** Ticks the blade edge takes to cross the fan (web BLADE_SWEEP_TICKS 4; 20% slower like the sword). */
	bladeSweepTicks: 5,
	/** Ticks the heavy-arrow release ring expands (web RELEASE_SHOW_TICKS). */
	releaseShowTicks: 8,
	/** Inner arcs drawn inside a swing fan, as fractions of its reach (the placeholder's "fill"). */
	fanFill: [0.45, 0.75] as ReadonlyArray<number>,
	/** Bow charge ring radius and aim line length range, tiles (web RingGeometry(0.6, 0.72), aim 0.7 + 1.3 * charge). */
	chargeRingRadius: 0.66,
	aimLineMin: 0.7,
	aimLineGrow: 1.3,
	/** Release ring radius range, tiles (web 0.6 + 0.9 * t). */
	releaseRadiusMin: 0.6,
	releaseRadiusGrow: 0.9,
	/** Finisher wind-up preview scale range (web 0.35 + 0.65 * t). */
	windupScaleMin: 0.35,
	/** Guard: the first fraction of the guard flashes (web g > 0.8). */
	guardFlashFrom: 0.8,
} as const;

/** BindToRenderStep priority offsets (added to Enum.RenderPriority values by the controllers). */
export const RENDER_ORDER = {
	/** Touch controls: mode, layout and finger state, before the sim samples input (simAfterInput). */
	touchBeforeSim: 0,
	/** After Input: sample input once, then run the frame's ticks. */
	simAfterInput: 1,
	/** Right after the sim: the FX hit tracker diffs the new state and dispatches juice / audio events. */
	fxAfterSim: 2,
	/**
	 * After the FX tracker: the tutorial director (TutorialController) reads the frame's state, events and raw
	 * buttons, pushes the tutorial HUD state and fires the funnel steps (tutorial runs only).
	 */
	tutorialAfterFx: 3,
	/** After the default camera (Camera = 200), so the scriptable rig wins (same as spike B). */
	cameraAfterCamera: 1,
	/** Renderers run after the camera so every view uses the same frame's alpha. */
	viewsAfterCamera: 2,
} as const;

/**
 * Sprite renderer (docs/ART.md S4; logic in sprites.ts). Gameplay timings are NOT here: one-shots are stretched over
 * the sim's own timers (roll, swing, hurt, corpse). Reference speeds are read from the sim's data, not copied.
 */
export const SPRITE_VIEW = {
	/**
	 * Extra camera-ward shift of every billboard, studs, ON TOP of the floor clearance spriteBillboard computes from the
	 * layout and pitch (sprite tops vs walls behind / in front; tuned in S0).
	 */
	depthBiasStuds: 0,
	/** Added to the computed floor clearance so the lowest pixel row sits just above the floor, studs. */
	floorClearanceMarginStuds: 0.05,
	/** The player's run loop plays at its authored fps at this ground speed, world units / s (the walk speed). */
	playerRunRefSpeed: PLAYER_SPEED,
	/** The swarmer's move loop plays at its authored fps at this ground speed, world units / s (its walk speed). */
	swarmerMoveRefSpeed: SWARMER.data.speed,
	/** The sniper's move loop plays at its authored fps at this ground speed, world units / s (its walk speed). */
	sniperMoveRefSpeed: SNIPER.data.speed,
	/**
	 * The Demon Lord's move loop (chase, walk home, the charge) plays at its authored fps at this ground speed, world
	 * units / s: his chase speed (the walk home at data.speed plays slower, the charge at loopRateMax).
	 */
	demonlordMoveRefSpeed: DEMONLORD_DATA.chaseSpeed,
	/**
	 * Which of the boss set's animations each Demon Lord action plays (docs/BOSS_DEMONLORD.md D6; tune by eye in D7).
	 * Optional ones (attack.2, intro, taunt) fall back when the set lacks them: a named attack to `attack`, a special
	 * (intro, taunt, summon) to whatever plays without it (idle).
	 */
	demonlordAnims: {
		/** CLEAVE and DOUBLE_CLEAVE: the overhead swing, over the telegraph and the whole active span. */
		cleave: "attack",
		/** HELLFIRE: the level swing, over the telegraph and the hold. */
		hellfire: "attack.2",
		/** CHARGE: the level swing from the impact tick, over the impact hold (the run itself plays `move`). */
		impact: "attack.2",
		/** SUMMON (a special): rising from the crouch, over the telegraph and the hold. */
		summon: "intro",
		/** The intro roar (phase 1) and the phase-change taunt (phases 2-3), over the roar's timer. */
		intro: "intro",
		taunt: "taunt",
	},
	/**
	 * A boss sprite's death is stretched over this fraction of its corpse time and holds its last frame while the
	 * corpse fades over the rest (bossCorpseFadeFrom): the Demon Lord's death darkens and holds, so a fade from the
	 * first frame would hide it. Placeholder bosses and the swarmer fade over the whole corpse time.
	 */
	bossDeathCorpseFraction: 0.6,
	bossCorpseFadeFrom: 0.6,
	/** The bruiser's move loop plays at its authored fps at this ground speed, world units / s (its plod). */
	bruiserMoveRefSpeed: BRUISER.data.speed,
	/** Mother Bramble's (boss.act1) move loop (REPOSITION, the walk back to the centre) plays at its fps at this speed. */
	bossAct1MoveRefSpeed: BOSS_ACT1_DATA.speed,
	/** Below this fraction of the reference speed a body counts as standing (idle): wall slides, separation nudges. */
	moveMinFraction: 0.1,
	/** Run / move loop rate (speed / reference speed) is clamped to this range (flask walk 0.5, pushes, teleports). */
	loopRateMin: 0.25,
	loopRateMax: 2,
	/**
	 * The player's hit flinch is stretched over the first this many ticks of the post-hit invulnerability
	 * (PlayerState.hurtTicks). Default: all of it. Shorten in Studio if the flinch reads as a slide while running.
	 */
	playerHitTicks: HURT_INVULN_TICKS,
	/** An actor's death is stretched over this fraction of its corpse time; the rest holds the last frame. */
	deathCorpseFraction: 1,
	/** The animation clock runs on sim time; a frame's step is capped at this many seconds (hitches, run changes). */
	maxAnimDtSec: 0.25,
	/** Side of the invisible feet-anchor Part a sprite's BillboardGui is adorned to, studs. */
	anchorStuds: 0.1,
	/** The `ui.ring.player` ring under each player: a flat floor Part this thick (studs), lifted by ACTOR_VIEW.liftStuds. */
	ringThicknessStuds: 0.05,
	/** Ring tint (ImageColor3-style multiply on a Decal): the local player, and teammates in co-op. */
	ringLocalRole: "uiAccent" as ColorRole,
	ringTeammateRole: "uiTextDim" as ColorRole,
} as const;

/**
 * Frame marks inside the phased attack animations (docs/BRAMBLE_ART.md BR4, docs/DEMON_ART.md DA4; logic in sprites.ts):
 * where a wind-up ends and its release (the strike, the take-off, the landing, the impact) begins, so the release frame
 * shows on the tick the sim fires. A mark is a FRACTION of the animation's frame count, resolved per set as frame
 * round(mark * frames) clamped to the animation (sprites.ts segmentStart / segmentLength), so it works for any frame
 * count and survives a re-cut; to pin frame k of an n-frame animation, write k / n. A segment always keeps >= 1 frame.
 *
 * Measured on the 2D Demons art (docs/DEMON_ART.md DA1 / DA3, docs/BRAMBLE_ART.md BR1 / BR3): the k / n below are
 * kept-frame indices of the sets in art/atlases.json (the source frame in brackets). Gameplay timings are NOT here
 * (they are read from the sim's data).
 */
export const SPRITE_ANIM_MARKS = {
	/** Mother Bramble (boss.act1, Demon Elite 3): wind-up = frames [0, release), played over the attack's telegraph. */
	bossAct1: {
		/**
		 * `attack` (Attack 1, the horizontal sweep, 6 frames; FAN, FAST_FAN): the release, index 3 [f5] (wind-up 0-2,
		 * contact 4, follow-through 5). The release replays once per volley.
		 */
		fanRelease: 3 / 6,
		/** `attack.2` (Attack 2, the overhead strike, 6 frames; RING, DOUBLE_RING): release index 3 [f5], on each ring's tick. */
		ringRelease: 3 / 6,
		/**
		 * `attack.3` (Attack 3, a 360 spin, 6 frames; SPIRAL): indices 0-1 over the telegraph; [this, end) = indices 2-5,
		 * one revolution, loop at the animation's fps through the channel.
		 */
		spiralRelease: 2 / 6,
		/** `attack.4` (Attack 4, the leap, 8 frames; SLAM): take-off index 3 [f4]; the crouch 0-2 plays over the telegraph. */
		slamTakeoff: 3 / 8,
		/** `attack.4`: the landing, index 6 [f8], shown on the impact tick (V_MARK); airborne = indices 4-5 before it. */
		slamLanding: 6 / 8,
		/**
		 * A ring's release (rings have no volley period) plays over this many ticks, then idle (DOUBLE_RING: then the
		 * wind-up again up to the second ring). Keep it under the boss's shortest recover minus its 30-tick wait while
		 * the player is dead (act1's PLAYER_DEAD_WAIT_TICKS, not exported), 48 - 30 = 18: the follow-through is read
		 * from the RECOVER timer, so a longer one could replay a stale strike after that wait.
		 */
		ringReleaseTicks: 12,
	},
	/** The bruiser (enemy.bruiser, Demon Beast 3; its `attack` is Attack 4, a leap and ground slam, 8 frames). */
	bruiser: {
		/** The impact, index 6 [f8], shown on the slam tick: the leap [0, impact) (indices 0-5) plays over the telegraph. */
		impact: 6 / 8,
		/** The crouched follow-through, index 7 [f10]: [followThrough, end) is held over the rest of the recover. */
		followThrough: 7 / 8,
		/**
		 * The impact frames [impact, followThrough) play over this many ticks from the slam tick (BRUISER_RECOVER's first),
		 * then the follow-through holds for the rest of recoverTicks. Keep it under recoverTicks (sprites.spec checks it).
		 */
		impactTicks: 10,
	},
} as const;
