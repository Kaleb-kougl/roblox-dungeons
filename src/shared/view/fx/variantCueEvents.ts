/**
 * A frame's enemy-variant sound events (docs/ENEMY_VARIANTS.md EV9 / EV11 audio cues): an Imp's blink landing, a
 * Summoner's summon, an Ooze's split, a Shielded enemy's shield breaking and a Vengeful corpse firing its ring. A
 * rendered frame may run several ticks, and the moments below last exactly one tick (the affix events are cleared at the
 * start of every tick; the others are one-tick states), so the run views (shared/play LiveRun, shared/lockstep
 * LockstepClient) `reset` this at the start of every frame and `collect` after every tick, as they do
 * BoostFrameEvents and ComboEvents. The audio cue mapper (shared/view/audio AudioCueMapper.frame's `variants`) reads it
 * once per frame through `audibleVariantCues`.
 *
 * Per tick, after the step (state.tick already advanced, so this tick's spawns carry spawnTick === state.tick - 1):
 *   - blinks: imps on their landing tick: aiState TELEGRAPH, attack IMP_ATTACK_FAN, aiTicks === IMP_LAND_AIM_TICKS
 *     (the imp's view contract; the snap happened this tick). The blink's wind-up start already plays
 *     sfx.enemy.telegraph, so the landing (the snap, then the aim line) is the moment the blink sound marks. A cancelled
 *     blink (the destination went invalid) never lands: no sound. Not counted while a boon draft is open: a frozen tick
 *     leaves aiTicks untouched, so the landing state would repeat every frozen tick.
 *   - summons: swarmers a Summoner summoned this tick (a new actor whose id sits in a living or dead summoner's summon
 *     slots), i.e. when the cast resolves and the summons appear. A cast that summoned nothing (a full actor pool)
 *     is silent; its wind-up already played the telegraph.
 *   - splits: `slime.small` actors spawned this tick (they only come from an Ooze's split, in its onDeath).
 *   - shieldBreaks / vengefulFired: the sim's AffixEvents `shieldBroke` / `vengefulFired` (runs with affixes only).
 *     `vengefulArmed` (the kill that starts the corpse's telegraph) is not a cue: the kill plays the death sound.
 *
 *   - The second endless set (docs/NEW_ENEMIES.md NE8), from per-slot transitions between consecutive ticks ((slot,
 *     actor id) -> aiState / alive, kept across frames; a new state or the tick going back only snapshots, so nothing
 *     sounds on its first tick; a new actor id counts as coming from no state): `fuses` a Bomber entering its fuse
 *     (TELEGRAPH, BOMBER_ATTACK_FUSE), `blasts` a Bomber alive last tick and a detonated corpse now (v[BOMBER_FUSED] =
 *     BOMBER_DETONATED: a fizzle is the death sound only), `charges` a Charger leaving its lane telegraph into the
 *     charge (or straight into a stun / recover when the first step is blocked), `stuns` a Charger entering
 *     CHARGER_STUN, `spins` a Reaper entering REAPER_SPIN; `strikes` the tick's SimEvents.strikes (strike bullets
 *     fired, NE5) less its SimEvents.shells (docs/NEW_ENEMIES_3.md NT2: a Mortar's shell is a STRIKE but never the
 *     Stormcaller's lightning). A frozen tick (a boon draft) changes no state, so no transition repeats.
 *
 *   - The third endless set (docs/NEW_ENEMIES_2.md NX7): `blocks` / `guardBreaks` (SimEvents.shieldBlocks /
 *     guardBreaks), `hookThrows` a Chainhook leaving its aim telegraph into CHAINHOOK_THROWN (the per-slot transitions
 *     above; a throw dropped on its last aim tick goes back to keeping range: no sound), `hookLatches`
 *     (SimEvents.hookLatched), `pyreLights` (SimEvents.pyresLanded: a brazier spawned), and the Snatcher's pellet
 *     moments from the tick's PelletEvents: `snatches` (stolen), `swallows` (swallowed) and `pelletReturns` (returned
 *     to the floor at its death; pellets credited to its killer, NXD18, are `eaten` and chomp instead).
 *
 *   - The fourth endless set (docs/NEW_ENEMIES_3.md NT7): `lobs` a Mortar leaving its draw (TELEGRAPH,
 *     MORTAR_ATTACK_LOB) for MORTAR_FLIGHT (the release; a draw called off because the target left the room goes back to
 *     keeping range: no sound), `shells` (SimEvents.shells: the impact; the shell is never lightning), `heals` the
 *     tick's heal pulses (CombatState.healEvents.healSlot), `healCuts` (SimEvents.healCuts: a beam cut, never a natural
 *     end), `lunges` / `spooks` (SimEvents.lunges / spooks).
 *
 * Counts per frame (the mapper only asks > 0: several imps landing on one frame are one sound). Read-only on the sim,
 * no allocation per tick. Presentation only: nothing here is hashed or written back.
 */
