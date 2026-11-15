/**
 * The actor pool and the generic actor rules (E1.8; source: `src/sim/actors/actors.ts`): spawning into slots, the
 * per-tick loop that drives archetypes, damage (with the per-second cap), death, corpses, contact damage, hashing.
 * Archetype code calls these through SimCtx (ctx.spawnActor, ctx.damageActor, ...).
 *
 * Pool (CombatState.actors): an array that grows up to MAX_ACTORS slots and never shrinks within a run. A spawn takes
 * the LOWEST-index free slot (kind === NO_KIND), else appends a new slot, else (pool full) returns undefined and
 * counts CombatState.actorsDropped. Slots are freed when a corpse times out (ArchetypeData.corpseTicks, default
 * CORPSE_TICKS) or on ctx.freeActor. Everything is in slot order, so the reuse order is deterministic.
 */

import {
	CORPSE_TICKS,
	DAMAGE_CAP_BUCKETS,
	DAMAGE_CAP_BUCKET_TICKS,
	DAMAGE_CAP_WINDOW_SECONDS,
	HIT_FLASH_TICKS,
	MAX_ACTORS,
} from "../combatData";
import { PLAYER_RADIUS } from "../../playerData";
import { SQRT1_2 } from "../../jsnum";
import { endlessActorHp } from "../../endlessData";
import { tutorialBossHp, tutorialHeldDamage, tutorialScalingFloor } from "../../tutorial/tutorial";
import { partyHpMultiplier } from "../../partyData";
import { partySize, playerAt } from "../../party";
import type { SimCtx } from "../ctx";
import { archetypeAt } from "./registry";
import { scoreDamageDealt, scoreKill } from "../../score/score";
import { runOnKill } from "../../progression/runMods";
import { dropsOnKill } from "../../drops/drops";
import { affixAbsorb, affixHoldsCorpse, affixesOnFree, affixesOnKill, affixesOnSpawn } from "../../affixes/affixes";
import { buildsOnKill } from "../../builds/procs";
import { buildsExecute, buildsKillCarry } from "../../builds/execute";
import { buildsOnOvercap } from "../../builds/overcap";
import { ACTOR_HASH_FIELDS, ACTOR_SCRATCH_SLOTS, AiState, NO_KIND, type ActorState } from "./types";

function zeros(n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(0);
	return out;
}

/** A free slot (kind NO_KIND, capBucket -1, everything else 0). */
export function createFreeActor(): ActorState {
	return {
		id: 0,
		kind: NO_KIND,
		spawnTick: 0,
		x: 0,
		z: 0,
		prevX: 0,
		prevZ: 0,
		faceX: 0,
		faceZ: 0,
		hp: 0,
		hpMax: 0,
		radius: 0,
		alive: 0,
		deadTicks: 0,
		aiState: 0,
		aiTicks: 0,
		attack: 0,
		cooldown: 0,
		flashTicks: 0,
		emitterId: 0,
		phase: 0,
		capBucket: -1,
		capWindow: zeros(DAMAGE_CAP_BUCKETS),
		v: zeros(ACTOR_SCRATCH_SLOTS),
	};
}

export function cloneActor(a: Readonly<ActorState>): ActorState {
	return { ...a, capWindow: [...a.capWindow], v: [...a.v] };
}

/** True for a slot holding an actor (alive or a corpse). */
export function isActorPresent(a: Readonly<ActorState>): boolean {
	return a.kind !== NO_KIND;
}

function fill(arr: number[], v: number): void {
	for (let k = 0; k < arr.size(); k++) arr[k] = v;
}

function clearActor(a: ActorState): void {
	a.id = 0;
	a.kind = NO_KIND;
	a.spawnTick = 0;
	a.x = 0;
	a.z = 0;
	a.prevX = 0;
	a.prevZ = 0;
	a.faceX = 0;
	a.faceZ = 0;
	a.hp = 0;
	a.hpMax = 0;
	a.radius = 0;
	a.alive = 0;
	a.deadTicks = 0;
	a.aiState = AiState.IDLE;
	a.aiTicks = 0;
	a.attack = 0;
	a.cooldown = 0;
	a.flashTicks = 0;
	a.emitterId = 0;
	a.phase = 0;
	a.capBucket = -1;
	fill(a.capWindow, 0);
	fill(a.v, 0);
}

/**
 * Spawns archetype index `kind` at (x, z); see SimCtx.spawnActor. `affix` (shared/dungeon AffixKind; elite affixes,
 * docs/ENEMY_VARIANTS.md EV7): only the endless room spawn path passes one; it is stamped (affixes.ts affixesOnSpawn:
 * Hulking hp / radius, the shield) BEFORE def.init, so init's first cooldown draw already sees Swift. Without
 * state.affixes it is ignored.
 */
