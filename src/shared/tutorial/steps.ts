/**
 * The tutorial's script as data (docs/TUTORIAL.md "Floor 1" / "Floor 2" tables, "Architecture §3"; a Roblox-port
 * feature, no web source): the ordered steps the TutorialDirector walks, and the one-shot callouts. Pure data.
 *
 * Each step has a stable `id` (also its funnel step name: letters, digits and `_`, at most 32 chars, never renamed
 * once shipped or the funnel splits), a 1-based funnel `number` (its index + 1), where it lives (a floor-1 lesson
 * room, or a floor), its prompt (theme string keys per device: tutorialPromptKey), an optional HUD highlight, the
 * world marker's target and its completion rule. Lessons tied to rooms may finish out of order; the director's
 * current step is the lowest unfinished one.
 *
 * Funnel numbering: the `boost` step (6, docs/BOOSTS.md B9, reversing P8) was inserted on 2026-10-26, so `roll` ..
 * `finish` moved from 6..15 to 7..16 (docs/TUTORIAL.md §6). Never insert or reorder steps lightly: every number after
 * the change point moves, and the dashboard funnel is not comparable across the change.
 */
import type { TutorialLessonId } from "shared/run";

/**
 * The HUD element a step (or a callout) rings with the pulsing `uiAccent` highlight. `boosts` is the boost row
 * (docs/BOOSTS.md B9): rung when the tutorial's guaranteed boost is picked up (TUTORIAL_BOOST_HIGHLIGHT; not the
 * `boost` step's own highlight: the row is empty until the pickup).
 */
export type TutorialHighlight = "flask" | "weapons" | "score" | "bossBar" | "hearts" | "boosts";

/** Every highlight target (the client's ring wiring covers each). */
export const TUTORIAL_HIGHLIGHTS: ReadonlyArray<TutorialHighlight> = [
	"flask",
	"weapons",
	"score",
	"bossBar",
	"hearts",
	"boosts",
];

/**
 * What the world marker points at while the step is current (TutorialDirector resolves it to world XZ):
 *   door       the lesson room's door until the player has entered it; then nothing while inside, the room centre
 *              when they wander out unfinished
 *   pedestal   the room's door until entered, then the pedestal (the room centre)
 *   shrine     the room's door until entered, then the shrine (the room centre)
 *   stairwell  floor 1: the stairwell room's door until entered, then the stairwell; later floors: the stairwell
 *   boss       the living boss (the floor's stairwell, the arena centre, when there is none)
 *   none       no marker
 *   drop       the ground boost drop nearest the player (lowest ground slot on a tie); nothing while none lies on the
 *              floor (the `boost` step, docs/BOOSTS.md B9). While a drop lies and the `boost` step is still open but
 *              not current (an earlier step unfinished), the director shows it out of order too: its prompt and this
 *              marker, except inside an entered, unfinished lesson room and under the objective card
 */
export type TutorialMarkerKind = "door" | "pedestal" | "shrine" | "stairwell" | "boss" | "none" | "drop";

export interface TutorialMarkerTarget {
	readonly kind: TutorialMarkerKind;
	/** The floor-1 lesson room it belongs to (door / pedestal / shrine / floor-1 stairwell). */
	readonly lesson?: TutorialLessonId;
}

/** Input devices a prompt is written for. Touch has no controls yet: its keys hold the keyboard text for now. */
export type TutorialDevice = "keyboard" | "gamepad" | "touch";

export const TUTORIAL_DEVICES: ReadonlyArray<TutorialDevice> = ["keyboard", "gamepad", "touch"];

/** A skill a combat lesson needs besides clearing its room (counted from the frame the room was first entered). */
export type TutorialSkill =
	/** >= 1 dodge roll (events.rollStarted). */
	| "roll"
	/** >= 1 bullet erased by the sword guard (score source `guard`). Waived once the room is cleared without one. */
	| "guard"
	/** The bow in hand (the active weapon set holds weapon.bow). */
	| "bow"
	/** A heavy arrow released (the bow slot's BOW_V_HEAVY_TICK moved). */
	| "heavyArrow"
	/** An Ember burnt (events.emberUsed). Waived once the room is cleared with no Ember left to burn. */
	| "ember";

/**
 * How a step completes (TutorialDirector evaluates it every frame, latching it done):
 *   objective  Continue: a FIRE press edge in the raw input buttons, the card up >= objectiveCardMinSeconds
 *   move       walked >= TUTORIAL.moveTiles tiles (summed per frame; floor-change teleports not counted)
 *   flask      a flask drunk (events.flaskUsed)
 *   clear      the lesson room entered and its scoring record cleared (every member down at once), plus `skills`
 *   relic      the lesson room entered and a relic taken (the pedestal)
 *   curse      a curse accepted, or the shrine's zone left after standing in it
 *   floor      the floor reached >= `floor` (the stairwell)
 *   boon       a boon confirmed in the draft
 *   boss       the boss defeated (Depth grew)
 *   boost      a boost runs on the player (the drop picked up, on its landing frame too); waived (done, not skipped)
 *              once a drop has been seen on the step's floor and none lies there any more while no boost ran (it
 *              faded untaken)
 *
 * Any step still unfinished when the run leaves its floor (`floor` below) is marked skipped (done, never practised):
 * a player who takes the stairwell early is not stuck behind a lesson they can no longer reach.
 */
