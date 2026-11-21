/**
 * Task 1 go/no-go spikes, the preload spike P0 and the invites spike I0 (docs/SPIKES.md). All are OFF unless enabled
 * here or by a Workspace attribute, so a normal play session never runs them.
 *
 * Enable at runtime from the Studio command bar (client context while playing, or on the server
 * so it replicates):
 *   workspace:SetAttribute("KV_SpikeBullets", true)
 *   workspace:SetAttribute("KV_SpikeCamera", true)
 *   workspace:SetAttribute("KV_SpikePreload", true)   (best set before Play: it measures the join)
 *   workspace:SetAttribute("KV_InviteSpike", true)    (client + server; only a published place has the APIs)
 *   workspace:SetAttribute("KV_UiArtSpike", true)     (client; docs/UI_ART.md UA1)
 *   workspace:SetAttribute("KV_L10nSpike", true)      (client; docs/LOCALIZATION.md L0)
 *   workspace:SetAttribute("KV_PadSpike", true)       (client; docs/GAMEPAD_MENUS.md GM0)
 * An attribute, when present, overrides the default below; setting it to false stops the spike
 * and cleans up everything it made.
 *
 * @module
 */

/** Compile-time defaults. Flip one to true to run a spike without touching attributes. */
export const SPIKE_DEFAULTS = {
	bullets: false,
	camera: false,
	preload: false,
	invites: false,
	touch: false,
	uiArt: false,
	l10n: false,
	pad: false,
} as const;

/** Workspace attribute names that override SPIKE_DEFAULTS. */
export const SPIKE_ATTRIBUTES = {
	bullets: "KV_SpikeBullets",
	camera: "KV_SpikeCamera",
	preload: "KV_SpikePreload",
	invites: "KV_InviteSpike",
	touch: "KV_TouchSpike",
	uiArt: "KV_UiArtSpike",
	l10n: "KV_L10nSpike",
	pad: "KV_PadSpike",
} as const;

/**
 * The name of a spike that has an on / off flag: a key of `SPIKE_DEFAULTS` and of `SPIKE_ATTRIBUTES`. The spike flag
 * helpers take one to read the default and the Workspace attribute that overrides it.
 */
export type SpikeName = keyof typeof SPIKE_DEFAULTS;

/**
 * Touch spike MB1 (docs/MOBILE_IMPL.md MB1, docs/SPIKES.md "Spike MB0"): a debug overlay on a phone or tablet that
 * reports the input flags, the fps and memory, every active finger and the offset between touch and GUI space.
 */
export const TOUCH_SPIKE = {
	/** Seconds between overlay refreshes (the fps window). */
	refreshSec: 0.25,
	/** Side of the probe square at the bottom left, pixels. */
	probeSize: 120,
	/** Finger lines shown (the rest are counted, not listed). */
	maxFingerLines: 5,
	/** DisplayOrder of the overlay ScreenGui: above the game HUD, under the spike HUD (100). */
	displayOrder: 50,
	/** Text size of the info label, pixels. */
	textSize: 14,
	/** BackgroundTransparency of the info label and the probe (0 = opaque). */
	backgroundTransparency: 0.4,
} as const;