import {
	AiState,
	BOMBER,
	BOMBER_ATTACK_FUSE,
	BOMBER_DETONATED,
	BOMBER_FUSED,
	CHAINHOOK,
	CHAINHOOK_THROWN,
	CHARGER,
	CHARGER_CHARGE,
	CHARGER_RECOVER,
	CHARGER_STUN,
	IMP,
	IMP_ATTACK_FAN,
	IMP_LAND_AIM_TICKS,
	MORTAR,
	MORTAR_ATTACK_LOB,
	MORTAR_FLIGHT,
	NO_KIND,
	REAPER,
	REAPER_SPIN,
	SLIME_SMALL_ID,
	SUMMONER,
	SUMMONER_SUMMON_FIRST,
	SUMMONER_SUMMON_SLOTS,
	archetypeIndex,
	isDraftOpen,
	type ActorState,
	type SimState,
} from "shared/sim";

/** What the audio mapper reads once per frame (VariantCueEvents satisfies it). */
export interface VariantCueSource {
	/** Imp blink landings this frame. */
	readonly blinks: number;
	/** Swarmers summoned this frame. */
	readonly summons: number;
	/** Slimelets split off this frame. */
	readonly splits: number;
	/** Shields broken this frame (AffixEvents.shieldBroke). */
	readonly shieldBreaks: number;
	/** Vengeful rings fired this frame (AffixEvents.vengefulFired). */
	readonly vengefulFired: number;
	/** docs/NEW_ENEMIES.md NE8: Bomber fuses lit, Bomber detonations, Charger charges and stuns, Reaper spins started. */
	readonly fuses: number;
	readonly blasts: number;
	readonly charges: number;
	readonly stuns: number;
	readonly spins: number;
	/** Lightning strike bullets fired this frame (SimEvents.strikes less SimEvents.shells: a Mortar's shell is not one). */
	readonly strikes: number;
	/** docs/NEW_ENEMIES_2.md NX7: shield blocks, guard breaks, hooks thrown and latched, braziers lit. */
	readonly blocks: number;
	readonly guardBreaks: number;
	readonly hookThrows: number;
	readonly hookLatches: number;
	readonly pyreLights: number;
	/** Pellets a Snatcher ate, swallows, and stolen pellets put back on the floor (PelletEvents). */
	readonly snatches: number;
	readonly swallows: number;
	readonly pelletReturns: number;
	/** docs/NEW_ENEMIES_3.md NT7: Mortar releases and shell impacts, heal pulses and beam cuts, Jackal lunges and spooks. */
	readonly lobs: number;
	readonly shells: number;
	readonly heals: number;
	readonly healCuts: number;
	readonly lunges: number;
	readonly spooks: number;
}

/** Nothing happened (no run, or audibleVariantCues while quiet). */
export const NO_VARIANT_CUES: VariantCueSource = table.freeze({
	blinks: 0,
	summons: 0,
	splits: 0,
	shieldBreaks: 0,
	vengefulFired: 0,
	fuses: 0,
	blasts: 0,
	charges: 0,
	stuns: 0,
	spins: 0,
	strikes: 0,
	blocks: 0,
	guardBreaks: 0,
	hookThrows: 0,
	hookLatches: 0,
	pyreLights: 0,
	snatches: 0,
	swallows: 0,
	pelletReturns: 0,
	lobs: 0,
	shells: 0,
	heals: 0,
	healCuts: 0,
	lunges: 0,
	spooks: 0,
});

/** A slot's previous state when it held another actor (or none): no state at all. */
const NO_STATE = -1;

/** Archetype index of `id`, or NO_KIND when it is not registered. */
function kindOf(id: string): number {
	const [ok, index] = pcall(() => archetypeIndex(id));
	return ok ? (index as number) : NO_KIND;
}

