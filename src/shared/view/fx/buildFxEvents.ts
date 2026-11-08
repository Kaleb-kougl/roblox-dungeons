/**
 * A frame's build effects (docs/BUILDS.md BU8, "Presentation feed"; BU5's fields in "BU5 (as built)"). The sim's
 * BuildEvents (shared/sim builds.ts) are per TICK, cleared at the start of every tick and NOT hashed: one entry per spark
 * segment (hop or Storm Crown fork), per Volatile ring / Soul Shards volley, per evolution / duo taken, and BU5's novas,
 * Executioner kills, Phantom Step erases, Jackpot pays, Lionheart heals and the Momentum / Thrill Seeker / Flurry /
 * Ricochet releases, and BU6's embers and duo procs ("BU6 (as built)"). A rendered frame may run several ticks, so the run views (shared/play LiveRun, shared/lockstep
 * LockstepClient) `reset` this at the start of every frame and `collect` after every tick, as they do NearMissEvents.
 * BuildFxDirector (buildFxRules.ts), the audio cue mapper and the score pops read it once per frame.
 *
 *   - Every record carries `tick`: state.tick at the end of the tick that produced it.
 *   - EffectRecord's `amount` / `kind` per list: bursts / shards / momentum / thrills / flurries / ricochets the bullets
 *     spawned (momentum's kind the tier crossed, flurries' the FlurryKind); novas the radius in sim units (kind:
 *     NovaKind; NovaRecord adds the bullets erased); executes and phantoms 1; jackpots the points paid; heals the half
 *     hearts restored (owner = the healed player, x / z where they stood); embers 1 (kind: the Duo that dropped it,
 *     Fire Arrows / Blazing Trail); duoProcs the duo rule's value (kind: the Duo; Storm Blade / Conductor / Chain
 *     Reaction's spark: enemies struck; Chain Reaction's burst / Close Call: bullets spawned); goldRush the kill's
 *     points (the same x / z / points as that kill's score pop); unshaken 1 (x / z the player at the hit). `gen` is the
 *     proc generation for sparks / bursts / shards and 0 for every BU5 / BU6 record (embers and the duos' bullets are
 *     fired at generation 0; Chain Reaction's at genMax, which its record does not carry).
 *   - BU6's duoProc entries are split by duo: Gold Rush into `goldRush` (the score pops tint that kill's pop), Unshaken
 *     into `unshaken` (the shield glint on the player), every other duo (Storm Blade, Conductor, Chain Reaction, Close
 *     Call) into `duoProcs` (an origin flare). Their sparks and bullets are already ordinary spark segments / bursts /
 *     shards / effect bullets, drawn as such.
 *   - docs/LEGENDARIES.md LG6: one StreakRecord per Overkill streak that struck (`overkills`: the corpse, the target,
 *     owner, the proc generation, the carry dealt), and one EffectRecord per Bastion brace (`braces`: owner = the
 *     bracing player, x / z where they stood at collect, kind = BraceKind PIP / HEAL / SPENT, amount 1, gen 0).
 *     Supernova's and Skewer's duoProc entries go to `duoProcs` like BU6's (an origin flare; amount: Supernova's bolts,
 *     Skewer's enemies struck including the target).
 *   - docs/BUILDS_V2.md BV11 (builds v2, wave 1; BV1's BuildEvents lists as built): one WaveRecord per counter-wave
 *     spawned (`waves`: Riposte's FORWARD crescent, Counterstrike's RING, Rebuke's REBUKE ring; the origin, unit
 *     direction, half-angle cosine, range, speed, owner, damage, WaveKind and `count` = counterCount, the erases it
 *     answers); one BallistaRecord per burst (`ballistas`: amount = bolts spawned, kind = 1 a wall's back fan / 0 the last
 *     pierce's ring, dirX / dirZ the unit direction from the burst toward its archer where they stood at collect, the
 *     fan's facing as the view guesses it: the feed carries no flight direction; 0 / 0 when they coincide); Siege
 *     Bolt's `pinStarts` (actor slot, archer, where) and `pinEnds` (actor slot, archer, distance carried, slam); `slams`
 *     (EffectRecord: the slammed actor, owner, amount = enemies struck); Wrecker's `smashes` (the piece's cell centre,
 *     owner, gen = the smash's generation, amount = splinters spawned) and Demolition's `demolitions` (amount 1); Full
 *     Heart's `heartBeams` (BeamRecord: the line, owner, enemies struck); Happy Hour's `happyHours` (the drinking
 *     player); `overcaps` (EffectRecord: the boss, the hitter, amount = points paid). Thunder Guard's sparks are
 *     ordinary SparkRecords with `thunder` set (sparkFork SparkFork.THUNDER: from an erased bullet; never a `fork`).
 *     Rebuke has no list of its own (its rings are `waves` of kind REBUKE); Dragon Bolt's embers are `embers` of kind
 *     Duo.DRAGON_BOLT; Thunder Guard's and Powder Keg's duoProc entries go to `duoProcs` like BU6's (an origin flare).
 *   - Runs without builds (`state.builds === undefined`: M1, the tutorial, fixtures) collect nothing: no tick, no record.
 *
 * Read-only on the sim. No allocation in steady state (records come from pools that only grow). Presentation only.
 */