/** Spike A: pooled bullet Parts moved with one workspace:BulkMoveTo per frame. */
export const BULLET_SPIKE = {
	/** Selectable bullet counts (keys 1-4, or the HUD buttons). */
	counts: [100, 500, 1000, 2000],
	/** Index into `counts` used on start: 1000, the E1.6 target. */
	defaultCountIndex: 2,
	/** Bullet sphere diameter, studs (0.15 tiles at 4 studs/tile reads like the web's bullets). */
	diameterStuds: 0.6,
	/** Bullets per ring (one ring = one burst from the emitter). */
	perRing: 40,
	/** Outward speed, studs per second. */
	speedStuds: 12,
	/** Rings are recycled at this radius, studs (the web view is ~30 x 17 tiles). */
	maxRadiusStuds: 60,
	/**
	 * Height of the bullet plane above the floor, studs: above the character's feet, or (no character: the game
	 * spawns none) above whatever a ray straight down from the camera's focus hits (a dungeon floor, the Baseplate).
	 * 2 = the sim's BULLET_Y (0.5 tiles), so the draw order against walls and floor markings is the game's.
	 */
	heightStuds: 2,
	/** That ray starts this far above the camera's focus and reaches twice as far down, studs (a miss: y = 0). */
	floorProbeStuds: 100,
	/** Spin of the spiral pattern, radians per second. */
	spiralSpinRadPerSec: 1.2,
	/** Angle added per ring in the spiral pattern, radians. */
	spiralStepRad: 0.25,
	/** Ring colors, cycled (placeholder for the theme's bullet color roles). */
	colors: [
		[255, 90, 90],
		[255, 200, 80],
		[120, 200, 255],
		[200, 120, 255],
	],
	/** Seconds between HUD stat refreshes. */
	statsIntervalSec: 0.5,
	/** Folder name under Workspace (cleaned up on stop). */
	folderName: "KV_SpikeBullets",
	/** MicroProfiler label for the per-frame update. */
	profileLabel: "KV BulletSpike",
	/**
	 * Render modes (docs/PROJECTILE_ART.md PA0; keys 5-8 or the HUD buttons). `id` picks the pool, `short` is the
	 * button, `move` names what the HUD's move time measures in that mode.
	 *   neon:    today's neon spheres, one BulkMoveTo (the baseline);
	 *   decal:   (A) a Part per bullet with a Top-face Decal, BulkMoveTo turned along the velocity, frames = textures;
	 *   surface: (B) a Part per bullet with a Top-face SurfaceGui + ImageLabel (FxSpriteController's construction),
	 *            BulkMoveTo turned along the velocity, frames = ImageRectOffset;
	 *   canvas:  (C) ONE Top-face SurfaceGui per pool on a flat Part over the area, an ImageLabel per bullet moved by
	 *            Position / Rotation writes (no Part moves), frames = ImageRectOffset.
	 */
	modes: [
		{ id: "neon", short: "N neon", move: "BulkMoveTo" },
		{ id: "decal", short: "A decal", move: "BulkMoveTo" },
		{ id: "surface", short: "B surf", move: "BulkMoveTo" },
		{ id: "canvas", short: "C canv", move: "writes" },
	],
	/** Index into `modes` used on start: the neon baseline. */
	defaultModeIndex: 0,
	/**
	 * The optional "player" bullets (key 0 or the HUD button): a second pool of the same mode (production keeps the
	 * player and enemy pools apart; mode C gets a second canvas), faster rings at half a step's offset.
	 */
	players: {
		/** Bullets in the player pool (PA0's 1,000 enemy + 200 player). */
		count: 200,
		perRing: 20,
		speedStuds: 30,
		/** Ring angle offset against the enemy rings, radians (half of the player ring's step). */
		offsetRad: math.pi / 20,
		color: [255, 235, 140],
	},
	/**
	 * The sprite modes (A / B / C): a 6x19 px bolt at 29.6 px/tile (PAD5), 4 studs/tile -> 0.81 x 2.57 studs. With pack
	 * art, option B takes the art's own size and canvas (production's spriteBulletLook) instead.
	 */
	sprite: {
		/** Across the travel direction, studs. */
		widthStuds: 0.81,
		/** Along the travel direction, studs. */
		lengthStuds: 2.57,
		/**
		 * The bolt's art size, pixels (across, along): option B's canvas with the engine stand-in, at production's
		 * BULLET_ART_VIEW.canvasPixelsPerArtPixel (4: 24 x 76).
		 */
		artPx: [6, 19],
		/** Option (A)'s Decal part's thickness, studs (its Top face sits at the bullet height; B uses production's). */
		thicknessStuds: 0.05,
		/** Flipbook frames and rate (PAD8: 10 fps, phase = slot index mod frames). */
		frames: 3,
		fps: 10,
		/** The pack sprite tried first (ThemePack.bullet); its first `frames` frames are the flipbook (B / C). */
		lookId: "bullet.player.basic",
		/**
		 * Without pack art, B / C read SPIKE_ENGINE_TEXTURES.strip as `frames` equal cells across this many pixels
		 * (an assumption: if the sprites look empty or cut off, set the texture's real size here).
		 */
		fallbackStripPx: [128, 128],
		/**
		 * Option (A) only: turn added to the Decal bolts' heading, degrees (90 / 180 / 270 if A's bolts do not point
		 * along their travel; a Decal keeps the -Z-up convention a Top-face SurfaceGui does not). Options B and C follow
		 * production's canvas convention: their knob is BULLET_ART_VIEW.canvasTurnDeg (shared/view bullets config.ts).
		 */
		decalYawOffsetDeg: 0,
	},
	/** Option (C): the canvas Part per pool. */
	canvas: {
		/** Extra half-width beyond `maxRadiusStuds`, studs (a bullet's length fits inside). */
		marginStuds: 4,
		/** Canvas pixels per stud (2 x (60 + 4) studs x 8 = a 1024 px canvas; the sprite is 6.5 x 20.6 px). */
		pxPerStud: 8,
		thicknessStuds: 0.05,
		/** Lift of the player canvas over the enemy canvas, studs (two coplanar surfaces would z-fight). */
		playerLiftStuds: 0.02,
	},
} as const;

