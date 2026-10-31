// Enemy-variant sound events (docs/ENEMY_VARIANTS.md EV9 / EV11 audio cues): the per-tick collector the run views fill
// (an Imp's blink landing, a Summoner's summons, an Ooze's split, a shield breaking, a Vengeful ring), its quiet gate,
// and the LiveRun wiring.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind } from "shared/dungeon";
import { LiveRun } from "shared/play";
import {
	AFFIXES_CONFIG,
	AiState,
	EMPTY_INPUT,
	IMP_ATTACK_BLINK,
	IMP_ATTACK_FAN,
	IMP_LAND_AIM_TICKS,
	NO_KIND,
	SLIME_ID,
	SLIME_SMALL_ID,
	SUMMONER,
	SimCtx,
	archetypeAt,
	archetypeIndex,
	createSimState,
	step,
	type ActorSpawn,
	type ActorState,
	type AffixEvent,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { comboQuiet } from "./comboEvents";
import { NO_VARIANT_CUES, VariantCueEvents, audibleVariantCues, impLandedThisTick } from "./variantCueEvents";

function openConfig(spawns: ActorSpawn[]): SimConfig {
	return { encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 } };
}

function actorsOf(s: SimState, id: string): ActorState[] {
	const out: ActorState[] = [];
	for (const a of s.combat.actors) if (a.kind !== NO_KIND && archetypeAt(a.kind).id === id) out.push(a);
	return out;
}

/** Kills `a` the way the sim does, then advances the tick as a step would (its spawns are "this tick's"). */
function killAsAStep(s: SimState, config: SimConfig, a: ActorState): void {
	new SimCtx().bind(s, config, EMPTY_INPUT).killActor(a);
	s.tick += 1;
}

function affixEvent(slot: number, a: ActorState, affix: number): AffixEvent {
	return { slot, actorId: a.id, affix, x: a.x, z: a.z, amount: 1 };
}

describe("VariantCueEvents: blinks", () => {
	it("counts an imp only on its landing tick (TELEGRAPH, the fan's aim, aiTicks === IMP_LAND_AIM_TICKS)", () => {
		const s = createSimState(1, 0, 0, openConfig([{ kind: "imp", x: 6, z: 0 }]));
		const imp = actorsOf(s, "imp")[0];
		const ev = new VariantCueEvents();
		imp.aiState = AiState.TELEGRAPH;
		imp.attack = IMP_ATTACK_FAN;
		imp.aiTicks = IMP_LAND_AIM_TICKS;
		expect(impLandedThisTick(imp)).toBe(true);
		ev.collect(s);
		expect(ev.blinks).toBe(1);
		// The aim ticks after the landing, the blink's own wind-up, a dead imp: no blink.
		imp.aiTicks = IMP_LAND_AIM_TICKS - 1;
		ev.collect(s);
		imp.aiTicks = IMP_LAND_AIM_TICKS;
		imp.attack = IMP_ATTACK_BLINK;
		ev.collect(s);
		imp.attack = IMP_ATTACK_FAN;
		imp.alive = 0;
		ev.collect(s);
		expect(ev.blinks).toBe(1);
		expect(ev.count()).toBe(1);
		ev.reset();
		expect([ev.blinks, ev.count()]).toEqual([0, 0]);
	});

	it("a real imp: every landing is counted once, on its landing tick", () => {
		const config = openConfig([{ kind: "imp", x: 6, z: 0 }]);
		const s = createSimState(4, 0, 0, config);
		s.player.hurtTicks = 1e6; // the player can't be hurt
		const imp = actorsOf(s, "imp")[0];
		const ev = new VariantCueEvents();
		let landings = 0;
		let blinks = 0;
		for (let t = 0; t < 60 * 30; t++) {
			step(s, EMPTY_INPUT, config);
			ev.reset();
			ev.collect(s);
			if (impLandedThisTick(imp)) landings++;
			blinks += ev.blinks;
		}
		expect(landings).toBeGreaterThanOrEqual(3);
		expect(blinks).toBe(landings);
	});
});

