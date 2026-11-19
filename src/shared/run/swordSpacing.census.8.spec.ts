// docs/SWORD_SPACING.md SP0 / SP4: the Knight's contact-hit census, brake off and on, shard 8 of
// SWORD_SPACING_CENSUS.shards (run seeds split over ten files, about two minutes a seed for the four columns, so each
// runs in its own process; shared/run/testing spacingCensus.ts holds the census, the same in every shard). OPT-IN
// CENSUS: without the runner's `--census` flag (npm run test:only -- --census run/swordSpacing.census) it runs nothing
// (swordSpacing.smoke covers the code path). Printed: per column the per-archetype table and a `[spacing-raw]` line the
// doc's totals are summed from. Sanity only.
import { describe, expect, it } from "@rbxts/jest-globals";
import { censusShard } from "shared/dungeon/testing";
import { SWORD_SPACING_CENSUS, censusRequested, swordSpacingShard } from "shared/run/testing";

const [FIRST, LAST] = censusShard(8, SWORD_SPACING_CENSUS.shards, SWORD_SPACING_CENSUS.seeds);

describe(`sword spacing census, shard 8: seeds ${FIRST}-${LAST}, floors 1-${SWORD_SPACING_CENSUS.maxFloor}`, () => {
	it(censusRequested() ? "contact hits per fighter, brake off and on (printed)" : "opt-in (--census)", () => {
		if (!censusRequested()) return;
		const t0 = os.clock();
		const c = swordSpacingShard(FIRST, LAST);
		print(c.lines.join("\n"));
		print(`[spacing] shard 8: ${string.format("%.1f", os.clock() - t0)} s`);
		for (const t of c.totals) {
			expect(t.runs).toBe(LAST - FIRST + 1);
			expect(t.rooms).toBeGreaterThan(0);
			expect(t.fightTicks).toBeGreaterThan(0);
		}
	});
});
