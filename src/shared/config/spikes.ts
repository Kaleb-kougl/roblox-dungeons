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
 * An attribute, when present, overrides the default below; setting it to false stops the spike
 * and cleans up everything it made.
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
} as const;

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
	/** Height of the bullet plane above the floor, studs. */
	heightStuds: 1.5,
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
	promptMessage: "Invite spike (I0): pick friends to invite to Kaleb-Vale",
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
