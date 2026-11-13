/**
 * Presentation tunables of a secret room on screen (docs/SECRET_ROOMS.md SR6, Player experience; logic in look.ts /
 * knock.ts / shout.ts / cues.ts, drawing in the client's SecretRenderController, Track V2). Presentation only: where the
 * secret is, what opens it and what the chest gives live in shared/dungeon secretsData.ts and shared/sim
 * secretsData.ts, so nothing here can change a replay. Roblox-port choices, no web source. Every time is seconds of SIM
 * time (the views' clock: it holds during pause and the hitstop freeze) unless named otherwise; distances are tiles.
 *
 * The open's timeline (t = 0 on the open's tick, SecretLook.t):
 *   0 .. burst.sec       the crack bursts into rubble (shards, dust, the `stamp` nudge, the solo freeze), SECRET! shouts
 *   0 .. sink.sec        the void rock over the chamber (VoidPlan.held) sinks; the chamber (built hidden) shows under it
 *   reveal.jingleSec     the discovery jingle (`sfx.jingle.secret`), the torches light
 *   openingSec           SecretLook leaves OPENING for OPEN (every step above is over)
 * Reduced motion: no dust, no sink (the chamber cuts in at the open), no shards; the shout and the sounds stay.
 */
import type { ColorRole } from "shared/theme";
import { TREASURE_VIEW } from "../treasure/config";

const BURST_SEC = 0.35;
const SINK_SEC = 0.5;
const JINGLE_SEC = 0.4;