export type TutorialRule =
	| { readonly kind: "objective" }
	| { readonly kind: "move" }
	| { readonly kind: "flask" }
	| { readonly kind: "clear"; readonly skills: ReadonlyArray<TutorialSkill> }
	| { readonly kind: "relic" }
	| { readonly kind: "curse" }
	| { readonly kind: "floor"; readonly floor: number }
	| { readonly kind: "boon" }
	| { readonly kind: "boss" }
	| { readonly kind: "boost" };

export interface TutorialStep {
	/** Stable id and funnel step name (`[A-Za-z0-9_]`, <= MAX_TUTORIAL_STEP_ID_CHARS). */
	readonly id: string;
	/** Funnel step number, 1-based (= index + 1). */
	readonly number: number;
	/** The floor the step belongs to (1: the Training Halls; 2: Mother Bramble). Left unfinished past it: skipped. */
	readonly floor: number;
	/** The floor-1 room it is taught in (its prompt shows inside it, whatever step is current). */
	readonly lesson?: TutorialLessonId;
	/** Prompt id: theme keys `tutorial.prompt.<prompt>.<device>` (tutorialPromptKey). */
	readonly prompt: string;
	/**
	 * A lesson-room step normally shows the "follow the marker" prompt until its room is entered; true shows its own
	 * prompt on the way there too (the stairwell: the walk in IS the lesson).
	 */
	readonly promptBeforeEntry?: boolean;
	/** The objective card is up while this step is current (TutorialView.card). */
	readonly card?: "objective";
	readonly highlight?: TutorialHighlight;
	readonly marker: TutorialMarkerTarget;
	readonly rule: TutorialRule;
}

/** Longest step id (the funnel's step name limit, shared/onboarding MAX_TUTORIAL_STEP_NAME_CHARS). */
export const MAX_TUTORIAL_STEP_ID_CHARS = 32;

/** The prompt shown while the current step's lesson room has not been entered yet. */
export const TUTORIAL_FOLLOW_PROMPT = "follow";

const NO_MARKER: TutorialMarkerTarget = table.freeze({ kind: "none" as TutorialMarkerKind });

type StepDef = Omit<TutorialStep, "number">;

const STEP_DEFS: ReadonlyArray<StepDef> = [
	// --- Floor 1, entrance (docs/TUTORIAL.md lessons 0-2)
	{
		id: "objective",
		floor: 1,
		prompt: "objective",
		card: "objective",
		marker: NO_MARKER,
		rule: { kind: "objective" },
	},
	{ id: "move", floor: 1, prompt: "move", marker: NO_MARKER, rule: { kind: "move" } },
	{ id: "flask", floor: 1, prompt: "flask", highlight: "flask", marker: NO_MARKER, rule: { kind: "flask" } },
	// --- Floor 1, combat A-F (lessons 3-8), and the boost combat B drops
	{
		id: "attack",
		floor: 1,
		lesson: "combatA",
		prompt: "attack",
		marker: { kind: "door", lesson: "combatA" },
		rule: { kind: "clear", skills: [] },
	},
	{
		id: "hits",
		floor: 1,
		lesson: "combatB",
		prompt: "hits",
		highlight: "hearts",
		marker: { kind: "door", lesson: "combatB" },
		rule: { kind: "clear", skills: [] },
	},
	// Combat B's last kill drops the guaranteed Fury (shared/run TUTORIAL_DROPS_CONFIG, docs/BOOSTS.md B9) wherever
	// that swarmer died: no lesson room. No highlight (the boost row is empty until the pickup, which rings it once:
	// TUTORIAL_BOOST_HIGHLIGHT).
	{ id: "boost", floor: 1, prompt: "boost", marker: { kind: "drop" }, rule: { kind: "boost" } },
	{
		id: "roll",
		floor: 1,
		lesson: "combatC",
		prompt: "roll",
		marker: { kind: "door", lesson: "combatC" },
		rule: { kind: "clear", skills: ["roll"] },
	},
	{
		id: "guard",
		floor: 1,
		lesson: "combatD",
		prompt: "guard",
		marker: { kind: "door", lesson: "combatD" },
		rule: { kind: "clear", skills: ["guard"] },
	},
	{
		id: "bow",
		floor: 1,
		lesson: "combatE",
		prompt: "bow",
		highlight: "weapons",
		marker: { kind: "door", lesson: "combatE" },
		rule: { kind: "clear", skills: ["bow", "heavyArrow"] },
	},
	{
		id: "ember",
		floor: 1,
		lesson: "combatF",
		prompt: "ember",
		marker: { kind: "door", lesson: "combatF" },
		rule: { kind: "clear", skills: ["ember"] },
	},
	// --- Floor 1, treasure, shrine, stairwell (lessons 9, 10, 12; 11 is the score callout)
	{
		id: "relic",
		floor: 1,
		lesson: "treasure",
		prompt: "relic",
		marker: { kind: "pedestal", lesson: "treasure" },
		rule: { kind: "relic" },
	},
	{
		id: "curse",
		floor: 1,
		lesson: "shrine",
		prompt: "curse",
		highlight: "score",
		marker: { kind: "shrine", lesson: "shrine" },
		rule: { kind: "curse" },
	},
	{
		id: "stairwell",
		floor: 1,
		lesson: "stairwell",
		prompt: "stairwell",
		promptBeforeEntry: true,
		marker: { kind: "stairwell", lesson: "stairwell" },
		rule: { kind: "floor", floor: 2 },
	},
	// --- Between floors 1 and 2: the real boon draft
	{ id: "draft", floor: 2, prompt: "draft", marker: NO_MARKER, rule: { kind: "boon" } },
	// --- Floor 2, Mother Bramble
	{ id: "boss", floor: 2, prompt: "boss", highlight: "bossBar", marker: { kind: "boss" }, rule: { kind: "boss" } },
	{ id: "finish", floor: 2, prompt: "finish", marker: { kind: "stairwell" }, rule: { kind: "floor", floor: 3 } },
];

