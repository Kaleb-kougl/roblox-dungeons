// The Codex tracker's frame from the sim state (claude/codex-plan.md CX4): sightings (actors, drops, Greed's curse) are
// measured from the VIEW player within SIGHTING_VIEW.radius, finds (draft, boons, levels, duos, relics, curses,
// boosts, left) are the LOCAL player's; boosts come from the state, never the view player's; deaths from a slot.
import { describe, expect, it } from "@rbxts/jest-globals";
import { codexEligibility, emptyCodexDoc } from "shared/codex";
import { AffixKind } from "shared/dungeon";
import { altarFloor, pactsSetup, skipToFloorAny, teleport } from "shared/run/testing";
import {
	AFFIXES_CONFIG,
	BUILDS_CONFIG,
	Boon,
	Boost,
	CardKind,
	Curse,
	DROPS_CONFIG,
	Duo,
	NO_KIND,
	PactKind,
	Relic,
	affixesOnSpawn,
	archetypeAt,
	boonCard,
	createRunState,
	createSimState,
	duoCard,
	greedCurseFor,
	playerAt,
	type ActorSpawn,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { SIGHTING_VIEW } from "../sighting";
import { CODEX_NO_CURSE, CodexTracker, clearCodexFrameEvents, newCodexFrame, pushCodexDeath, readCodexFrame } from ".";

const NEAR = SIGHTING_VIEW.radius - 1;
const FAR_X = 40;

function sandbox(spawns: ActorSpawn[]): { s: SimState; config: SimConfig } {
	const config: SimConfig = {
		encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 },
		party: { size: 2 },
		affixes: AFFIXES_CONFIG,
		drops: DROPS_CONFIG,
		builds: BUILDS_CONFIG,
	};
	const s = createSimState(1, 0, 0, config);
	const mate = playerAt(s, 1);
	mate.x = FAR_X;
	mate.z = 0;
	return { s, config };
}

function slotOf(s: SimState, id: string): number {
	const actors = s.combat.actors;
	for (let i = 0; i < actors.size(); i++)
		if (actors[i].kind !== NO_KIND && archetypeAt(actors[i].kind).id === id) return i;
	error(`no ${id}`, 0);
}