export const SECRET_VIEW = {
	/** Workspace folder, render step and profiler label of SecretRenderController (Track V2). */
	folderName: "KV_Secret",
	renderStep: "KV_Secret",
	profileLabel: "KV Secret",

	// --- before the open (SRD4: crack + dust, nothing else) ------------------------------------------------------------
	/**
	 * The dust trickle from the crack's joints: one pass every `everySec` while the crack is hidden, on the crack's cells
	 * in turn (pass k on cell k mod cells), `frames` frames at `fps` (the `fx.secret.dust` flipbook's; one-shot), sim
	 * time with no phase: every client shows the same pass. None under reduced motion. SR15 tunes the cadence.
	 */
	dust: { everySec: 4, frames: 6, fps: 10 },
	/**
	 * A knock (a wrong-way hit, the sim's per-tick knock feed): a dust puff on the face and the hollow knock, at most one
	 * per `throttleSec` per crack (KnockThrottle: a stream of arrows is a few taps a second, not a drum roll; one swing's
	 * pass over both cells is one knock); the puff lasts `puffSec`. 0.2 s, not the plan's 0.25: the sword's swings 1 and
	 * 2 land 14 ticks (0.233 s) apart (SWORD_DATA's port tempo), and each must knock (SR15 tunes it).
	 */
	knock: {
		throttleSec: 0.2,
		puffSec: 0.3,
		/**
		 * The puff (Track V2: ParticleController.secretPuff, chips in `secret.dust` on the knocked cell's face, lifted
		 * `faceLiftPx`): a ChipBurst shape; the Particles setting's levels and reduced motion as every chip burst.
		 */
		puff: { chunks: 0, bits: 6, sparks: 0, startPx: 10, radiusTiles: 0.25, speed: 0.35 },
		/** Burst seed salt (render rng, shared/view/fx burstSeed), apart from every other burst's (11-19, 41-64). */
		seedSalt: 72,
	},

	// --- the crack (SecretRenderController's crack Part, Track V2) --------------------------------------------------------
	/**
	 * The crack overlay `secret.crack` on the crack Part's front (+f) and top faces: tinted by the biome's wall colour
	 * lerped `darken` toward black (the art only darkens; SR15 tunes the contrast), the surface lit like the wall
	 * (`lightInfluence`). Without the art (or before it downloads, docs/STAGE_ASSETS.md SA18) a darker band in the same
	 * colour runs across each face's middle `bandShare` of its height, at `bandTransparency`. The overlay's variant (a
	 * sprites set's `idle` frame) is picked per crack by its cell (`variantSalt`): every client draws the same one.
	 */
	crack: {
		darken: 0.45,
		lightInfluence: 1,
		bandShare: 0.22,
		bandTransparency: 0.25,
		variantSalt: 0x5ec7,
		/** The SurfaceGuis' canvas, px per stud (the art's 32 px a tile at STUDS_PER_TILE 4). */
		pixelsPerStud: 8,
	},
	/**
	 * The dust trickle's look (`fx.secret.dust`, an upright billboard hanging from the crack's top edge, `faceTiles` in
	 * front of the face). Without the art: one pale mote (`fallbackStuds` across, in `secret.dust`) falling the wall's
	 * height over the pass, fading in its last `fallbackFadeShare`.
	 */
	dustLook: { role: "secret.dust" as ColorRole, faceTiles: 0.08, fallbackStuds: 0.35, fallbackFadeShare: 0.4 },
	/**
	 * The rubble on the opened cells: `secret.rubble` laid flat (tinted by the wall colour lerped `darken` toward black,
	 * `liftStuds` over the floor), else `fallbackPieces` low wall-coloured blocks per cell (`fallbackStuds` across, up to
	 * `fallbackHeightStuds` high), placed by the cell's hash (`seedSalt`).
	 */
	rubble: {
		darken: 0.2,
		liftStuds: 0.05,
		fallbackPieces: 3,
		fallbackStuds: 1.1,
		fallbackHeightStuds: 0.6,
		/** A block's centre within `spreadShare` of its cell round the cell's centre; its size `minScale` .. 1 of the above. */
		spreadShare: 0.7,
		minScale: 0.5,
		seedSalt: 0x7b11,
	},
	/**
	 * The chamber's two torches on its back wall (built hidden, lit at reveal.jingleSec): a self-lit flame block
	 * `flameStuds` across in the decor flame role, DECOR_LIGHTS.heightTiles up and wallOffsetTiles off the face, with a
	 * PointLight of DECOR_LIGHTS' range and brightness (no shadows) fading in over `fadeSec`.
	 */
	torch: { flameStuds: 0.5, fadeSec: 0.3 },

	// --- the open -------------------------------------------------------------------------------------------------------
	/**
	 * The burst: `sec` long (shards fly, dust, the wall Part gone at once, rubble on the two cells), `shards` pieces, a
	 * solo `freezeMs` freeze (freezeFrameOn, docs/FEEL.md) for an open by the view player, and the `stamp` nudge.
	 */
	burst: {
		sec: BURST_SEC,
		shards: 12,
		freezeMs: TREASURE_VIEW.open.freezeMs,
		/**
		 * The shards (Track V2): small wall-coloured blocks `shardStuds` across flying out of the crack's face into the
		 * room at `speedTiles` / s (fanned over `spreadDeg`), rising `riseTiles` and falling back under `gravityTiles` /
		 * s^2, fading over the burst; none under reduced motion. Plus a dust burst (ParticleController.secretBurst,
		 * `chips` in `secret.dust`, seeded with `seedSalt`).
		 */
		shardStuds: 0.6,
		speedTiles: 5,
		spreadDeg: 80,
		riseTiles: 3,
		gravityTiles: 18,
		/** Each shard's speed and rise vary by up to +- speedJitter / 2 of them (hashed); it fades from `fadeFrom` of the burst. */
		speedJitter: 0.5,
		fadeFrom: 0.5,
		chips: { chunks: 6, bits: 14, sparks: 2, startPx: 14, radiusTiles: 0.8, speed: 0.9 },
		seedSalt: 71,
	},
	/** The void rock over the chamber (VoidPlan.held's columns) sinks `depthTiles` over `sec` from the open (ease in). */
	sink: { sec: SINK_SEC, depthTiles: 3 },
	/** The reveal: the jingle and the two torches lighting at `jingleSec` after the open. */
	reveal: { jingleSec: JINGLE_SEC },
	/** OPENING lasts until every step of the timeline is over. */
	openingSec: math.max(BURST_SEC, SINK_SEC, JINGLE_SEC),

	// --- the news -------------------------------------------------------------------------------------------------------
	/**
	 * SECRET! (`fx.secret.text`, the combo shout's construction, FLOOR_SHOUT_PRIORITY.secret): for the view player when
	 * they opened it or stand within `nearTiles` of the crack (a far teammate's open is the toast's news), `lifeSec` long.
	 */
	shout: { lifeSec: 1.4, nearTiles: 9 },
	/** The co-op toast `Secret found by {name}` (`hud.toast.secret`): every member but the finder, `seconds` long. */
	toast: { seconds: 3, idBase: -(2 ** 25) },
	/**
	 * The sounds (shared/view/audio): the open and the jingle at full volume for an open by the local player or within
	 * `nearTiles` of them, else at the teammate's volume (AUDIO_VIEW.teammateVolume) a rank lower; a knock likewise.
	 */
	audio: { nearTiles: 9 },

	// --- KV_SecretLabel (Studio check aid, off by default; shared/play RUN_ATTRIBUTES.secretLabel) -----------------------
	/**
	 * Studio, or with KV_Debug: outlines of the crack (`crackRole`), the chamber (`chamberRole`) and the front box
	 * (`frontRole`), boxes `outlineStuds` thick and `heightStuds` tall, and a label over the crack (secretDebugLabel:
	 * tier, status, chamber size). Developer text, English only (createKvBillboardGui: AutoLocalize off).
	 */
	debug: {
		crackRole: "uiAccent" as ColorRole,
		chamberRole: "uiMana" as ColorRole,
		frontRole: "ember" as ColorRole,
		outlineStuds: 0.08,
		heightStuds: 0.6,
		liftStuds: 6,
		widthPx: 220,
		heightPx: 20,
		textSize: 14,
		textRole: "uiText" as ColorRole,
	},
} as const;
