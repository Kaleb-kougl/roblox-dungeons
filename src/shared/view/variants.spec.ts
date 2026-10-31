// Enemy variants on screen (docs/ENEMY_VARIANTS.md EV9): the sprite inputs of the imp, the Ooze and the summoner per
// state; the ring / aim line attack filters and the ring's fill against the sim's own telegraph (imp blink, summoner
// cast); elite = elite room OR affixed; a Vengeful corpse's drawn length; the goo pool split and decal look; the affix
// chip key and colour; the Hulking draw scale; imp landings and shield-hit flashes from per-frame diffs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, AFFIX_KIND_COUNT } from "shared/dungeon";
import {
	ACTOR_SCRATCH_SLOTS,
	AFFIXES_CONFIG,
	AFFIX_RULES,
	AiState,
	BRUISER,
	BulletKind,
	BulletPayload,
	CORPSE_TICKS,
	DAMAGE_CAP_BUCKETS,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	IMP,
	IMP_ATTACK_BLINK,
	IMP_ATTACK_FAN,
	IMP_DEST_X,
	IMP_DEST_Z,
	IMP_REPOSITION,
	NO_KIND,
	SLIME,
	SLIME_CRAWL,
	SLIME_SMALL,
	SUMMONER,
	SUMMONER_ATTACK_PANIC,
	SUMMONER_ATTACK_SUMMON,
	SUMMONER_BACKOFF,
	SUMMONER_KEEP,
	SWARMER,
	SimCtx,
	archetypeIndex,
	createSimState,
	partySize,
	playerAt,
	spawnActor,
	step,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { AFFIX_IDS, affixNameKey, affixRole, loadThemePack, type SpriteAnimationDef } from "shared/theme";
import { HitTracker } from "./fx";
import {
	ACTOR_SPRITE_INPUTS,
	chooseActorAnim,
	corpseTransparency,
	impAttack,
	impSpriteInput,
	slimeSmallSpriteInput,
	slimeSpriteInput,
	summonerAttack,
	summonerSpriteInput,
	actorSpriteScale,
	scaledSpriteLayout,
	type SpriteAnimSource,
} from "./sprites";
import { actorFxMarkings, ringFill, type ActorFxHintsView, type SegmentSink } from "./markings";
import {
	BlinkWatch,
	ShieldFlashWatch,
	affixChipKey,
	affixChipRect,
	affixDrawScale,
	affixIdOf,
	affixRingPieces,
	affixRingRadius,
	affixRingSegments,
	affixRoleOf,
	createBarRect,
	eliteView,
	enemyBulletPool,
	gooDecalLook,
	isGooPayload,
	shieldRowRect,
	vengefulArmed,
	vengefulCorpseView,
	viewAffix,
	variantLook,
	viewFxHints,
	type GooLook,
} from "./variants";
import { AFFIX_VIEW, GOO_VIEW, VARIANT_ANIM_MARKS, VARIANT_SPRITE_VIEW } from "./variantsConfig";

/** A live ActorState at rest (fields overridden per case). */
function actor(over: Partial<ActorState>): ActorState {
	return {
		id: 1,
		kind: 0,
		spawnTick: -1,
		x: 0,
		z: 0,
		prevX: 0,
		prevZ: 0,
		faceX: 1,
		faceZ: 0,
		hp: 3,
		hpMax: 3,
		radius: 0.4,
		alive: 1,
		deadTicks: 0,
		aiState: 0,
		aiTicks: 0,
		attack: 0,
		cooldown: 0,
		flashTicks: 0,
		emitterId: 0,
		phase: 0,
		capBucket: -1,
		capWindow: table.create(DAMAGE_CAP_BUCKETS, 0),
		v: table.create(ACTOR_SCRATCH_SLOTS, 0),
		...over,
	};
}

function anim(frames: number, fps: number, loop: boolean): SpriteAnimationDef {
	return { sheet: 0, start: 0, frames, fps, loop };
}

function source(anims: Readonly<Record<string, SpriteAnimationDef>>): SpriteAnimSource {
	return {
		animation(name: string) {
			return anims[name];
		},
	};
}

const ENEMY_SET = source({
	idle: anim(4, 8, true),
	move: anim(6, 10, true),
	attack: anim(8, 12, false),
	death: anim(6, 10, false),
});
const SLIME_SET = source({ idle: anim(1, 8, true), move: anim(8, 10, true), death: anim(7, 10, false) });

/** Counts segments and remembers their mean point (a ring's centre). */
class CountSink implements SegmentSink {
	n = 0;
	sx = 0;
	sz = 0;
	seg(x0: number, z0: number, x1: number, z1: number): void {
		this.n++;
		this.sx += x0 + x1;
		this.sz += z0 + z1;
	}
	centre(): [number, number] {
		return [this.sx / (2 * this.n), this.sz / (2 * this.n)];
	}
}

const enc = (kind: string, x: number, z: number) => ({
	spawns: [{ kind, x, z }],
	rooms: [],
	entranceRoom: -1,
	bossRoom: -1,
});

/** Players can't be hurt. */
function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}

