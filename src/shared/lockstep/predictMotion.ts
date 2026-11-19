/**
 * Local prediction's motion mirror (docs/LOCAL_PREDICTION.md Design 2-3, LP1 / LP2), pure: one tick of ONE player's
 * body, replayed on scratch objects from a merged (stepped) state, never writing it. A line-for-line copy of what moves
 * the body in a tick (LPD1: mirror, not refactor; the sim is not touched), in the sim's order:
 *
 *   1. stepPlayer (sim/player.ts) steps 1, 3-6 and 8: prev = pos, the roll / flask timers, the ROLL and FLASK press
 *      edges, the roll (the dash at the player's trait) or the walk (flask x weapon x Quickstep, then the sword
 *      spacing brake while the weapon in hand says so: docs/SWORD_SPACING.md Design 5), facing, prevButtons.
 *      Skipped (no motion): the i-frames a roll or the Ember grants, the Ember itself, events, the debug hit, Wrecker's
 *      roll smash (corrected: docs/LOCAL_PREDICTION.md "Census").
 *   2. stepWeapons (sim/combat/weapons/weapons.ts) as far as it moves the body: every set's cooldown, the SWAP edge
 *      (onto an empty set nothing, ARD3), then the weapon in hand: the sword's guard / combo / finisher wind-up and its
 *      lunge (sword.ts `step`, braked like the sim's), the bow's charge (bow.ts `step`). Nothing is swung, fired or erased; a weapon without a
 *      mirror keeps its slot (its merged moveMultiplier is held, Design 3). prevButtons.
 *   3. stepDrops 3 (sim/drops/drops.ts): the Quickstep and Frenzy timers count down (the walk and attackTicks read them).
 *
 * Sword spacing (docs/SWORD_SPACING.md Design 5, SP5): the sim brakes the walk and the lunge against a list built from
 * the tick-start state (sim/combat/spacing.ts tickSpacing). The mirror brakes against its OWN list (never the sim's
 * module scratch), built once per prediction pass from the merged state (buildMotionSpacing): one tick from the merged
 * state is exact; over a longer horizon the enemies stay where the merged state had them (a documented limitation: the
 * smoother corrects it like any mispredict).
 *
 * Everything else that touches the body (the boss's seal, hits, pickups, the floor change, a draft) is not predicted:
 * the next prediction from a newer merged state corrects it. The parity specs (predictMotion.spec.ts) pin this file to
 * the real sim bit for bit: a sim change that moves the body fails them until the mirror follows (docs/LOCAL_PREDICTION.md
 * Risks, "Mirror drift").
 *
 * Reads the merged state only through read-only helpers (runMods, swordGuardTicks, bowChargeTicks, solidCells inside
 * movePlayer) and writes only the MotionScratch. No allocation per tick.
 */
import { jsMin } from "shared/jsmath";
import {
	AXIS_MAX,
	BOOST_PERCENT,
	BOW_V_CHARGE,
	BOW_WEAPON_ID,
	Boost,
	Button,
	FLASK_HEAL_HALF_HEARTS,
	FLASK_MOVE_MULTIPLIER,
	FLASK_USE_TICKS,
	FRENZY_ATTACK_TICKS_PERCENT,
	NO_WEAPON,
	QUICKSTEP_WALK_PERCENT,
	ROLL_DASH_STEP,
	ROLL_DASH_TICKS,
	ROLL_RECOVERY_STEP,
	ROLL_TICKS,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_SPACING,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_GUARD,
	SWORD_V_LAST,
	SWORD_V_STEP,
	SWORD_V_WINDOW,
	SWORD_WEAPON_ID,
	WALK_STEP,
	WEAPON_SCRATCH_SLOTS,
	BRAKE_RESULT,
	bowChargeTicks,
	brakeStep,
	buildSpacingList,
	combinedPercent,
	movePlayer,
	newPlayerState,
	newSpacingList,
	playerAt,
	runMods,
	scalePercent,
	scaleTicks,
	swordGuardTicks,
	weaponIndex,
	weaponMoveMultiplier,
	weaponSpacingActive,
	weaponsAt,
	type InputFrame,
	type PlayerState,
	type PlayerTraits,
	type SimConfig,
	type SimState,
	type SpacingConfig,
	type SpacingList,
	type SpacingTick,
	type WeaponSlotState,
	type WeaponsState,
} from "shared/sim";

