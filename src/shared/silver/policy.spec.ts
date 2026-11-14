import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY_WORLD_KIND } from "shared/daily";
import { DEV_WORLD_KIND, ENDLESS_WORLD_KIND, TUTORIAL_WORLD_KIND } from "shared/run";
import { SILVER_PAYING_WORLDS, silverEligibility } from "shared/silver";

const LIVE = { debug: false, studio: false };

describe("silverEligibility (docs/SILVER.md What never pays)", () => {
	it("the paying worlds are shared/run's endless and shared/daily's Daily (pinned: no barrel import there)", () => {
		expect([...SILVER_PAYING_WORLDS]).toEqual([ENDLESS_WORLD_KIND, DAILY_WORLD_KIND]);
	});

	it("endless and the Daily pay", () => {
		expect(silverEligibility(ENDLESS_WORLD_KIND, LIVE)).toBe(undefined);
		expect(silverEligibility(DAILY_WORLD_KIND, LIVE)).toBe(undefined);
	});

	it("the tutorial, M1 worlds and dev never pay", () => {
		for (const w of [TUTORIAL_WORLD_KIND, DEV_WORLD_KIND, "game", "dungeonNoEncounter", "greybox", ""]) {
			expect(silverEligibility(w, LIVE)).toBe("world");
		}
	});

	it("debug, dev, stress, unranked fallback and unfaked Studio runs never pay", () => {
		expect(silverEligibility(ENDLESS_WORLD_KIND, { debug: true, studio: false })).toBe("debug");
		expect(silverEligibility(ENDLESS_WORLD_KIND, { ...LIVE, dev: true })).toBe("dev");
		expect(silverEligibility(ENDLESS_WORLD_KIND, { ...LIVE, stress: 2 })).toBe("stress");
		expect(silverEligibility(ENDLESS_WORLD_KIND, { ...LIVE, stress: 0 })).toBe(undefined);
		expect(silverEligibility(DAILY_WORLD_KIND, { ...LIVE, unranked: true })).toBe("unranked");
		expect(silverEligibility(ENDLESS_WORLD_KIND, { debug: false, studio: true })).toBe("studio");
	});
});