import { BulletKind, BulletPayload, Duo, SparkFork, playerAt, partySize, type SimState } from "shared/sim";

/** One spark segment: from (x1, z1) to the target at (x2, z2); `fork` a Storm Crown fork (from the hop's start). */
export interface SparkRecord {
	readonly x1: number;
	readonly z1: number;
	readonly x2: number;
	readonly z2: number;
	readonly owner: number;
	readonly gen: number;
	readonly fork: boolean;
	/** docs/BUILDS_V2.md BV11: a Thunder Guard spark (SparkFork.THUNDER: from an erased bullet to its target). */
	readonly thunder: boolean;
	readonly tick: number;
}

/** One Overkill streak (docs/LEGENDARIES.md LG2 / LG6): from the corpse (x1, z1) to the target at (x2, z2). */
export interface StreakRecord {
	readonly x1: number;
	readonly z1: number;
	readonly x2: number;
	readonly z2: number;
	readonly owner: number;
	/** The proc generation: 0 for the player's own kill, +1 per link of a chain. */
	readonly gen: number;
	/** The damage the streak dealt. */
	readonly carry: number;
	readonly tick: number;
}

/** One effect: where, whose, which generation, how much and which kind (see the file comment per list). */
export interface EffectRecord {
	readonly x: number;
	readonly z: number;
	readonly owner: number;
	readonly gen: number;
	readonly amount: number;
	readonly kind: number;
	readonly tick: number;
}

/** A nova (Overflowing / Bulwark): an EffectRecord (amount = radius, kind = NovaKind) and the bullets it erased. */
export interface NovaRecord extends EffectRecord {
	readonly erased: number;
}

/** An evolution or duo taken: the player and the boon / duo index. */
export interface TakeRecord {
	readonly player: number;
	readonly index: number;
	readonly tick: number;
}

/**
 * One counter-wave spawned (docs/BUILDS_V2.md BV2 / BV6, BV11): the BuildWave's numbers at its spawn, the erases it
 * answers (`count`, COUNTER xN) and the tick (the wave grew once on that tick: radius speed x SIM_DT at its end).
 */
export interface WaveRecord {
	readonly x: number;
	readonly z: number;
	/** Unit direction (the facing); a full ring's too. */
	readonly dirX: number;
	readonly dirZ: number;
	/** The cone's half-angle cosine (a full ring: below -1). */
	readonly halfCos: number;
	/** Where it ends and its growth, world units and units per second. */
	readonly range: number;
	readonly speed: number;
	readonly owner: number;
	readonly damage: number;
	/** WaveKind (FORWARD / RING / REBUKE). */
	readonly kind: number;
	/** counterCount: the guard's (or roll's) erases it answers. */
	readonly count: number;
	readonly tick: number;
}