export function spawnActor(ctx: SimCtx, kind: number, x: number, z: number, affix = 0): ActorState | undefined {
	const c = ctx.combat;
	const actors = c.actors;
	const def = archetypeAt(kind); // throws before touching the pool for a bad kind
	let a: ActorState | undefined;
	let slot = -1;
	for (let i = 0; i < actors.size(); i++) {
		if (actors[i].kind === NO_KIND) {
			a = actors[i];
			slot = i;
			break;
		}
	}
	if (a === undefined) {
		if (actors.size() >= MAX_ACTORS) {
			c.actorsDropped += 1;
			return undefined;
		}
		a = createFreeActor();
		actors.push(a);
		slot = actors.size() - 1;
	}
	const d = def.data;
	a.id = c.nextActorId;
	c.nextActorId += 1;
	a.kind = kind;
	a.spawnTick = ctx.tick;
	a.x = x;
	a.z = z;
	a.prevX = x;
	a.prevZ = z;
	// Face the camera (screen-down) until the archetype turns it.
	a.faceX = SQRT1_2;
	a.faceZ = SQRT1_2;
	// Endless mode (Roblox port): hp scaled by the floor and Depth at the moment of the spawn (bosses: Depth only),
	// then (co-op, M4) by the party size (bosses too), then (a tutorial boss) by the tutorial's boss hp percent.
	const endless = ctx.state.endless;
	let hp =
		endless !== undefined
			? endlessActorHp(d.hp, d.boss === true, tutorialScalingFloor(ctx.state, endless.floor), endless.depth)
			: d.hp;
	if (endless !== undefined && ctx.state.party !== undefined) hp *= partyHpMultiplier(ctx.state.party.size);
	// The tutorial's practice boss (docs/TUTORIAL.md): bossHpPercent of that (exactly hp outside a tutorial run).
	if (d.boss === true) hp = tutorialBossHp(ctx.state, hp);
	a.hp = hp;
	a.hpMax = hp;
	a.radius = d.radius;
	a.alive = 1;
	a.emitterId = c.enemyBullets.acquireEmitter();
	c.enemyEmitters += 1;
	ctx.events.actorsSpawned += 1;
	// Elite affixes (opt-in): the slot's affix entry follows the pool; a planned room spawn's affix is stamped here.
	if (ctx.state.affixes !== undefined) affixesOnSpawn(ctx.state, slot, a, affix);
	if (def.init !== undefined) def.init(ctx, a);
	return a;
}

/**
 * Books `dmg` against the actor's per-second cap (budget cap x DAMAGE_CAP_WINDOW_SECONDS per window); returns how much
 * may land. Ticks are never negative, so Luau's floored `%` equals the source's `((b % n) + n) % n` / `b % n`.
 */
function applyDamageCap(a: ActorState, tick: number, dmg: number, cap: number): number {
	const n = DAMAGE_CAP_BUCKETS;
	const bucket = math.floor(tick / DAMAGE_CAP_BUCKET_TICKS);
	if (a.capBucket !== bucket) {
		// Clear the buckets we moved through since the last write (all of them after a long pause).
		const gap = a.capBucket < 0 ? n : math.min(n, bucket - a.capBucket);
		for (let k = 0; k < gap; k++) a.capWindow[(((bucket - k) % n) + n) % n] = 0;
		a.capBucket = bucket;
	}
	let taken = 0;
	for (let k = 0; k < n; k++) taken += a.capWindow[k];
	const room = cap * DAMAGE_CAP_WINDOW_SECONDS - taken;
	if (room <= 0) return 0;
	const applied = dmg < room ? dmg : room;
	a.capWindow[bucket % n] += applied;
	return applied;
}

