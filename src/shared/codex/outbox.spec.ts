// The client's Codex outbox (claude/codex-plan.md CX6): claims and views queue until the first loaded status and go out
// then; a failed load first drops them for the session; batches respect CODEX.claimMaxItems / viewedMaxIds; flushes
// are paced (flushSeconds, hurried by run over / the screen closing) and each remote stays under callsPerWindow per
// window, well below the server's CODEX.claimRate.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CODEX, CODEX_OUTBOX, CodexOutbox, CodexTier, type CodexClaim, type CodexSend } from "shared/codex";

const S = CodexTier.SEEN;
const F = CodexTier.FOUND;

function claims(n: number, tier: number = S): CodexClaim[] {
	const out: CodexClaim[] = [];
	for (let i = 1; i <= n; i++) out.push({ id: `boon:x${i}`, tier, floor: tier === F ? 3 : 0 });
	return out;
}

function sizes(sends: ReadonlyArray<CodexSend>): string[] {
	return sends.map((s) => (s.kind === "claim" ? `claim:${s.items.size()}` : `viewed:${s.ids.size()}`));
}

describe("CodexOutbox", () => {
	it("keeps the pacing well under the server's rate (CODEX.claimRate)", () => {
		expect(CODEX_OUTBOX.windowSeconds).toBe(CODEX.claimRate.windowSeconds);
		expect(CODEX_OUTBOX.callsPerWindow * 2 <= CODEX.claimRate.count).toBe(true);
		expect(CODEX_OUTBOX.flushSeconds > 0).toBe(true);
	});

	it("queues before the first status and sends everything once a loaded status arrives", () => {
		const o = new CodexOutbox();
		o.claim(claims(3));
		o.view(["boon:x1"]);
		expect(o.flush(0)).toEqual([]);
		expect(o.pendingCount()).toBe(4);
		expect(o.pendingClaims().map((c) => c.id)).toEqual(["boon:x1", "boon:x2", "boon:x3"]);
		o.receive(true);
		expect(o.isReady()).toBe(true);
		const sent = o.flush(1);
		expect(sizes(sent)).toEqual(["claim:3", "viewed:1"]);
		expect(o.pendingCount()).toBe(0);
	});

	it("a failed load first drops the queue and refuses everything after; once ready a failed status is ignored", () => {
		const o = new CodexOutbox();
		o.claim(claims(2));
		o.receive(false);
		expect([o.isUnavailable(), o.pendingCount()]).toEqual([true, 0]);
		o.claim(claims(1));
		o.view(["boon:x1"]);
		// a later loaded status (like the tracker's receive) makes it ready again; what was dropped stays dropped
		o.receive(true);
		expect(o.flush(0)).toEqual([]);
		o.claim(claims(1));
		expect(sizes(o.flush(1))).toEqual(["claim:1"]);

		const ready = new CodexOutbox();
		ready.receive(true);
		ready.receive(false);
		ready.claim(claims(1));
		expect(sizes(ready.flush(0))).toEqual(["claim:1"]);
	});

	it("collapses claims per entry to the highest tier (with its floor) and views per id", () => {
		const o = new CodexOutbox();
		o.receive(true);
		o.claim([
			{ id: "enemy:imp", tier: S, floor: 0 },
			{ id: "enemy:imp", tier: F, floor: 4 },
			{ id: "enemy:imp", tier: S, floor: 0 },
			{ id: "boon:volatile", tier: F, floor: 2 },
		]);
		o.view(["enemy:imp", "enemy:imp", "boon:volatile"]);
		const sent = o.flush(0);
		expect(sent).toEqual([
			{
				kind: "claim",
				items: [
					{ id: "enemy:imp", tier: F, floor: 4 },
					{ id: "boon:volatile", tier: F, floor: 2 },
				],
			},
			{ kind: "viewed", ids: ["enemy:imp", "boon:volatile"] },
		]);
	});

	it("splits into batches of at most CODEX.claimMaxItems claims and CODEX.viewedMaxIds ids", () => {
		const o = new CodexOutbox();
		o.receive(true);
		o.claim(claims(CODEX.claimMaxItems * 2 + 1));
		const ids: string[] = [];
		for (let i = 0; i < CODEX.viewedMaxIds + 1; i++) ids.push(`boon:v${i}`);
		o.view(ids);
		expect(sizes(o.flush(0))).toEqual([
			`claim:${CODEX.claimMaxItems}`,
			`claim:${CODEX.claimMaxItems}`,
			"claim:1",
			`viewed:${CODEX.viewedMaxIds}`,
			"viewed:1",
		]);
	});

	it("flushes at most every flushSeconds unless hurried", () => {
		const o = new CodexOutbox();
		o.receive(true);
		o.claim(claims(1));
		expect(sizes(o.flush(10))).toEqual(["claim:1"]);
		o.claim([{ id: "enemy:imp", tier: S, floor: 0 }]);
		expect(o.flush(10 + CODEX_OUTBOX.flushSeconds / 2)).toEqual([]);
		expect(sizes(o.flush(10 + CODEX_OUTBOX.flushSeconds))).toEqual(["claim:1"]);
		o.claim([{ id: "enemy:slime", tier: S, floor: 0 }]);
		o.hurry();
		expect(sizes(o.flush(10 + CODEX_OUTBOX.flushSeconds + 0.01))).toEqual(["claim:1"]);
	});

	it("never makes more than callsPerWindow calls per remote in a window; the rest waits, still hurried", () => {
		const o = new CodexOutbox();
		o.receive(true);
		const max = CODEX_OUTBOX.callsPerWindow;
		o.claim(claims(CODEX.claimMaxItems * (max + 2)));
		o.hurry();
		const first = o.flush(0);
		expect(first.size()).toBe(max);
		expect(o.pendingCount()).toBe(CODEX.claimMaxItems * 2);
		// still inside the window: nothing more, even hurried
		expect(o.flush(1)).toEqual([]);
		expect(o.flush(CODEX_OUTBOX.windowSeconds - 0.01)).toEqual([]);
		// the window moved on: the rest goes out (hurried, so no flushSeconds wait)
		expect(sizes(o.flush(CODEX_OUTBOX.windowSeconds))).toEqual([
			`claim:${CODEX.claimMaxItems}`,
			`claim:${CODEX.claimMaxItems}`,
		]);
		// views have their own window
		const v = new CodexOutbox();
		v.receive(true);
		v.claim(claims(CODEX.claimMaxItems * max));
		v.view(["boon:x1"]);
		expect(sizes(v.flush(0)).size()).toBe(max + 1);
	});
});
