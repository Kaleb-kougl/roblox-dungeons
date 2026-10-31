// Elite affixes in the sim (docs/ENEMY_VARIANTS.md EV7): one spec per rule (Hulking hp / radius / walk; Swift walk and
// cooldowns scaled but every telegraph as long as without; Shielded absorbs and refills; Vengeful telegraphs >= 0.6 s,
// then fires exactly one gapped ring at the nearest living player, its corpse held and then freed), the rewards, the
// opt-in rule (no state, no group, nothing changes without SimConfig.affixes) and runtime spawns never carrying one.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	AFFIX_RULES,
	AiState,
	BRUISER,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	GAP_TURNS,
	NO_KIND,
	PERCENT,
	SIM_DT,
	SNIPER,
	SWARMER,
	SimCtx,
	actorAffix,
	actorCooldownPercent,
	actorWalkPercent,
	affixDropBonus,
	affixKillPercent,
	archetypeIndex,
	createSimState,
	enemyCooldown,
	rngInt,
	scalePercent,
	scaleTicks,
	spawnActor,
	step,
	stepParty,
	walkStep,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";

interface World {
	s: SimState;
	ctx: SimCtx;
	config: SimConfig;
}

function world(extra: Partial<SimConfig> = {}, withAffixes = true): World {
	const config: SimConfig = { ...DEFAULT_SIM_CONFIG, ...extra };
	if (withAffixes) config.affixes = AFFIXES_CONFIG;
	const s = createSimState(7, 0, 0, config);
	const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
	return { s, ctx, config };
}

function spawn(w: World, id: string, x: number, z: number, affix: number = AffixKind.NONE): ActorState {
	w.ctx.bind(w.s, w.config, EMPTY_INPUT);
	const a = spawnActor(w.ctx, archetypeIndex(id), x, z, affix);
	if (a === undefined) error("spawn failed", 0);
	return a;
}

function tick(w: World, n = 1): void {
	for (let k = 0; k < n; k++) step(w.s, EMPTY_INPUT, w.config);
}

describe("stamping", () => {
	it("Hulking: hp x175 %, radius x120 % at the stamp (before init), walk x85 %, cooldowns unchanged", () => {
		const w = world();
		const plain = spawn(w, BRUISER.id, 20, 0);
		const hulk = spawn(w, BRUISER.id, -20, 0, AffixKind.HULKING);
		expect([plain.hp, plain.hpMax, plain.radius]).toEqual([10, 10, 0.5]);
		expect([hulk.hp, hulk.hpMax, hulk.radius]).toEqual([17.5, 17.5, 0.6]);
		expect([actorAffix(w.s, plain), actorAffix(w.s, hulk)]).toEqual([AffixKind.NONE, AffixKind.HULKING]);
		expect(actorWalkPercent(w.ctx, hulk)).toBe(AFFIX_RULES.hulkingWalkPercent);
		expect(walkStep(w.ctx, hulk)).toBe(scalePercent(BRUISER.data.speed * SIM_DT, 85));
		expect(walkStep(w.ctx, plain)).toBe(BRUISER.data.speed * SIM_DT);
		expect(actorCooldownPercent(w.ctx, hulk)).toBe(PERCENT);
	});

	it("one affix slot per actor slot, reset when the slot is freed and reused; runtime spawns never carry one", () => {
		const w = world();
		const a = spawn(w, SWARMER.id, 20, 0, AffixKind.SWIFT);
		spawn(w, SWARMER.id, 21, 0);
		expect(w.s.affixes!.slots.size()).toBe(w.s.combat.actors.size());
		w.ctx.freeActor(a);
		expect(w.s.affixes!.slots[0].affix).toBe(AffixKind.NONE);
		const b = w.ctx.spawnActor(SWARMER.id, 22, 0)!; // a runtime spawn (summons, splits, adds): no affix
		expect(w.s.combat.actors.indexOf(b)).toBe(0);
		expect(actorAffix(w.s, b)).toBe(AffixKind.NONE);
		expect(w.s.affixes!.slots[0]).toEqual({
			affix: 0,
			actorId: 0,
			shield: 0,
			shieldMax: 0,
			shieldIdleTicks: 0,
			vengeTicks: 0,
			vengeArmTick: -1,
		});
	});

	it("without SimConfig.affixes: no state, the affix argument is ignored, every read neutral", () => {
		const w = world({}, false);
		const a = spawn(w, BRUISER.id, 20, 0, AffixKind.HULKING);
		expect(w.s.affixes).toBe(undefined);
		expect([a.hp, a.radius]).toEqual([10, 0.5]);
		expect([actorWalkPercent(w.ctx, a), actorCooldownPercent(w.ctx, a)]).toEqual([PERCENT, PERCENT]);
		expect([affixKillPercent(w.s, a, PERCENT), affixDropBonus(w.s, a)]).toEqual([PERCENT, 0]);
	});
});