/** The motion state the mirror replays: scratch copies, never the merged state's own objects. */
export interface MotionScratch {
	/** The player's body (every PlayerState field; only the motion ones change). */
	readonly player: PlayerState;
	/** The player's weapons (active set, prevButtons, each set's weapon / cooldown / scratch). */
	readonly weapons: WeaponsState;
	/** Quickstep's timer (state.drops), counted down like stepDrops. 0 without drops. */
	quickstepTicks: number;
	/** Frenzy's timer, the same way. */
	frenzyTicks: number;
}

/** The predictor's own spacing brake (its list and the run's config), filled by buildMotionSpacing. */
export interface MotionSpacing {
	readonly list: SpacingList;
	config: Readonly<SpacingConfig>;
}

/** An empty brake (fill it with buildMotionSpacing). */
export function newMotionSpacing(): MotionSpacing {
	return { list: newSpacingList(), config: SWORD_SPACING };
}

/**
 * A prediction pass's brake, like the sim's tickSpacing but into `out` (never the sim's scratch): undefined without
 * `config` (the run config's `spacing` absent: nothing braked); else `out`'s list rebuilt from the merged `state` with
 * `config`. Build it once per pass (every replayed tick reads the same merged state).
 */
export function buildMotionSpacing(
	out: MotionSpacing,
	state: Readonly<SimState>,
	config: Readonly<SpacingConfig> | undefined,
): SpacingTick | undefined {
	if (config === undefined) return undefined;
	buildSpacingList(state, config, out.list);
	out.config = config;
	return out;
}

function newSlot(): WeaponSlotState {
	const v: number[] = [];
	for (let k = 0; k < WEAPON_SCRATCH_SLOTS; k++) v.push(0);
	return { weapon: NO_WEAPON, cooldown: 0, v };
}

/** An empty scratch (fill it with copyMotionBase). */
export function newMotionScratch(): MotionScratch {
	return {
		player: newPlayerState(0, 0),
		weapons: {
			activeSet: 0,
			prevButtons: 0,
			emitterId: 0,
			sets: [],
			swingTick: -1,
			swingX: 0,
			swingZ: 0,
			swingDirX: 0,
			swingDirZ: 1,
			swingRadius: 0,
			swingHalfCos: 1,
		},
		quickstepTicks: 0,
		frenzyTicks: 0,
	};
}

function copyPlayer(out: PlayerState, p: Readonly<PlayerState>): void {
	out.x = p.x;
	out.z = p.z;
	out.prevX = p.prevX;
	out.prevZ = p.prevZ;
	out.faceX = p.faceX;
	out.faceZ = p.faceZ;
	out.hearts = p.hearts;
	out.heartsMax = p.heartsMax;
	out.armor = p.armor;
	out.armorMax = p.armorMax;
	out.flask = p.flask;
	out.flaskMax = p.flaskMax;
	out.embers = p.embers;
	out.emberMax = p.emberMax;
	out.rollTicks = p.rollTicks;
	out.rollDirX = p.rollDirX;
	out.rollDirZ = p.rollDirZ;
	out.iframeTicks = p.iframeTicks;
	out.hurtTicks = p.hurtTicks;
	out.flaskTicks = p.flaskTicks;
	out.prevButtons = p.prevButtons;
	out.dead = p.dead;
}

function copyWeapons(out: WeaponsState, w: Readonly<WeaponsState>): void {
	out.activeSet = w.activeSet;
	out.prevButtons = w.prevButtons;
	out.emitterId = w.emitterId;
	out.swingTick = w.swingTick;
	out.swingX = w.swingX;
	out.swingZ = w.swingZ;
	out.swingDirX = w.swingDirX;
	out.swingDirZ = w.swingDirZ;
	out.swingRadius = w.swingRadius;
	out.swingHalfCos = w.swingHalfCos;
	const sets = out.sets;
	while (sets.size() < w.sets.size()) sets.push(newSlot());
	while (sets.size() > w.sets.size()) sets.pop();
	for (let i = 0; i < w.sets.size(); i++) {
		const from = w.sets[i];
		const to = sets[i];
		to.weapon = from.weapon;
		to.cooldown = from.cooldown;
		while (to.v.size() < from.v.size()) to.v.push(0);
		while (to.v.size() > from.v.size()) to.v.pop();
		for (let k = 0; k < from.v.size(); k++) to.v[k] = from.v[k];
	}
}

