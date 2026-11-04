import type { ColorRole, DecorFxName } from "shared/theme";

/**
 * Presentation tunables of a vault on screen (docs/TREASURE.md TR7, Player experience and Design §4; logic in
 * timeline.ts / vault.ts / text.ts, drawing in the client's TreasureRenderController). Presentation only: where the
 * vault is, its lock, tier and rewards live in shared/dungeon vaultData.ts and shared/sim treasureData.ts, so nothing
 * here can change a replay. Roblox-port choices, no web source. Every time is seconds of SIM time (the views' clock:
 * it holds during pause and the hitstop freeze), every distance tiles unless named otherwise.
 */
export const TREASURE_VIEW = {
	/** Workspace folder, render step and profiler label of TreasureRenderController. */
	folderName: "KV_Treasure",
	renderStep: "KV_Treasure",
	profileLabel: "KV Treasure",
	/** The chest and cage bases stand this far above the floor, studs (BREAKABLE_VIEW.liftStuds' value). */
	liftStuds: 0.02,
	/**
	 * Art (image / sprites) for the closed chest and the cage is capped at this height above its pivot (a taller frame is
	 * drawn smaller; breakableArtLayout). 0.9: the vale chest (docs/TREASURE.md TR9) stands 0.83 tiles above its
	 * footprint centre at the game's pitch (BREAKABLE_VIEW's 0.75 would shrink it by a tenth).
	 */
	maxHeightTiles: 0.9,
	/** The same cap for the open chest, whose lid stands up behind it (the vale art: 1.2 tiles), so it is never shrunk. */
	openMaxHeightTiles: 1.35,
	/** The placeholder cage's bars stand this far outside the chest's footprint, studs (cageBarOffsets). */
	cageMarginStuds: 0.25,

	// --- the sparkle (Player experience "Through the doorway") ---------------------------------------------------------
	/**
	 * The BL glint art (`decor.fx.<fx>`, else `decor.fx.<fallbackFx>`) over the closed chest, tinted by the tier's
	 * FLOOR role (treasureFloorRole): one pass every `everySec` (by VaultTier: Legendary twice as often), drawn
	 * `sizeScale` of the loaded-piece glint's size (Legendary 1.5x), the rate x unlockedRate once the chest is unlocked.
	 * Every client shows the same pass at the same tick (sim time, no phase). Reduced motion or Particles off: a still
	 * star (BREAKABLE_LOOT_VIEW.glintStillFrame at its reducedTransparency). Hidden while an enemy bullet is within
	 * duckTiles (lootGlintDucked, BL6's rule) and once the chest is open.
	 */
	sparkle: {
		fx: "loot" as DecorFxName,
		fallbackFx: "glint" as DecorFxName,
		everySec: [3, 3, 1.5] as ReadonlyArray<number>,
		sizeScale: [1, 1, 1.5] as ReadonlyArray<number>,
		unlockedRate: 2,
		duckTiles: 1.25,
		/**
		 * Without glint art (the placeholder pack): a small self-lit diamond `starStuds` across, `starLiftStuds` above the
		 * chest's top, at starTransparency between passes and starPeakTransparency during one (a pass lasts
		 * starPassSec).
		 */
		starStuds: 0.7,
		starLiftStuds: 0.6,
		starTransparency: 0.55,
		starPeakTransparency: 0.05,
		starPassSec: 0.45,
	},

	// --- the crack (Player experience "The crack") ---------------------------------------------------------------------
	crack: {
		/** The sparkle flashes white (whiteMix 1 -> 0 over flashSec) and shows the new tier from stepSec on. */
		flashSec: 0.18,
		stepSec: 0.09,
		/**
		 * The plate shatters: `count` shards (ComboController's helper, shared/view/hud comboShardAt) of the plate's
		 * width fly over `sec`, their flight x pxScale (comboShardAt's px are HUD px; the plate's canvas is larger), in the
		 * LOST tier's floor colour. Reduced motion: they fade in place.
		 */
		shardCount: 6,
		shardSec: 0.45,
		shardPxScale: 3,
		/** The new tier's name rises from the chest (a floor line) riseTiles up-screen over lineSec and fades. */
		lineSec: 0.6,
		lineRiseTiles: 0.8,
		lineFadeInSec: 0.06,
	},

	// --- the unlock (Player experience "The unlock") -------------------------------------------------------------------
	unlock: {
		/** After the room clear's stamp has landed (docs/ROOM_CLEAR.md): everything below starts delaySec after the clear. */
		delaySec: 0.6,
		/** The bars sink into the floor over sinkSec (ease in); reduced motion: they fade over the same time instead. */
		sinkSec: 0.35,
		/** The kept lock's floor line (`treasure.unlocked` / `.spareTime` / `.spareHits`), in the tier's floor colour. */
		keptLineSec: 0.9,
		keptLineRiseTiles: 0.4,
		keptLineFadeInSec: 0.08,
		/**
		 * Anticipation: once the bars are down, the closed chest wobbles every wobbleEverySec: a decaying sine of
		 * wobbleCycles cycles over wobbleSec, wobbleDeg at its peak (about its base, across the facing). None under
		 * reduced motion.
		 */
		wobbleEverySec: 1.2,
		wobbleSec: 0.3,
		wobbleDeg: 6,
		wobbleCycles: 2,
	},

	// --- the opening (Player experience "The opening") -----------------------------------------------------------------
	open: {
		/** The lid jolts `jolts` times over joltSec (a hop of joltStuds each); none under reduced motion. */
		joltSec: 0.25,
		jolts: 2,
		joltStuds: 0.35,
		/** The lid pops at popSec: the open art, the column, the ring burst, the solo freeze and the shake. */
		popSec: 0.25,
		/** The solo freeze on the pop (the heavy hit's 40 ms, through the hitstop clock; freezeFrameOn). */
		freezeMs: 40,
		/**
		 * The light column (Particles off: none): a tier-coloured shaft widthTiles across rising to heightTiles over
		 * riseSec, holding holdSec, fading over fadeSec; at most `opacity`. Drawn as `fx.treasure.column` when the pack has
		 * it (upright, tinted by the floor role), else as a self-lit Neon block.
		 */
		column: { riseSec: 0.12, holdSec: 0.35, fadeSec: 0.5, heightTiles: 5, widthTiles: 0.9, opacity: 0.65 },
		/** The ring burst (Particles off: none): one ring r0 -> r1 tiles over lifeSec and a chip burst, both in the tier's floor colour. */
		ring: { r0Tiles: 0.3, r1Tiles: 2.4, lifeSec: 0.45 },
		burst: { chunks: 0, bits: 24, sparks: 6, startPx: 10, radiusTiles: 0.35, speed: 1.3 },
		/** Burst seed salt (render rng, shared/view/fx burstSeed), apart from every other burst's (0..18). */
		seedSalt: 19,
		/**
		 * The boosts out of the chest (DropsEvents.fromChest) stay hidden until hopDelaySec after their landing tick, then
		 * take the BL hop (lootHopStuds): they come out of the popped chest, not before it.
		 */
		hopDelaySec: 0.3,
		/**
		 * The reward cards (BillboardGui, the score pops' style): from cardsSec, each card staggerSec after the one above,
		 * fading in over fadeInSec, rising riseTiles (ease out; none under reduced motion) and fading out over the last
		 * fadeOutSec of cardSec. Stacked rowStuds apart from baseStuds above the chest's base, glyphs `scale` of a score pop's.
		 */
		cardsSec: 0.3,
		staggerSec: 0.06,
		cardSec: 1.6,
		cardFadeInSec: 0.1,
		cardFadeOutSec: 0.4,
		cardRiseTiles: 1,
		cardBaseStuds: 4,
		cardRowStuds: 1.1,
		cardScale: 1.25,
		/** The near-miss / kept line under the cards: from lineStartSec for lineSec, glyphs lineScale of a score pop's. */
		lineStartSec: 0.6,
		lineSec: 1.4,
		lineFadeInSec: 0.1,
		lineFadeOutSec: 0.4,
		lineScale: 0.9,
	},

	// --- the lock plate (Player experience "The lock") ------------------------------------------------------------------
	/**
	 * A floor SurfaceGui forwardTiles in front of the chest's centre (along its facing), widthTiles x depthTiles, on
	 * the combo shout's construction and layer (under every bullet, marking and effect), at most maxOpacity and
	 * ducking (ShoutDuck) while an enemy bullet is in its box grown by duckMarginTiles. Fades in over fadeInSec on the
	 * arm; a kept lock's plate fades out over the bars' sink.
	 */
	plate: {
		forwardTiles: 1.3,
		widthTiles: 2.6,
		depthTiles: 0.9,
		canvasPxPerTile: 64,
		maxOpacity: 0.55,
		duckMarginTiles: 1,
		fadeInSec: 0.15,
		/** UNTOUCHED: allowance + 1 pips (the last one outlined: the hit that cracks), the spent ones dimmed. */
		pipPx: 22,
		pipGapPx: 8,
		pipStrokePx: 3,
		spentTransparency: 0.7,
		/** SWIFT: the countdown turns `warnRole` in its last warnSec and pulses (1 Hz, down to pulseMin) in its last pulseSec. */
		warnSec: 10,
		pulseSec: 5,
		pulseHz: 1,
		pulseMin: 0.45,
	},
	/** The floor lines (the crack's tier name, the unlock's kept line): a SurfaceGui this big, forwardTiles in front. */
	line: { forwardTiles: 0.9, widthTiles: 4, depthTiles: 0.9 },

	// --- colours -----------------------------------------------------------------------------------------------------
	/** The plate's lock name and countdown, its SWIFT warning, the near-miss line, the points card. */
	plateRole: "uiText" as ColorRole,
	warnRole: "ember" as ColorRole,
	nearMissRole: "uiTextDim" as ColorRole,
	pointsRole: "uiAccent" as ColorRole,
	/** The column's fallback block material is self-lit; this is its colour mix toward white at its core. */
	columnCoreMix: 0.35,

	// --- the HUD (TR8: toasts, minimap mark, sounds) ------------------------------------------------------------------
	/**
	 * Toasts (ToastPanel, top centre; TreasureToastController): the floor reveal's `hud.toast.vault` (floorSec, once per
	 * floor, shown only once the stage cover is gone, no boon draft is open and the solo run is not paused, so it never
	 * stacks on the stairwell card's new-best line, and only while the vault is still sealed) and the arm toast per lock
	 * (`hud.toast.vaultLock.*`, lockSec). Ids count down from idBase (apart from the progression toasts, the sightings'
	 * SIGHTING_VIEW.toastIdBase and the Daily's DAILY_RANK.toastIdBase).
	 */
	toast: {
		floorSec: 2,
		lockSec: 2.5,
		idBase: -(2 ** 22),
	},
	/**
	 * Sounds (shared/view/audio cue mapper, TreasureCueTracker): sfx.treasure.open's pitch by VaultTier (Common 0, Rare
	 * +3, Legendary +7 semitones; an exact PlaybackSpeed, no pack jitter).
	 */
	audio: {
		openSemitones: [0, 3, 7] as ReadonlyArray<number>,
	},

	// --- KV_TreasureLabel (Studio check aid, off by default) ---------------------------------------------------------
	/**
	 * Workspace boolean attribute (Studio, or with KV_Debug): a label over the chest with its lock, tier, status and
	 * ticksLeft / hits (treasureDebugText). Developer text, English only (AutoLocalize off: createKvBillboardGui).
	 */
	debugAttribute: "KV_TreasureLabel",
	debugLiftStuds: 6,
	debugWidthPx: 260,
	debugHeightPx: 20,
	debugTextSize: 14,
	debugRole: "uiText" as ColorRole,
} as const;
