/**
 * Developer mode (docs/DEV_MODE.md): jump to any endless floor, R restarts at once, god mode. A local, never-submitted
 * run (the `dev` world, refused by the server), shown only to players the SERVER allows.
 *
 * Who gets it (server, DevModeService; the client only reads the result):
 *   - nobody while `enabled` is false (the master switch: flip it off to ship a build with no dev mode at all),
 *   - in Studio: every player (RunService:IsStudio()),
 *   - on a live server: a UserId in `allowedUserIds`, or the place's creator when `allowPlaceCreator` is set and the
 *     game is owned by a user (game.CreatorType User).
 * The server sets the player attribute `allowedAttribute` (true) on those players; the client opens the panel only
 * when it is set. A client that forges the attribute only unlocks a local practice run: dev runs are never sent, and
 * a forged submission would replay without god mode or the floor jump and fail validation.
 */
export const DEV_MODE = {
	/** Master switch. False: no player ever gets dev mode, Studio included. */
	enabled: true,
	/** Roblox UserIds allowed on live servers (find yours on your profile URL: roblox.com/users/<id>/profile). */
	allowedUserIds: [] as ReadonlyArray<number>,
	/** The place's creator is allowed on live servers when the game is owned by a user (not a group). */
	allowPlaceCreator: true,
	/** Player attribute the server sets (true) on allowed players. */
	allowedAttribute: "KV_DevAllowed",
	/** Key that opens / closes the dev panel (an Enum.KeyCode name). Only allowed players' clients listen. */
	panelKey: "F2",
	/** The panel's floor picker range (inclusive). */
	minFloor: 1,
	maxFloor: 50,
	/** The floor the panel starts on. */
	defaultFloor: 1,
	/** God mode is on when the panel first opens. */
	defaultInvulnerable: true,
	/** The dev panel's ScreenGui order: above the HUD and menus (<= 15), below the loading screen / stage card (30). */
	displayOrder: 20,
	/** Workspace attribute (Studio command bar): true opens the panel as soon as the player is allowed. */
	openOnJoinAttribute: "KV_DevPanel",
} as const;

/**
 * The dev panel's look (client/ui/dev DevPanel; pixels at 1x) and its text. Dev-only English text lives here rather
 * than in the theme packs: only allowed developers ever see it, and the theme contract sits at Luau's local limit.
 */
export const DEV_PANEL_VIEW = {
	/** Key that flips god mode without opening the panel (an Enum.KeyCode name). */
	godKey: "F3",
	/** The chip and panel hang off the screen's left edge, this far in, vertically centred. */
	edgeInset: 8,
	chipHeight: 26,
	chipPadX: 10,
	/** Gap between the chip and the panel under it. */
	gap: 6,
	panelWidth: 248,
	pad: 10,
	rowGap: 6,
	rowHeight: 28,
	textSize: 16,
	titleSize: 18,
	corner: 6,
	panelTransparency: 0.1,
	/** Floor stepper buttons: the small and the big step. */
	floorStep: 1,
	floorBigStep: 5,
	/** Random seeds are drawn in [0, maxRandomSeed] (a valid run seed is an integer in [0, 2^32)). */
	maxRandomSeed: 2147483647,
	/** While the chip or panel is shown, the sim's god state is re-read this often (seconds). */
	pollSeconds: 0.2,
	strings: {
		chip: "DEV",
		chipRun: "DEV · F%d",
		chipGod: "GOD",
		title: "Developer mode",
		hint: "F2 panel · F3 god · R restart",
		floor: "Floor",
		seed: "Seed",
		reroll: "New",
		godOn: "God mode: ON",
		godOff: "God mode: OFF",
		godPending: "God mode: switching...",
		go: "Go to floor %d",
		restart: "Restart (R)",
		bossFloor: "boss floor",
		notInDevRun: "Go starts a local run (never submitted).",
		inDevRun: "Dev run on floor %d: not submitted.",
		/** The rollback probe's device tag (docs/ROLLBACK_SPIKE.md Design 5: Workspace KV_RollbackDeviceTag). */
		rollbackTag: "Rollback probe device tag",
	},
} as const;