describe("readCodexFrame", () => {
	it("actors and drops near the VIEW player (with their affix); an index outside the party reads as player 0", () => {
		const { s, config } = sandbox([
			{ kind: "imp", x: NEAR, z: 0 },
			{ kind: "bruiser", x: FAR_X - NEAR, z: 0 },
			{ kind: "slime.small", x: FAR_X, z: NEAR },
		]);
		const bruiser = slotOf(s, "bruiser");
		affixesOnSpawn(s, bruiser, s.combat.actors[bruiser], AffixKind.VENGEFUL);
		const g = s.drops!.ground[0];
		g.kind = Boost.QUICKSTEP;
		g.x = FAR_X;
		g.z = 1;
		const f = newCodexFrame();
		readCodexFrame(s, config, 0, 0, f);
		expect([f.localIndex, f.viewIndex, f.actors, f.drops]).toEqual([0, 0, [{ archetype: "imp", affix: 0 }], []]);
		readCodexFrame(s, config, 0, 1, f);
		expect([f.viewIndex, f.actors, f.drops]).toEqual([
			1,
			[
				{ archetype: "bruiser", affix: AffixKind.VENGEFUL },
				{ archetype: "slime.small", affix: 0 },
			],
			[Boost.QUICKSTEP],
		]);
		// the views are pooled: a later read rewrites them in place (no view allocated per actor per frame)
		const pooled = f.actors[0];
		readCodexFrame(s, config, 0, 1, f);
		expect([f.actors[0] === pooled, f.actorPool.size()]).toEqual([true, 2]);
		readCodexFrame(s, config, 0, 7, f);
		expect(f.viewIndex).toBe(0);
		expect([f.actors.size(), f.actors[0] === pooled, f.actorPool.size()]).toEqual([1, true, 2]);
		// dead ones are not in view; a smaller radius sees less
		s.combat.actors[slotOf(s, "imp")].alive = 0;
		expect(readCodexFrame(s, config, 0, 0, f).actors).toEqual([]);
		expect(readCodexFrame(s, config, 0, 1, f, 1).actors).toEqual([]);
	});

	it("finds are the LOCAL player's: draft (with kinds), boons, levels, duos, relics, curses, boosts, left", () => {
		const { s, config } = sandbox([]);
		s.run = createRunState(undefined, 2);
		const me = s.run.players[0];
		me.boons.push(Boon.HEARTY);
		me.relics.push(Relic.HOURGLASS);
		me.curses.push(Curse.HASTE);
		me.draftOpen = 1;
		me.draftOffers.push(boonCard(Boon.HEARTY), boonCard(Boon.BOUNTY), duoCard(Duo.GOLD_RUSH));
		s.builds!.players[0].levels[Boon.HEARTY] = 2;
		s.builds!.players[0].duos.push(Duo.CITADEL);
		s.drops!.players[0].ticks[Boost.AEGIS] = 10;
		// the teammate's own things never count for the local player
		s.run.players[1].boons.push(Boon.WARDING);
		s.drops!.players[1].ticks[Boost.FURY] = 10;
		const f = readCodexFrame(s, config, 0, 1, newCodexFrame());
		expect([f.boons, f.relics, f.curses, f.duos, f.boosts]).toEqual([
			[Boon.HEARTY],
			[Relic.HOURGLASS],
			[Curse.HASTE],
			[Duo.CITADEL],
			[Boost.AEGIS],
		]);
		expect(f.levels[Boon.HEARTY]).toBe(2);
		expect([f.draftOffers, f.draftKinds]).toEqual([
			[boonCard(Boon.HEARTY), boonCard(Boon.BOUNTY), duoCard(Duo.GOLD_RUSH)],
			[CardKind.EVOLUTION, CardKind.NEW, CardKind.DUO],
		]);
		expect([f.floor, f.left, f.greedCurse]).toEqual([1, false, CODEX_NO_CURSE]);
		me.draftOpen = 0;
		s.party!.left[0] = 1;
		readCodexFrame(s, config, 0, 1, f);
		expect([f.draftOffers, f.draftKinds, f.left]).toEqual([[], [], true]);
	});

	it("Greed's curse: the one the VIEW player's altar card names, while the cards show and Greed is theirs", () => {
		const setup = pactsSetup(7, 2);
		const floor = altarFloor(setup);
		expect(floor > 0).toBe(true);
		const s = createSimState(7, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloorAny(s, setup.config, floor);
		const a = s.pacts!;
		teleport(s, 1, a.altarX[PactKind.GREED], a.altarZ[PactKind.GREED]);
		teleport(s, 0, a.altarX[PactKind.GREED] + 200, a.altarZ[PactKind.GREED] + 200);
		const f = newCodexFrame();
		expect(readCodexFrame(s, setup.config, 0, 1, f).greedCurse).toBe(greedCurseFor(s, 1));
		expect(f.greedCurse >= 0).toBe(true);
		expect(readCodexFrame(s, setup.config, 0, 0, f).greedCurse).toBe(CODEX_NO_CURSE);
		expect(f.floor).toBe(floor);
	});

	it("pushCodexDeath reads the corpse's archetype and affix; a free slot pushes nothing; events clear", () => {
		const { s } = sandbox([{ kind: "swarmer", x: 2, z: 0 }]);
		const slot = slotOf(s, "swarmer");
		affixesOnSpawn(s, slot, s.combat.actors[slot], AffixKind.SWIFT);
		s.combat.actors[slot].alive = 0;
		const f = newCodexFrame();
		pushCodexDeath(s, f, slot);
		pushCodexDeath(s, f, slot + 1);
		expect(f.deaths).toEqual([{ archetype: "swarmer", affix: AffixKind.SWIFT }]);
		const death = f.deaths[0];
		f.pedestalRelics.push(Relic.HOURGLASS);
		f.bossEngaged = "boss.act1";
		f.bossDefeated = "boss.act1";
		f.boons.push(Boon.HEARTY);
		clearCodexFrameEvents(f);
		expect([f.deaths, f.pedestalRelics, f.bossEngaged, f.bossDefeated, f.boons]).toEqual([
			[],
			[],
			undefined,
			undefined,
			[Boon.HEARTY],
		]);
		pushCodexDeath(s, f, slot);
		expect([f.deaths.size(), f.deaths[0] === death]).toEqual([1, true]);
	});

	it("end to end: a frame read from the state feeds the tracker", () => {
		const { s, config } = sandbox([{ kind: "reaper", x: NEAR, z: 0 }]);
		const t = new CodexTracker();
		t.receive(emptyCodexDoc());
		t.startRun(codexEligibility({ world: "endless", debug: false, dev: false, stress: 0, studio: false }));
		const out = t.update(readCodexFrame(s, config, 0, 0, newCodexFrame()));
		expect(out.rises.map((r) => r.id)).toEqual(["enemy:reaper"]);
	});
});
