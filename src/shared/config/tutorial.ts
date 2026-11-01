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

/**
 * Floor 1: a Forge chain floor (shared/run tutorialChain: the TUTORIAL_ROOMS rooms in lesson order). The seed picks
 * only the theme (AUTO) and the decoration draws; the rooms and corridors are the chain's.
 */
export interface TutorialChainLayout {
	readonly seed: number;
	/** Corridor tiles between one lesson room's floor and the next one's (ForgeChainRoom.gap). */
	readonly corridorTiles: number;
}

export interface TutorialTunables {
	/**
	 * The run's seed (the sim rng and EndlessConfig.runSeed). The layouts below do not depend on it; the client
	 * starts the tutorial with it so every practice run replays the same way.
	 */
	readonly runSeed: number;
	/**
	 * Floor 1, "The Training Halls" (the lesson rooms): a strict chain, entrance -> combat A-F -> treasure -> shrine ->
	 * boss room (the open stairwell), each joined to the next by one short straight corridor and to nothing else
	 * (shared/run TUTORIAL_ROOMS has the rooms; tutorial.spec.ts checks the chain with checkTutorialChain). The seed
	 * only picks the theme and the decoration: 7500 is frost (the floor-1 biome of the old seed-searched layout) with
	 * its two frozen lakes in rooms 4 and 6 (combat D and F), so lesson E keeps its solid pillars (`node
	 * scripts/find-tutorial-seed.js --floor 1 --from 7500 --to 7700` lists the seeds that work: 40 of the first 48).
	 * Corridors are corridorTiles long (5 by the ellipse treasure room's rim); the tour is 198 tiles.
	 */
	readonly floor1: TutorialChainLayout;
	/**
	 * Floor 2, "Mother Bramble": a small boss floor (`--floor 2 --rooms 2,3,4 --to 3000`: the shortest entrance ->
	 * boss walk, fewest other rooms). Seed 905 at 2 rooms: the entrance and a 34x26 boss room (the larger arena of the
	 * two 28-tile walks), nothing else. Every later floor reuses it, empty.
	 */
	readonly floor2: TutorialForgeLayout;
	/** The tutorial's last floor: stepping into its stairwell (the floor `lastFloor` -> `lastFloor + 1` change) ends it. */
	readonly lastFloor: number;
	/**
	 * Mother Bramble's hp on floor 2, percent of her Depth 1 hp (TutorialSimConfig.bossHpPercent; her phase marks
	 * are fractions of it, so phases II and III still play). Tuned so a practice fight is ~20-30 s (docs/TUTORIAL.md).
	 */
	readonly bossHpPercent: number;
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

	// --- TutorialMetrics (shared/tutorial metrics.ts, docs/TUTORIAL_FUNNEL.md §5): the funnel's lesson / stuck reports.
	/**
	 * A stuck episode (one prompt shown with no progress) reports once it has lasted this many real seconds
	 * (TutorialStuckReport; the server's TutorialStuck event).
	 */
	readonly stuckSeconds: number;
	/** Reported seconds (lesson time, stuck episodes) are rounded to 1 / this (10: tenths of a second). */
	readonly metricsResolution: number;

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
	floor1: table.freeze({ seed: 7500, corridorTiles: 4 }),
	floor2: table.freeze({ seed: 905, roomCount: 2 }),
	lastFloor: 2,
	bossHpPercent: 20,
	startHalfHearts: TUTORIAL_START_HALF_HEARTS,
	moveTiles: 3,
	clusterSpacingTiles: 2,
	objectiveCardMinSeconds: 0.75,
	calloutHighlightSeconds: 4,
	ghostHeartHits: 3,
	stuckSeconds: 20,
	metricsResolution: 10,
	statusTimeoutSeconds: 6,
	outroDelaySeconds: 1.5,
});