/** Spike B: iso camera rig (low FOV from far away, damped follow, optional grid snap). */
export const CAMERA_SPIKE = {
	/** FOVs to compare, degrees (key F or the HUD button cycles). 70 is Roblox's default. */
	fovs: [5, 7, 10, 20, 70],
	/** Index into `fovs` used on start. */
	defaultFovIndex: 1,
	/** Follow damping time constant, seconds (0 = rigid). */
	followTauSec: 0.12,
	/** Snap grid sizes to compare, in render texels: 1 = the web build's texel grid. */
	snapTexels: [1, 4, 16],
	/** Placeholder character walk speed, studs per second (the web's 6 tiles/s). */
	walkStuds: 24,
	/** Placeholder character size, studs (1 x 1.5 x 1 tiles). */
	characterSize: [3, 6, 3],
	/** Auto-walk circle radius (studs) and angular speed (rad/s), for touch-only devices. */
	autoWalkRadiusStuds: 20,
	autoWalkRadPerSec: 0.5,
	/** Checker floor: half-extent in tiles, and pillars every N tiles for depth reference. */
	floorHalfTiles: 16,
	pillarEveryTiles: 6,
	pillarHeightTiles: 2,
	floorColors: [
		[70, 76, 92],
		[58, 62, 76],
	],
	pillarColor: [150, 120, 90],
	characterColor: [90, 200, 120],
	/** Folder name under Workspace (cleaned up on stop). */
	folderName: "KV_SpikeCamera",
	/** RenderStep priority: after the default camera (Camera = 200), so ours wins. */
	renderPriorityOffset: 1,
} as const;

/**
 * Spike P0 (docs/PRELOAD.md, docs/SPIKES.md "Spike P0"): PreloadAsync of content id strings vs never-parented
 * instances, for images and sounds, then a first-draw probe of one sheet. Runs once per enable, at join.
 */
export const PRELOAD_SPIKE = {
	/** Boolean Workspace attribute: true runs the instance batches before the string ones (the cache favours second). */
	instancesFirstAttribute: "KV_SpikePreloadInstancesFirst",
	/** The logical id whose sheets are the image batches (the knight). */
	imageAssetId: "class.vanguard",
	/** Logical-id prefix of the sound batches' ids, and how many content ids at most. */
	soundPrefix: "sfx.",
	soundCount: 5,
	/** Frames timed before the probe sheet is shown (the baseline). */
	baselineFrames: 30,
	/** Frames the probe sheet stays on screen (each one's os.clock delta is printed), then it is removed. */
	holdFrames: 10,
	/** The probe ImageLabel's size, screen pixels. */
	probeSizePx: 1,
	/** The probe's ScreenGui DisplayOrder: above the loading screen (shared/view LOADING_VIEW.displayOrder 30). */
	displayOrder: 101,
	/** Milliseconds per second (for the printed timings). */
	msPerSec: 1000,
} as const;

