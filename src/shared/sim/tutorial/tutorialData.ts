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
