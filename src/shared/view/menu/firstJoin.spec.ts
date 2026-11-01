// The first-join choice with Roblox invites (docs/INVITES.md §4 "Join intent", ID6): onboarding status x join intent,
// the intent wait, and KV_Tutorial.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { INVITE, type ArrivalJoinIntent } from "shared/invite";
import type { OnboardingStatus } from "shared/onboarding";
import { FirstJoinGate, firstJoinChoice, firstJoinDispatchChoice, firstJoinGateReason } from ".";

const NEW_PLAYER = { loaded: true, tutorialDone: false };
const VETERAN = { loaded: true, tutorialDone: true };
const LOAD_FAILED = { loaded: false, tutorialDone: false };
const INTENT_WAIT = INVITE.intentWaitSeconds;
const STATUS_WAIT = TUTORIAL.statusTimeoutSeconds;

function choice(
	status: OnboardingStatus | undefined,
	intent: ArrivalJoinIntent | undefined,
	waitedSeconds: number,
	forced?: boolean,
) {
	return firstJoinChoice({ forced, status, intent, waitedSeconds });
}

describe("firstJoinChoice", () => {
	it("the config waits for the intent well inside the status timeout", () => {
		expect(INTENT_WAIT > 0).toBe(true);
		expect(INTENT_WAIT < STATUS_WAIT).toBe(true);
	});

	it("a new player: lobby / party skip the tutorial, none or an intent timeout starts it", () => {
		expect(choice(NEW_PLAYER, "lobby", 0)).toBe("normal");
		expect(choice(NEW_PLAYER, "party", 0)).toBe("normal");
		expect(choice(NEW_PLAYER, "none", 0)).toBe("tutorial");
		// No intent yet: waits until INVITE.intentWaitSeconds since join, then the tutorial as before.
		expect(choice(NEW_PLAYER, undefined, 0)).toBe("wait");
		expect(choice(NEW_PLAYER, undefined, INTENT_WAIT * 0.99)).toBe("wait");
		expect(choice(NEW_PLAYER, undefined, INTENT_WAIT)).toBe("tutorial");
		// A status that came after the intent wait is over starts the tutorial at once.
		expect(choice(NEW_PLAYER, undefined, STATUS_WAIT * 0.9)).toBe("tutorial");
		// A late intent that is already there when the status comes still counts.
		expect(choice(NEW_PLAYER, "lobby", STATUS_WAIT * 0.9)).toBe("normal");
	});

	it("a veteran or a failed load: the normal flow whatever the intent, never waiting for it", () => {
		for (const status of [VETERAN, LOAD_FAILED]) {
			for (const intent of ["lobby", "party", "none", undefined] as const) {
				expect([intent, choice(status, intent, 0)]).toEqual([intent, "normal"]);
				expect([intent, choice(status, intent, INTENT_WAIT)]).toEqual([intent, "normal"]);
			}
		}
	});

	it("no onboarding status: waits for it (an intent alone decides nothing), then the normal flow", () => {
		for (const intent of ["lobby", "party", "none", undefined] as const) {
			expect([intent, choice(undefined, intent, 0)]).toEqual([intent, "wait"]);
			expect([intent, choice(undefined, intent, INTENT_WAIT)]).toEqual([intent, "wait"]);
			expect([intent, choice(undefined, intent, STATUS_WAIT)]).toEqual([intent, "normal"]);
		}
	});

	it("KV_Tutorial wins over the intent, without waiting for anything", () => {
		for (const intent of ["lobby", "party", "none", undefined] as const) {
			for (const status of [NEW_PLAYER, VETERAN, LOAD_FAILED, undefined]) {
				expect(choice(status, intent, 0, true)).toBe("tutorial");
				expect(choice(status, intent, 0, false)).toBe("normal");
			}
		}
	});

	it("timeouts can be passed in", () => {
		const c = firstJoinChoice({
			forced: undefined,
			status: NEW_PLAYER,
			intent: undefined,
			waitedSeconds: 1,
			intentTimeoutSeconds: 1,
		});
		expect(c).toBe("tutorial");
	});
});

