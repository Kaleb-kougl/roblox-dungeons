/**
 * First-run tutorial ("Practice Descent") tunables for the world and the client (docs/TUTORIAL.md). The sim-side
 * numbers (harmless mode, the wounded start's clamp, the scaling floor) live in shared/sim tutorial/tutorialData.ts;
 * the onboarding doc's version and funnel in shared/onboarding.
 *
 * The world (shared/run tutorial.ts) is fixed: two hand-picked Dungeon Forge layouts, whatever seed the run is given.
 */
import { TUTORIAL_START_HALF_HEARTS } from "shared/sim/tutorial";

/**
 * One fixed Dungeon Forge layout: an endless floor's Forge params (shared/run tutorialForgeParams: the M1 preset plus
 * the endless options, solid pillars and double-size rooms) with this seed and room count.
 */
export interface TutorialForgeLayout {
	readonly seed: number;
	readonly roomCount: number;
}

export interface TutorialTunables {
	/**
	 * The run's seed (the sim rng and EndlessConfig.runSeed). The layouts below do not depend on it; the client
	 * starts the tutorial with it so every practice run replays the same way.
	 */
	readonly runSeed: number;
	/**
	 * Floor 1, "The Training Halls" (the lesson rooms). Chosen by `node scripts/find-tutorial-seed.js --floor 1
	 * --rooms 10 --from 0 --to 7999` (analyzeTutorialLayout, shared/run tutorialLayout.ts, on the endless Forge
	 * options): of 798 layouts meeting the hard criteria (6 combat / elite rooms, a treasure room, a shrine, no leg of
	 * the tour walking through a later room) seed 7513 scored best (307). Its tour is 277 tiles (the entrance -> boss
	 * walk is 105), every one of its 10 rooms is a lesson (no side room to wander into), legs of 19-30 tiles between
	 * the combat rooms, one loop corridor, and lesson E's room has 34 spawn tiles behind a solid pillar (coverTiles).
	 * Route: entrance 4 -> combat 0, 7, 5 -> elite 1 -> combat 6, 8 -> treasure 3 -> shrine 9 -> boss 2 (the
	 * stairwell). Treasure comes before the shrine, as the lesson table teaches them.
	 */
	readonly floor1: TutorialForgeLayout;
	/**
	 * Floor 2, "Mother Bramble": a small boss floor (`--floor 2 --rooms 2,3,4 --to 3000`: the shortest entrance ->
	 * boss walk, fewest other rooms). Seed 905 at 2 rooms: the entrance and a 34x26 boss room (the larger arena of the
	 * two 28-tile walks), nothing else. Every later floor reuses it, empty.
	 */
	readonly floor2: TutorialForgeLayout;
	/** The tutorial's last floor: stepping into its stairwell (the floor `lastFloor` -> `lastFloor + 1` change) ends it. */
	readonly lastFloor: number;
	/** Hearts at the start (half hearts): wounded, so the flask lesson can heal (TUTORIAL_START_HALF_HEARTS). */
	readonly startHalfHearts: number;
	/** The move lesson is done after walking this many tiles (docs/TUTORIAL.md lesson 1). */
	readonly moveTiles: number;
	/** Lesson spawns that stand in a group (dummies, swarmers) keep at least this many tiles apart. */
	readonly clusterSpacingTiles: number;

	// --- The director (shared/tutorial TutorialDirector): the step script's timing. Real seconds (frame dt).
	/**
	 * The objective card ignores Continue (the FIRE press edge) until it has been up this long, so a click that was
	 * already on its way (focusing the window, the last swing of a fight) does not dismiss it unread.
	 */
	readonly objectiveCardMinSeconds: number;
	/** A callout's HUD highlight (the score panel on the first kill, the hearts on the first harmless hit) lasts this long. */
	readonly calloutHighlightSeconds: number;
	/** The first this many harmless hits also flash the ghost half heart (TutorialView.ghostHeart). */
	readonly ghostHeartHits: number;

	// --- The client (TutorialController, docs/CLIENT.md "The tutorial run"). Real seconds.
	/**
	 * On join the client waits this long for the server's `onboardingStatus` (it also sends `requestOnboarding`).
	 * Without an answer it plays the normal ranked start: a slow DataStore never drags a veteran through the tutorial.
	 */
	readonly statusTimeoutSeconds: number;
	/**
	 * The tutorial finished (the floor lastFloor -> lastFloor + 1 change): the run freezes at once and the outro card
	 * shows this much later (a beat after the boss kill: a player standing on the stairwell descends on that tick).
	 */
	readonly outroDelaySeconds: number;
}

export const TUTORIAL: TutorialTunables = table.freeze({
	runSeed: 4242,
	floor1: table.freeze({ seed: 7513, roomCount: 10 }),
	floor2: table.freeze({ seed: 905, roomCount: 2 }),
	lastFloor: 2,
	startHalfHearts: TUTORIAL_START_HALF_HEARTS,
	moveTiles: 3,
	clusterSpacingTiles: 2,
	objectiveCardMinSeconds: 0.75,
	calloutHighlightSeconds: 4,
	ghostHeartHits: 3,
	statusTimeoutSeconds: 6,
	outroDelaySeconds: 1.5,
});