/** Damages a live actor; see SimCtx.damageActor. Returns the hp removed. */
export function damageActor(ctx: SimCtx, a: ActorState, amount: number): number {
	if (a.kind === NO_KIND || a.alive === 0 || !(amount > 0)) return 0;
	const def = archetypeAt(a.kind);
	const ev = ctx.events;
	ev.enemyHits += 1;
	let dmg = def.filterDamage !== undefined ? def.filterDamage(ctx, a, amount) : amount;
	if (!(dmg > 0)) dmg = 0;
	// Elite affixes (opt-in): a Shielded actor's shield takes its share after filterDamage, before the cap.
	if (dmg > 0 && ctx.state.affixes !== undefined) dmg = affixAbsorb(ctx.state, a, dmg);
	const cap = def.data.damageCapPerSecond;
	const uncapped = dmg;
	if (cap !== undefined && dmg > 0) dmg = applyDamageCap(a, ctx.tick, dmg, cap);
	// Builds v2 (docs/BUILDS_V2.md BV9, opt-in): the damage the cap dropped pays overcap points to the hitter.
	if (dmg < uncapped && ctx.state.builds !== undefined) buildsOnOvercap(ctx, a, uncapped - dmg);
	// Builds (docs/LEGENDARIES.md LG2): Overkill's carry reads the hit as it is here (after the cap, before Executioner,
	// LGD3) and the hp it met.
	const hit = dmg;
	const hpBefore = a.hp;
	// Builds (docs/BUILDS.md BU5, opt-in): Executioner turns a hit that leaves a non-boss enemy at <= 20 % into a kill.
	if (ctx.state.builds !== undefined && dmg > 0) dmg = buildsExecute(ctx, a, def, dmg);
	const executed = dmg !== hit;
	if (dmg > a.hp) dmg = a.hp; // overkill does not count
	if (dmg > 0) {
		// The tutorial's block lesson (tutorial.ts guard lock): a held actor keeps TUTORIAL_GUARD_HOLD_HP until a block.
		// The hit still flashes; exactly dmg in every other run.
		if (ctx.state.tutorial !== undefined) dmg = tutorialHeldDamage(ctx.state, a, dmg);
		a.hp -= dmg;
		ev.damageDealt += dmg;
		// Run contribution (docs/RUN_CONTRIBUTION.md CT2, scored runs): the same dmg, credited to the bound player (CT0:
		// every damageActor caller binds the damaging player). Unhashed feed, never read back; a tutorial hold that removed
		// nothing records nothing.
		if (dmg > 0) scoreDamageDealt(ctx.state, ctx.playerIndex, dmg, def.data.boss === true ? 1 : 0);
		if (a.hp > 0) a.flashTicks = HIT_FLASH_TICKS;
	}
	if (def.onHit !== undefined) def.onHit(ctx, a, dmg);
	if (a.alive !== 0 && a.hp <= 0) {
		// Builds (docs/BUILDS.md BU3, opt-in): a kill by player damage queues its proc (never a revive or the dummy).
		// Its Overkill carry (LG2) rides along in the transient ctx.killCarry, 0 again right after.
		if (ctx.state.builds !== undefined) {
			ctx.killCarry = buildsKillCarry(ctx, a, def, hit, hpBefore, executed);
			buildsOnKill(ctx, a, def);
			ctx.killCarry = 0;
		}
		killActor(ctx, a);
	}
	return dmg;
}

/**
 * Kills a live actor; see SimCtx.killActor. `quiet` (docs/NEW_ENEMIES.md NE2: the Bomber's own detonation) is a death
 * nobody earned: events and onDeath only. No score (no points, no combo), no Vampire Fang, no drop roll and no Vengeful
 * ring; a guaranteed drop room still counts the member as gone (dropsOnKill's reviver path: the guard step, never the
 * roll). Builds never proc here either way (damageActor's kill line does). The score room sees it dead (alive 0) as
 * usual.
 */
export function killActor(ctx: SimCtx, a: ActorState, quiet = false): void {
	if (a.kind === NO_KIND || a.alive === 0) return;
	a.alive = 0;
	a.hp = 0;
	a.deadTicks = 0;
	a.flashTicks = 0;
	ctx.events.actorsKilled += 1;
	ctx.events.enemiesKilled += 1;
	const def = archetypeAt(a.kind);
	if (quiet) {
		if (ctx.state.drops !== undefined) dropsOnKill(ctx, a, true);
	} else {
		// M2 scoring (opt-in), before onDeath's own kills. The killer is the bound player (ctx.playerIndex: the bullet's
		// owner or the swinging player; solo: 0) for Bounty and Vampire Fang.
		if (ctx.state.score !== undefined) scoreKill(ctx.state, a, ctx.playerIndex);
		// M2 Vampire Fang (endless runs): reviving archetypes (turrets) never count.
		if (ctx.state.run !== undefined) runOnKill(ctx.state, ctx.playerIndex, def.stepDead !== undefined);
		// Boost drops (docs/BOOSTS.md, opt-in): the kill may drop a boost (its own rng stream), before onDeath's own kills.
		if (ctx.state.drops !== undefined) dropsOnKill(ctx, a, def.stepDead !== undefined);
		// Elite affixes (opt-in): a Vengeful corpse arms its ring (fired by stepAffixes).
		if (ctx.state.affixes !== undefined) affixesOnKill(ctx.state, a);
	}
	if (def.onDeath !== undefined) def.onDeath(ctx, a, quiet);
}

