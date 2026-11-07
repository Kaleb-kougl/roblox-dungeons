import type { ColorRole } from "shared/theme";

/**
 * Presentation tunables of the pacts (docs/FORTUNE.md FO7 / FO9: the shrine room's two altars, the Greed take, the
 * Horde's chip, edges, shouts, spawn rings, pops and tally segment). Logic in ./pacts.ts, ./cards.ts, ./events.ts;
 * drawing in the client's PactRenderController (altars, cards, rings, the take pulse, the shouts' requests, the debug
 * labels) and the HUD; sounds in shared/view/audio. Presentation only: the gameplay numbers (altar cells, zone radius,
 * the deal, the wave, the x2) live in shared/dungeon pactsData.ts and shared/sim pactsData.ts, so nothing here can
 * change a replay. Roblox-port choices, no web source; starting values for the FO13 playtest.
 */
export const PACTS_VIEW = {
	/** Workspace folder, render step and profiler label of PactRenderController. */
	folderName: "KV_Pacts",
	renderStep: "KV_Pacts",
	profileLabel: "KV_Pacts",

	// --- the altar -------------------------------------------------------------------------------------------------
	/**
	 * The altar's body: the pack's `pact.altar` (an image or a sprite set's `idle` frame, drawn at its own pixelsPerTile
	 * as an upright billboard on its pivot, at most artMaxHeightTiles above it), or the placeholder plinth. Both altars
	 * draw the same body; the pact is told by the flame and the card.
	 */
	artMaxHeightTiles: 1,
	/**
	 * Where the flame stands on altar art, tiles above the floor at the art's own scale (scaled with it when the cap
	 * shrinks it): the vale altar's coal bed (scripts/art/gen-fortune-art.js ALTAR.coals, docs/FORTUNE.md FO10), so the
	 * flame rises out of the bowl's opening. The placeholder plinth's flame stands on its top.
	 */
	artTopTiles: 0.64,
	/** The plinth stands this far above the floor, studs (ACTOR_VIEW.liftStuds' value, like the pellets' cubes). */
	liftStuds: 0.02,
	/**
	 * The flame on top: a small Neon block (tiles, w x h x d) in the pact's role, standing on the body's top. While
	 * offered it flickers (scale 1 +- flickerAmount x the juice motionScale, flickerHz). The Horde's flame burns
	 * idleMix of the way toward the stone (a low ember) until the Horde is armed, then at full `pact.horde` and
	 * armedScale larger (FORTUNE.md "the altar's flame turns red"). Spent: no flame.
	 */
	flameTiles: [0.2, 0.28, 0.2] as readonly [number, number, number],
	flickerHz: 2.4,
	flickerAmount: 0.12,
	hordeIdleMix: 0.55,
	armedScale: 1.6,
	/** A spent / dimmed altar: its body darkens this far toward the theme background. */
	spentDim: 0.55,
	/** The colour a flame's ember mixes toward (the stone's, theme placeholders PACT_ALTAR_ROLE). */
	stoneRole: "uiTextDim" as ColorRole,

	// --- the floor card (the combo shout's construction, docs/COMBO.md CD9) ----------------------------------------
	card: {
		/** The card's box on the floor, tiles (along the screen's right x down the screen). */
		widthTiles: 5,
		depthTiles: 2.4,
		/** Its centre this far SCREEN-DOWN of the altar's centre, tiles (under the altar and whoever stands on it). */
		offsetTiles: 2,
		/** SurfaceGui canvas px per tile along the card's width (its depth follows from the camera pitch). */
		canvasPxPerTile: 64,
		/**
		 * Each line's share of the card's depth, by kind: the title, an ordinary line (take / gain / the dim line), the
		 * curse's short effect under Greed's take, the accept line.
		 */
		titleShare: 0.28,
		lineShare: 0.19,
		detailShare: 0.14,
		acceptShare: 0.18,
		/** A dimmed card's opacity, as a share of the shout's cap (COMBO_SHOUT.maxOpacity, <= 55 %). */
		dimOpacity: 0.6,
		/** The colour role of the take / gain / accept lines and the dim line (the title is the pact's role). */
		textRole: "uiText" as ColorRole,
		detailRole: "uiTextDim" as ColorRole,
		dimRole: "uiTextDim" as ColorRole,
		/** The card shows while the view player is within this many tiles of the shrine room's box (else hidden). */
		nearRoomTiles: 6,
	},

	// --- the Greed take ------------------------------------------------------------------------------------------
	greed: {
		/**
		 * FORTUNE.md: "At 0.5 s the Legendary deal opens". The world is frozen from the take's next tick (any draft); the
		 * client holds the reveal's start this long (real seconds, unpaused) after Greed's draft opens, the confirm held
		 * meanwhile (shared/play draftConfirmHeld: an open draft whose reveal has not begun).
		 */
		dealDelaySec: 0.5,
		/**
		 * The dark pulse at the altar on a take: a ring on the floor growing from startTiles to endTiles over sec, in
		 * pulseRole, fading out. Reduced motion: no growth (a fade in place at endTiles); Particles Off: none.
		 */
		pulse: { sec: 0.4, startTiles: 0.4, endTiles: 1.8, maxOpacity: 0.7 },
		pulseRole: "background" as ColorRole,
	},

	// --- the Horde ---------------------------------------------------------------------------------------------------
	horde: {
		/** The floor shouts' life in the shout slot (ComboController.requestShout): HORDE x2 on rousing, WAVE 2. */
		shoutLifeSec: 1.1,
		/**
		 * Wave 2's spawn rings: one per wave tile, a floor disc that fills from fillFrom to 1 of its radius over the
		 * telegraph (the sim's waveTelegraphTicks), its rim at ringOpacity. Reduced motion: the disc is full at once and
		 * only its opacity climbs. Particles Off: rings still show (gameplay information).
		 */
		ring: { radiusTiles: 0.5, fillFrom: 0.15, ringOpacity: 0.85, fillOpacity: 0.45, rimTiles: 0.08 },
		/** Score pops of the horde room's kills: drawn in this role (with the x2 mark). */
		popRole: "pact.horde" as ColorRole,
	},

	// --- debug ------------------------------------------------------------------------------------------------------
	/**
	 * KV_PactLabel (Workspace boolean, Studio or KV_Debug, off by default): a label over each altar (`greed avail` /
	 * `horde taken`, the Horde phase, the view player). Developer English, never translated.
	 */
	debugAttribute: "KV_PactLabel",
	debugWidthPx: 220,
	debugHeightPx: 44,
	debugTextSize: 14,
	debugLiftStuds: 4,
	debugRole: "uiText" as ColorRole,
} as const;

/** The HUD's Horde chip (status corner, beside the first boost cell; the touch strip's chip line). Reference px. */
export const HORDE_CHIP_VIEW = {
	/** Text size cap (TextScaled into the chip's box). */
	textSize: 16,
	/** Touch strip: the chip's width and text cap (its height is the strip's chip cell). */
	touchWidth: 120,
	touchTextSize: 12,
	role: "pact.horde" as ColorRole,
	/** The chip's panel fill, a dark backing so the hot red reads. */
	fillRole: "uiPanel" as ColorRole,
} as const;