/** Fills `out` from player `playerIndex` of the merged `state` (its body, weapons and boost timers). */
export function copyMotionBase(out: MotionScratch, state: Readonly<SimState>, playerIndex: number): void {
	copyPlayer(out.player, playerAt(state, playerIndex));
	copyWeapons(out.weapons, weaponsAt(state, playerIndex));
	const bp = state.drops?.players[playerIndex];
	out.quickstepTicks = bp !== undefined ? bp.ticks[Boost.QUICKSTEP] : 0;
	out.frenzyTicks = bp !== undefined ? bp.ticks[Boost.FRENZY] : 0;
}

/** Copies one scratch into another (the predictor keeps the pose one tick before the head). */
export function copyMotionScratch(out: MotionScratch, from: Readonly<MotionScratch>): void {
	copyPlayer(out.player, from.player);
	copyWeapons(out.weapons, from.weapons);
	out.quickstepTicks = from.quickstepTicks;
	out.frenzyTicks = from.frenzyTicks;
}

function pressed(prevButtons: number, buttons: number, bit: number): boolean {
	return bit32.band(buttons, bit) !== 0 && bit32.band(prevButtons, bit) === 0;
}

/** The weapon registry indices of the mirrored weapons, looked up once (the defs register at module load). */
let swordIndex: number | undefined;
let bowIndex: number | undefined;
function mirroredIndices(): void {
	if (swordIndex === undefined) swordIndex = weaponIndex(SWORD_WEAPON_ID);
	if (bowIndex === undefined) bowIndex = weaponIndex(BOW_WEAPON_ID);
}

/** runMods attackTicks with the predicted Frenzy timer (exactly attackTicks while the timer matches the state's). */
function predictedAttackTicks(s: Readonly<MotionScratch>, state: Readonly<SimState>, i: number, ticks: number): number {
	const boost = s.frenzyTicks > 0 ? FRENZY_ATTACK_TICKS_PERCENT : BOOST_PERCENT;
	return scaleTicks(ticks, combinedPercent(runMods(state, i).attackTicksPercent, boost));
}

function resetCombo(v: number[]): void {
	v[SWORD_V_STEP] = 0;
	v[SWORD_V_BUSY] = 0;
	v[SWORD_V_WINDOW] = 0;
}

/** sword.ts `step`, as far as it moves the body (the guard, the combo's timers, the wind-up and its lunge). */
function mirrorSword(
	s: MotionScratch,
	slot: WeaponSlotState,
	state: Readonly<SimState>,
	input: Readonly<InputFrame>,
	world: Readonly<SimConfig>,
	i: number,
	swapped: boolean,
	spacing: SpacingTick | undefined,
): void {
	const v = slot.v;
	const p = s.player;
	if (swapped) {
		resetCombo(v);
		v[SWORD_V_GUARD] = 0;
	}
	if (p.rollTicks > 0) {
		if (v[SWORD_V_STEP] === SWORD_STEP_WINDUP) resetCombo(v);
		v[SWORD_V_GUARD] = 0;
		return;
	}
	if (pressed(s.weapons.prevButtons, input.buttons, Button.ALT) && slot.cooldown === 0) {
		resetCombo(v);
		v[SWORD_V_GUARD] = swordGuardTicks(state, i);
		slot.cooldown = SWORD_DATA.guardCooldownTicks;
	}
	if (v[SWORD_V_GUARD] > 0) {
		v[SWORD_V_GUARD]--;
		return;
	}
	if (v[SWORD_V_STEP] === SWORD_STEP_WINDUP) {
		// Read per tick like sword.ts (setSwordTimings applies); the same division gives the same bits.
		const lungeStep = SWORD_DATA.lungeDistance / SWORD_DATA.finisherWindupTicks;
		let lx = p.faceX * lungeStep;
		let lz = p.faceZ * lungeStep;
		// docs/SWORD_SPACING.md Design 4 / 5: the lunge stops at the nearest contact enemy's keep distance (the pass's list).
		if (spacing !== undefined && spacing.config.lunge) {
			brakeStep(spacing.list, p.x, p.z, lx, lz, spacing.config.stopConeCos);
			lx = BRAKE_RESULT.x;
			lz = BRAKE_RESULT.z;
		}
		// movePlayer reads the merged state only (solidCells) and writes only the scratch player.
		movePlayer(state as SimState, lx, lz, world, p);
		v[SWORD_V_BUSY] -= 1;
		if (v[SWORD_V_BUSY] <= 0) {
			// swing(ctx, v, SWORD_FINISHER), its bookkeeping only.
			v[SWORD_V_STEP] = 0;
			v[SWORD_V_BUSY] = predictedAttackTicks(s, state, i, SWORD_DATA.finisherRecoveryTicks);
			v[SWORD_V_WINDOW] = SWORD_DATA.comboWindowTicks;
			v[SWORD_V_LAST] = SWORD_FINISHER;
		}
		return;
	}
	if (v[SWORD_V_BUSY] > 0) {
		v[SWORD_V_BUSY]--;
	} else if (v[SWORD_V_WINDOW] > 0) {
		v[SWORD_V_WINDOW] -= 1;
		if (v[SWORD_V_WINDOW] === 0) v[SWORD_V_STEP] = 0;
	}
	if (bit32.band(input.buttons, Button.FIRE) !== 0 && v[SWORD_V_BUSY] === 0) {
		if (v[SWORD_V_STEP] < 2) {
			// swing(ctx, v, step + 1), its bookkeeping only.
			const n = v[SWORD_V_STEP] + 1;
			v[SWORD_V_STEP] = n;
			v[SWORD_V_BUSY] = predictedAttackTicks(s, state, i, SWORD_DATA.swingRecoveryTicks);
			v[SWORD_V_WINDOW] = SWORD_DATA.comboWindowTicks;
			v[SWORD_V_LAST] = n;
		} else {
			v[SWORD_V_STEP] = SWORD_STEP_WINDUP;
			v[SWORD_V_BUSY] = SWORD_DATA.finisherWindupTicks;
		}
	}
}