describe("FirstJoinGate", () => {
	it("waits for both, then latches", () => {
		const gate = new FirstJoinGate(STATUS_WAIT, INTENT_WAIT);
		expect(gate.poll(0.1, undefined)).toBe("wait");
		gate.receive(NEW_PLAYER);
		expect(gate.poll(0.1, undefined)).toBe("wait"); // the intent may still come
		gate.receiveIntent("party");
		expect(gate.seenIntent()).toBe("party");
		expect(gate.poll(0.1, undefined)).toBe("normal");
		expect(gate.decided()).toBe("normal");
		gate.receiveIntent("none");
		expect(gate.poll(0.1, undefined)).toBe("normal");
		expect(gate.waitedSeconds()).toBeCloseTo(0.3);
	});

	it("a new player without an intent gets the tutorial after the intent wait", () => {
		const gate = new FirstJoinGate(STATUS_WAIT, INTENT_WAIT);
		gate.receive(NEW_PLAYER);
		const step = INTENT_WAIT / 4;
		let c = gate.poll(step, undefined);
		for (let i = 0; i < 2; i++) c = gate.poll(step, undefined);
		expect(c).toBe("wait");
		expect(gate.poll(step, undefined)).toBe("tutorial");
		gate.receiveIntent("lobby"); // too late: latched
		expect(gate.poll(step, undefined)).toBe("tutorial");
	});

	it("a veteran never waits for the intent; no status at all ends normal at the status timeout", () => {
		const vet = new FirstJoinGate(STATUS_WAIT, INTENT_WAIT);
		vet.receive(VETERAN);
		expect(vet.poll(0, undefined)).toBe("normal");
		const silent = new FirstJoinGate(STATUS_WAIT, INTENT_WAIT);
		expect(silent.poll(STATUS_WAIT * 0.5, undefined)).toBe("wait");
		expect(silent.poll(STATUS_WAIT * 0.5, undefined)).toBe("normal");
	});

	it("KV_Tutorial decides on the first poll", () => {
		expect(new FirstJoinGate().poll(0, true)).toBe("tutorial");
		expect(new FirstJoinGate().poll(0, false)).toBe("normal");
	});
});

describe("firstJoinDispatchChoice", () => {
	const facts = (inLobby: boolean, intent: ArrivalJoinIntent | undefined, forced?: boolean) => ({
		forced,
		inLobby,
		intent,
	});

	it("a latched tutorial becomes the normal flow once the player is in a lobby or the intent was upgraded", () => {
		expect(firstJoinDispatchChoice("tutorial", facts(false, "none"))).toBe("tutorial");
		expect(firstJoinDispatchChoice("tutorial", facts(false, undefined))).toBe("tutorial");
		expect(firstJoinDispatchChoice("tutorial", facts(true, "none"))).toBe("normal"); // placed, intent not here yet
		expect(firstJoinDispatchChoice("tutorial", facts(false, "lobby"))).toBe("normal"); // upgraded, state not yet
		expect(firstJoinDispatchChoice("tutorial", facts(false, "party"))).toBe("normal");
		expect(firstJoinDispatchChoice("tutorial", facts(true, "party"))).toBe("normal");
	});

	it("KV_Tutorial keeps the tutorial; a normal choice stays normal", () => {
		expect(firstJoinDispatchChoice("tutorial", facts(true, "lobby", true))).toBe("tutorial");
		expect(firstJoinDispatchChoice("normal", facts(true, "lobby", false))).toBe("normal");
		for (const intent of ["lobby", "party", "none", undefined] as const) {
			expect(firstJoinDispatchChoice("normal", facts(false, intent))).toBe("normal");
		}
	});

	it("the staggered party case: none latches the tutorial, a later upgrade wins at dispatch", () => {
		const gate = new FirstJoinGate(STATUS_WAIT, INTENT_WAIT);
		gate.receive(NEW_PLAYER);
		gate.receiveIntent("none");
		const latched = gate.poll(0.1, undefined);
		expect(latched).toBe("tutorial");
		// The loading screen is still up; a party mate arrives and the server upgrades the intent.
		expect(latched !== "wait" && firstJoinDispatchChoice(latched, facts(true, "party"))).toBe("normal");
	});
});