describe("Swift", () => {
	it("walk x135 %; the first cooldown drawn in init is already x75 % (the same single draw)", () => {
		for (const id of [SWARMER.id, SNIPER.id]) {
			const a = world();
			const b = world();
			const swift = spawn(a, id, 6, 0, AffixKind.SWIFT);
			const plain = spawn(b, id, 6, 0);
			expect(a.s.rngState).toBe(b.s.rngState);
			expect(swift.cooldown).toBe(scaleTicks(plain.cooldown, AFFIX_RULES.swiftCooldownPercent));
			expect(walkStep(a.ctx, swift)).toBe(scalePercent(a.ctx.data(swift).speed * SIM_DT, 135));
			for (let k = 0; k < 10; k++)
				expect(enemyCooldown(a.ctx, swift, 60, 144)).toBe(scaleTicks(enemyCooldown(b.ctx, plain, 60, 144), 75));
			expect(a.s.rngState).toBe(b.s.rngState);
		}
	});

	it("telegraphs are exactly as long as without (swarmer, sniper, bruiser); the Swift one attacks no later", () => {
		const cases: Array<[string, number, number]> = [
			[SWARMER.id, 3, SWARMER.data.lungeTelegraphTicks],
			[SNIPER.id, 6, SNIPER.data.telegraphTicks],
			[BRUISER.id, 3, BRUISER.data.telegraphTicks],
		];
		for (const [id, dist, ticks] of cases) {
			const seen: number[] = [];
			const at: number[] = [];
			for (const affix of [AffixKind.SWIFT, AffixKind.NONE]) {
				const w = world();
				const a = spawn(w, id, dist, 0, affix);
				let first = -1;
				let firstTicks = -1;
				for (let k = 0; k < 600 && first < 0; k++) {
					tick(w);
					if (a.aiState === AiState.TELEGRAPH) {
						first = w.s.tick;
						firstTicks = a.aiTicks;
					}
				}
				seen.push(firstTicks);
				at.push(first);
			}
			expect([id, seen[0], seen[1]]).toEqual([id, ticks, ticks]);
			expect(at[0] > 0 && at[0] <= at[1]).toBe(true);
		}
	});
});

describe("Shielded", () => {
	it("a shield of 40 % of its hp absorbs first, breaks with an event, and refills fully after 5 s without damage", () => {
		const w = world();
		const a = spawn(w, BRUISER.id, 30, 30, AffixKind.SHIELDED); // far from the player: stays calm
		const x = w.s.affixes!.slots[0];
		expect([x.shield, x.shieldMax]).toEqual([4, 4]);
		expect(w.ctx.damageActor(a, 3)).toBe(0);
		expect([a.hp, x.shield]).toEqual([10, 1]);
		expect(w.s.affixes!.events.shieldHits.map((e) => e.amount)).toEqual([3]);
		expect(w.ctx.damageActor(a, 3)).toBe(2);
		expect([a.hp, x.shield]).toEqual([8, 0]);
		expect(w.s.affixes!.events.shieldBroke.map((e) => e.amount)).toEqual([1]);
		expect(w.ctx.damageActor(a, 1)).toBe(1); // a broken shield takes nothing
		tick(w, AFFIX_RULES.shieldRefillTicks - 1);
		expect(x.shield).toBe(0);
		tick(w);
		expect(x.shield).toBe(4);
		expect(w.s.affixes!.events.shieldRefilled.size()).toBe(1);
	});

	it("any damage restarts the 5 s; a full shield does not count", () => {
		const w = world();
		const a = spawn(w, BRUISER.id, 30, 30, AffixKind.SHIELDED);
		const x = w.s.affixes!.slots[0];
		tick(w, 100);
		expect(x.shieldIdleTicks).toBe(0);
		w.ctx.damageActor(a, 2);
		tick(w, 150);
		w.ctx.damageActor(a, 1);
		expect(x.shield).toBe(1);
		tick(w, AFFIX_RULES.shieldRefillTicks - 1);
		expect(x.shield).toBe(1);
		tick(w);
		expect(x.shield).toBe(4);
	});
});

/** The ring's gap from the live enemy bullets: the arc is symmetric about -gap, so -sum(directions) points at it. */
function gapOf(s: SimState): [number, number, number] {
	const b = s.combat.enemyBullets;
	let sx = 0;
	let sz = 0;
	let n = 0;
	b.forEachActive((i) => {
		const v = b.velocityAt(i);
		const len = math.sqrt(v.x * v.x + v.z * v.z);
		sx += v.x / len;
		sz += v.z / len;
		n++;
	});
	const len = math.sqrt(sx * sx + sz * sz);
	return [-sx / len, -sz / len, n];
}

