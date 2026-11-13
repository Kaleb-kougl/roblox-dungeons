/**
 * The Options screen (task L4: the juice settings panel grown into tabs, plus rebinding, task L4b client): its tabs,
 * layout tunables and every theme string key it reads (`options.*`; hud.spec.ts checks they all exist). The juice tab
 * keeps the juice panel's `fx.settings.*` keys.
 */
import type { BindingDevice, BindingRefusal, GameAction, InputDeviceKind } from "shared/play";

export type OptionsTab = "juice" | "controls" | "audio" | "display";
/** Tab order (the first is selected when the screen opens). */
export const OPTIONS_TABS: ReadonlyArray<OptionsTab> = ["juice", "controls", "audio", "display"];
/**
 * A Controls sub-tab: a binding device, or Touch (docs/HAPTICS.md HP5: the phone's Vibration row only; touch has no
 * bindings, test strip or device reset).
 */
export type OptionsControlsDevice = BindingDevice | "touch";
/** The Controls tab's sub-tabs (every one; a device without touch shows `optionsDevices(false)`). */
export const OPTIONS_DEVICES: ReadonlyArray<OptionsControlsDevice> = ["kbm", "pad", "touch"];
const OPTIONS_DEVICES_NO_TOUCH: ReadonlyArray<OptionsControlsDevice> = ["kbm", "pad"];

/** The Controls sub-tabs shown: Touch only on a touch-enabled device (as the Display tab's touch rows). */
export function optionsDevices(touch: boolean): ReadonlyArray<OptionsControlsDevice> {
	return touch ? OPTIONS_DEVICES : OPTIONS_DEVICES_NO_TOUCH;
}

/** The sub-tab drawn: `device` when it is shown, else the first (a stored Touch on a device without touch). */
export function shownControlsDevice(device: OptionsControlsDevice, touch: boolean): OptionsControlsDevice {
	const shown = optionsDevices(touch);
	return shown.includes(device) ? device : shown[0];
}

/**
 * The Controls sub-tab an opening of Options starts on: Touch when the last-used device is touch and the device shows
 * Touch (a phone player's only Controls row; docs/HAPTICS.md HP7 review), else the sub-tab kept from last time.
 */
export function openingControlsDevice(
	current: OptionsControlsDevice,
	lastDevice: InputDeviceKind,
	touch: boolean,
): OptionsControlsDevice {
	return lastDevice === "touch" && touch ? "touch" : current;
}

/** The binding device a Controls sub-tab rebinds, or undefined for Touch (no bindings). */
export function controlsBindingDevice(device: OptionsControlsDevice): BindingDevice | undefined {
	return device === "touch" ? undefined : device;
}

/** Every way a rebind / clear can be refused (shared/play BindingRefusal), for the refusal notes. */
export const BINDING_REFUSALS: ReadonlyArray<BindingRefusal> = [
	"reserved",
	"unknown",
	"notRebindable",
	"badSlot",
	"primaryRequired",
	"onlyInput",
];