// ---------------------------------------------------------------------------------------------

describe("sprite inputs per state", () => {
	it("registers the four new archetypes", () => {
		for (const id of [IMP.id, SLIME.id, SLIME_SMALL.id, SUMMONER.id])
			expect(ACTOR_SPRITE_INPUTS.has(id)).toBe(true);
		expect(ACTOR_SPRITE_INPUTS.get(IMP.id)).toBe(impSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(SLIME.id)).toBe(slimeSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(SLIME_SMALL.id)).toBe(slimeSmallSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(SUMMONER.id)).toBe(summonerSpriteInput);
	});

	it("imp: the crouch over the blink wind-up, the throw over the landing aim, nothing while repositioning", () => {
		const blink = impAttack(AiState.TELEGRAPH, IMP_ATTACK_BLINK, IMP.data.blinkTelegraphTicks, 0)!;
		expect([blink.elapsed, blink.total]).toEqual([0, IMP.data.blinkTelegraphTicks]);
		expect([blink.segment!.from, blink.segment!.to]).toEqual([0, VARIANT_ANIM_MARKS.imp.land]);
		const last = impAttack(AiState.TELEGRAPH, IMP_ATTACK_BLINK, 1, 1)!;
		expect(last.elapsed).toBe(last.total);
		const fan = impAttack(AiState.TELEGRAPH, IMP_ATTACK_FAN, IMP.data.landAimTicks, 0)!;
		expect([fan.elapsed, fan.total]).toEqual([0, IMP.data.landAimTicks]);
		expect([fan.segment!.from, fan.segment!.to]).toEqual([VARIANT_ANIM_MARKS.imp.land, 1]);
		expect(impAttack(IMP_REPOSITION, 0, 0, 0)).toBe(undefined);
		expect(impAttack(AiState.TELEGRAPH, 0, 5, 0)).toBe(undefined);
		// Chosen: attack while winding up; move while strafing; death when dead.
		const winding = actor({
			kind: archetypeIndex(IMP.id),
			aiState: AiState.TELEGRAPH,
			attack: IMP_ATTACK_BLINK,
			aiTicks: 10,
		});
		expect(chooseActorAnim(impSpriteInput(winding, 0), ENEMY_SET).anim).toBe("attack");
		const strafing = actor({ aiState: IMP_REPOSITION, prevX: 0, x: IMP.data.speed / 60 });
		expect(chooseActorAnim(impSpriteInput(strafing, 0), ENEMY_SET).anim).toBe("move");
		const dead = actor({ alive: 0, deadTicks: 3, aiState: AiState.TELEGRAPH, attack: IMP_ATTACK_BLINK });
		expect(impSpriteInput(dead, 0).attack).toBe(undefined);
		expect(chooseActorAnim(impSpriteInput(dead, 0), ENEMY_SET).anim).toBe("death");
	});

	it("slime / slime.small: idle, move, death only (never an attack)", () => {
		for (const input of [slimeSpriteInput, slimeSmallSpriteInput]) {
			const crawl = actor({ aiState: SLIME_CRAWL, prevX: 0, x: SLIME_SMALL.data.speed / 60 });
			expect(input(crawl, 0).attack).toBe(undefined);
			expect(chooseActorAnim(input(crawl, 0), SLIME_SET).anim).toBe("move");
			expect(chooseActorAnim(input(actor({ aiState: AiState.TELEGRAPH, aiTicks: 5 }), 0), SLIME_SET).anim).toBe(
				"idle",
			);
			expect(chooseActorAnim(input(actor({ alive: 0, deadTicks: 2 }), 0), SLIME_SET).anim).toBe("death");
			expect(input(actor({}), 0).corpseTicks).toBe(CORPSE_TICKS);
		}
		expect(slimeSpriteInput(actor({}), 0).refSpeed).toBe(SLIME.data.speed);
		expect(slimeSmallSpriteInput(actor({}), 0).refSpeed).toBe(SLIME_SMALL.data.speed);
	});

	it("summoner: the cast over its summon telegraph, the panic swing over its own, move while backing off", () => {
		const cast = summonerAttack(AiState.TELEGRAPH, SUMMONER_ATTACK_SUMMON, SUMMONER.data.summonTelegraphTicks, 0)!;
		expect([cast.anim, cast.elapsed, cast.total]).toEqual([
			VARIANT_SPRITE_VIEW.summonerAnims.cast,
			0,
			SUMMONER.data.summonTelegraphTicks,
		]);
		const panic = summonerAttack(AiState.TELEGRAPH, SUMMONER_ATTACK_PANIC, 1, 1)!;
		expect([panic.anim, panic.elapsed, panic.total]).toEqual([
			VARIANT_SPRITE_VIEW.summonerAnims.panic,
			SUMMONER.data.panicTelegraphTicks,
			SUMMONER.data.panicTelegraphTicks,
		]);
		expect(summonerAttack(SUMMONER_KEEP, 0, 0, 0)).toBe(undefined);
		const backing = actor({ aiState: SUMMONER_BACKOFF, prevX: 0, x: SUMMONER.data.speed / 60 });
		expect(summonerSpriteInput(backing, 0).attack).toBe(undefined);
		expect(chooseActorAnim(summonerSpriteInput(backing, 0), ENEMY_SET).anim).toBe("move");
		// A set without attack.2 plays `attack` for the cast.
		const casting = actor({ aiState: AiState.TELEGRAPH, attack: SUMMONER_ATTACK_SUMMON, aiTicks: 30 });
		expect(chooseActorAnim(summonerSpriteInput(casting, 0), ENEMY_SET).anim).toBe("attack");
	});
});

