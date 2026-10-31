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
 * Counts per frame (the mapper only asks > 0: several imps landing on one frame are one sound). Read-only on the sim,
 * no allocation per tick. Presentation only: nothing here is hashed or written back.
 */
import {
	AiState,
	IMP,
	IMP_ATTACK_FAN,
	IMP_LAND_AIM_TICKS,
	NO_KIND,
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
}

/** Nothing happened (no run, or audibleVariantCues while quiet). */
export const NO_VARIANT_CUES: VariantCueSource = table.freeze({
	blinks: 0,
	summons: 0,
	splits: 0,
	shieldBreaks: 0,
	vengefulFired: 0,
});

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
	private readonly impKind = kindOf(IMP.id);
	private readonly smallKind = kindOf(SLIME_SMALL_ID);
	private readonly summonerKind = kindOf(SUMMONER.id);

	/** A new frame: forget the last one's counts. */
	reset(): void {
		this.blinks = 0;
		this.summons = 0;
		this.splits = 0;
		this.shieldBreaks = 0;
		this.vengefulFired = 0;
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return this.blinks + this.summons + this.splits + this.shieldBreaks + this.vengefulFired;
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