function isGapTurn(gx: number, gz: number, bx: number, bz: number): boolean {
	const dot = gx * bx + gz * bz;
	for (const t of GAP_TURNS) if (math.abs(dot - t[0]) < 1e-6) return true;
	return false;
}

describe("Vengeful", () => {
	it("the corpse telegraphs >= 0.6 s, fires exactly one gapped ring (one main-rng draw), is held, then freed", () => {
		const w = world();
		const a = spawn(w, SWARMER.id, 5, 0, AffixKind.VENGEFUL);
		const id = a.id;
		w.ctx.killActor(a); // tick 0
		const x = w.s.affixes!.slots[0];
		expect([x.vengeArmTick, x.vengeTicks]).toEqual([0, AFFIX_RULES.vengefulTelegraphTicks]);
		expect(w.s.affixes!.events.vengefulArmed.size()).toBe(1);
		let fires = 0;
		let fireTick = -1;
		let freedTick = -1;
		for (let k = 0; k < 240; k++) {
			const before = w.s.rngState;
			const t = w.s.tick;
			tick(w);
			const fired = w.s.affixes!.events.vengefulFired;
			if (fired.size() > 0) {
				fires += fired.size();
				fireTick = t;
				expect(fired[0].amount).toBe(BRUISER.data.ring.count);
				const h = { rngState: before };
				rngInt(h, 0, GAP_TURNS.size() - 1);
				expect(w.s.rngState).toBe(h.rngState);
				const [gx, gz, n] = gapOf(w.s);
				expect(n).toBe(BRUISER.data.ring.count);
				expect(isGapTurn(gx, gz, -1, 0)).toBe(true); // the player stands at the origin, the corpse at (5, 0)
			} else if (fireTick < 0) {
				expect(w.s.combat.enemyBullets.activeCount).toBe(0);
				expect(w.s.combat.actors[0].id).toBe(id); // held past CORPSE_TICKS while armed
			}
			if (freedTick < 0 && w.s.combat.actors[0].kind === NO_KIND) freedTick = t;
		}
		expect(fires).toBe(1);
		expect(fireTick).toBe(AFFIX_RULES.vengefulTelegraphTicks);
		expect(fireTick >= AFFIX_RULES.vengefulTelegraphTicks).toBe(true);
		expect(freedTick).toBe(fireTick + 1);
		expect(w.s.affixes!.slots[0].affix).toBe(AffixKind.NONE);
	});

	it("a corpse freed early (a floor change frees every actor) never fires", () => {
		const w = world();
		const a = spawn(w, SWARMER.id, 5, 0, AffixKind.VENGEFUL);
		w.ctx.killActor(a);
		tick(w, 10);
		w.ctx.freeActor(w.s.combat.actors[0]);
		tick(w, 60);
		expect(w.s.combat.enemyBullets.activeCount).toBe(0);
	});

	it("co-op: the gap faces the NEAREST living player (targetNearest on the corpse), not player 0", () => {
		const w = world({ party: { size: 2 } });
		const a = spawn(w, SWARMER.id, 5, 0, AffixKind.VENGEFUL);
		const p0 = w.s.party!.players[0];
		const p1 = w.s.party!.players[1];
		p0.x = 5;
		p0.z = -7;
		p1.x = 5;
		p1.z = 3;
		p0.prevX = p0.x;
		p0.prevZ = p0.z;
		p1.prevX = p1.x;
		p1.prevZ = p1.z;
		w.ctx.killActor(a);
		let fired = false;
		for (let k = 0; k < 60 && !fired; k++) {
			stepParty(w.s, [EMPTY_INPUT, EMPTY_INPUT], w.config);
			fired = w.s.affixes!.events.vengefulFired.size() > 0;
		}
		expect(fired).toBe(true);
		const [gx, gz] = gapOf(w.s);
		expect(isGapTurn(gx, gz, 0, 1)).toBe(true); // toward player 1 (north of the corpse)
		expect(gx * 0 + gz * -1 < 0).toBe(true); // away from player 0
	});
});

describe("rewards", () => {
	it("an affixed kill: x150 % points (with Bounty: combined) and +4 drop chance points", () => {
		const w = world();
		const a = spawn(w, SWARMER.id, 20, 0, AffixKind.SWIFT);
		const b = spawn(w, SWARMER.id, 22, 0);
		expect([affixKillPercent(w.s, a, PERCENT), affixKillPercent(w.s, a, 110)]).toEqual([150, 165]);
		expect([affixKillPercent(w.s, b, 110), affixDropBonus(w.s, a), affixDropBonus(w.s, b)]).toEqual([110, 4, 0]);
	});
});