/** True on an imp's blink landing tick (its view contract; `a` must be an imp). */
export function impLandedThisTick(a: Readonly<ActorState>): boolean {
	return (
		a.alive !== 0 &&
		a.aiState === AiState.TELEGRAPH &&
		a.attack === IMP_ATTACK_FAN &&
		a.aiTicks === IMP_LAND_AIM_TICKS
	);
}

/** True when `a` was spawned by the tick just stepped (`state.tick` has advanced past it). */
function spawnedThisTick(state: Readonly<SimState>, a: Readonly<ActorState>): boolean {
	return a.id !== 0 && a.kind !== NO_KIND && a.spawnTick === state.tick - 1;
}

/** The enemy-variant sound events of every tick a frame ran. */
export class VariantCueEvents implements VariantCueSource {
	blinks = 0;
	summons = 0;
	splits = 0;
	shieldBreaks = 0;
	vengefulFired = 0;
	fuses = 0;
	blasts = 0;
	charges = 0;
	stuns = 0;
	spins = 0;
	strikes = 0;
	blocks = 0;
	guardBreaks = 0;
	hookThrows = 0;
	hookLatches = 0;
	pyreLights = 0;
	snatches = 0;
	swallows = 0;
	pelletReturns = 0;
	lobs = 0;
	shells = 0;
	heals = 0;
	healCuts = 0;
	lunges = 0;
	spooks = 0;
	private readonly impKind = kindOf(IMP.id);
	private readonly smallKind = kindOf(SLIME_SMALL_ID);
	private readonly summonerKind = kindOf(SUMMONER.id);
	private readonly bomberKind = kindOf(BOMBER.id);
	private readonly chargerKind = kindOf(CHARGER.id);
	private readonly reaperKind = kindOf(REAPER.id);
	private readonly chainhookKind = kindOf(CHAINHOOK.id);
	private readonly mortarKind = kindOf(MORTAR.id);
	/** Per slot, the previous tick's actor id, aiState and liveness (the NE8 transitions). */
	private readonly slotIds: number[] = [];
	private readonly slotStates: number[] = [];
	private readonly slotAlive: boolean[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = -1;

	/** A new frame: forget the last one's counts (the per-slot memory stays: a frame boundary is no transition). */
	reset(): void {
		this.blinks = 0;
		this.summons = 0;
		this.splits = 0;
		this.shieldBreaks = 0;
		this.vengefulFired = 0;
		this.fuses = 0;
		this.blasts = 0;
		this.charges = 0;
		this.stuns = 0;
		this.spins = 0;
		this.strikes = 0;
		this.blocks = 0;
		this.guardBreaks = 0;
		this.hookThrows = 0;
		this.hookLatches = 0;
		this.pyreLights = 0;
		this.snatches = 0;
		this.swallows = 0;
		this.pelletReturns = 0;
		this.lobs = 0;
		this.shells = 0;
		this.heals = 0;
		this.healCuts = 0;
		this.lunges = 0;
		this.spooks = 0;
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return (
			this.blinks +
			this.summons +
			this.splits +
			this.shieldBreaks +
			this.vengefulFired +
			this.fuses +
			this.blasts +
			this.charges +
			this.stuns +
			this.spins +
			this.strikes +
			this.blocks +
			this.guardBreaks +
			this.hookThrows +
			this.hookLatches +
			this.pyreLights +
			this.snatches +
			this.swallows +
			this.pelletReturns +
			this.lobs +
			this.shells +
			this.heals +
			this.healCuts +
			this.lunges +
			this.spooks
		);
	}

	/** The NE8 transitions of the tick just stepped (file comment); updates the per-slot memory. */
	private collectTransitions(state: Readonly<SimState>): void {
		const fresh = state !== this.lastState || state.tick < this.lastTick;
		this.lastState = state;
		this.lastTick = state.tick;
		const actors = state.combat.actors;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			while (this.slotIds.size() <= i) {
				this.slotIds.push(0);
				this.slotStates.push(NO_STATE);
				this.slotAlive.push(false);
			}
			const known = a.id !== 0 && this.slotIds[i] === a.id;
			const prev = known ? this.slotStates[i] : NO_STATE;
			const wasAlive = known && this.slotAlive[i];
			const alive = a.alive !== 0;
			if (!fresh && a.kind !== NO_KIND) {
				const st = a.aiState;
				if (a.kind === this.bomberKind) {
					if (
						alive &&
						st === AiState.TELEGRAPH &&
						a.attack === BOMBER_ATTACK_FUSE &&
						prev !== AiState.TELEGRAPH
					)
						this.fuses++;
					if (wasAlive && !alive && a.v[BOMBER_FUSED] === BOMBER_DETONATED) this.blasts++;
				} else if (a.kind === this.chargerKind && alive) {
					const charged = st === CHARGER_CHARGE || st === CHARGER_STUN || st === CHARGER_RECOVER;
					if (prev === AiState.TELEGRAPH && charged) this.charges++;
					if (st === CHARGER_STUN && prev !== CHARGER_STUN) this.stuns++;
				} else if (a.kind === this.reaperKind && alive) {
					if (st === REAPER_SPIN && prev !== REAPER_SPIN) this.spins++;
				} else if (a.kind === this.chainhookKind && alive) {
					if (st === CHAINHOOK_THROWN && prev === AiState.TELEGRAPH) this.hookThrows++;
				} else if (a.kind === this.mortarKind && alive) {
					if (st === MORTAR_FLIGHT && prev === AiState.TELEGRAPH && a.attack === MORTAR_ATTACK_LOB)
						this.lobs++;
				}
			}
			this.slotIds[i] = a.kind !== NO_KIND ? a.id : 0;
			this.slotStates[i] = a.aiState;
			this.slotAlive[i] = alive;
		}
		const e = state.events;
		// docs/NEW_ENEMIES_3.md NT2: a Mortar's shell is a STRIKE too (in e.strikes); only lightning plays the strike cue.
		this.strikes += e.strikes - e.shells;
		this.blocks += e.shieldBlocks;
		this.guardBreaks += e.guardBreaks;
		this.hookLatches += e.hookLatched;
		this.pyreLights += e.pyresLanded;
		// docs/NEW_ENEMIES_3.md NT7
		this.shells += e.shells;
		this.heals += state.combat.healEvents.healSlot.size();
		this.healCuts += e.healCuts;
		this.lunges += e.lunges;
		this.spooks += e.spooks;
		const pe = state.pellets?.events;
		if (pe !== undefined) {
			this.snatches += pe.stolen.size();
			this.swallows += pe.swallowed.size();
			this.pelletReturns += pe.returned.size();
		}
	}

