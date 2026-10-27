/**
 * The first-join choice with Roblox invites (docs/INVITES.md §4 "Join intent", ID6): the tutorial's first-run rule
 * (shared/tutorial firstRunChoice: KV_Tutorial, else the server's onboarding status, else the normal flow after
 * TUTORIAL.statusTimeoutSeconds) plus the server's `joinIntent`. An invited or party arrival (`lobby` / `party`: the
 * server put them in a lobby) skips the AUTOMATIC first-run tutorial and gets the menu (the main menu's Tutorial still
 * plays it). Only a choice that would start the tutorial waits for the intent, at most INVITE.intentWaitSeconds from
 * join; `none` or no intent by then starts it exactly as before. KV_Tutorial still wins (a dev override). Pure, so
 * TutorialController only feeds it (firstJoin.spec.ts).
 *
 * The latched choice is not final: it is DISPATCHED only once the join loading screen released (up to
 * PRELOAD's timeout later), and the server may place the player meanwhile (a late LaunchData, a party mate arriving)
 * and upgrade its `joinIntent` from none to lobby / party. `firstJoinDispatchChoice` re-checks at dispatch.
 */
import { INVITE, type ArrivalJoinIntent } from "shared/invite";
import type { OnboardingStatus } from "shared/onboarding";
import { TUTORIAL } from "shared/config";
import { firstRunChoice, type FirstRunChoice, type FirstRunDecision, type FirstRunInputs } from "shared/tutorial";

export interface FirstJoinInputs extends FirstRunInputs {
	/** The server's `joinIntent`, once it arrived. */
	readonly intent: ArrivalJoinIntent | undefined;
	/** Default INVITE.intentWaitSeconds (counted on `waitedSeconds`' clock: real seconds since join). */
	readonly intentTimeoutSeconds?: number;
}

export function firstJoinChoice(inputs: FirstJoinInputs): FirstRunChoice {
	const base = firstRunChoice(inputs);
	if (base !== "tutorial" || inputs.forced !== undefined) return base;
	const intent = inputs.intent;
	if (intent !== undefined) return intent === "none" ? "tutorial" : "normal";
	const timeout = inputs.intentTimeoutSeconds ?? INVITE.intentWaitSeconds;
	return inputs.waitedSeconds >= timeout ? "tutorial" : "wait";
}

/** What the client knows when it dispatches the latched first-join choice. */
export interface FirstJoinDispatchFacts {
	/** KV_Tutorial (true / false), or undefined. */
	readonly forced: boolean | undefined;
	/** The player is in a lobby now (the `lobby` slice's `mine`). */
	readonly inLobby: boolean;
	/** The latest `joinIntent` (it may have been upgraded since the gate latched). */
	readonly intent: ArrivalJoinIntent | undefined;
}

/**
 * The choice to dispatch: a latched "tutorial" becomes the normal flow when the player is in a lobby by now or the
 * latest join intent is lobby / party (ID6: never pull a grouped player into the tutorial), unless KV_Tutorial forced
 * it. Everything else is dispatched as latched.
 */
export function firstJoinDispatchChoice(latched: FirstRunDecision, facts: FirstJoinDispatchFacts): FirstRunDecision {
	if (latched !== "tutorial" || facts.forced === true) return latched;
	if (facts.inLobby || facts.intent === "lobby" || facts.intent === "party") return "normal";
	return latched;
}

/**
 * The first-join gate over time (replaces shared/tutorial FirstRunGate in TutorialController): `receive` the
 * onboarding status and `receiveIntent` the join intent whenever they arrive, `poll` once per frame with the frame's
 * real delta. The first answer other than "wait" is latched.
 */
export class FirstJoinGate {
	private waited = 0;
	private status: OnboardingStatus | undefined;
	private intent: ArrivalJoinIntent | undefined;
	private choice: FirstRunDecision | undefined;

	constructor(
		private readonly statusTimeoutSeconds: number = TUTORIAL.statusTimeoutSeconds,
		private readonly intentTimeoutSeconds: number = INVITE.intentWaitSeconds,
	) {}

	receive(status: Readonly<OnboardingStatus>): void {
		this.status = { loaded: status.loaded, tutorialDone: status.tutorialDone };
	}

	receiveIntent(intent: ArrivalJoinIntent): void {
		this.intent = intent;
	}

	poll(dt: number, forced: boolean | undefined): FirstRunChoice {
		if (this.choice !== undefined) return this.choice;
		if (dt > 0) this.waited += dt;
		const c = firstJoinChoice({
			forced,
			status: this.status,
			intent: this.intent,
			waitedSeconds: this.waited,
			timeoutSeconds: this.statusTimeoutSeconds,
			intentTimeoutSeconds: this.intentTimeoutSeconds,
		});
		if (c !== "wait") this.choice = c;
		return c;
	}

	decided(): FirstRunDecision | undefined {
		return this.choice;
	}

	/** The intent this gate saw (undefined: none yet), for the decision's log line. */
	seenIntent(): ArrivalJoinIntent | undefined {
		return this.intent;
	}

	/** Seconds waited so far (frozen once decided). */
	waitedSeconds(): number {
		return this.waited;
	}
}