describe("VariantCueEvents: splits and summons", () => {
	it("counts the slimelets an Ooze's death spawned, on that tick only", () => {
		const config = openConfig([{ kind: SLIME_ID, x: 8, z: 0 }]);
		const s = createSimState(3, 3, 0, config);
		const ev = new VariantCueEvents();
		ev.collect(s);
		expect(ev.splits).toBe(0);
		killAsAStep(s, config, actorsOf(s, SLIME_ID)[0]);
		expect(actorsOf(s, SLIME_SMALL_ID).size()).toBe(2);
		ev.collect(s);
		expect(ev.splits).toBe(2);
		// The next tick: the same slimelets are no news.
		ev.reset();
		s.tick += 1;
		ev.collect(s);
		expect(ev.count()).toBe(0);
		// A slimelet's own death spawns nothing.
		killAsAStep(s, config, actorsOf(s, SLIME_SMALL_ID)[0]);
		ev.collect(s);
		expect(ev.count()).toBe(0);
	});

	it("a real Summoner: the summons are counted on the tick they appear, each once", () => {
		const config = openConfig([{ kind: SUMMONER.id, x: 0, z: 8 }]);
		const s = createSimState(5, 0, 0, config);
		s.player.hurtTicks = 1e6;
		const swarmer = archetypeIndex("swarmer");
		const ev = new VariantCueEvents();
		const seen = new Set<number>();
		let summons = 0;
		let castTicks = 0;
		for (let t = 0; t < 60 * 20; t++) {
			const before = seen.size();
			step(s, EMPTY_INPUT, config);
			ev.reset();
			ev.collect(s);
			for (const a of s.combat.actors) if (a.kind === swarmer) seen.add(a.id);
			expect(ev.summons).toBe(seen.size() - before);
			summons += ev.summons;
			if (ev.summons > 0) castTicks++;
		}
		expect(summons).toBe(seen.size());
		expect(castTicks).toBeGreaterThanOrEqual(1);
		expect(summons).toBeGreaterThanOrEqual(2);
	});

	it("a swarmer that is nobody's summon is not a summon", () => {
		const config = openConfig([{ kind: "swarmer", x: 5, z: 0 }]);
		const s = createSimState(2, 0, 0, config);
		const ev = new VariantCueEvents();
		s.tick = 1; // the initial spawn is "the last tick's"
		ev.collect(s);
		expect(ev.count()).toBe(0);
	});
});

describe("VariantCueEvents: affix events", () => {
	it("counts AffixEvents shieldBroke and vengefulFired; armed, refilled and shield hits are no cue", () => {
		const config: SimConfig = { ...openConfig([{ kind: "bruiser", x: 6, z: 0 }]), affixes: AFFIXES_CONFIG };
		const s = createSimState(1, 0, 0, config);
		const a = actorsOf(s, "bruiser")[0];
		const e = s.affixes!.events;
		e.shieldHits.push(affixEvent(0, a, AffixKind.SHIELDED));
		e.shieldRefilled.push(affixEvent(0, a, AffixKind.SHIELDED));
		e.vengefulArmed.push(affixEvent(0, a, AffixKind.VENGEFUL));
		const ev = new VariantCueEvents();
		ev.collect(s);
		expect(ev.count()).toBe(0);
		e.shieldBroke.push(affixEvent(0, a, AffixKind.SHIELDED));
		e.vengefulFired.push(affixEvent(0, a, AffixKind.VENGEFUL), affixEvent(0, a, AffixKind.VENGEFUL));
		ev.collect(s);
		expect([ev.shieldBreaks, ev.vengefulFired]).toEqual([1, 2]);
	});

	it("a run without affixes collects no affix event", () => {
		const s = createSimState(1, 0, 0, openConfig([]));
		const ev = new VariantCueEvents();
		ev.collect(s);
		expect(ev.count()).toBe(0);
	});
});

describe("audibleVariantCues", () => {
	it("passes the source through, or nothing while quiet (stage cover, run over)", () => {
		const ev = new VariantCueEvents();
		ev.blinks = 1;
		expect(audibleVariantCues(ev, comboQuiet(false, false))).toBe(ev);
		expect(audibleVariantCues(ev, comboQuiet(true, false))).toBe(NO_VARIANT_CUES);
		expect(audibleVariantCues(ev, comboQuiet(false, true))).toBe(NO_VARIANT_CUES);
		expect([
			NO_VARIANT_CUES.blinks,
			NO_VARIANT_CUES.summons,
			NO_VARIANT_CUES.splits,
			NO_VARIANT_CUES.shieldBreaks,
			NO_VARIANT_CUES.vengefulFired,
		]).toEqual([0, 0, 0, 0, 0]);
	});
});

describe("RunView.variantCues wiring", () => {
	it("LiveRun collects the frame's ticks and resets every frame", () => {
		const config = openConfig([{ kind: SLIME_ID, x: 8, z: 0 }]);
		const run = new LiveRun({ seed: 3, spawnX: 3, spawnZ: 0, config, atBossDoor: false });
		run.frame(1 / 60, EMPTY_INPUT);
		expect(run.variantCues.count()).toBe(0);
		// Killed between frames: the slimelets carry this tick, which the next step finishes.
		new SimCtx().bind(run.state, config, EMPTY_INPUT).killActor(actorsOf(run.state, SLIME_ID)[0]);
		expect(run.frame(1 / 60, EMPTY_INPUT)).toBe(1);
		expect(run.variantCues.splits).toBe(2);
		run.frame(3 / 60, EMPTY_INPUT);
		expect(run.variantCues.splits).toBe(0);
	});
});