/**
 * Every trigger of the invites spike (HUD buttons): `promptServer` / `promptServerOne` = the server calls
 * `SocialService:PromptGameInvite` (`promptServerOne` with `InviteUser` = the recipient), `promptClient` = the client
 * calls it, `canSendServer` / `canSendClient` = `CanSendGameInviteAsync` without and with a recipient on that side,
 * `dump` = both sides log the player's join data and party again, `hello` = sent by the client (not a button) once it
 * listens, so the server replays that player's arrival lines.
 */
export const INVITE_SPIKE_ACTIONS = [
	"promptServer",
	"promptServerOne",
	"promptClient",
	"canSendServer",
	"canSendClient",
	"dump",
	"hello",
] as const;
/**
 * One trigger of the invites spike (an `INVITE_SPIKE_ACTIONS` member). The spike HUD's buttons carry one, and the
 * client forwards the server-side ones over the spike's RemoteEvent.
 */
export type InviteSpikeAction = (typeof INVITE_SPIKE_ACTIONS)[number];

/** The actions the client forwards to the server over the spike's RemoteEvent (the server accepts only these). */
export const INVITE_SPIKE_SERVER_ACTIONS: ReadonlyArray<InviteSpikeAction> = [
	"promptServer",
	"promptServerOne",
	"canSendServer",
	"dump",
	"hello",
];

/**
 * Spike I0 (docs/INVITES.md I0, docs/SPIKES.md "Spike I0"): Roblox invites and parties. Client and server, published
 * place only (none of these APIs work in Studio). Logs `[InviteSpike]` (server) / `[InviteSpike/client]` lines and
 * shows the last `hudLines` of both sides on the spike HUD.
 */
export const INVITE_SPIKE = {
	/** Folder the server spike makes under ReplicatedStorage while on (removed with it), holding the RemoteEvent. */
	folderName: "KV_InviteSpike",
	/** RemoteEvent in that folder: client -> server an InviteSpikeAction, server -> every client one log line. */
	remoteName: "Request",
	/** How long the client waits for the server's folder / remote before it says the server spike is off, seconds. */
	remoteWaitSec: 15,
	/** After PlayerAdded the server reads `GetJoinData().LaunchData` every `launchDataPollSec` for `launchDataWatchSec`. */
	launchDataPollSec: 1,
	launchDataWatchSec: 15,
	/** `ExperienceInviteOptions.PromptMessage` of the spike's prompts. */
	promptMessage: "Invite spike (I0): pick friends to invite to Roblox Dungeons",
	/** First field of the spike's LaunchData (`kvspike|<side>|<ISO time>|<inviter UserId>`). */
	launchDataTag: "kvspike",
	/** LaunchData's documented maximum length, characters (the spike warns past it). */
	launchDataMaxChars: 200,
	/** Workspace attributes: a recipient UserId (number) for the with-recipient checks, else the first other player. */
	recipientAttribute: "KV_InviteSpikeRecipient",
	/** Workspace attribute: a Notification String id (string) for `InviteMessageId`; unset = Roblox's default text. */
	messageIdAttribute: "KV_InviteSpikeMessageId",
	/** Log lines kept on the spike HUD (newest last). */
	hudLines: 12,
	/** Server lines about one player's arrival kept to replay to that client when it says `hello`. */
	replayLines: 40,
	/** Nesting depth and string length the value dumps print before they elide (`{...}`, `...`). */
	dumpMaxDepth: 3,
	dumpMaxStringChars: 200,
	/** Seconds a player must wait between two spike requests to the server. */
	requestCooldownSec: 1,
} as const;