describe("firstJoinGateReason (docs/TUTORIAL_FUNNEL.md OnboardingGate)", () => {
	const facts = (
		status: OnboardingStatus | undefined,
		inLobby: boolean,
		intent: ArrivalJoinIntent | undefined,
		forced?: boolean,
	) => ({ status, inLobby, intent, forced });

	it("KV_Tutorial is `forced` either way, whatever else is known", () => {
		expect(firstJoinGateReason("tutorial", facts(undefined, false, undefined, true))).toBe("forced");
		expect(firstJoinGateReason("normal", facts(undefined, false, undefined, false))).toBe("forced");
		expect(firstJoinGateReason("tutorial", facts(VETERAN, true, "party", true))).toBe("forced");
	});

	it("a tutorial start is `tutorial` (status or the intent timeout)", () => {
		expect(firstJoinGateReason("tutorial", facts(NEW_PLAYER, false, "none"))).toBe("tutorial");
		expect(firstJoinGateReason("tutorial", facts(NEW_PLAYER, false, undefined))).toBe("tutorial");
	});

	it("the normal flow names the status first: timeout, loadFailed, done", () => {
		expect(firstJoinGateReason("normal", facts(undefined, false, undefined))).toBe("timeout");
		expect(firstJoinGateReason("normal", facts(undefined, true, "lobby"))).toBe("timeout");
		expect(firstJoinGateReason("normal", facts(LOAD_FAILED, false, "none"))).toBe("loadFailed");
		expect(firstJoinGateReason("normal", facts(LOAD_FAILED, false, "party"))).toBe("loadFailed");
		expect(firstJoinGateReason("normal", facts(VETERAN, false, "none"))).toBe("done");
		expect(firstJoinGateReason("normal", facts(VETERAN, true, "party"))).toBe("done");
	});

	it("a new player sent to the menu by grouping: party, else invited (lobby intent or placed in a lobby)", () => {
		expect(firstJoinGateReason("normal", facts(NEW_PLAYER, false, "party"))).toBe("party");
		expect(firstJoinGateReason("normal", facts(NEW_PLAYER, true, "party"))).toBe("party");
		expect(firstJoinGateReason("normal", facts(NEW_PLAYER, false, "lobby"))).toBe("invited");
		expect(firstJoinGateReason("normal", facts(NEW_PLAYER, true, "none"))).toBe("invited");
		expect(firstJoinGateReason("normal", facts(NEW_PLAYER, true, undefined))).toBe("invited");
	});

	it("end to end through the gate and the dispatch re-check", () => {
		const run = (
			status: OnboardingStatus | undefined,
			intent: ArrivalJoinIntent | undefined,
			waited: number,
			atDispatch: { inLobby: boolean; intent: ArrivalJoinIntent | undefined },
		) => {
			const gate = new FirstJoinGate(STATUS_WAIT, INTENT_WAIT);
			if (status !== undefined) gate.receive(status);
			if (intent !== undefined) gate.receiveIntent(intent);
			const latched = gate.poll(waited, undefined);
			if (latched === "wait") return "wait";
			const dispatchFacts = { forced: undefined, ...atDispatch };
			const dispatched = firstJoinDispatchChoice(latched, dispatchFacts);
			return firstJoinGateReason(dispatched, { ...dispatchFacts, status: gate.seenStatus() });
		};
		const alone = { inLobby: false, intent: "none" as const };
		expect(run(NEW_PLAYER, "none", 0.1, alone)).toBe("tutorial");
		expect(run(NEW_PLAYER, undefined, INTENT_WAIT, { inLobby: false, intent: undefined })).toBe("tutorial");
		expect(run(NEW_PLAYER, "lobby", 0.1, { inLobby: true, intent: "lobby" })).toBe("invited");
		expect(run(NEW_PLAYER, "party", 0.1, { inLobby: true, intent: "party" })).toBe("party");
		expect(run(NEW_PLAYER, "none", 0.1, { inLobby: true, intent: "party" })).toBe("party"); // upgraded later
		expect(run(NEW_PLAYER, "none", 0.1, { inLobby: true, intent: "none" })).toBe("invited"); // placed, no upgrade yet
		expect(run(VETERAN, undefined, 0.1, alone)).toBe("done");
		expect(run(LOAD_FAILED, undefined, 0.1, alone)).toBe("loadFailed");
		expect(run(undefined, undefined, STATUS_WAIT, alone)).toBe("timeout");
	});
});
