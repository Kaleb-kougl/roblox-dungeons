/**
 * A frame's build effects (docs/BUILDS.md BU8, "Presentation feed"). The sim's BuildEvents (shared/sim builds.ts) are
 * per TICK, cleared at the start of every tick and NOT hashed: one entry per spark hop that hit (`sparkX1/Z1/X2/Z2`,
 * owner, gen), per Volatile ring and per Soul Shards volley that spawned at least one bullet (corpse, owner, gen,
 * bullets fired), per evolution / duo taken. A rendered frame may run several ticks, so the run views (shared/play
 * LiveRun, shared/lockstep LockstepClient) `reset` this at the start of every frame and `collect` after every tick, as
 * they do NearMissEvents. BuildFxDirector (buildFxRules.ts) and the audio cue mapper read it once per frame.
 *
 *   - Every record carries `tick`: state.tick at the end of the tick that produced it.
 *   - Embers (Fire Arrows / Blazing Trail, BU6) have no feed entry: an ember is a stationary player bullet of
 *     BulletKind.EMBER, so a slot of that kind whose life left went UP since the last tick (or that held no ember) is a
 *     new one (its position, owner = emitter - 1, gen from its source): an ember's life only falls, a reused slot's
 *     jumps back to the full life. This per-slot memory spans frames (not reset per frame; a new simulation clears it).
 *   - Novas and executes (BU5) read the plan's field names (`novaX/Z/Radius/Owner/Kind`, `execX/Z`) when the sim's
 *     BuildEvents carries them (PendingBuildEventFields); until then they collect nothing. The Jackpot pop has no
 *     documented field yet: `jackpots` stays empty (a data slot the director already handles).
 *   - Runs without builds (`state.builds === undefined`: M1, the tutorial, fixtures) collect nothing: no tick, no record.
 *
 * Read-only on the sim. No allocation in steady state (records come from pools that only grow). Presentation only.
 */
import {
	BulletKind,
	BulletPayload,
	playerBulletOwner,
	sourceGen,
	type BuildEvents,
	type BulletSimulation,
	type SimState,
} from "shared/sim";

/**
 * The evolution feed fields the plan names (docs/BUILDS.md Architecture 4) that BU5 adds to BuildEvents. Read
 * optionally so this view works before and after that merge; once the sim declares them they are plain BuildEvents
 * fields and this cast is a no-op.
 */
interface PendingBuildEventFields {
	readonly novaX?: ReadonlyArray<number>;
	readonly novaZ?: ReadonlyArray<number>;
	readonly novaRadius?: ReadonlyArray<number>;
	readonly novaOwner?: ReadonlyArray<number>;
	readonly novaKind?: ReadonlyArray<number>;
	readonly execX?: ReadonlyArray<number>;
	readonly execZ?: ReadonlyArray<number>;
}

/** One spark hop: from (x1, z1) to the target at (x2, z2). */
export interface SparkRecord {
	readonly x1: number;
	readonly z1: number;
	readonly x2: number;
	readonly z2: number;
	readonly owner: number;
	readonly gen: number;
	readonly tick: number;
}

/** A Volatile ring, a Soul Shards volley, an ember dropped or a nova: where, whose, which generation. */
export interface EffectRecord {
	readonly x: number;
	readonly z: number;
	readonly owner: number;
	readonly gen: number;
	/** Bullets spawned (burst / shard), 1 for an ember, the radius in sim units for a nova. */
	readonly amount: number;
	/** The nova's kind (sim novaKind); 0 for every other record. */
	readonly kind: number;
	readonly tick: number;
}

/** An evolution or duo taken: the player and the boon / duo index. */
export interface TakeRecord {
	readonly player: number;
	readonly index: number;
	readonly tick: number;
}

/** An execute (Executioner): where the enemy died. */
export interface ExecuteRecord {
	readonly x: number;
	readonly z: number;
	readonly tick: number;
}

/** What the views read once per frame (BuildFxEvents satisfies it). */
export interface BuildFxFrameSource {
	/** Builds ticks collected this frame. */
	readonly ticks: number;
	readonly sparks: ReadonlyArray<SparkRecord>;
	readonly bursts: ReadonlyArray<EffectRecord>;
	readonly shards: ReadonlyArray<EffectRecord>;
	readonly embers: ReadonlyArray<EffectRecord>;
	readonly novas: ReadonlyArray<EffectRecord>;
	readonly executes: ReadonlyArray<ExecuteRecord>;
	/** Jackpot pops (no sim field yet: always empty). */
	readonly jackpots: ReadonlyArray<EffectRecord>;
	readonly evolved: ReadonlyArray<TakeRecord>;
	readonly duos: ReadonlyArray<TakeRecord>;
}