/** bow.ts `step`, as far as it moves the body (the charge; a release fires and ends it). */
function mirrorBow(
	s: MotionScratch,
	slot: WeaponSlotState,
	state: Readonly<SimState>,
	input: Readonly<InputFrame>,
	i: number,
	swapped: boolean,
): void {
	const v = slot.v;
	if (swapped || s.player.rollTicks > 0) {
		v[BOW_V_CHARGE] = 0;
		return;
	}
	if (bit32.band(input.buttons, Button.ALT) !== 0) {
		if (v[BOW_V_CHARGE] < bowChargeTicks(state, i)) v[BOW_V_CHARGE]++;
		return;
	}
	v[BOW_V_CHARGE] = 0; // released (a heavy arrow or a cancel) or not charging
}

/** stepPlayer steps 1, 3-6 and 8 on the scratch player (see the file comment). */
function mirrorPlayer(
	s: MotionScratch,
	state: Readonly<SimState>,
	input: Readonly<InputFrame>,
	world: Readonly<SimConfig>,
	traits: Readonly<PlayerTraits>,
	spacing: SpacingTick | undefined,
): void {
	const p = s.player;
	p.prevX = p.x;
	p.prevZ = p.z;
	const buttons = input.buttons;
	const prevButtons = p.prevButtons;
	if (p.dead !== 0) {
		p.prevButtons = buttons;
		return;
	}
	if (p.rollTicks > 0) p.rollTicks--;
	if (p.flaskTicks > 0) p.flaskTicks--;

	let mx = input.moveX / AXIS_MAX;
	let mz = input.moveZ / AXIS_MAX;
	const moveLen2 = mx * mx + mz * mz;
	if (moveLen2 > 1) {
		const inv = 1 / math.sqrt(moveLen2);
		mx *= inv;
		mz *= inv;
	}

	if (pressed(prevButtons, buttons, Button.ROLL) && p.rollTicks === 0) {
		if (input.moveX !== 0 || input.moveZ !== 0) {
			const inv = 1 / math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ);
			p.rollDirX = input.moveX * inv;
			p.rollDirZ = input.moveZ * inv;
		} else {
			p.rollDirX = p.faceX;
			p.rollDirZ = p.faceZ;
		}
		p.rollTicks = ROLL_TICKS;
	}

	if (pressed(prevButtons, buttons, Button.FLASK) && p.flask > 0 && p.hearts < p.heartsMax && p.flaskTicks === 0) {
		p.flask--;
		p.hearts = jsMin(p.heartsMax, p.hearts + FLASK_HEAL_HALF_HEARTS);
		p.flaskTicks = FLASK_USE_TICKS;
	}

	const sim = state as SimState; // movePlayer reads it (solidCells) and writes only `p`
	if (p.rollTicks > 0) {
		const elapsed = ROLL_TICKS - p.rollTicks;
		const dist =
			elapsed < ROLL_DASH_TICKS ? scalePercent(ROLL_DASH_STEP, traits.rollDashPercent) : ROLL_RECOVERY_STEP;
		movePlayer(sim, p.rollDirX * dist, p.rollDirZ * dist, world, p);
	} else {
		const base =
			(p.flaskTicks > 0 ? WALK_STEP * FLASK_MOVE_MULTIPLIER : WALK_STEP) * weaponMoveMultiplier(s.weapons);
		const walk = scalePercent(base, s.quickstepTicks > 0 ? QUICKSTEP_WALK_PERCENT : BOOST_PERCENT);
		let wx = mx * walk;
		let wz = mz * walk;
		// docs/SWORD_SPACING.md Design 3 / 5: braked while the weapon in hand says so (the scratch weapons, as the sim
		// reads its own before stepWeapons), against the pass's list.
		if (spacing !== undefined && spacing.config.walk && weaponSpacingActive(s.weapons, buttons)) {
			brakeStep(spacing.list, p.x, p.z, wx, wz, spacing.config.stopConeCos);
			wx = BRAKE_RESULT.x;
			wz = BRAKE_RESULT.z;
		}
		movePlayer(sim, wx, wz, world, p);
	}

	if (input.aimX !== 0 || input.aimZ !== 0) {
		const inv = 1 / math.sqrt(input.aimX * input.aimX + input.aimZ * input.aimZ);
		p.faceX = input.aimX * inv;
		p.faceZ = input.aimZ * inv;
	} else if (p.rollTicks > 0) {
		p.faceX = p.rollDirX;
		p.faceZ = p.rollDirZ;
	} else if (input.moveX !== 0 || input.moveZ !== 0) {
		const inv = 1 / math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ);
		p.faceX = input.moveX * inv;
		p.faceZ = input.moveZ * inv;
	}
	p.prevButtons = buttons;
}