/** A Ballista burst (BV3, BV11): an EffectRecord (amount = bolts, kind = 1 back fan / 0 ring) and a facing guess. */
export interface BallistaRecord extends EffectRecord {
	/** Unit direction from the burst toward its archer at collect (0 / 0 when they coincide or the archer is gone). */
	readonly dirX: number;
	readonly dirZ: number;
}

/** A Siege Bolt pin that started (BV4): the pinned actor's slot, the archer, where the actor was. */
export interface PinStartRecord {
	readonly slot: number;
	readonly owner: number;
	readonly x: number;
	readonly z: number;
	readonly tick: number;
}

/** A Siege Bolt pin that ended (BV4): the actor's slot, the archer, the distance carried (world units), a slam or not. */
export interface PinEndRecord {
	readonly slot: number;
	readonly owner: number;
	readonly carried: number;
	readonly slam: boolean;
	readonly tick: number;
}

/** A Full Heart beam (BV7): from the player (x1, z1) to the line's end (x2, z2), the owner, enemies struck. */
export interface BeamRecord {
	readonly x1: number;
	readonly z1: number;
	readonly x2: number;
	readonly z2: number;
	readonly owner: number;
	readonly struck: number;
	readonly tick: number;
}

/** A player and the tick (Happy Hour's drink, BV7). */
export interface PlayerTickRecord {
	readonly player: number;
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
	readonly novas: ReadonlyArray<NovaRecord>;
	readonly executes: ReadonlyArray<EffectRecord>;
	readonly phantoms: ReadonlyArray<EffectRecord>;
	readonly jackpots: ReadonlyArray<EffectRecord>;
	readonly heals: ReadonlyArray<EffectRecord>;
	readonly momentum: ReadonlyArray<EffectRecord>;
	readonly thrills: ReadonlyArray<EffectRecord>;
	readonly flurries: ReadonlyArray<EffectRecord>;
	readonly ricochets: ReadonlyArray<EffectRecord>;
	/** BU6: Storm Blade / Conductor / Chain Reaction / Close Call firing (kind: the Duo). */
	readonly duoProcs: ReadonlyArray<EffectRecord>;
	/** BU6: Gold Rush kills (amount: the kill's points). */
	readonly goldRush: ReadonlyArray<EffectRecord>;
	/** BU6: hits Unshaken kept off the combo (owner: the player hit). */
	readonly unshaken: ReadonlyArray<EffectRecord>;
	readonly evolved: ReadonlyArray<TakeRecord>;
	readonly duos: ReadonlyArray<TakeRecord>;
	/** LG6: Overkill streaks that struck. */
	readonly overkills: ReadonlyArray<StreakRecord>;
	/** LG6: Bastion braces (owner: the bracing player; kind: BraceKind). */
	readonly braces: ReadonlyArray<EffectRecord>;
	// --- docs/BUILDS_V2.md BV11 (builds v2, wave 1; see the file comment). ---
	/** Counter-waves spawned (Riposte, Counterstrike, Rebuke). */
	readonly waves: ReadonlyArray<WaveRecord>;
	/** Ballista bursts (kind 1 a back fan, 0 a ring; amount: bolts). */
	readonly ballistas: ReadonlyArray<BallistaRecord>;
	/** Siege Bolt pins that started / ended. */
	readonly pinStarts: ReadonlyArray<PinStartRecord>;
	readonly pinEnds: ReadonlyArray<PinEndRecord>;
	/** Siege Bolt slams (amount: enemies struck). */
	readonly slams: ReadonlyArray<EffectRecord>;
	/** Wrecker smashes (gen: the smash's generation; amount: splinters) and Demolition blasts. */
	readonly smashes: ReadonlyArray<EffectRecord>;
	readonly demolitions: ReadonlyArray<EffectRecord>;
	/** Full Heart beams. */
	readonly heartBeams: ReadonlyArray<BeamRecord>;
	/** Happy Hour drinks (the player whose timer started or restarted). */
	readonly happyHours: ReadonlyArray<PlayerTickRecord>;
	/** Overcap payouts (owner: the hitter; amount: points). */
	readonly overcaps: ReadonlyArray<EffectRecord>;
}