interface SparkSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	gen: number;
	tick: number;
}

interface EffectSlot {
	x: number;
	z: number;
	owner: number;
	gen: number;
	amount: number;
	kind: number;
	tick: number;
}

interface TakeSlot {
	player: number;
	index: number;
	tick: number;
}

interface ExecuteSlot {
	x: number;
	z: number;
	tick: number;
}

/** A pooled list: `items` holds the first size() of `pool`. */
class Pooled<T extends defined> {
	readonly items: T[] = [];
	private readonly pool: T[] = [];

	constructor(private readonly make: () => T) {}

	clear(): void {
		this.items.clear();
	}

	push(): T {
		const n = this.items.size();
		let r = this.pool[n];
		if (r === undefined) {
			r = this.make();
			this.pool.push(r);
		}
		this.items.push(r);
		return r;
	}
}

const newEffect = (): EffectSlot => ({ x: 0, z: 0, owner: 0, gen: 0, amount: 0, kind: 0, tick: 0 });
const newTake = (): TakeSlot => ({ player: 0, index: 0, tick: 0 });

/** True for a payload of BulletKind.EMBER. */
export function isEmberPayload(payload: number): boolean {
	return BulletPayload.get(payload, "kind") === BulletKind.EMBER;
}

/** The build effects of every tick a frame ran. */
export class BuildFxEvents implements BuildFxFrameSource {
	ticks = 0;
	private readonly sparkList = new Pooled<SparkSlot>(() => ({
		x1: 0,
		z1: 0,
		x2: 0,
		z2: 0,
		owner: 0,
		gen: 0,
		tick: 0,
	}));
	private readonly burstList = new Pooled<EffectSlot>(newEffect);
	private readonly shardList = new Pooled<EffectSlot>(newEffect);
	private readonly emberList = new Pooled<EffectSlot>(newEffect);
	private readonly novaList = new Pooled<EffectSlot>(newEffect);
	private readonly jackpotList = new Pooled<EffectSlot>(newEffect);
	private readonly executeList = new Pooled<ExecuteSlot>(() => ({ x: 0, z: 0, tick: 0 }));
	private readonly evolvedList = new Pooled<TakeSlot>(newTake);
	private readonly duoList = new Pooled<TakeSlot>(newTake);
	/** Per player bullet slot: the ember life seen last tick (0: no ember there), and the simulation it belongs to. */
	private readonly emberLife: number[] = [];
	private emberSim: BulletSimulation | undefined;

	readonly sparks: ReadonlyArray<SparkRecord> = this.sparkList.items;
	readonly bursts: ReadonlyArray<EffectRecord> = this.burstList.items;
	readonly shards: ReadonlyArray<EffectRecord> = this.shardList.items;
	readonly embers: ReadonlyArray<EffectRecord> = this.emberList.items;
	readonly novas: ReadonlyArray<EffectRecord> = this.novaList.items;
	readonly jackpots: ReadonlyArray<EffectRecord> = this.jackpotList.items;
	readonly executes: ReadonlyArray<ExecuteRecord> = this.executeList.items;
	readonly evolved: ReadonlyArray<TakeRecord> = this.evolvedList.items;
	readonly duos: ReadonlyArray<TakeRecord> = this.duoList.items;

	/** A new frame: forget the last one's records. */
	reset(): void {
		this.ticks = 0;
		this.sparkList.clear();
		this.burstList.clear();
		this.shardList.clear();
		this.emberList.clear();
		this.novaList.clear();
		this.jackpotList.clear();
		this.executeList.clear();
		this.evolvedList.clear();
		this.duoList.clear();
	}

	/** Every record of this frame (0: nothing happened). */
	count(): number {
		return (
			this.sparks.size() +
			this.bursts.size() +
			this.shards.size() +
			this.embers.size() +
			this.novas.size() +
			this.jackpots.size() +
			this.executes.size() +
			this.evolved.size() +
			this.duos.size()
		);
	}