/**
 * Spike UA1 (docs/UI_ART.md UA1, docs/SPIKES.md "Spike UA1"): the UI art primitives on screen. A sliced test panel at
 * two sizes with SliceScale snapped and fixed, the same inside a CanvasGroup with GroupTransparency, a row of
 * icon-atlas images at their fitArt size, a focused-button bracket demo, and a line with the UIScale and scales.
 * Reference px (the HUD's 1280 x 720 design; the spike's ScreenGui carries the HUD's UIScale).
 */
export const UI_ART_SPIKE = {
	/** ScreenGui DisplayOrder: above the menus and HUD, under the spike HUD (100). */
	displayOrder: 60,
	/** The sliced test panel's id and its two sizes, reference px. */
	panelId: "ui.panel.menu",
	sizes: [
		[200, 120],
		[420, 300],
	],
	/** GroupTransparency of the CanvasGroup copy. */
	groupTransparency: 0.5,
	/** Icon-atlas ids drawn in the icon row, each with the UI_ART.iconBox kind it fits into. */
	icons: [
		["ui.heart.full", "heart"],
		["ui.heart.half", "heart"],
		["ui.heart.empty", "heart"],
		["ui.flask.full", "flask"],
		["ui.flask.empty", "flask"],
		["ui.candle", "ember"],
		["ui.chip", "pip"],
		["ui.chip.white", "pip"],
		["ui.focus.corner", "glyph"],
		["ui.icon.check", "glyph"],
		["ui.icon.cross", "glyph"],
		["ui.icon.gear", "glyph"],
		["ui.icon.help", "glyph"],
		["ui.icon.pause", "glyph"],
		["ui.icon.home", "glyph"],
		["ui.icon.speaker", "glyph"],
		["ui.icon.mute", "glyph"],
		["ui.icon.coin", "glyph"],
	],
	/** The bracket demo: a button-sized ui.button with the four focus brackets, reference px. */
	buttonId: "ui.button",
	buttonSize: [260, 40],
	/** Gap between the spike's pieces, its outer margin and backdrop transparency. */
	gap: 12,
	margin: 16,
	backdropTransparency: 0.2,
	/** Decimals printed for the UIScale and SliceScale. */
	scaleFormat: "%.4f",
} as const;

/**
 * Spike L0 (docs/LOCALIZATION.md L0, docs/SPIKES.md "Spike L0"): a glyph sheet (font candidates x script samples, each
 * cell with its TextFits and TextBounds), wrapped-text boxes per script, the Arabic sample in each TextDirection, the
 * AutoLocalize probe labels and the locale ids. Samples and font candidates: shared/spikes l10nSpike.ts. Screen px.
 */
export const L10N_SPIKE = {
	/** ScreenGui DisplayOrder: above the menus and HUD, under the spike HUD (100). */
	displayOrder: 70,
	/** Outer margin, gap between pieces, backdrop transparency. */
	margin: 12,
	gap: 6,
	backdropTransparency: 0.15,
	/** Monospace text size of headings and info lines. */
	infoTextSize: 14,
	/** Glyph sheet: the font-name column width, one cell's size, the sample's text size and the metrics line's. */
	fontColumnWidth: 120,
	cellWidth: 240,
	cellHeight: 26,
	glyphTextSize: 18,
	metricsTextSize: 11,
	metricsHeight: 14,
	/** Wrapped-text boxes: width, text size, and the fonts each box is drawn in (one row per font). */
	wrapWidth: 220,
	wrapTextSize: 16,
	wrapFonts: ["Arcade", "BuilderSans"],
	/** The Arabic direction row: box width and the TextDirection names tried (each set through pcall). */
	directionWidth: 320,
	directions: ["Auto", "LeftToRight", "RightToLeft"],
	/** The AutoLocalize probe labels: width, height, text size. */
	probeWidth: 360,
	probeHeight: 28,
	probeTextSize: 18,
	/** Seconds after the sheet mounts before the TextFits / TextBounds table is printed (layout has settled). */
	logDelaySec: 1,
	/** Format of a cell's metrics line: TextFits, then TextBounds width x height. */
	metricsFormat: "fits %s  %dx%d",
} as const;

