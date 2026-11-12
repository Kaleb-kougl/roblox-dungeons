import type { ColorRole } from "shared/theme";

/** A particle burst's shape (the particle system's ChipBurst, in tiles; shared/view/fx particles.ts). */
export interface GoldenBurstView {
	readonly chunks: number;
	readonly bits: number;
	readonly sparks: number;
	/** Start height above the floor, render px. */
	readonly startPx: number;
	readonly radiusTiles: number;
	readonly speed: number;
}

/**
 * Presentation tunables of the Goldling (docs/FORTUNE.md "Player experience -> The Goldling", Design §5, FO8 / FO9;
 * logic in golden.ts, drawing in the client's GoldenRenderController and the controllers it hands beats to). Presentation
 * only: the gameplay numbers (appear / escape ticks, hp, points, boosts) live in shared/sim goldenData.ts and its
 * archetype, so nothing here can change a replay. Roblox-port choices, no web source.
 */
export const GOLDEN_VIEW = {
	/** Workspace folder, render step and profiler label of GoldenRenderController. */
	folderName: "KV_Golden",
	renderStep: "KV_Golden",
	profileLabel: "KV_Golden",

	// --- appear ------------------------------------------------------------------------------------------------------
	/**
	 * The gold flash where it came out (its piece's cell centre, docs/GOLDLING_RUMOURS.md GR4): a chip burst in
	 * golden.coin and one ring from the spot (the particle system's ring pool: radius r0 -> r1 tiles over lifeSec; reduced
	 * motion: no growth, a flash in place at r1). It and the GOLDLING! shout wait afterBreakSec of sim time after the
	 * release tick (GoldenAppearQueue), so the piece's own break (chips, splinters, shatter: BreakableRenderController,
	 * the same tick) reads first and the coins burst out of it.
	 */
	appear: {
		burst: { chunks: 0, bits: 14, sparks: 8, startPx: 4, radiusTiles: 0.3, speed: 1 } as GoldenBurstView,
		ring: { r0Tiles: 0.2, r1Tiles: 1.6, lifeSec: 0.4 },
		seedSalt: 61,
		afterBreakSec: 0.12,
	},
	/**
	 * The floor shout `fx.golden.shout` ("GOLDLING!") in the combo shout's slot (ComboController.requestShout: under every
	 * bullet, <= COMBO_SHOUT.maxOpacity, ducking near enemy bullets), golden.coin, this long.
	 */
	shoutSec: 1.2,

	// --- running -----------------------------------------------------------------------------------------------------
	/**
	 * The timer ring under it: a ring of fixed-size floor pieces (a DashLayer, like the affix rings) of radius = the
	 * actor's radius + marginTiles, covering (ticks left / escapeTicks) of the circle, clockwise on screen from
	 * screen-up, in golden.coin. It loses a whole piece at a time (pieces never shrink): `pieces` around the full
	 * circle. Over the sprite effects and goo decals, under every telegraph and marking (AFFIX_VIEW.ringLiftStuds').
	 */
	ring: {
		marginTiles: 0.25,
		pieces: 24,
		dash: { width: 0.2, height: 0.03 },
		liftStuds: 0.12,
		transparency: 0.1,
	},
	/**
	 * The last warnSec seconds: the ring pulses (radius x 1 + pulseAmp x the wave, one cycle per pulseSec) and blinks
	 * toward warnRole (up to warnMix, in colourSteps steps), and the body flickers (flickerSec per cycle, half of it at
	 * flickerTransparency). Reduced motion: no pulse, no flicker: the ring stays at warnMix toward warnRole (colour only).
	 */
	warn: {
		warnSec: 3,
		pulseSec: 0.4,
		pulseAmp: 0.18,
		warnRole: "uiText" as ColorRole,
		warnMix: 0.7,
		colourSteps: 6,
		flickerSec: 0.16,
		flickerTransparency: 0.65,
	},

	// --- hits --------------------------------------------------------------------------------------------------------
	/**
	 * Each damaging hit: a coin burst at the hit spot, death particles in golden.coin (the pack's fx.golden.coin sprite
	 * instead when it has one), and a small "+points" pop (hud.score.pop, golden.coin; the score pops' life and fade, the
	 * pellets' rise) `pop.scale` of a kill pop's glyphs, at most pop.maxAlive at once.
	 */
	coins: { chunks: 0, bits: 7, sparks: 3, startPx: 6, radiusTiles: 0.2, speed: 1.1 } as GoldenBurstView,
	coinSeedSalt: 62,
	pop: { scale: 0.8, liftPx: 2, maxAlive: 8 },

	// --- caught ------------------------------------------------------------------------------------------------------
	/**
	 * The catch: a coin fountain (a bigger, higher burst in golden.coin, plus the fx.golden.coin sprite at
	 * fountainFxScale when the pack has it), a solo freeze of catchFreezeMs through the hitstop clock (Freeze frame
	 * setting; only the view player's own catch in a solo run), the `stamp` camera nudge on the view player's catch
	 * (Screen shake setting), and the jackpot's own pop in place of its kill pop: jackpotPop.scale of a kill pop's glyphs,
	 * liftPx higher, golden.coin. The boosts it lands hop in like a broken piece's loot (BREAKABLE_LOOT_VIEW's hop).
	 */
	fountain: { chunks: 4, bits: 26, sparks: 10, startPx: 10, radiusTiles: 0.35, speed: 1.35 } as GoldenBurstView,
	fountainSeedSalt: 63,
	fountainFxScale: 1.6,
	catchFreezeMs: 40,
	jackpotPop: { scale: 2.4, liftPx: 8, maxAlive: 2 },

	// --- escaped -----------------------------------------------------------------------------------------------------
	/**
	 * The escape: a dive puff where it stood (a small, slow, low burst in the archetype's colour, enemy.golden), and the
	 * floor line `fx.golden.escaped` ("It got away!  +{points} banked", the floor's banked coins) in the combo shout's slot
	 * for escapedSec, golden.coin.
	 */
	puff: { chunks: 0, bits: 10, sparks: 0, startPx: 2, radiusTiles: 0.25, speed: 0.45 } as GoldenBurstView,
	puffSeedSalt: 64,
	escapedSec: 1.8,

	// --- the minimap -------------------------------------------------------------------------------------------------
	/** A gold blip (the boost glint's diamond, with the marks' dark edge) while it stands on a cell in sight. */
	minimap: { sizePx: 6, role: "golden.coin" as ColorRole },

	// --- sounds (shared/view/audio AudioCueMapper) ---------------------------------------------------------------------
	/**
	 * sfx.golden.hit climbs one step of ladderSemitones (the major scale, pelletEatSpeed's) per damaging hit on the same
	 * Goldling: the first hit the root, every later one a step up, holding at the octave. One start per frame (the
	 * frame's highest hit count), never inside hitMinIntervalSec (a pack's minInterval wins).
	 */
	audio: {
		ladderSemitones: [0, 2, 4, 5, 7, 9, 11, 12] as ReadonlyArray<number>,
		hitMinIntervalSec: 0.05,
	},

	// --- rumours (docs/GOLDLING_RUMOURS.md GR5-GR7; logic in rumour.ts) ---------------------------------------------
	/**
	 * The floor rumour plays once per floor after floorDelaySec of unfrozen time on a floor whose Goldling hides and whose
	 * room nobody engaged yet (no time counts while a draft is open, the stage cover is up, the solo run is paused or the
	 * run is over); the room rumour once, on the first unfrozen frame its room is engaged (the floor rumour skipped if it
	 * had not played). floorVolume / roomVolume scale the two cues (the room cue x AUDIO_VIEW.teammateVolume while the
	 * view player stands outside its room, RD6).
	 */
	rumour: {
		floorDelaySec: 1.0,
		floorVolume: 0.45,
		roomVolume: 0.8,
		/**
		 * The HUD chip (GoldenRumourChip, beside the Horde chip): `hud.chip.golden.rumour` ("Coins jingling...") from the
		 * floor rumour on, `hud.chip.golden.hiding` ("It's hiding here!") from the room rumour on, in `role` on a
		 * `fillRole` panel with the coin glyph (ui.icon.coin when the pack has it), its text capped at textSize (touch:
		 * touchWidth wide, capped at touchTextSize). While it reads "hiding" it pulses gently: its content's scale
		 * 1 + pulseAmp x a 0..1 wave, one cycle per pulseSec (reduced motion: still).
		 */
		chip: {
			role: "golden.coin" as ColorRole,
			fillRole: "uiPanel" as ColorRole,
			textSize: 16,
			touchWidth: 120,
			touchTextSize: 12,
			pulseSec: 0.8,
			pulseAmp: 0.08,
		},
	},

	// --- KV_GoldenLabel (Studio check aid, off by default) -----------------------------------------------------------
	/**
	 * Workspace boolean attribute (Studio, or with KV_Debug): a label over the running Goldling with its status, ticks
	 * left and hp (goldenDebugText). Developer text, English only (AutoLocalize off through client/ui
	 * createKvBillboardGui).
	 */
	debugAttribute: "KV_GoldenLabel",
	debugLiftStuds: 3,
	debugWidthPx: 220,
	debugHeightPx: 20,
	debugTextSize: 14,
	debugRole: "uiText" as ColorRole,
} as const;