/** stepWeapons, as far as it moves the body (see the file comment). */
function mirrorWeapons(
	s: MotionScratch,
	state: Readonly<SimState>,
	input: Readonly<InputFrame>,
	world: Readonly<SimConfig>,
	i: number,
	spacing: SpacingTick | undefined,
): void {
	const w = s.weapons;
	const buttons = input.buttons;
	const sets = w.sets;
	for (const slot of sets) if (slot.cooldown > 0) slot.cooldown--;
	if (s.player.dead === 0) {
		let swapped = false;
		if (pressed(w.prevButtons, buttons, Button.SWAP) && sets.size() > 1) {
			const target = (w.activeSet + 1) % sets.size();
			if (sets[target].weapon !== NO_WEAPON) {
				w.activeSet = target;
				swapped = true;
			}
		}
		const slot = sets[w.activeSet];
		if (slot.weapon !== NO_WEAPON) {
			mirroredIndices();
			if (slot.weapon === swordIndex) mirrorSword(s, slot, state, input, world, i, swapped, spacing);
			else if (slot.weapon === bowIndex) mirrorBow(s, slot, state, input, i, swapped);
			// Any other weapon: its slot stays the base's (its moveMultiplier is held).
		}
	}
	w.prevButtons = buttons;
}

/**
 * One tick of player `playerIndex`'s motion on `s`, from merged `state` (read only) with `input` (the frame the sim
 * will step for that tick), `world` (the floor's config: simWorldConfig(state, runConfig)) and `traits` (the player's,
 * playerTraits(runConfig, playerIndex)) and `spacing` (the pass's brake: buildMotionSpacing(own, state,
 * runConfig.spacing); undefined: nothing braked). See the file comment.
 */
export function predictMotionTick(
	s: MotionScratch,
	state: Readonly<SimState>,
	input: Readonly<InputFrame>,
	world: Readonly<SimConfig>,
	playerIndex: number,
	traits: Readonly<PlayerTraits>,
	spacing?: SpacingTick,
): void {
	mirrorPlayer(s, state, input, world, traits, spacing);
	mirrorWeapons(s, state, input, world, playerIndex, spacing);
	// stepDrops 3: the timers count down after the step (only with drops; both stay 0 without).
	if (s.quickstepTicks > 0) s.quickstepTicks -= 1;
	if (s.frenzyTicks > 0) s.frenzyTicks -= 1;
}