/** Revives a dead actor in place with full hp. */
export function reviveActor(a: ActorState): void {
	if (a.kind === NO_KIND) return;
	a.alive = 1;
	a.hp = a.hpMax;
	a.deadTicks = 0;
}

/** Frees the slot (no onDeath). Its in-flight bullets keep their emitter id and keep flying. */
export function freeActor(ctx: SimCtx, a: ActorState): void {
	if (a.kind === NO_KIND) return;
	ctx.combat.enemyBullets.releaseEmitter(a.emitterId);
	if (ctx.state.affixes !== undefined) affixesOnFree(ctx.state, a);
	clearActor(a);
}

/**
 * The actor phase of stepCombat: every present actor in slot order, except those spawned this tick.
 * prev = position; flash counts down; alive -> def.step; dead -> deadTicks += 1, then def.stepDead or the corpse timer (elite affixes: a Vengeful corpse whose ring is pending
 * is held past it, affixHoldsCorpse; never through def.stepDead, which marks a reviver).
 * A `while` loop: archetypes may append slots mid-loop (runtime spawns), and the bound must be re-read like JS does
 * (the new slots are skipped anyway: spawnTick === tick).
 */
export function stepActors(ctx: SimCtx): void {
	// The Warbanner aura (docs/NEW_ENEMIES.md NE6): one mask per tick from tick-start positions (empty without a banner).
	ctx.rebuildAura();
	// Siege Bolt (docs/BUILDS_V2.md BV4): actors a heavy arrow carries are held (empty without pins).
	ctx.rebuildPins();
	const actors = ctx.combat.actors;
	const tick = ctx.tick;
	// Co-op: each actor's hooks see its own target (the nearest living player) as ctx.player.
	const party = ctx.state.party !== undefined;
	const affixes = ctx.state.affixes !== undefined;
	let i = 0;
	while (i < actors.size()) {
		const slot = i;
		const a = actors[i];
		i++;
		if (a.kind === NO_KIND || a.spawnTick === tick) continue;
		a.prevX = a.x;
		a.prevZ = a.z;
		if (a.flashTicks > 0) a.flashTicks--;
		const def = archetypeAt(a.kind);
		if (party) ctx.targetNearest(a);
		if (a.alive !== 0) {
			// Siege Bolt (BV4): a pinned actor does not step (no walk, no attack, no timers).
			if (!ctx.isPinned(a)) def.step(ctx, a);
		} else {
			a.deadTicks++;
			if (def.stepDead !== undefined) def.stepDead(ctx, a);
			else if (
				a.deadTicks >= (def.data.corpseTicks ?? CORPSE_TICKS) &&
				!(affixes && affixHoldsCorpse(ctx.state, slot, a))
			)
				freeActor(ctx, a);
		}
	}
	if (party) ctx.actingPlayer(0);
}

/**
 * Contact damage: the first live actor (slot order) with contactDamage > 0 overlapping the player hurts them.
 * Co-op: the same for every living player, in player index order.
 */
export function stepContactDamage(ctx: SimCtx): void {
	const n = partySize(ctx.state);
	for (let k = 0; k < n; k++) contactDamageOn(ctx, k);
}

function contactDamageOn(ctx: SimCtx, k: number): void {
	const p = playerAt(ctx.state, k);
	if (p.dead !== 0) return;
	const actors = ctx.combat.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const dmg = archetypeAt(a.kind).data.contactDamage;
		if (dmg <= 0) continue;
		const r = a.radius + PLAYER_RADIUS;
		const dx = p.x - a.x;
		const dz = p.z - a.z;
		if (dx * dx + dz * dz >= r * r) continue;
		if (ctx.hurtPlayerAt(k, dmg, a.kind)) return; // landed: post-hit invulnerability ignores the rest anyway
	}
}

/** Hash fields of one actor slot, fixed order: ACTOR_HASH_FIELDS, capWindow, v. */
export function writeActorHash(a: Readonly<ActorState>, out: number[]): void {
	for (const f of ACTOR_HASH_FIELDS) out.push(a[f]);
	for (const n of a.capWindow) out.push(n);
	for (const n of a.v) out.push(n);
}

/** Dump names for writeActorHash of slot `slot`, same order (`actors[3].hp`, `actors[3].capWindow[0]`, ...). */
export function actorHashNames(a: Readonly<ActorState>, slot: number, out: string[]): void {
	const p = `actors[${slot}]`;
	for (const f of ACTOR_HASH_FIELDS) out.push(`${p}.${f}`);
	for (let k = 0; k < a.capWindow.size(); k++) out.push(`${p}.capWindow[${k}]`);
	for (let k = 0; k < a.v.size(); k++) out.push(`${p}.v[${k}]`);
}
