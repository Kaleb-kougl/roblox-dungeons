// Late beds (docs/STAGE_ASSETS.md SA18, SAD14): a bed not downloaded when wanted starts late, once, if still wanted.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AUDIO_VIEW, BedGate } from "shared/view/audio";

describe("BedGate", () => {
	it("plays a ready bed at once and stops on silence", () => {
		const g = new BedGate();
		expect(g.want("music.biome.1", true)).toBe("play");
		expect(g.isWaiting()).toBe(false);
		expect(g.poll(() => true)).toBe(undefined);
		expect(g.want(undefined, true)).toBe("stop");
		expect(g.current()).toBe(undefined);
	});

	it("waits for a bed not yet downloaded, then starts it once when it lands", () => {
		const g = new BedGate();
		expect(g.want("music.biome.2", false)).toBe("wait");
		expect(g.poll(() => false)).toBe(undefined);
		expect(g.poll((id) => id === "music.biome.2")).toBe("music.biome.2");
		expect(g.isWaiting()).toBe(false);
		expect(g.poll(() => true)).toBe(undefined);
	});

	it("drops a late bed that is no longer wanted", () => {
		const g = new BedGate();
		expect(g.want("music.biome.2", false)).toBe("wait");
		expect(g.want("music.boss", true)).toBe("play");
		expect(g.poll(() => true)).toBe(undefined);
		expect(g.want("music.biome.3", false)).toBe("wait");
		expect(g.want(undefined, true)).toBe("stop");
		expect(g.poll(() => true)).toBe(undefined);
	});

	it("the same wanted bed asked again starts it once it is ready", () => {
		const g = new BedGate();
		expect(g.want("amb.b1", false)).toBe("wait");
		expect(g.want("amb.b1", false)).toBe("wait");
		expect(g.want("amb.b1", true)).toBe("play");
		expect(g.poll(() => true)).toBe(undefined);
		// playing: a later not-ready reading (KV_StandInsForce) never stops it
		expect(g.want("amb.b1", false)).toBe("play");
		expect(g.isWaiting()).toBe(false);
	});

	it("fades late beds in over a configured time", () => {
		expect(AUDIO_VIEW.lateBedFadeSec > 0).toBe(true);
	});
});
