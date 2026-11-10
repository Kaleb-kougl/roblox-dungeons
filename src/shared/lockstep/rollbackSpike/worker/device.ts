/**
 * What the rollback probe's summaries say about the device and the moment (docs/ROLLBACK_SPIKE.md Design 5 "Logged,
 * not only shown"): the device class and label from what the game knows (Roblox gives scripts no device model), and
 * the probe case (room / floor / boss / walk) from the state. Pure.
 */
import { NO_KIND, archetypeAt, type SimState } from "shared/sim";
import { ROLLBACK_PROBE_LIMITS, type RollbackDeviceClass, type RollbackProbeCase } from "shared/spikes";
import { ROLLBACK_SPIKE } from "../config";

/** What the client reads about its device (UserInputService, GuiService, the camera's viewport). */
export interface RollbackDeviceFacts {
	/** GuiService:IsTenFootInterface(). */
	readonly tenFoot: boolean;
	readonly touch: boolean;
	readonly keyboard: boolean;
	readonly gamepad: boolean;
	/** Viewport size, pixels. */
	readonly viewportX: number;
	readonly viewportY: number;
}

/**
 * The device class: a ten-foot interface is a console; touch without a keyboard or a gamepad is a phone or (short side
 * at least ROLLBACK_SPIKE.probe.tabletMinShortSidePx) a tablet; anything else a pc.
 */
export function rollbackDeviceClass(f: Readonly<RollbackDeviceFacts>): RollbackDeviceClass {
	if (f.tenFoot) return "console";
	if (f.touch && !f.keyboard && !f.gamepad) {
		const short = math.min(f.viewportX, f.viewportY);
		return short >= ROLLBACK_SPIKE.probe.tabletMinShortSidePx ? "tablet" : "phone";
	}
	return "pc";
}

const UTF8_CONTINUATION_MIN = 0x80;
const UTF8_CONTINUATION_MAX = 0xbf;

/**
 * Strips control characters (the server's reader refuses them) and trims spaces; a tag that is not valid UTF-8 keeps
 * its ASCII characters only (the reader refuses invalid UTF-8 too).
 */
function cleanTag(tag: string): string {
	let [plain] = string.gsub(tag, "%c", "");
	if (utf8.len(plain)[0] === false) [plain] = string.gsub(plain, "[\128-\255]", "");
	const [trimmed] = string.gsub(plain, "^%s+", "");
	const [done] = string.gsub(trimmed, "%s+$", "");
	return done;
}

/** `s` cut to at most `max` bytes without splitting a UTF-8 character (the cut moves back to a character's start). */
export function utf8Truncate(s: string, max: number): string {
	if (s.size() <= max) return s;
	let cut = max;
	while (cut > 0) {
		const [b] = string.byte(s, cut + 1);
		if (b === undefined || b < UTF8_CONTINUATION_MIN || b > UTF8_CONTINUATION_MAX) break;
		cut--;
	}
	return s.sub(1, cut);
}

/**
 * The device label: the inputs present, the viewport, then the tester's tag (KV_RollbackDeviceTag), cut to the
 * reader's maxDeviceLabelChars ("touch 2400x1080 Pixel 6a").
 */
export function rollbackDeviceLabel(f: Readonly<RollbackDeviceFacts>, tag: string | undefined): string {
	const inputs: string[] = [];
	if (f.tenFoot) inputs.push("tv");
	if (f.touch) inputs.push("touch");
	if (f.keyboard) inputs.push("kb");
	if (f.gamepad) inputs.push("pad");
	if (inputs.size() === 0) inputs.push("none");
	let label = `${inputs.join("+")} ${math.round(f.viewportX)}x${math.round(f.viewportY)}`;
	const t = tag !== undefined ? cleanTag(tag) : "";
	if (t !== "") label = `${label} ${t}`;
	return utf8Truncate(label, ROLLBACK_PROBE_LIMITS.maxDeviceLabelChars);
}

/** Actors alive (a kind, not dead). */
export function aliveActors(state: Readonly<SimState>): number {
	let n = 0;
	for (const a of state.combat.actors) if (a.kind !== NO_KIND && a.alive !== 0) n++;
	return n;
}

/**
 * The probe case from the state: "boss" while a boss is engaged; "floor" while at least floorCaseRooms score rooms
 * are engaged and not cleared at once (the whole floor entered: the replay bench's dense case); "room" while one is;
 * else "walk".
 */
export function rollbackProbeCase(state: Readonly<SimState>): RollbackProbeCase {
	for (const a of state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0 || a.phase <= 0) continue;
		if (archetypeAt(a.kind).data.boss === true) return "boss";
	}
	let engaged = 0;
	const score = state.score;
	if (score !== undefined) {
		for (const r of score.rooms) if (r.engageTick >= 0 && r.cleared === 0) engaged++;
	}
	if (engaged >= ROLLBACK_SPIKE.probe.floorCaseRooms) return "floor";
	return engaged > 0 ? "room" : "walk";
}
