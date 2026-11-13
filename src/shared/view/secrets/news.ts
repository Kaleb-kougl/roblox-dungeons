/**
 * A secret room's news on the HUD (docs/SECRET_ROOMS.md SR9, Design 9): the SECRET! floor shout, the co-op toast and
 * the chest's reward cards. Pure (no Instances), tested headlessly; the client's SecretRenderController / toast path
 * (Track V2) shows them.
 *
 *   secretShout        SECRET! (`fx.secret.text`) on the combo shout's slot at FLOOR_SHOUT_PRIORITY.secret (over the
 *                      new best, under the Goldling's appearance), in the chest tier's floor colour, for the VIEW player
 *                      when they opened it (credited or the toast's finder) or stand within SECRET_VIEW.shout.nearTiles
 *                      of the crack; a far teammate's open asks for nothing (the toast says it)
 *   secretToast        `Secret found by {name}` (`hud.toast.secret`) in a party run, for every member but the finder
 *                      (the finder has the shout), `{name}` the finder's display name (the caller's lookup); none
 *                      solo, without a finder (a Charger with nobody alive) or a name
 *   secretRewardTexts  the chest's reward cards (the vault's rewardCardTexts: relic, bonus draft, boosts, points) for
 *                      the view player, under the line `Secret cache` (`treasure.secret.title`, where a vault shows its
 *                      kept / near-miss line)
 */
import { treasureFloorRole } from "shared/theme";
import { partySize, type SimState } from "shared/sim";
import type { FloorShoutRequest } from "../fx/buildsV2Fx";
import { FLOOR_SHOUT_PRIORITY } from "../hud/dailyRankConfig";
import { rewardCardTexts, type RewardCardText, type TreasureStr } from "../treasure/text";
import { playerNear } from "./cues";
import { SECRET_VIEW } from "./config";
import type { SecretOpenedEvent, SecretTakenEvent } from "./events";

/** The theme strings these helpers read (shared/theme secrets.ts SECRET_STRING_KEYS, by name). */
export const SECRET_TEXT_KEYS = {
	shout: "fx.secret.text",
	toast: "hud.toast.secret",
	cacheTitle: "treasure.secret.title",
} as const;

/** The SECRET! shout for view player `viewIndex` (see the file comment), or undefined. */
export function secretShout(
	o: Readonly<SecretOpenedEvent>,
	state: Readonly<SimState>,
	viewIndex: number,
): FloorShoutRequest | undefined {
	const mine = o.player === viewIndex || o.finder === viewIndex;
	if (!mine && !playerNear(state, viewIndex, o.x, o.z, SECRET_VIEW.shout.nearTiles)) return undefined;
	return {
		key: SECRET_TEXT_KEYS.shout,
		vars: undefined,
		role: treasureFloorRole(o.tier),
		lifeSec: SECRET_VIEW.shout.lifeSec,
		priority: FLOOR_SHOUT_PRIORITY.secret,
		player: o.finder,
	};
}

/** One toast to push: its key and args (`name`) and how long it shows (seconds). */
export interface SecretToast {
	readonly key: string;
	readonly args: Readonly<Record<string, string>>;
	readonly seconds: number;
}

/**
 * The co-op toast for local player `localIndex` (see the file comment), or undefined. `nameOf(player)`: that party
 * member's display name (undefined: unknown, no toast).
 */
export function secretToast(
	o: Readonly<SecretOpenedEvent>,
	state: Readonly<SimState>,
	localIndex: number,
	nameOf: (player: number) => string | undefined,
): SecretToast | undefined {
	if (partySize(state) < 2 || o.finder < 0 || o.finder === localIndex) return undefined;
	const name = nameOf(o.finder);
	if (name === undefined) return undefined;
	return { key: SECRET_TEXT_KEYS.toast, args: { name }, seconds: SECRET_VIEW.toast.seconds };
}

/** The chest's cards and their line (see the file comment). */
export interface SecretRewardTexts {
	/** `Secret cache`: drawn where a vault's open line goes. */
	readonly title: string;
	readonly cards: ReadonlyArray<RewardCardText>;
}

/** The reward cards of a taken secret chest for view player `player` (a spectator: the watched player's share). */
export function secretRewardTexts(s: TreasureStr, t: Readonly<SecretTakenEvent>, player: number): SecretRewardTexts {
	return { title: s(SECRET_TEXT_KEYS.cacheTitle), cards: rewardCardTexts(s, t, player) };
}
