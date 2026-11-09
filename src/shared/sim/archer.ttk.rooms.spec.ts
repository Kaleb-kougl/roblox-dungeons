// docs/ARCHER.md AR13: time to clear one room of each endless room kind (shared/run/testing characterTune.ts
// KIND_ROOMS: the swarmer pack, snipers, bruisers, imps, Oozes, a summoner, bombers, chargers, stormcallers, reapers, a
// Warbanner with company, and LG7's two turret pairs) at floors 2 / 6 / 11 / 20's spawn hp, no build, per character:
// the Knight (sword) and the Archer (bow, charged shots back to back) built through the real character path, the
// Archer again with the stream only, and the old two-weapon player ("both": bow far, sword near). Open endless arena,
// god mode, seeds 1-3. Printed: the table in the doc. Loose bounds only: every endless room kind is cleared within its
// cap (the turret pairs, M1 sandbox kinds that revive after 6 s, "clear" only when both are down at once: printed, not
// checked).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KIND_FLOORS,
	KIND_ROOMS,
	characterTtkHeader,
	characterTtkRows,
	formatCharacterTtkRow,
	type FighterMode,
	type TuneCharacter,
} from "shared/run/testing";

const SEEDS = [1, 2, 3];
const WHO: ReadonlyArray<TuneCharacter> = ["knight", "archer", "archer", "both"];
const MODES: ReadonlyArray<FighterMode> = ["knight", "archer", "archer-stream", "both"];
const NAMES = ["Knight", "Archer", "Archer (stream only)", "Both"];
const BASE = 3;

describe("AR13 TTK: one room per endless room kind, per character (no build)", () => {
	it("every endless room kind is cleared at every floor by every character (printed)", () => {
		const t0 = os.clock();
		const rows = characterTtkRows(KIND_ROOMS, [{ label: "no build", cards: [] }], WHO, KIND_FLOORS, SEEDS, MODES);
		print(`[archer tune] rooms by kind, no build, seeds 1-3, mean seconds to clear`);
		print(`[archer tune] ${characterTtkHeader(NAMES, KIND_FLOORS, BASE)}`);
		for (const row of rows) print(`[archer tune] ${formatCharacterTtkRow(row, BASE, false)}`);
		print(`[archer tune] rooms by kind: ${string.format("%.1f", os.clock() - t0)} s`);
		for (const row of rows)
			for (let c = 0; c < WHO.size(); c++)
				if (row.fight.find("turret")[0] === undefined)
					expect([row.fight, NAMES[c], row.seconds[c].every((x) => x > 0)]).toEqual([
						row.fight,
						NAMES[c],
						true,
					]);
	});
});
