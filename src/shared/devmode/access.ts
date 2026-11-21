/**
 * Who may use developer mode (docs/DEV_MODE.md): the pure rule DevModeService applies to each joining player (the
 * client never decides; it reads the player attribute the server sets). Plain data in, boolean out: tested headlessly.
 *
 * @module
 */
import { DEV_MODE } from "shared/config";

/** What the rule reads about the server and the player. */
export interface DevAccessFacts {
	/** RunService:IsStudio(). */
	readonly studio: boolean;
	readonly userId: number;
	/** game.CreatorId. */
	readonly creatorId: number;
	/** game.CreatorType is User (a group-owned game has no single creator to allow). */
	readonly creatorIsUser: boolean;
}

/** The rule's switches (DEV_MODE's by default; specs pass their own). */
export interface DevAccessPolicy {
	readonly enabled: boolean;
	readonly allowedUserIds: ReadonlyArray<number>;
	readonly allowPlaceCreator: boolean;
}

/**
 * True when the player may use developer mode: never while the master switch is off; always in Studio; on a live server
 * a listed UserId, or the place's creator (a user-owned game, `allowPlaceCreator`). Guests / invalid ids (<= 0) never
 * match the creator rule.
 */
export function devModeAllowed(facts: Readonly<DevAccessFacts>, policy: Readonly<DevAccessPolicy> = DEV_MODE): boolean {
	if (!policy.enabled) return false;
	if (facts.studio) return true;
	if (facts.userId <= 0) return false;
	if (policy.allowedUserIds.includes(facts.userId)) return true;
	return policy.allowPlaceCreator && facts.creatorIsUser && facts.creatorId === facts.userId;
}
