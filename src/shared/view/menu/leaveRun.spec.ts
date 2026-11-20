// Leave run's follow-up once its forfeit landed, the run-over panel's "left" test and a left party run's line and exit
// (leaveRun.ts, lobby.ts partyRunOverLine).
import { describe, expect, it } from "@rbxts/jest-globals";
import { LEFT_RUN_END_REASON, MENU_STRINGS, afterForfeitStep, partyExitStep, partyRunOverLine, runOverLeft } from ".";

describe("after the forfeit", () => {
	it("Leave run shows the finished run's run-over panel, never the menu", () => {
		expect(afterForfeitStep(true, false, true, true)).toBe("runOver");
	});

	it("a forfeiting restart starts the next run", () => {
		expect(afterForfeitStep(false, true, true, true)).toBe("restart");
	});

	it("waits until the forfeit tick ran and its death was submitted", () => {
		expect(afterForfeitStep(true, false, false, false)).toBe("none");
		expect(afterForfeitStep(true, false, false, true)).toBe("none");
		expect(afterForfeitStep(true, false, true, false)).toBe("none");
		expect(afterForfeitStep(false, true, false, false)).toBe("none");
		expect(afterForfeitStep(false, true, true, false)).toBe("none");
	});

	it("does nothing for an ordinary death or victory", () => {
		expect(afterForfeitStep(false, false, true, true)).toBe("none");
		expect(afterForfeitStep(false, false, false, false)).toBe("none");
	});

	it("Leave run wins when both wait", () => {
		expect(afterForfeitStep(true, true, true, true)).toBe("runOver");
	});
});

describe("run-over panel of a left run", () => {
	it("is the run Leave run ended, solo or party", () => {
		expect(runOverLeft(3, 3)).toBe(true);
	});

	it("is not the next run (Again or a new party run after a leave) or an earlier one", () => {
		expect(runOverLeft(3, 4)).toBe(false);
		expect(runOverLeft(4, 3)).toBe(false);
	});

	it("is never a run nobody left", () => {
		expect(runOverLeft(0, 0)).toBe(false);
		expect(runOverLeft(0, 1)).toBe(false);
	});
});

describe("a party run left with Leave run", () => {
	it("ends on this client with its own reason", () => {
		expect(LEFT_RUN_END_REASON).toBe("left");
	});

	it("its run-over line says the player left, over any verdict", () => {
		expect(partyRunOverLine({ status: "none" }, 2, true)).toEqual({ key: MENU_STRINGS.partyLeft, reason: "" });
		expect(partyRunOverLine({ status: "rejected", run: 2, code: "desync" }, 2, true)).toEqual({
			key: MENU_STRINGS.partyLeft,
			reason: "",
		});
	});

	it("a party that is down or a run the server ended keep their lines", () => {
		expect(partyRunOverLine({ status: "pending" }, 2)).toEqual({ key: MENU_STRINGS.partyDown, reason: "" });
		expect(partyRunOverLine({ status: "rejected", run: 2, code: "desync" }, 2)).toEqual({
			key: MENU_STRINGS.partyEnded,
			reason: "desync",
		});
		expect(partyRunOverLine({ status: "rejected", run: 2, code: "desync" }, 2, false).key).toBe(
			MENU_STRINGS.partyEnded,
		);
	});

	it("Back to lobby goes at once after a leave, without the party's verdict", () => {
		expect(partyExitStep(true, true, false)).toBe("exit");
		expect(partyExitStep(true, true, true)).toBe("exit");
	});

	it("a party that went down waits for its verdict", () => {
		expect(partyExitStep(true, false, false)).toBe("wait");
		expect(partyExitStep(true, false, true)).toBe("exit");
	});

	it("a run still being played is left first", () => {
		expect(partyExitStep(false, false, false)).toBe("leave");
		expect(partyExitStep(false, false, true)).toBe("leave");
	});
});