export const OPTIONS_STRINGS = {
	title: "options.title",
	close: "options.close",
	reset: "options.reset",
	hint: "options.hint",
	/** Controls tab: column heads, the empty secondary, Clear, the device reset and its confirmation. */
	primary: "options.controls.primary",
	secondary: "options.controls.secondary",
	button: "options.controls.button",
	emptySlot: "options.controls.empty",
	clear: "options.controls.clear",
	resetDevice: "options.controls.reset",
	resetConfirm: "options.controls.resetConfirm",
	resetYes: "options.controls.resetYes",
	cancel: "options.controls.cancel",
	test: "options.controls.test",
	/**
	 * Controls > Gamepad: vibration On / Off (docs/GAMEPAD_MENUS.md GM9; labels as roomEdges); the same label on Controls
	 * > Touch for the phone (docs/HAPTICS.md HP5).
	 */
	vibration: "options.controls.vibration",
	/** The capture overlay ("Press a key... (5)") and its cancel line. */
	captureKey: "options.capture.key",
	captureButton: "options.capture.button",
	captureCancel: "options.capture.cancel",
	/** "{input} is already used by {action}." [Swap] [Cancel] */
	conflict: "options.conflict",
	swap: "options.conflict.swap",
	/** Audio tab. */
	master: "options.audio.master",
	music: "options.audio.music",
	sfx: "options.audio.sfx",
	percent: "options.percent",
	down: "options.down",
	up: "options.up",
	/** Display tab. */
	hudScale: "options.display.hudScale",
	/** The room-edge lines On / Off (docs/ROOM_EDGES.md RE6; the option labels are the juice tab's fx.settings.on / off). */
	roomEdges: "options.display.roomEdges",
	/** Corner HUD panels fade under the action, On / Off (docs/HUD_LAYOUT.md H7; labels as roomEdges). */
	hudFade: "options.display.hudFade",
	/** Item tooltips on the live HUD's items / boost rows, On / Off (docs/ITEM_TOOLTIPS.md ITD8; labels as roomEdges). */
	hudTooltips: "options.display.hudTooltips",
	/** The corner minimap On / Off (docs/MINIMAP.md M10; labels as roomEdges). */
	minimap: "options.display.minimap",
	/** The watched player's rim On / Off (docs/PLAYER_OUTLINE.md P4; labels as roomEdges). */
	playerOutline: "options.display.playerOutline",
	/** The build effects Full / Reduced (docs/BUILDS.md BUD13) and its two option labels. */
	buildFx: "options.display.buildFx",
	buildFxFull: "options.display.buildFx.full",
	buildFxReduced: "options.display.buildFx.reduced",
	/** The gauntlet cursor's size Small / Normal / Large (docs/CURSOR.md D2, C6) and its three option labels. */
	cursorSize: "options.display.cursorSize",
	cursorSizeSmall: "options.display.cursorSize.small",
	cursorSizeNormal: "options.display.cursorSize.normal",
	cursorSizeLarge: "options.display.cursorSize.large",
	/** Touch controls (docs/MOBILE.md MB7): the size and opacity steps (percent), and the auto-target and left-handed On / Off rows (labels as roomEdges). */
	touchSize: "options.display.touchSize",
	touchOpacity: "options.display.touchOpacity",
	touchAutoTarget: "options.display.touchAutoTarget",
	touchLeftHanded: "options.display.touchLeftHanded",
	/**
	 * Language (docs/LOCALIZATION.md L6): the row label, "Automatic ({name})" ({name}: the endonym Automatic picks), and
	 * the previous / next buttons around the value (language.ts; the endonyms are not strings).
	 */
	language: "options.display.language",
	languageAuto: "options.display.language.auto",
	languagePrev: "options.display.language.prev",
	languageNext: "options.display.language.next",
	/** Prefixes: `options.tab.<tab>`, `options.device.<kbm|pad|touch>`, `options.action.<action>`, `options.refused.<reason>`. */
	tabPrefix: "options.tab.",
	devicePrefix: "options.device.",
	actionPrefix: "options.action.",
	refusedPrefix: "options.refused.",
} as const;

export function optionsTabKey(tab: OptionsTab): string {
	return `${OPTIONS_STRINGS.tabPrefix}${tab}`;
}

export function optionsDeviceKey(device: OptionsControlsDevice): string {
	return `${OPTIONS_STRINGS.devicePrefix}${device}`;
}

/** The display name of a game action ("options.action.swap" -> "Swap weapons"). */
export function actionNameKey(action: GameAction): string {
	return `${OPTIONS_STRINGS.actionPrefix}${action}`;
}

/** The note shown when a captured input is refused (vars: input, action). */
export function refusalKey(reason: BindingRefusal): string {
	return `${OPTIONS_STRINGS.refusedPrefix}${reason}`;
}

/** Every `options.*` key the screen can read (hud.spec.ts checks each exists in the placeholder pack). */
export function optionsStringKeys(actions: ReadonlyArray<GameAction>): Array<string> {
	const out = new Array<string>();
	for (const [name, key] of pairs(OPTIONS_STRINGS as unknown as Map<string, string>)) {
		if (string.find(name, "Prefix$")[0] === undefined) out.push(key);
	}
	for (const tab of OPTIONS_TABS) out.push(optionsTabKey(tab));
	for (const device of OPTIONS_DEVICES) out.push(optionsDeviceKey(device));
	for (const action of actions) out.push(actionNameKey(action));
	for (const reason of BINDING_REFUSALS) out.push(refusalKey(reason));
	return out;
}

/** The longest input label (shared/play inputLabel) a binding slot must fit ("Middle click"; hud.spec.ts checks). */
export const OPTIONS_LABEL_MAX_CHARS = 12;

/** Options screen layout (reference pixels; under the HUD's UIScale). */
export const OPTIONS_VIEW = {
	width: 780,
	tabSize: { x: 150, y: 34 },
	/** Controls: the scrolling list's height, one row's height, the action label and slot widths. */
	listHeight: 300,
	rowHeight: 30,
	actionWidth: 230,
	slotSize: { x: 190, y: 28 },
	clearSize: { x: 80, y: 28 },
	/** The input test strip: one chip per action. */
	chipSize: { x: 88, y: 22 },
	chipText: 14,
	/** Audio: the - / + buttons and the value label. */
	stepSize: { x: 40, y: 30 },
	valueWidth: 70,
	/** Modal prompts (capture, conflict, reset confirmation). */
	modalWidth: 460,
	modalButton: { x: 160, y: 36 },
	/** Scroll bar thickness of the bindings list. */
	scrollBar: 6,
} as const;
