/**
 * The new-best celebration's presentation tunables (docs/NEW_BEST.md NB3): when a stored best counts as a target, when
 * the score panel's target row turns "within reach", the reach pulse, the NEW BEST slam, the score number's white
 * flash and shine, the floor shout's life, the gold confetti (in-run at the screen edges, full screen at run over),
 * the run-over record rows' roll, and the Studio debug attribute. Data only; the per-frame state machine and the pure
 * helpers are newBest.ts. Presentation only (NBD1): no number here changes the sim, the score or a record.
 *
 * Units: scores are points, floors endless floor numbers; times are real (unpaused) seconds; sizes on the HUD are
 * reference px (HUD_VIEW), confetti sizes screen px.
 *
 * @module
 */

/** The theme colour role of everything gold (the passed row, the gold number, the shout, the confetti; NB4). */
export const NEW_BEST_ROLE = "newBest";

/**
 * The new-best celebration's tunables, read by the NewBest state machine (newBest.ts) and the client's score panel,
 * confetti and run-over rows: when a best counts as a target and when it is within reach, the reach pulse, the slam,
 * the flash and shine, the floor shout, the confetti, the run-over record rows, the row's layout and the Studio debug
 * attribute's name. Units are the file header's: points, real seconds, reference px, screen px for the confetti.
 */
export const NEW_BEST = {
	/** A stored best under this many points counts as no best (NBD5: the first record waits for the run-over). */
	minScore: 1000,
	/** The target row turns `reach` (ember, pulsing) once the gap is at most this share of the best. */
	reachFraction: 0.1,
	/** Longest step one frame may take (a hitch never skips a timeline). */
	maxFrameDtSec: 0.1,
	/** The reach state's pulse (the row's brightness, kept under reduced motion like the combo's pulse), Hz. */
	pulseHz: 1,
	/** The crossing slams NEW BEST into the row: fromScale -> 1 over sec, ease out back (none under reduced motion). */
	slam: { fromScale: 1.6, sec: 0.12 },
	/** The score number flashes white (uiText) for flashSec at the crossing, then holds gold for the rest of the run. */
	flashSec: 0.15,
	/** One shine sweep across the gold number after the crossing (none under reduced motion). */
	shine: { delaySec: 0.05, sweepSec: 0.45 },
	/** The NEW BEST! floor shout's life (the combo shout's construction, COMBO_SHOUT; it replaces a showing tier shout). */
	shout: { lifeSec: 1.2 },
	/**
	 * Gold confetti (NBD8): `inRun` falls from the top corners, only outside HUD_CLEAR_ZONE (confettiPieceAt); `runOver`
	 * falls over the whole screen. Each piece starts within `spawnShare` of the life, falls `fallScreens` screen heights
	 * per life (times a per-piece speedMin .. speedMin + speedSpan), sways `swayPx` side to side at `swayHz`, spins up to `spinDegPerSec`, and
	 * fades out over the last `fadeShare` of its own flight. None under reduced motion.
	 */
	confetti: {
		inRun: { count: 40, lifeSec: 1.2 },
		runOver: { count: 90, lifeSec: 2.2 },
		spawnShare: 0.3,
		fallScreens: 0.9,
		/** Each piece's fall speed is fallScreens times a per-piece factor in [speedMin, speedMin + speedSpan). */
		speedMin: 0.75,
		speedSpan: 0.5,
		swayPx: 14,
		swayHz: 1.3,
		spinDegPerSec: 540,
		fadeShare: 0.25,
		/** Piece size range, screen px (the client scales it with the HUD scale if it likes). */
		minSizePx: 5,
		maxSizePx: 10,
		/** In-run pieces keep at least this far (px) from the clear zone and from the screen's side edges. */
		edgeMarginPx: 4,
	},
	/**
	 * Run over on a record run (docs/NEW_BEST.md "Run over on a record run"): the ribbon at once, the record rows roll
	 * from `rowDelaySec` (each `rollSec` long, the second `rowGapSec` after the first), the confetti from 0.
	 */
	runOver: { rowDelaySec: 0.3, rollSec: 1.0, rowGapSec: 0.4 },
	/**
	 * Studio check aid (CLAUDE.md working agreement: off by default). The Workspace string attribute forces the run's
	 * baseline (parseNewBestDebug): "score:500", "floor:2", both ("score:2000,floor:3"), "first" or "unknown".
	 */
	debugAttribute: "KV_NewBestDebug",
} as const;

/**
 * How the client draws the celebration (docs/NEW_BEST.md NB6 / NB7 / NB9). Reference px (HUD_VIEW) unless noted.
 */
export const NEW_BEST_DRAW = {
	/**
	 * Score panel row 1 (the label row): px kept on the right for the `SCORE` label; the target slot on the left takes
	 * the rest of the row minus HUD_VIEW.gap (TextScaled up to HUD_VIEW.smallText, so a long number or translation
	 * shrinks to fit and the row never grows: scoreEstimate stays 158 of 160).
	 */
	labelSlotWidth: 56,
	/** The reach row (ember) is drawn up to this share toward uiText at the pulse's peak. */
	reachPulseMix: 0.5,
	/**
	 * The touch strip's compact target line (`-12340` / `NEW BEST`), hung under the strip's combo line, right-aligned
	 * over the strip's score width: its text size and its gap under the combo line.
	 */
	touchText: 14,
	touchGap: 2,
	/**
	 * The confetti's ScreenGui sits this far above HUD_VIEW.hudDisplayOrder: over the HUD (the corner panels, the
	 * run-over panel), under the pause / settings layer and the stage card (LOADING_VIEW.displayOrder).
	 */
	confettiDisplayOrderAboveHud: 1,
	/** Run-over record rows: score and floor at most. */
	maxRecordRows: 2,
} as const;