	/** After every tick. No-op without builds. */
	collect(state: Readonly<SimState>): void {
		const b = state.builds;
		if (b === undefined) return;
		const e = b.events;
		const tick = state.tick;
		this.ticks += 1;
		for (let i = 0; i < e.sparkX1.size(); i++) {
			const r = this.sparkList.push();
			r.x1 = e.sparkX1[i];
			r.z1 = e.sparkZ1[i];
			r.x2 = e.sparkX2[i];
			r.z2 = e.sparkZ2[i];
			r.owner = e.sparkOwner[i];
			r.gen = e.sparkGen[i];
			r.tick = tick;
		}
		for (let i = 0; i < e.burstX.size(); i++) {
			effect(
				this.burstList.push(),
				e.burstX[i],
				e.burstZ[i],
				e.burstOwner[i],
				e.burstGen[i],
				e.burstFired[i],
				tick,
			);
		}
		for (let i = 0; i < e.shardX.size(); i++) {
			effect(
				this.shardList.push(),
				e.shardX[i],
				e.shardZ[i],
				e.shardOwner[i],
				e.shardGen[i],
				e.shardFired[i],
				tick,
			);
		}
		for (let i = 0; i < e.evolvedPlayer.size(); i++)
			take(this.evolvedList.push(), e.evolvedPlayer[i], e.evolvedBoon[i], tick);
		for (let i = 0; i < e.duoPlayer.size(); i++) take(this.duoList.push(), e.duoPlayer[i], e.duoTaken[i], tick);
		this.collectPending(e, tick);
		this.collectEmbers(state, tick);
	}

	/** BU5's novas and executes, when the sim's feed has them (see PendingBuildEventFields). */
	private collectPending(events: Readonly<BuildEvents>, tick: number): void {
		const e = events as unknown as PendingBuildEventFields;
		const nx = e.novaX;
		if (nx !== undefined) {
			for (let i = 0; i < nx.size(); i++) {
				const r = effect(
					this.novaList.push(),
					nx[i],
					e.novaZ?.[i] ?? 0,
					e.novaOwner?.[i] ?? 0,
					0,
					e.novaRadius?.[i] ?? 0,
					tick,
				);
				r.kind = e.novaKind?.[i] ?? 0;
			}
		}
		const ex = e.execX;
		if (ex !== undefined) {
			for (let i = 0; i < ex.size(); i++) {
				const r = this.executeList.push();
				r.x = ex[i];
				r.z = e.execZ?.[i] ?? 0;
				r.tick = tick;
			}
		}
	}

	/** Embers spawned this tick (see the file comment). */
	private collectEmbers(state: Readonly<SimState>, tick: number): void {
		const sim = state.combat.playerBullets;
		const seen = this.emberLife;
		if (sim !== this.emberSim) {
			this.emberSim = sim;
			for (let i = 0; i < seen.size(); i++) seen[i] = 0;
		}
		const n = sim.highWater();
		while (seen.size() < n) seen.push(0);
		for (let i = 0; i < seen.size(); i++) {
			const payload = i < n && sim.isVisible(i) ? sim.payloadAt(i) : -1;
			if (payload < 0 || !isEmberPayload(payload)) {
				seen[i] = 0;
				continue;
			}
			const life = sim.lifeAt(i);
			const last = seen[i];
			seen[i] = life;
			if (life <= last) continue;
			const p = sim.positionAt(i);
			effect(
				this.emberList.push(),
				p.x,
				p.z,
				playerBulletOwner(sim.emitterIdAt(i)),
				sourceGen(BulletPayload.get(payload, "source")),
				1,
				tick,
			);
		}
	}
}

function effect(
	r: EffectSlot,
	x: number,
	z: number,
	owner: number,
	gen: number,
	amount: number,
	tick: number,
): EffectSlot {
	r.x = x;
	r.z = z;
	r.owner = owner;
	r.gen = gen;
	r.amount = amount;
	r.kind = 0;
	r.tick = tick;
	return r;
}

function take(r: TakeSlot, player: number, index: number, tick: number): void {
	r.player = player;
	r.index = index;
	r.tick = tick;
}

const EMPTY_SPARKS = table.freeze([] as SparkRecord[]);
const EMPTY_EFFECTS = table.freeze([] as EffectRecord[]);
const EMPTY_TAKES = table.freeze([] as TakeRecord[]);
const EMPTY_EXECUTES = table.freeze([] as ExecuteRecord[]);

/** No build effects (no run, no builds, or audibleBuilds while quiet). Frozen. */
export const NO_BUILD_FX_EVENTS: BuildFxFrameSource = table.freeze({
	ticks: 0,
	sparks: EMPTY_SPARKS,
	bursts: EMPTY_EFFECTS,
	shards: EMPTY_EFFECTS,
	embers: EMPTY_EFFECTS,
	novas: EMPTY_EFFECTS,
	executes: EMPTY_EXECUTES,
	jackpots: EMPTY_EFFECTS,
	evolved: EMPTY_TAKES,
	duos: EMPTY_TAKES,
});

/**
 * The builds source the audio mapper reads: `source` as is, or NO_BUILD_FX_EVENTS while `quiet` (comboQuiet: the stage
 * cover, run over), like audibleVariantCues.
 */
export function audibleBuilds(source: BuildFxFrameSource, quiet: boolean): BuildFxFrameSource {
	return quiet ? NO_BUILD_FX_EVENTS : source;
}
