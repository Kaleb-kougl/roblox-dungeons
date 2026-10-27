/**
 * First-run tutorial tunables for the sim (docs/TUTORIAL.md "Architecture §1"; a Roblox-port feature, no web source).
 * Data only; imports nothing from the sim, so player.ts / state.ts can use it without a require cycle.
 */

/**
 * The tutorial's start health in half hearts (2 of 3 hearts at START_HALF_HEARTS = 6): wounded, so the flask lesson
 * can heal. The value the tutorial world passes as TutorialSimConfig.startHalfHearts.
 */
export const TUTORIAL_START_HALF_HEARTS = 4;

/** TutorialSimConfig.startHalfHearts is clamped to [TUTORIAL_MIN_START_HALF_HEARTS, heartsMax]: never start dead. */
export const TUTORIAL_MIN_START_HALF_HEARTS = 1;

/**
 * A tutorial run's enemies scale (endless hp and bullet speed: endlessData.ts) as on this floor, whatever floor they
 * are on: the floor-2 boss fight is the real Depth 1 / floor 1 fight.
 */
export const TUTORIAL_SCALING_FLOOR = 1;

/** TutorialSimConfig.bossHpPercent when absent: bosses keep their full hp. */
export const TUTORIAL_FULL_BOSS_HP_PERCENT = 100;

/**
 * TutorialSimConfig.guardLock (the block lesson, docs/TUTORIAL.md "Decisions" 9): until a player has blocked a bullet
 * with the sword's guard, the lock room's enemies never drop below this many hp (hits still land, flash and count).
 */
export const TUTORIAL_GUARD_HOLD_HP = 1;

/** TutorialState.guardLock phases. */
/** No lock configured, or its room not entered yet. */
export const GUARD_LOCK_WAITING = 0;
/** The room's enemies spawned and are held at TUTORIAL_GUARD_HOLD_HP. */
export const GUARD_LOCK_ARMED = 1;
/** A block landed (or the room spawned nothing): the room's enemies die as anywhere else. Final. */
export const GUARD_LOCK_RELEASED = 2;

/** TutorialState.guardLockFloor without a lock. */
export const NO_GUARD_LOCK_FLOOR = 0;
/** TutorialState.guardLockRoom without a lock. */
export const NO_GUARD_LOCK_ROOM = -1;
