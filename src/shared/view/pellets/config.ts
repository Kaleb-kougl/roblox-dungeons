import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of pellets (docs/PELLETS.md PL7; logic in pellets.ts, drawing in the client's
 * PelletRenderController / ScorePopController / ParticleController, sounds in shared/view/audio). Presentation only: the
 * gameplay numbers (pickup radius, points, placement) live in shared/sim pelletsData.ts and shared/dungeon
 * pelletsData.ts, so nothing here can change a replay. Roblox-port choices, no web source.
 */
export const PELLETS_VIEW = {
	/** Workspace folder, render step and profiler label of PelletRenderController. */
	folderName: "KV_Pellets",
	renderStep: "KV_Pellets",
	profileLabel: "KV_Pellets",
	/** Pellet bodies built ahead (a pool per kind; the normal pool grows past it when a floor needs more). */
	poolSize: 64,

	// --- the pellet on the floor ---------------------------------------------------------------------------------
	/**
	 * With art: the sprite is drawn flat on the floor this wide (tiles; the theme placeholders' cube sides, 0.25 and
	 * 0.45), at artLiftStuds: over the floor effects (FX_SPRITE_VIEW.liftStuds 0.02), under every floor marking
	 * (MARKING_VIEW.liftTiles) and every bullet.
	 */
	artTiles: { normal: 0.25, power: 0.45 },
	artLiftStuds: 0.03,
	/** The placeholder cube stands this far above the floor (ACTOR_VIEW.liftStuds' value). */
	liftStuds: 0.02,
	/**
	 * Pop-in on the engagement tick: a wave out from the room's centre, the farthest pellet starting waveSec after the
	 * nearest; each grows from 0 over popSec with an ease-out-back overshoot (presentation only: all are collectable at
	 * once). Under reduced motion: no wave, no pop (they are there at once).
	 */
	popIn: { waveSec: 0.4, popSec: 0.18 },
	/** With this many regular pellets left in a live room (or fewer, at least one), they pulse brighter (the hint). */
	lastFewHint: 3,
	/**
	 * The last-few pulse: a glow toward glowRole (0..glowMax of the way) and a scale of 1..1 + scaleAmp, one cycle per
	 * periodSec. Reduced motion: a steady glowMax, no scale.
	 */
	lastFew: { periodSec: 0.6, scaleAmp: 0.2, glowMax: 0.6 },
	/** The colour a pulsing pellet glows toward (the last few and the power pellet). */
	glowRole: "uiText" as ColorRole,
	/** At the room's clear the pellets left shrink away over shrinkSec; reduced motion: they fade in place instead. */
	shrinkSec: 0.3,
	/** The power pellet's slow pulse (scale 1..1 + scaleAmp, glow 0..glowMax); reduced motion: still, no glow. */
	power: { periodSec: 1.2, scaleAmp: 0.15, glowMax: 0.35 },

	// --- the power pellet taken ------------------------------------------------------------------------------------
	/**
	 * Every erased enemy bullet becomes a small cube (sizePx render px, the pellet.power colour) flying into the picker
	 * over sec (ease-in), at most maxCubes at once (the rest of a full screen still pays: the sim caps nothing it
	 * draws). Reduced motion: no flight, the cubes fade in place.
	 */
	flyIn: { sec: 0.3, sizePx: 3, maxCubes: 64, hopPx: 4 },
	/** A ring from the picker (the particle system's ring pool): radius r0 -> r1 tiles over lifeSec. */
	ring: { r0Tiles: 0.3, r1Tiles: 2.5, lifeSec: 0.35 },
	/** The solo freeze (like the parry's, docs/GRAZE_PARRY.md GPD7): the view player's own pickup, freezeFrameOn. */
	freezeMs: 30,

	// --- pellet pops (PD11) ------------------------------------------------------------------------------------------
	/**
	 * A tiny "+points" per pellet (the kill pops' pool and string, hud.score.pop): glyphs `scale` of a kill pop's, alive
	 * lifeSec, rising risePx (ease-out) and fading over the last fadeSec. One pop per player per frame (merged). Reduced
	 * motion: no rise, a fade over the whole life. At most maxAlive at once (the oldest is replaced).
	 */
	pop: { scale: 0.6, lifeSec: 0.4, risePx: 8, fadeSec: 0.15, maxAlive: 12 },

	// --- sounds (shared/view/audio AudioCueMapper) ---------------------------------------------------------------------
	/**
	 * sfx.pellet.eat climbs as a room's pellets are eaten (owner, 2026-11-03): the k-th of a room's n pellets plays
	 * ladder[floor((k - 1) / (n - 1) x (size - 1))] semitones up, the major scale over one octave, so the first pellet is
	 * the root and the last (the one that earns the Sweep) the octave; the Sweep's sting follows it. One start per frame
	 * (at the frame's last pellet, the local player's first), never inside eatMinIntervalSec (a pack's minInterval wins).
	 */
	audio: {
		ladderSemitones: [0, 2, 4, 5, 7, 9, 11, 12] as ReadonlyArray<number>,
		eatMinIntervalSec: 0.06,
		stingMinIntervalSec: 0.3,
	},

	// --- KV_PelletDebug (Studio check aid, off by default) -----------------------------------------------------------
	/**
	 * Workspace boolean attribute (Studio, or with KV_Debug): a label `left / count` over every live room's centre.
	 * Developer text, English only (AutoLocalize off through client/ui createKvBillboardGui).
	 */
	debugAttribute: "KV_PelletDebug",
	debugLiftStuds: 4,
	debugWidthPx: 120,
	debugHeightPx: 20,
	debugTextSize: 14,
	debugRole: "uiText" as ColorRole,
} as const;