	/** Adds the tick just stepped (call after every step / stepParty). */
	collect(state: Readonly<SimState>): void {
		const actors = state.combat.actors;
		const frozen = isDraftOpen(state);
		for (const a of actors) {
			if (a.kind === NO_KIND) continue;
			if (a.kind === this.impKind) {
				if (!frozen && impLandedThisTick(a)) this.blinks++;
			} else if (a.kind === this.smallKind) {
				if (spawnedThisTick(state, a)) this.splits++;
			} else if (a.kind === this.summonerKind) {
				this.summons += summonedThisTick(state, actors, a);
			}
		}
		const affixes = state.affixes;
		if (affixes !== undefined) {
			this.shieldBreaks += affixes.events.shieldBroke.size();
			this.vengefulFired += affixes.events.vengefulFired.size();
		}
		this.collectTransitions(state);
	}
}

/** How many of summoner `s`'s summon slots name an actor spawned by the tick just stepped. */
function summonedThisTick(
	state: Readonly<SimState>,
	actors: ReadonlyArray<ActorState>,
	s: Readonly<ActorState>,
): number {
	let n = 0;
	for (let k = 0; k < SUMMONER_SUMMON_SLOTS; k++) {
		const id = s.v[SUMMONER_SUMMON_FIRST + k];
		if (id === undefined || id <= 0) continue;
		for (const o of actors) {
			if (o.id === id) {
				if (spawnedThisTick(state, o)) n++;
				break;
			}
		}
	}
	return n;
}

/**
 * The variant source the audio mapper reads: `source` as is, or NO_VARIANT_CUES while `quiet` (shared/view/fx
 * comboQuiet(covered, runOver): under the stage cover or once the run is over no variant sound plays, like the combo's).
 */
export function audibleVariantCues(source: VariantCueSource, quiet: boolean): VariantCueSource {
	return quiet ? NO_VARIANT_CUES : source;
}
