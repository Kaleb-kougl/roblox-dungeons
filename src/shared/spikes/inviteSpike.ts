import { INVITE_SPIKE, INVITE_SPIKE_SERVER_ACTIONS, InviteSpikeAction } from "shared/config";

/**
 * Helpers both halves of the invites spike I0 use (docs/SPIKES.md "Spike I0"): value dumps for the log, the spike's
 * LaunchData string and prompt options, the recipient pick, and the server's check of a client request. No
 * services: callers pass in what they read.
 */

/** Which side made a prompt, as written into the spike's LaunchData. */
export type InviteSpikeSide = "server" | "client";

const SIDE_CODES: Record<InviteSpikeSide, string> = { server: "s", client: "c" };

/** `kvspike|<s or c>|<ISO time>|<inviter UserId>`: what the invitee's GetJoinData().LaunchData should hold. */
export function inviteSpikeLaunchData(side: InviteSpikeSide, inviterId: number, isoTime: string): string {
	return `${INVITE_SPIKE.launchDataTag}|${SIDE_CODES[side]}|${isoTime}|${inviterId}`;
}

/** A LaunchData string the spike made, split back into its fields. */
export interface InviteSpikeLaunch {
	readonly side: InviteSpikeSide;
	readonly isoTime: string;
	readonly inviterId: number;
}

/** The fields of a spike LaunchData string, or undefined for anything else (users can edit LaunchData). */
export function parseInviteSpikeLaunchData(s: string): InviteSpikeLaunch | undefined {
	const parts = s.split("|");
	if (parts.size() !== 4 || parts[0] !== INVITE_SPIKE.launchDataTag) return undefined;
	const side = parts[1] === SIDE_CODES.server ? "server" : parts[1] === SIDE_CODES.client ? "client" : undefined;
	const inviterId = tonumber(parts[3]);
	if (side === undefined || inviterId === undefined) return undefined;
	return { side, isoTime: parts[2], inviterId };
}

/**
 * The spike's ExperienceInviteOptions: INVITE_SPIKE.promptMessage, `launch` as LaunchData, InviteUser = `recipient`
 * if given, InviteMessageId = `messageId` if it is a non-empty string. May throw (an engine-side property check):
 * call it inside pcall. The caller owns (and destroys) the instance.
 */
export function makeInviteSpikeOptions(
	launch: string,
	recipient: number | undefined,
	messageId: unknown,
): ExperienceInviteOptions {
	const options = new Instance("ExperienceInviteOptions");
	options.PromptMessage = INVITE_SPIKE.promptMessage;
	options.LaunchData = launch;
	if (recipient !== undefined) options.InviteUser = recipient;
	if (typeIs(messageId, "string") && messageId !== "") options.InviteMessageId = messageId;
	return options;
}

function quote(s: string): string {
	const max = INVITE_SPIKE.dumpMaxStringChars;
	return s.size() > max ? `"${s.sub(1, max)}..." (${s.size()} chars)` : `"${s}"`;
}

/** One value as a log fragment: strings quoted, Players by name and id, tables to INVITE_SPIKE.dumpMaxDepth. */
export function describeValue(value: unknown, depth = 0): string {
	if (value === undefined) return "nil";
	if (typeIs(value, "string")) return quote(value);
	if (typeIs(value, "number") || typeIs(value, "boolean") || typeIs(value, "EnumItem")) return tostring(value);
	if (typeIs(value, "Instance")) {
		return value.IsA("Player") ? `Player(${value.Name}, ${value.UserId})` : `${value.ClassName}(${value.Name})`;
	}
	if (typeIs(value, "table")) {
		if (depth >= INVITE_SPIKE.dumpMaxDepth) return "{...}";
		const fields = describeFields(value, depth + 1);
		return fields.size() === 0 ? "{}" : `{ ${fields.join(", ")} }`;
	}
	return `${typeOf(value)} ${tostring(value)}`;
}

/** Every key of a table as `key (type) = value`, sorted by key, so a dump lists what the engine actually returned. */
export function describeFields(value: unknown, depth = 0): Array<string> {
	const out = new Array<string>();
	if (!typeIs(value, "table")) return out;
	for (const [k, v] of value as unknown as Map<unknown, unknown>) {
		out.push(`${tostring(k)} (${typeOf(v)}) = ${describeValue(v, depth)}`);
	}
	out.sort();
	return out;
}

/**
 * The recipient of the with-recipient checks: the INVITE_SPIKE.recipientAttribute value if it is a positive number,
 * else the first id in `otherIds` (players in the server other than the sender), else undefined.
 */
export function pickInviteSpikeRecipient(attribute: unknown, otherIds: ReadonlyArray<number>): number | undefined {
	if (typeIs(attribute, "number") && attribute > 0) return attribute;
	return otherIds.size() > 0 ? otherIds[0] : undefined;
}

/** A client request is an InviteSpikeAction the server handles; anything else is dropped. */
export function isInviteSpikeServerAction(value: unknown): value is InviteSpikeAction {
	return typeIs(value, "string") && (INVITE_SPIKE_SERVER_ACTIONS as ReadonlyArray<string>).includes(value);
}
