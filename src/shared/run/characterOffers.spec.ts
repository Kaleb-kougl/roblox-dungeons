// docs/ARCHER.md AR2: over 2,000 simulated builds runs per character (shared/run/testing buildOffers.ts, the real
// drawCardOffers / drawLegendaryOffers with the character's boon mask, to floor 21: drafts, boss double drafts and a
// Greed deal per checkpoint), a Knight is never dealt Piercing Arrows, Ballista or their duos, an Archer never Riposte
// or its duos; both weapons (no mask) deal every boon. Printed: the per-character New-card offer counts.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOONS, BOON_COUNT, Boon, DUOS, DUO_COUNT, Duo, createSimState, eligibleBoonMask } from "shared/sim";
import { characterLoadout, type CharacterId } from "shared/characters";
import { simulateOffers, type OfferCheckpoint } from "shared/run/testing";

const RUNS = 2000;
const CHECKPOINTS = [11, 21];

const NEVER: { readonly [K in CharacterId]: { boons: number[]; duos: number[] } } = {
	knight: {
		boons: [Boon.PIERCING_ARROWS, Boon.BALLISTA],
		duos: [Duo.FIRE_ARROWS, Duo.CONDUCTOR, Duo.SKEWER, Duo.DRAGON_BOLT],
	},
	archer: { boons: [Boon.RIPOSTE], duos: [Duo.THUNDER_GUARD, Duo.STILLWATER, Duo.REBUKE] },
};

function maskOf(id: CharacterId): boolean[] {
	return eligibleBoonMask(createSimState(1, 0, 0, { loadout: characterLoadout(id) }), 0, []);
}

function last(checkpoints: ReadonlyArray<OfferCheckpoint>): OfferCheckpoint {
	return checkpoints[checkpoints.size() - 1];
}

describe(`character offers: ${RUNS} simulated builds runs per character (to floor 21)`, () => {
	for (const id of ["knight", "archer"] as const) {
		it(`${id}: never dealt its other weapon's boons or their duos; every other boon is dealt`, () => {
			for (const policy of ["greedy", "random"] as const) {
				const st = simulateOffers(policy, RUNS, CHECKPOINTS, undefined, maskOf(id));
				const t = last(st.checkpoints);
				expect(t.runs).toBe(RUNS);
				for (let b = 0; b < BOON_COUNT; b++) {
					const never = NEVER[id].boons.includes(b);
					expect([policy, BOONS[b].id, t.boonDealt[b] === 0]).toEqual([policy, BOONS[b].id, never]);
					if (never) expect([BOONS[b].id, t.ownedBoon[b]]).toEqual([BOONS[b].id, 0]);
				}
				for (let d = 0; d < DUO_COUNT; d++) {
					if (NEVER[id].duos.includes(d)) expect([DUOS[d].id, t.duoDealt[d]]).toEqual([DUOS[d].id, 0]);
				}
				const offered = BOONS.map((def, b) => `${def.id.sub(6)} ${t.draftsOfferingBoon[b]}`).join(", ");
				print(`[character offers] ${id} ${policy}, New cards dealt by floor 21: ${offered}`);
			}
		});
	}

	it("both weapons (no mask): every boon is dealt", () => {
		const t = last(simulateOffers("random", RUNS, CHECKPOINTS).checkpoints);
		for (let b = 0; b < BOON_COUNT; b++) expect([BOONS[b].id, t.boonDealt[b] > 0]).toEqual([BOONS[b].id, true]);
	});
});
