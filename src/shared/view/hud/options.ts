/**
 * The Options screen (task L4: the juice settings panel grown into tabs, plus rebinding, task L4b client): its tabs,
 * layout tunables and every theme string key it reads (`options.*`; hud.spec.ts checks they all exist). The juice tab
 * keeps the juice panel's `fx.settings.*` keys.
 */
import type { BindingDevice, BindingRefusal, GameAction } from "shared/play";

export type OptionsTab = "juice" | "controls" | "audio" | "display";
/** Tab order (the first is selected when the screen opens). */
export const OPTIONS_TABS: ReadonlyArray<OptionsTab> = ["juice", "controls", "audio", "display"];
/** The Controls tab's sub-tabs. */
export const OPTIONS_DEVICES: ReadonlyArray<BindingDevice> = ["kbm", "pad"];

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
	/** Prefixes: `options.tab.<tab>`, `options.device.<kbm|pad>`, `options.action.<action>`, `options.refused.<reason>`. */
	tabPrefix: "options.tab.",
	devicePrefix: "options.device.",
	actionPrefix: "options.action.",
	refusedPrefix: "options.refused.",
} as const;

export function optionsTabKey(tab: OptionsTab): string {
	return `${OPTIONS_STRINGS.tabPrefix}${tab}`;
}

export function optionsDeviceKey(device: BindingDevice): string {
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