interface SparkSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	gen: number;
	fork: boolean;
	thunder: boolean;
	tick: number;
}

interface StreakSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	gen: number;
	carry: number;
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

interface NovaSlot extends EffectSlot {
	erased: number;
}

interface TakeSlot {
	player: number;
	index: number;
	tick: number;
}

interface WaveSlot {
	x: number;
	z: number;
	dirX: number;
	dirZ: number;
	halfCos: number;
	range: number;
	speed: number;
	owner: number;
	damage: number;
	kind: number;
	count: number;
	tick: number;
}

interface BallistaSlot extends EffectSlot {
	dirX: number;
	dirZ: number;
}

interface PinStartSlot {
	slot: number;
	owner: number;
	x: number;
	z: number;
	tick: number;
}

interface PinEndSlot {
	slot: number;
	owner: number;
	carried: number;
	slam: boolean;
	tick: number;
}

interface BeamSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	struck: number;
	tick: number;
}

interface PlayerTickSlot {
	player: number;
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

/** True for a payload of BulletKind.EMBER (the bullet renderer's ember decal pool). */
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
		fork: false,
		thunder: false,
		tick: 0,
	}));
	private readonly burstList = new Pooled<EffectSlot>(newEffect);
	private readonly shardList = new Pooled<EffectSlot>(newEffect);
	private readonly emberList = new Pooled<EffectSlot>(newEffect);
	private readonly novaList = new Pooled<NovaSlot>(() => ({ ...newEffect(), erased: 0 }));
	private readonly executeList = new Pooled<EffectSlot>(newEffect);
	private readonly phantomList = new Pooled<EffectSlot>(newEffect);
	private readonly jackpotList = new Pooled<EffectSlot>(newEffect);
	private readonly healList = new Pooled<EffectSlot>(newEffect);
	private readonly momentumList = new Pooled<EffectSlot>(newEffect);
	private readonly thrillList = new Pooled<EffectSlot>(newEffect);
	private readonly flurryList = new Pooled<EffectSlot>(newEffect);
	private readonly ricochetList = new Pooled<EffectSlot>(newEffect);
	private readonly duoProcList = new Pooled<EffectSlot>(newEffect);
	private readonly goldRushList = new Pooled<EffectSlot>(newEffect);
	private readonly unshakenList = new Pooled<EffectSlot>(newEffect);
	private readonly evolvedList = new Pooled<TakeSlot>(newTake);
	private readonly duoList = new Pooled<TakeSlot>(newTake);
	private readonly streakList = new Pooled<StreakSlot>(() => ({
		x1: 0,
		z1: 0,
		x2: 0,
		z2: 0,
		owner: 0,
		gen: 0,
		carry: 0,
		tick: 0,
	}));
	private readonly braceList = new Pooled<EffectSlot>(newEffect);
	// docs/BUILDS_V2.md BV11 (builds v2, wave 1).
	private readonly waveList = new Pooled<WaveSlot>(() => ({
		x: 0,
		z: 0,
		dirX: 0,
		dirZ: 0,
		halfCos: 0,
		range: 0,
		speed: 0,
		owner: 0,
		damage: 0,
		kind: 0,
		count: 0,
		tick: 0,
	}));
	private readonly ballistaList = new Pooled<BallistaSlot>(() => ({ ...newEffect(), dirX: 0, dirZ: 0 }));
	private readonly pinStartList = new Pooled<PinStartSlot>(() => ({ slot: 0, owner: 0, x: 0, z: 0, tick: 0 }));
	private readonly pinEndList = new Pooled<PinEndSlot>(() => ({
		slot: 0,
		owner: 0,
		carried: 0,
		slam: false,
		tick: 0,
	}));
	private readonly slamList = new Pooled<EffectSlot>(newEffect);
	private readonly smashList = new Pooled<EffectSlot>(newEffect);
	private readonly demolitionList = new Pooled<EffectSlot>(newEffect);
	private readonly heartBeamList = new Pooled<BeamSlot>(() => ({
		x1: 0,
		z1: 0,
		x2: 0,
		z2: 0,
		owner: 0,
		struck: 0,
		tick: 0,
	}));
	private readonly happyList = new Pooled<PlayerTickSlot>(() => ({ player: 0, tick: 0 }));
	private readonly overcapList = new Pooled<EffectSlot>(newEffect);
	/** BV11's lists that are not effect lists, for reset and count. */
	private readonly waveOneLists: ReadonlyArray<{ readonly items: ReadonlyArray<defined>; clear(): void }> = [
		this.waveList,
		this.pinStartList,
		this.pinEndList,
		this.heartBeamList,
		this.happyList,
	];
	/** Every effect list, for reset and count. */
	private readonly effectLists: ReadonlyArray<Pooled<EffectSlot>> = [
		this.burstList,
		this.shardList,
		this.emberList,
		this.novaList,
		this.executeList,
		this.phantomList,
		this.jackpotList,
		this.healList,
		this.momentumList,
		this.thrillList,
		this.flurryList,
		this.ricochetList,
		this.duoProcList,
		this.goldRushList,
		this.unshakenList,
		this.braceList,
		this.ballistaList,
		this.slamList,
		this.smashList,
		this.demolitionList,
		this.overcapList,
	];

	readonly sparks: ReadonlyArray<SparkRecord> = this.sparkList.items;
	readonly bursts: ReadonlyArray<EffectRecord> = this.burstList.items;
	readonly shards: ReadonlyArray<EffectRecord> = this.shardList.items;
	readonly embers: ReadonlyArray<EffectRecord> = this.emberList.items;
	readonly novas: ReadonlyArray<NovaRecord> = this.novaList.items;
	readonly executes: ReadonlyArray<EffectRecord> = this.executeList.items;
	readonly phantoms: ReadonlyArray<EffectRecord> = this.phantomList.items;
	readonly jackpots: ReadonlyArray<EffectRecord> = this.jackpotList.items;
	readonly heals: ReadonlyArray<EffectRecord> = this.healList.items;
	readonly momentum: ReadonlyArray<EffectRecord> = this.momentumList.items;
	readonly thrills: ReadonlyArray<EffectRecord> = this.thrillList.items;
	readonly flurries: ReadonlyArray<EffectRecord> = this.flurryList.items;
	readonly ricochets: ReadonlyArray<EffectRecord> = this.ricochetList.items;
	readonly duoProcs: ReadonlyArray<EffectRecord> = this.duoProcList.items;
	readonly goldRush: ReadonlyArray<EffectRecord> = this.goldRushList.items;
	readonly unshaken: ReadonlyArray<EffectRecord> = this.unshakenList.items;
	readonly evolved: ReadonlyArray<TakeRecord> = this.evolvedList.items;
	readonly duos: ReadonlyArray<TakeRecord> = this.duoList.items;
	readonly overkills: ReadonlyArray<StreakRecord> = this.streakList.items;
	readonly braces: ReadonlyArray<EffectRecord> = this.braceList.items;
	readonly waves: ReadonlyArray<WaveRecord> = this.waveList.items;
	readonly ballistas: ReadonlyArray<BallistaRecord> = this.ballistaList.items;
	readonly pinStarts: ReadonlyArray<PinStartRecord> = this.pinStartList.items;
	readonly pinEnds: ReadonlyArray<PinEndRecord> = this.pinEndList.items;
	readonly slams: ReadonlyArray<EffectRecord> = this.slamList.items;
	readonly smashes: ReadonlyArray<EffectRecord> = this.smashList.items;
	readonly demolitions: ReadonlyArray<EffectRecord> = this.demolitionList.items;
	readonly heartBeams: ReadonlyArray<BeamRecord> = this.heartBeamList.items;
	readonly happyHours: ReadonlyArray<PlayerTickRecord> = this.happyList.items;
	readonly overcaps: ReadonlyArray<EffectRecord> = this.overcapList.items;

	/** A new frame: forget the last one's records. */
	reset(): void {
		this.ticks = 0;
		this.sparkList.clear();
		for (const l of this.effectLists) l.clear();
		this.evolvedList.clear();
		this.duoList.clear();
		this.streakList.clear();
		for (const l of this.waveOneLists) l.clear();
	}

	/** Every record of this frame (0: nothing happened). */
	count(): number {
		let n = this.sparks.size() + this.evolved.size() + this.duos.size() + this.overkills.size();
		for (const l of this.effectLists) n += l.items.size();
		for (const l of this.waveOneLists) n += l.items.size();
		return n;
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
			// BV11: a Thunder Guard spark (SparkFork.THUNDER) is no Storm Crown fork (it was drawn thin before BV11).
			const fork = e.sparkFork[i] ?? SparkFork.HOP;
			r.fork = fork === SparkFork.FORK;
			r.thunder = fork === SparkFork.THUNDER;
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
		this.collectEvolutions(state, tick);
		this.collectDuos(state, tick);
		this.collectLegendaries(state, tick);
		this.collectWaveOne(state, tick);
	}

	/** docs/BUILDS_V2.md BV11: builds v2, wave 1's lists (see the file comment). */
	private collectWaveOne(state: Readonly<SimState>, tick: number): void {
		const e = state.builds!.events;
		for (let i = 0; i < e.waveX.size(); i++) {
			const r = this.waveList.push();
			r.x = e.waveX[i];
			r.z = e.waveZ[i];
			r.dirX = e.waveDirX[i];
			r.dirZ = e.waveDirZ[i];
			r.halfCos = e.waveHalfCos[i];
			r.range = e.waveRange[i];
			r.speed = e.waveSpeed[i];
			r.owner = e.waveOwner[i];
			r.damage = e.waveDamage[i];
			r.kind = e.waveKind[i];
			r.count = e.counterCount[i] ?? 0;
			r.tick = tick;
		}
		const n = partySize(state);
		for (let i = 0; i < e.ballistaX.size(); i++) {
			const r = this.ballistaList.push();
			const x = e.ballistaX[i];
			const z = e.ballistaZ[i];
			const owner = e.ballistaOwner[i];
			effect(r, x, z, owner, 0, e.ballistaFired[i], tick);
			r.kind = e.ballistaWall[i];
			const p = owner >= 0 && owner < n ? playerAt(state, owner) : undefined;
			const dx = p !== undefined ? p.x - x : 0;
			const dz = p !== undefined ? p.z - z : 0;
			const d = math.sqrt(dx * dx + dz * dz);
			r.dirX = d > 0 ? dx / d : 0;
			r.dirZ = d > 0 ? dz / d : 0;
		}
		for (let i = 0; i < e.pinStartSlot.size(); i++) {
			const r = this.pinStartList.push();
			r.slot = e.pinStartSlot[i];
			r.owner = e.pinStartOwner[i];
			r.x = e.pinStartX[i];
			r.z = e.pinStartZ[i];
			r.tick = tick;
		}
		for (let i = 0; i < e.pinEndSlot.size(); i++) {
			const r = this.pinEndList.push();
			r.slot = e.pinEndSlot[i];
			r.owner = e.pinEndOwner[i];
			r.carried = e.pinEndCarried[i];
			r.slam = e.pinEndSlam[i] !== 0;
			r.tick = tick;
		}
		for (let i = 0; i < e.slamX.size(); i++)
			effect(this.slamList.push(), e.slamX[i], e.slamZ[i], e.slamOwner[i], 0, e.slamStruck[i], tick);
		for (let i = 0; i < e.smashX.size(); i++) {
			const gen = e.smashGen[i];
			effect(this.smashList.push(), e.smashX[i], e.smashZ[i], e.smashOwner[i], gen, e.smashFired[i], tick);
		}
		for (let i = 0; i < e.demolitionX.size(); i++)
			effect(this.demolitionList.push(), e.demolitionX[i], e.demolitionZ[i], e.demolitionOwner[i], 0, 1, tick);
		for (let i = 0; i < e.beamX1.size(); i++) {
			const r = this.heartBeamList.push();
			r.x1 = e.beamX1[i];
			r.z1 = e.beamZ1[i];
			r.x2 = e.beamX2[i];
			r.z2 = e.beamZ2[i];
			r.owner = e.beamOwner[i];
			r.struck = e.beamStruck[i];
			r.tick = tick;
		}
		for (let i = 0; i < e.happyPlayer.size(); i++) {
			const r = this.happyList.push();
			r.player = e.happyPlayer[i];
			r.tick = tick;
		}
		for (let i = 0; i < e.overcapX.size(); i++) {
			const points = e.overcapPoints[i];
			effect(this.overcapList.push(), e.overcapX[i], e.overcapZ[i], e.overcapOwner[i], 0, points, tick);
		}
	}

	/** LG6: Overkill's streaks and Bastion's braces (see the file comment). */
	private collectLegendaries(state: Readonly<SimState>, tick: number): void {
		const e = state.builds!.events;
		for (let i = 0; i < e.overkillX1.size(); i++) {
			const r = this.streakList.push();
			r.x1 = e.overkillX1[i];
			r.z1 = e.overkillZ1[i];
			r.x2 = e.overkillX2[i];
			r.z2 = e.overkillZ2[i];
			r.owner = e.overkillOwner[i];
			r.gen = e.overkillGen[i];
			r.carry = e.overkillCarry[i];
			r.tick = tick;
		}
		const n = partySize(state);
		for (let i = 0; i < e.bracePlayer.size(); i++) {
			const who = e.bracePlayer[i];
			const p = who >= 0 && who < n ? playerAt(state, who) : undefined;
			const r = this.braceList.push();
			effect(r, p?.x ?? 0, p?.z ?? 0, who, 0, 1, tick);
			r.kind = e.braceKind[i];
		}
	}

	/** BU5's evolution records (see the file comment for each list's amount / kind). */
	private collectEvolutions(state: Readonly<SimState>, tick: number): void {
		const e = state.builds!.events;
		for (let i = 0; i < e.novaX.size(); i++) {
			const r = this.novaList.push();
			effect(r, e.novaX[i], e.novaZ[i], e.novaOwner[i], 0, e.novaRadius[i], tick);
			r.kind = e.novaKind[i];
			r.erased = e.novaErased[i];
		}
		for (let i = 0; i < e.execX.size(); i++)
			effect(this.executeList.push(), e.execX[i], e.execZ[i], e.execOwner[i], 0, 1, tick);
		for (let i = 0; i < e.phantomX.size(); i++)
			effect(this.phantomList.push(), e.phantomX[i], e.phantomZ[i], e.phantomOwner[i], 0, 1, tick);
		for (let i = 0; i < e.jackpotX.size(); i++) {
			const points = e.jackpotPoints[i];
			effect(this.jackpotList.push(), e.jackpotX[i], e.jackpotZ[i], e.jackpotOwner[i], 0, points, tick);
		}
		const n = partySize(state);
		for (let i = 0; i < e.lionPlayer.size(); i++) {
			const who = e.lionPlayer[i];
			const p = who >= 0 && who < n ? playerAt(state, who) : undefined;
			effect(this.healList.push(), p?.x ?? 0, p?.z ?? 0, who, 0, e.lionHealed[i], tick);
		}
		for (let i = 0; i < e.momentumX.size(); i++) {
			const r = this.momentumList.push();
			const fired = e.momentumFired[i];
			effect(r, e.momentumX[i], e.momentumZ[i], e.momentumOwner[i], 0, fired, tick);
			r.kind = e.momentumTier[i];
		}
		for (let i = 0; i < e.thrillX.size(); i++)
			effect(this.thrillList.push(), e.thrillX[i], e.thrillZ[i], e.thrillOwner[i], 0, e.thrillFired[i], tick);
		for (let i = 0; i < e.flurryX.size(); i++) {
			const r = this.flurryList.push();
			const fired = e.flurryFired[i];
			effect(r, e.flurryX[i], e.flurryZ[i], e.flurryOwner[i], 0, fired, tick);
			r.kind = e.flurryKind[i];
		}
		for (let i = 0; i < e.ricochetX.size(); i++) {
			const fired = e.ricochetFired[i];
			effect(this.ricochetList.push(), e.ricochetX[i], e.ricochetZ[i], e.ricochetOwner[i], 0, fired, tick);
		}
	}

	/** BU6's embers and duo procs (see the file comment). */
	private collectDuos(state: Readonly<SimState>, tick: number): void {
		const e = state.builds!.events;
		for (let i = 0; i < e.emberX.size(); i++) {
			const r = this.emberList.push();
			effect(r, e.emberX[i], e.emberZ[i], e.emberOwner[i], 0, 1, tick);
			r.kind = e.emberDuo[i];
		}
		for (let i = 0; i < e.duoProcDuo.size(); i++) {
			const duo = e.duoProcDuo[i];
			const list =
				duo === Duo.GOLD_RUSH ? this.goldRushList : duo === Duo.UNSHAKEN ? this.unshakenList : this.duoProcList;
			const r = list.push();
			effect(r, e.duoProcX[i], e.duoProcZ[i], e.duoProcOwner[i], 0, e.duoProcValue[i], tick);
			r.kind = duo;
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
const EMPTY_NOVAS = table.freeze([] as NovaRecord[]);
const EMPTY_TAKES = table.freeze([] as TakeRecord[]);
const EMPTY_STREAKS = table.freeze([] as StreakRecord[]);
const EMPTY_WAVES = table.freeze([] as WaveRecord[]);
const EMPTY_BALLISTAS = table.freeze([] as BallistaRecord[]);
const EMPTY_PIN_STARTS = table.freeze([] as PinStartRecord[]);
const EMPTY_PIN_ENDS = table.freeze([] as PinEndRecord[]);
const EMPTY_BEAMS = table.freeze([] as BeamRecord[]);
const EMPTY_PLAYER_TICKS = table.freeze([] as PlayerTickRecord[]);

/** No build effects (no run, no builds, or audibleBuilds while quiet). Frozen. */
export const NO_BUILD_FX_EVENTS: BuildFxFrameSource = table.freeze({
	ticks: 0,
	sparks: EMPTY_SPARKS,
	bursts: EMPTY_EFFECTS,
	shards: EMPTY_EFFECTS,
	embers: EMPTY_EFFECTS,
	novas: EMPTY_NOVAS,
	executes: EMPTY_EFFECTS,
	phantoms: EMPTY_EFFECTS,
	jackpots: EMPTY_EFFECTS,
	heals: EMPTY_EFFECTS,
	momentum: EMPTY_EFFECTS,
	thrills: EMPTY_EFFECTS,
	flurries: EMPTY_EFFECTS,
	ricochets: EMPTY_EFFECTS,
	duoProcs: EMPTY_EFFECTS,
	goldRush: EMPTY_EFFECTS,
	unshaken: EMPTY_EFFECTS,
	evolved: EMPTY_TAKES,
	duos: EMPTY_TAKES,
	overkills: EMPTY_STREAKS,
	braces: EMPTY_EFFECTS,
	waves: EMPTY_WAVES,
	ballistas: EMPTY_BALLISTAS,
	pinStarts: EMPTY_PIN_STARTS,
	pinEnds: EMPTY_PIN_ENDS,
	slams: EMPTY_EFFECTS,
	smashes: EMPTY_EFFECTS,
	demolitions: EMPTY_EFFECTS,
	heartBeams: EMPTY_BEAMS,
	happyHours: EMPTY_PLAYER_TICKS,
	overcaps: EMPTY_EFFECTS,
});

/**
 * The builds source the audio mapper reads: `source` as is, or NO_BUILD_FX_EVENTS while `quiet` (comboQuiet: the stage
 * cover, run over), like audibleVariantCues.
 */
export function audibleBuilds(source: BuildFxFrameSource, quiet: boolean): BuildFxFrameSource {
	return quiet ? NO_BUILD_FX_EVENTS : source;
}