function numbered(defs: ReadonlyArray<StepDef>): ReadonlyArray<TutorialStep> {
	const out: TutorialStep[] = [];
	for (let i = 0; i < defs.size(); i++) out.push(table.freeze({ ...defs[i], number: i + 1 }) as TutorialStep);
	return table.freeze(out);
}

/** The tutorial's steps, in order (funnel numbers 1..TUTORIAL_STEP_COUNT). */
export const TUTORIAL_STEPS: ReadonlyArray<TutorialStep> = numbered(STEP_DEFS);

/** Number of steps: the funnel's last lesson step (shared/onboarding TUTORIAL_FUNNEL_MAX_STEP equals it). */
export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.size();

/** The step with funnel number `n` (1-based), or undefined. */
export function tutorialStepByNumber(n: number): TutorialStep | undefined {
	if (n % 1 !== 0) return undefined;
	return TUTORIAL_STEPS[n - 1];
}

/** The funnel step name of step number `n` (its id), or undefined for a number outside 1..TUTORIAL_STEP_COUNT. */
export function tutorialStepName(n: number): string | undefined {
	return tutorialStepByNumber(n)?.id;
}

/** The index of step `id` in TUTORIAL_STEPS, or -1. */
export function tutorialStepIndex(id: string): number {
	for (let i = 0; i < TUTORIAL_STEPS.size(); i++) if (TUTORIAL_STEPS[i].id === id) return i;
	return -1;
}

// ---------------------------------------------------------------------------------------------
// Callouts: one-shot toasts (never blocking, never a funnel step)

/**
 * What fires a callout (once per tutorial):
 *   firstKill     the first enemy killed (score source `kills`): the score lesson (docs/TUTORIAL.md lesson 11)
 *   harmlessHit   the first hit that landed harmlessly ("in a real run that costs half a heart")
 *   graze         the first graze (praise)
 *   bossPhase     the boss entered phase `phase`
 * (The boost drop is a step, `boost`, not a callout: docs/BOOSTS.md B9.)
 */
export type TutorialCalloutTrigger =
	| { readonly kind: "firstKill" }
	| { readonly kind: "harmlessHit" }
	| { readonly kind: "graze" }
	| { readonly kind: "bossPhase"; readonly phase: number };

export interface TutorialCallout {
	readonly id: string;
	/** Theme string key `tutorial.callout.<id>` (device-independent). */
	readonly key: string;
	readonly trigger: TutorialCalloutTrigger;
	/** Rung for TUTORIAL.calloutHighlightSeconds when it fires (over the step's own highlight). */
	readonly highlight?: TutorialHighlight;
}

function callout(id: string, trigger: TutorialCalloutTrigger, highlight?: TutorialHighlight): TutorialCallout {
	return table.freeze({ id, key: `tutorial.callout.${id}`, trigger, highlight });
}

/** Every callout, in check order (several may fire on one frame; they queue in this order). */
export const TUTORIAL_CALLOUTS: ReadonlyArray<TutorialCallout> = table.freeze([
	callout("score", { kind: "firstKill" }, "score"),
	callout("harmlessHit", { kind: "harmlessHit" }, "hearts"),
	callout("graze", { kind: "graze" }),
	callout("bossPhase2", { kind: "bossPhase", phase: 2 }, "bossBar"),
	callout("bossPhase3", { kind: "bossPhase", phase: 3 }, "bossBar"),
]);

/**
 * Rung for TUTORIAL.calloutHighlightSeconds on the first frame a boost runs on the player (the pickup of combat B's
 * Fury, docs/BOOSTS.md B9: the moment the `boost` step completes). Not a callout (no toast of its own: the HUD's
 * `hud.toast.boost` says what the boost does), and not the step's highlight (the row is empty before the pickup).
 */
export const TUTORIAL_BOOST_HIGHLIGHT: TutorialHighlight = "boosts";
