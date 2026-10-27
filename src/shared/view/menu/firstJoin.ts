/**
 * The first-join choice with Roblox invites (docs/INVITES.md §4 "Join intent", ID6): the tutorial's first-run rule
 * (shared/tutorial firstRunChoice: KV_Tutorial, else the server's onboarding status, else the normal flow after
 * TUTORIAL.statusTimeoutSeconds) plus the server's `joinIntent`. An invited or party arrival (`lobby` / `party`: the
 * server put them in a lobby) skips the AUTOMATIC first-run tutorial and gets the menu (the main menu's Tutorial still
 * plays it). Only a choice that would start the tutorial waits for the intent, at most INVITE.intentWaitSeconds from
 * join; `none` or no intent by then starts it exactly as before. KV_Tutorial still wins (a dev override). Pure, so
 * TutorialController only feeds it (firstJoin.spec.ts).
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