/**
 * Spike GM0 (docs/GAMEPAD_MENUS.md GM0, docs/SPIKES.md "Spike GM0"): gamepad GUI navigation. A test ScreenGui with
 * one column per question (selection image, scrolling, destroyed / hidden selection, a Stop group in a second ScreenGui,
 * `GuiService:Select` and SelectionOrder, glyphs, haptics, console signals, Start / Select) and a log tail; every
 * finding is also printed with the `[PadSpike]` prefix. Pixels are screen px (no UIScale).
 */
export const PAD_SPIKE = {
	/** DisplayOrder of the spike's ScreenGui (above the menus and the HUD, under the spike HUD 100). */
	displayOrder: 55,
	/** DisplayOrder of the trap ScreenGui (question 4): a different order from the spike's own. */
	trapDisplayOrder: 57,
	/** Prefix of every printed line. */
	logPrefix: "[PadSpike]",
	/** Lines of the on-screen log tail (newest last). */
	logLines: 12,
	/** Monospace text size of the labels, the buttons and the log. */
	textSize: 13,
	/** Outer margin and the gap between pieces. */
	margin: 8,
	gap: 4,
	/** Width of one column, of the status / log column, and the height of a button. */
	columnWidth: 230,
	logWidth: 330,
	buttonHeight: 26,
	/** Thickness of the scrolling frames' scroll bars, px. */
	scrollBarPx: 6,
	/** Seconds between refreshes of the status lines (selected object, PreferredInput, navigation flags). */
	statusRefreshSec: 0.25,
	/** Backdrop transparency of the panels (0 = opaque). */
	backdropTransparency: 0.2,
	/** RGB of the text, the panels' backdrop and the buttons (developer UI: no theme roles). */
	textColor: [255, 255, 255],
	panelColor: [20, 20, 28],
	buttonColor: [60, 60, 84],
	/** Question 2: buttons in the button list, the list's height, and the text-only list's lines and height. */
	listButtons: 30,
	listHeight: 180,
	textLines: 40,
	textListHeight: 120,
	/** Seconds a scrolling frame's CanvasPosition must stay still before its new value is logged (no spam). */
	canvasSettleSec: 0.25,
	/** Question 5: the SelectionOrder given to the third button of the Select(root) row (the other two keep 0). */
	selectRootOrder: -1,
	/** Question 6: the pad KeyCodes whose platform image and string are read (Enum.KeyCode names). */
	glyphKeys: [
		"ButtonA",
		"ButtonB",
		"ButtonX",
		"ButtonY",
		"ButtonL1",
		"ButtonR1",
		"ButtonL2",
		"ButtonR2",
		"ButtonStart",
		"ButtonSelect",
		"DPadUp",
		"DPadDown",
		"DPadLeft",
		"DPadRight",
	],
	/** Side of one glyph image, px; glyph cells per row. */
	glyphSize: 28,
	glyphColumns: 2,
	/** Question 7: the motors tried with SetMotor (Enum.VibrationMotor names), each at every strength (0..1). */
	motors: ["Small", "Large"],
	motorStrengths: [0.3, 1],
	/** Question 7: how long one SetMotor try runs before the motor is set back to 0, seconds. */
	motorSec: 0.2,
	/** Question 7: seconds a played HapticEffect instance is kept before it is destroyed. */
	effectLifeSec: 2,
	/** Question 7: the HapticEffectType names tried with a HapticEffect (each through pcall). */
	hapticTypes: ["UIClick", "UIHover", "UINotification", "GameplayExplosion", "GameplayCollision"],
	/** Question 9: the pad buttons whose InputBegan / InputEnded is always logged (every other pad press: Began only). */
	watchKeys: ["ButtonStart", "ButtonSelect"],
	/** Keyboard key that puts the selection back on the spike's first button (the menus may take it on a device switch). */
	reselectKey: "F7",
} as const;