describe("markings: attack filters and the ring", () => {
	const IMP_FX = IMP.data.fx as ActorFxHintsView;

	it("imp: the ring at its destination during the blink wind-up only, the aim line during the landing aim only", () => {
		const v = table.create(ACTOR_SCRATCH_SLOTS, 0);
		v[IMP_DEST_X] = 3;
		v[IMP_DEST_Z] = -2;
		const blink = actor({ aiState: AiState.TELEGRAPH, attack: IMP_ATTACK_BLINK, aiTicks: 25, v });
		const bright = new CountSink();
		const dim = new CountSink();
		expect(actorFxMarkings(bright, dim, blink, IMP_FX, 0, 0, 0)).toBe(true);
		expect(dim.n).toBeGreaterThan(2); // the outline (fill below brightFrom)
		const [cx, cz] = dim.centre();
		expect(cx).toBeCloseTo(3, 6);
		expect(cz).toBeCloseTo(-2, 6);
		// No aim line: every bright segment is the inner fill circle, centred on the destination too.
		const [bx, bz] = bright.centre();
		expect(bx).toBeCloseTo(3, 6);
		expect(bz).toBeCloseTo(-2, 6);
		const aim = actor({ aiState: AiState.TELEGRAPH, attack: IMP_ATTACK_FAN, aiTicks: 5, v });
		aim.v[5] = 1; // IMP_AIM_X
		const b2 = new CountSink();
		const d2 = new CountSink();
		expect(actorFxMarkings(b2, d2, aim, IMP_FX, 0, 0, 0)).toBe(true);
		expect([b2.n, d2.n]).toEqual([1, 0]); // the bold aim line alone
		expect(
			actorFxMarkings(new CountSink(), new CountSink(), actor({ aiState: IMP_REPOSITION }), IMP_FX, 0, 0, 0),
		).toBe(false);
	});

	it("summoner: its casting ring around itself during the summon only (viewFxHints), never during the panic", () => {
		const fx = viewFxHints(SUMMONER.id, SUMMONER.data.fx as ActorFxHintsView)!;
		expect(fx.ring!.attack).toBe(SUMMONER_ATTACK_SUMMON);
		expect(viewFxHints(SUMMONER.id, SUMMONER.data.fx as ActorFxHintsView)).toBe(fx); // cached
		expect(viewFxHints(IMP.id, IMP_FX)).toBe(IMP_FX); // its own filters
		const cast = actor({ aiState: AiState.TELEGRAPH, attack: SUMMONER_ATTACK_SUMMON, aiTicks: 50, x: 4, z: 1 });
		const dim = new CountSink();
		expect(actorFxMarkings(new CountSink(), dim, cast, fx, 4, 1, 0)).toBe(true);
		const [cx, cz] = dim.centre();
		expect(cx).toBeCloseTo(4, 6);
		expect(cz).toBeCloseTo(1, 6);
		const panic = actor({ aiState: AiState.TELEGRAPH, attack: SUMMONER_ATTACK_PANIC, aiTicks: 20 });
		expect(actorFxMarkings(new CountSink(), new CountSink(), panic, fx, 0, 0, 0)).toBe(false); // generic ring instead
	});

	it("ringFill: 0 on the wind-up's first tick, 1 when it runs out, full without fillTicks", () => {
		expect(ringFill(30, 30, 0)).toBe(0);
		expect(ringFill(15, 30, 0)).toBe(0.5);
		expect(ringFill(1, 30, 1)).toBe(1);
		expect(ringFill(40, 30, 0)).toBe(0);
		expect(ringFill(0, 30, 1)).toBe(1);
		expect(ringFill(7, undefined, 0)).toBe(1);
	});

	it("imp: the ring fills over exactly the sim's blink telegraph and the landing follows its last tick", () => {
		const config: SimConfig = { encounter: enc(IMP.id, 0, 6) };
		const s = createSimState(11, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		const fx = viewFxHints(IMP.id, IMP_FX)!;
		const ring = fx.ring!;
		expect(ring.fillTicks).toBe(IMP.data.blinkTelegraphTicks);
		let shown = 0;
		let blinks = 0;
		for (let t = 0; t < 900; t++) {
			const wasShowing = shown;
			step(s, EMPTY_INPUT, config);
			const drawn = a.aiState === ring.state && a.attack === ring.attack;
			if (drawn) {
				expect(ringFill(a.aiTicks, ring.fillTicks, 0)).toBe(shown / ring.fillTicks!);
				shown++;
				continue;
			}
			if (wasShowing > 0) {
				// The state after the ring's last tick is the landing (or a cancel), and the ring was full by then.
				expect(wasShowing).toBe(IMP.data.blinkTelegraphTicks);
				if (a.attack === IMP_ATTACK_FAN) blinks++;
			}
			shown = 0;
		}
		expect(blinks).toBeGreaterThanOrEqual(3);
	});

	it("summoner: the ring fills over exactly the sim's summon telegraph and the summons burst out after it", () => {
		const config: SimConfig = { encounter: enc(SUMMONER.id, 0, 7.5) };
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		const ring = viewFxHints(SUMMONER.id, SUMMONER.data.fx as ActorFxHintsView)!.ring!;
		expect(ring.fillTicks).toBe(SUMMONER.data.summonTelegraphTicks);
		const swarmers = () => {
			let n = 0;
			for (const o of s.combat.actors) if (o.kind === archetypeIndex(SWARMER.id) && o.alive !== 0) n++;
			return n;
		};
		let shown = 0;
		let casts = 0;
		for (let t = 0; t < 1200 && casts < 2; t++) {
			const before = swarmers();
			const wasShowing = shown;
			step(s, EMPTY_INPUT, config);
			if (a.aiState === ring.state && a.attack === ring.attack) {
				expect(ringFill(a.aiTicks, ring.fillTicks, 0)).toBe(shown / ring.fillTicks!);
				shown++;
				continue;
			}
			if (wasShowing > 0) {
				expect(wasShowing).toBe(SUMMONER.data.summonTelegraphTicks);
				expect(swarmers()).toBeGreaterThan(before);
				casts++;
			}
			shown = 0;
		}
		expect(casts).toBe(2);
	});
});

describe("affixes", () => {
	it("elite = elite room OR affixed", () => {
		expect(eliteView(false, AffixKind.NONE)).toBe(false);
		expect(eliteView(true, AffixKind.NONE)).toBe(true);
		for (let k = 1; k <= AFFIX_KIND_COUNT; k++) {
			expect(eliteView(false, k)).toBe(true);
			expect(eliteView(true, k)).toBe(true);
		}
	});

	it("the hit tracker marks an affixed actor elite outside elite rooms (and not a stale slot)", () => {
		const s = createSimState(1, 0, 0, { encounter: enc(SWARMER.id, 5, 0) });
		const a = s.combat.actors[0];
		const slots = [{ affix: AffixKind.SWIFT, actorId: a.id, shield: 0, shieldMax: 0, vengeTicks: 0 }];
		const st = { tick: 1, events: { enemyHits: 0 }, combat: { actors: s.combat.actors }, affixes: { slots } };
		const tracker = new HitTracker({ describe: () => ({ boss: false }) });
		tracker.update(st, 0);
		a.hp -= 1;
		st.tick = 2;
		tracker.update(st, 0);
		expect(tracker.events.count()).toBe(1);
		expect([tracker.events.at(0).type, tracker.events.at(0).elite]).toEqual(["hit", true]);
		// The same slot stamped for another id reads as no affix.
		expect(viewAffix(st, 0, a.id + 1)).toBe(AffixKind.NONE);
		expect(viewAffix(st, 0, a.id)).toBe(AffixKind.SWIFT);
		expect(viewAffix({}, 0, a.id)).toBe(AffixKind.NONE);
	});

	it("the chip shows `affix.<id>.name` in `affix.<id>` (every key a string of the placeholder pack)", () => {
		const pack = loadThemePack("placeholder", { warn: () => undefined });
		expect(affixChipKey(AffixKind.NONE)).toBe(undefined);
		expect(affixRoleOf(AffixKind.NONE)).toBe(undefined);
		expect(affixChipKey(AffixKind.SWIFT)).toBe("affix.swift.name");
		expect(affixRoleOf(AffixKind.VENGEFUL)).toBe("affix.vengeful");
		for (let k = 1; k <= AFFIX_KIND_COUNT; k++) {
			const id = AFFIX_IDS[k - 1];
			expect(affixIdOf(k)).toBe(id);
			expect(affixChipKey(k)).toBe(affixNameKey(id));
			expect(affixRoleOf(k)).toBe(affixRole(id));
			expect(pack.hasString(affixChipKey(k)!)).toBe(true);
		}
		expect(affixChipKey(AFFIX_KIND_COUNT + 1)).toBe(undefined);
	});

	it("chip and shield row sit on top of the bar's plate", () => {
		const g = { innerLeft: -6, innerW: 12, plateLeft: -7, plateW: 14, top: 20 };
		const row = shieldRowRect(g, 2, 4, createBarRect());
		expect([row.left, row.bottom, row.w, row.h]).toEqual([-6, 20, 6, AFFIX_VIEW.shieldRowPx]);
		expect(shieldRowRect(g, 0, 4, createBarRect()).w).toBe(0);
		expect(shieldRowRect(g, 0.01, 4, createBarRect()).w).toBe(1);
		const chip = affixChipRect(g, true, createBarRect());
		expect(chip.bottom).toBe(20 + AFFIX_VIEW.shieldRowPx + AFFIX_VIEW.chipGapPx);
		expect(chip.left + chip.w / 2).toBe(0); // centred over the bar
		expect(chip.w).toBe(math.max(AFFIX_VIEW.chipMinWidthPx, 14));
		expect(affixChipRect(g, false, createBarRect()).bottom).toBe(20 + AFFIX_VIEW.chipGapPx);
	});

	it("Hulking: drawn radius / data radius (1.2), snapped; plain actors 1", () => {
		const config: SimConfig = { ...DEFAULT_SIM_CONFIG, affixes: AFFIXES_CONFIG };
		const s = createSimState(7, 0, 0, config);
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		const hulk = spawnActor(ctx, archetypeIndex(BRUISER.id), 10, 0, AffixKind.HULKING)!;
		const plain = spawnActor(ctx, archetypeIndex(BRUISER.id), -10, 0, AffixKind.NONE)!;
		expect(affixDrawScale(hulk.radius, BRUISER.data.radius)).toBe(AFFIX_RULES.hulkingRadiusPercent / 100);
		expect(affixDrawScale(plain.radius, BRUISER.data.radius)).toBe(1);
		expect(affixDrawScale(0.42, 0.35)).toBe(1.2);
		expect(affixDrawScale(0.5, undefined)).toBe(1);
		expect(affixDrawScale(0.5, 0)).toBe(1);
		// Sprites: spriteScale only for the sets shared with a bigger sibling (slime.small), times the affix scale.
		expect(actorSpriteScale(SLIME_SMALL.id, SLIME_SMALL.data.spriteScale)).toBe(0.6);
		expect(actorSpriteScale(BRUISER.id, BRUISER.data.spriteScale)).toBe(1);
		expect(actorSpriteScale(BRUISER.id, BRUISER.data.spriteScale, 1.2)).toBe(1.2);
		const layout = { frameW: 64, frameH: 48, pivot: { x: 32, y: 40 }, pixelsPerTile: 32 };
		expect(scaledSpriteLayout(layout, 1)).toBe(layout);
		expect(scaledSpriteLayout(layout, 2).pixelsPerTile).toBe(16);
	});

	it("the floor ring is a closed polygon around the actor, no piece longer than ringPieceTiles", () => {
		const r = affixRingRadius(0.6);
		expect(r).toBe(0.6 + AFFIX_VIEW.ringMarginTiles);
		let longest = 0;
		let n = 0;
		let first: [number, number] | undefined;
		let last: [number, number] = [0, 0];
		affixRingSegments(
			{
				seg(x0, z0, x1, z1) {
					n++;
					if (first === undefined) first = [x0, z0];
					last = [x1, z1];
					longest = math.max(longest, math.sqrt((x1 - x0) ** 2 + (z1 - z0) ** 2));
					expect(math.sqrt((x1 - 2) ** 2 + (z1 - 3) ** 2)).toBeCloseTo(r, 9);
				},
			},
			2,
			3,
			r,
		);
		expect(n).toBe(affixRingPieces(r));
		expect(n).toBeGreaterThanOrEqual(AFFIX_VIEW.ringMinPieces);
		expect(longest).toBeLessThanOrEqual(AFFIX_VIEW.ringPieceTiles);
		expect(last[0]).toBeCloseTo(first![0], 9);
		expect(last[1]).toBeCloseTo(first![1], 9);
	});

	it("shield hits flash for shieldFlashTicks from the frame the shield went down; refills never flash", () => {
		const a = actor({ id: 9, kind: 2 });
		const slot = { affix: AffixKind.SHIELDED, actorId: 9, shield: 4, shieldMax: 4, vengeTicks: 0 };
		const st = { tick: 10, combat: { actors: [a] }, affixes: { slots: [slot] } };
		const w = new ShieldFlashWatch(4);
		w.update(st);
		expect(w.flashing(0, 9, 10)).toBe(false);
		slot.shield = 2;
		st.tick = 12;
		w.update(st);
		expect(w.flashing(0, 9, 12)).toBe(true);
		expect(w.flashing(0, 9, 12 + AFFIX_VIEW.shieldFlashTicks - 1)).toBe(true);
		expect(w.flashing(0, 9, 12 + AFFIX_VIEW.shieldFlashTicks)).toBe(false);
		expect(w.flashing(0, 8, 12)).toBe(false); // another actor
		slot.shield = 4;
		st.tick = 40;
		w.update(st);
		expect(w.flashing(0, 9, 40)).toBe(false);
	});
});

describe("affix looks", () => {
	it("a shield hit flashes 'shield' unless the hit flash shows; an armed Vengeful corpse pulses 'telegraph'", () => {
		expect(variantLook("normal", 1, false, true)).toBe("shield");
		expect(variantLook("telegraph", 1, false, true)).toBe("shield");
		expect(variantLook("flash", 1, false, true)).toBe("flash");
		expect(variantLook("normal", 1, false, false)).toBe("normal");
		expect(variantLook("normal", 0, true, false)).toBe("telegraph");
		expect(variantLook("normal", 0, false, true)).toBe("normal");
		expect(variantLook("normal", 1, true, false)).toBe("normal"); // the pulse is a corpse's
	});
});

describe("Vengeful corpse (EVD16)", () => {
	it("is drawn as long as the sim holds it, opaque but for the last fade ticks", () => {
		const v = vengefulCorpseView(CORPSE_TICKS, AFFIX_RULES.vengefulTelegraphTicks, AFFIX_VIEW.vengefulFadeTicks);
		expect(v.corpseTicks).toBe(AFFIX_RULES.vengefulTelegraphTicks + 1);
		const opaqueUntil = v.corpseTicks - AFFIX_VIEW.vengefulFadeTicks;
		for (let d = 0; d <= opaqueUntil; d++) expect(corpseTransparency(0, d, v.corpseTicks, v.fadeFrom)).toBe(0);
		expect(corpseTransparency(0, AFFIX_RULES.vengefulTelegraphTicks, v.corpseTicks, v.fadeFrom)).toBeLessThan(1);
		// A long base corpse keeps its own length.
		expect(vengefulCorpseView(90, 36, 8).corpseTicks).toBe(90);
	});

	it("an armed corpse is never fully transparent in a real run, and the pulse ends when the ring fires", () => {
		const config: SimConfig = { ...DEFAULT_SIM_CONFIG, affixes: AFFIXES_CONFIG };
		const s = createSimState(7, 0, 0, config);
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		const a = spawnActor(ctx, archetypeIndex(SWARMER.id), 5, 0, AffixKind.VENGEFUL)!;
		const id = a.id;
		ctx.killActor(a);
		const v = vengefulCorpseView(CORPSE_TICKS, AFFIX_RULES.vengefulTelegraphTicks, AFFIX_VIEW.vengefulFadeTicks);
		let armedStates = 0;
		for (let t = 0; t < 120; t++) {
			const c = s.combat.actors[0];
			if (c.kind === NO_KIND || c.id !== id) break;
			if (vengefulArmed(s, 0, id)) {
				armedStates++;
				expect(corpseTransparency(c.alive, c.deadTicks, v.corpseTicks, v.fadeFrom)).toBeLessThan(1);
			}
			step(s, EMPTY_INPUT, config);
		}
		expect(armedStates).toBeGreaterThanOrEqual(AFFIX_RULES.vengefulTelegraphTicks);
		expect(vengefulArmed(s, 0, id)).toBe(false);
	});
});

describe("goo (EVD5)", () => {
	it("splits the pools by payload kind: GOO to the decal pool, everything else (and goo with the decal off) normal", () => {
		const goo = BulletPayload.pack({ damage: 2, kind: BulletKind.GOO });
		expect(isGooPayload(goo)).toBe(true);
		expect(enemyBulletPool(goo, true)).toBe("goo");
		expect(enemyBulletPool(goo, false)).toBe("enemy");
		expect(enemyBulletPool(goo)).toBe(GOO_VIEW.decal ? "goo" : "enemy");
		for (const kind of [BulletKind.ENEMY, BulletKind.SNIPER, BulletKind.SPRAYER]) {
			const p = BulletPayload.pack({ damage: 2, kind });
			expect(isGooPayload(p)).toBe(false);
			expect(enemyBulletPool(p, true)).toBe("enemy");
		}
	});

	it("a real Ooze's puddles all go to the decal pool", () => {
		const config: SimConfig = { encounter: enc(SLIME.id, 0, 5) };
		const s = createSimState(3, 0, 0, config);
		ghost(s);
		let goo = 0;
		for (let t = 0; t < 240; t++) {
			step(s, EMPTY_INPUT, config);
			const b = s.combat.enemyBullets;
			for (let i = 0; i < b.highWater(); i++) {
				if (!b.isLive(i)) continue;
				expect(enemyBulletPool(b.payloadAt(i), true)).toBe("goo");
				goo++;
			}
		}
		expect(goo).toBeGreaterThan(0);
	});

	it("pops in over popSec and fades over the last fadeSec", () => {
		const total = SLIME.data.goo.life;
		const out: GooLook = { scale: 0, transparency: 0 };
		expect(gooDecalLook(total, total, out).scale).toBe(0);
		expect(gooDecalLook(total - GOO_VIEW.popSec / 2, total, out).scale).toBeCloseTo(0.5, 9);
		expect(gooDecalLook(total - GOO_VIEW.popSec, total, out).scale).toBe(1);
		expect(gooDecalLook(total / 2, total, out).transparency).toBe(0);
		expect(gooDecalLook(GOO_VIEW.fadeSec / 2, total, out).transparency).toBeCloseTo(0.5, 9);
		expect(gooDecalLook(0, total, out).transparency).toBe(1);
	});
});

describe("imp blink puffs", () => {
	it("reports each landing once, from where it stood to where it landed", () => {
		const config: SimConfig = { encounter: enc(IMP.id, 0, 6) };
		const s = createSimState(11, 0, 0, config);
		ghost(s);
		const a = s.combat.actors[0];
		const w = new BlinkWatch(8);
		const kind = archetypeIndex(IMP.id);
		let puffs = 0;
		let lastX = a.x;
		let lastZ = a.z;
		let destX = 0;
		let destZ = 0;
		for (let t = 0; t < 900; t++) {
			step(s, EMPTY_INPUT, config);
			if (a.aiState === AiState.TELEGRAPH && a.attack === IMP_ATTACK_BLINK) {
				destX = a.v[IMP_DEST_X];
				destZ = a.v[IMP_DEST_Z];
			}
			// Render a frame every other tick (frames step several ticks too).
			if (t % 2 === 0) {
				const n = w.update(s, kind);
				for (let i = 0; i < n; i++) {
					const p = w.at(i);
					expect([p.toX, p.toZ]).toEqual([destX, destZ]);
					expect([p.toX, p.toZ]).toEqual([a.x, a.z]);
					expect([p.fromX, p.fromZ]).toEqual([lastX, lastZ]);
					puffs++;
				}
				lastX = a.x;
				lastZ = a.z;
			}
		}
		expect(puffs).toBeGreaterThanOrEqual(3);
	});
});
