/**
 * The stored onboarding document (one DataStore value per player, OnboardingService) and the status the client
 * gets. Pure: decoding never throws, so a garbage or old-shaped value reads as "never played".
 *
 * First sightings (docs/ENEMY_VARIANTS.md EV12, plan change 9): an OPTIONAL `seen` list of sighting ids
 * (./sightings.ts) under the SAME doc version 1. Bumping ONBOARDING_DOC_VERSION would read every stored doc as empty
 * and send every existing player through the first-run tutorial again, so instead: a doc without `seen` (every doc
 * written before EV12) decodes exactly as before, with nothing seen; a bad `seen` alone reads as nothing seen and never
 * touches the tutorial fields; `seen` is written only when it lists something, so a player who has seen nothing keeps
 * the old stored shape. A build from before EV12 reads a new doc fine (it ignores `seen`), but drops `seen` when it
 * writes (only during a rollout with mixed servers; the worst case is a repeated toast).
 *
 * The new-player window (docs/TUTORIAL_FUNNEL.md §7, TF2): three more OPTIONAL fields under the same version, read the
 * same way as `seen`: `firstDay` (a non-negative integer UTC day), `newRuns` (an integer 0..NEW_PLAYER.runs) and
 * `returned` (a boolean). Each is read on its own: missing or malformed decodes as absent and never touches any other
 * field; each is written only when present, so a doc without them keeps the old stored shape. Every copy this module
 * makes (finishing, a sighting) keeps them.
 *
 * @module
 */
import type { DocCodec } from "shared/settings";
import { NEW_PLAYER, ONBOARDING_DOC_VERSION, ONBOARDING_TUTORIAL_VERSION } from "./config";
import { normalizeSeen, sameSeen, withSighting } from "./sightings";

export type TutorialOutcome = "completed" | "skipped";

export const TUTORIAL_OUTCOMES: ReadonlyArray<TutorialOutcome> = ["completed", "skipped"];

export interface OnboardingDoc {
	/** The ONBOARDING_TUTORIAL_VERSION the player last finished; 0 = never finished one. */
	tutorialVersion: number;
	/** How they finished it. Meaningless while tutorialVersion is 0 (the empty doc says "skipped"). */
	outcome: TutorialOutcome;
	/** os.time() of the finish (0 in the empty doc). */
	at: number;
	/**
	 * First sightings (EV12): the sighting ids this account has seen, canonical order (normalizeSeen). Absent = none
	 * (never an empty list: see seenOf / withSeenId).
	 */
	seen?: ReadonlyArray<string>;
	/**
	 * The new-player window (docs/TUTORIAL_FUNNEL.md §7, TF2): the UTC day number (floor(os.time() / 86400)) of the
	 * first fresh join. Absent = the player joined before the field existed (never in the window) or is not fresh.
	 */
	firstDay?: number;
	/** Ranked runs accepted inside the window, 0..NEW_PLAYER.runs (absent = 0). */
	newRuns?: number;
	/** NewPlayerReturned was logged: never again. Absent = false. */
	returned?: boolean;
}

/** What the server tells the client (`onboardingStatus`). */
export interface OnboardingStatus {
	/** False when the join load failed: the stored state is unknown, so the client must not force the tutorial. */
	loaded: boolean;
	/** isTutorialDone of this session's document (false after a failed load, until the player finishes it). */
	tutorialDone: boolean;
	/**
	 * First sightings (EV12): the ids this account has seen (absent = none). Meaningless while `loaded` is false: the
	 * client then shows no first-sighting toast at all (the stored set is unknown).
	 */
	seen?: ReadonlyArray<string>;
}

/** The value as written to the DataStore. */
export interface StoredOnboardingDoc {
	v: number;
	tutorialVersion: number;
	outcome: TutorialOutcome;
	at: number;
	/** Written only when it lists something (EV12; old docs have none). */
	seen?: string[];
	/** The new-player window (TF2): each written only when present. */
	firstDay?: number;
	newRuns?: number;
	returned?: boolean;
}

export function emptyOnboardingDoc(): OnboardingDoc {
	return { tutorialVersion: 0, outcome: "skipped", at: 0 };
}

/**
 * The document written when a player finishes the current tutorial at `at` (os.time()). `seen`: the sightings to keep
 * (pass the current doc's, seenOf(doc): finishing the tutorial never forgets a sighting). `keep`: the doc whose
 * new-player fields (firstDay / newRuns / returned, TF2) to keep (pass the current doc: finishing never resets the
 * new-player window); absent = none.
 */
export function finishedOnboardingDoc(
	outcome: TutorialOutcome,
	at: number,
	seen: ReadonlyArray<string> = [],
	keep?: Readonly<OnboardingDoc>,
): OnboardingDoc {
	const out = withSeenList({ tutorialVersion: ONBOARDING_TUTORIAL_VERSION, outcome, at }, seen);
	return keep !== undefined ? withNewPlayerFields(out, newPlayerFieldsOf(keep)) : out;
}

/** The sighting ids of a doc (empty when it has none). */
export function seenOf(doc: Readonly<OnboardingDoc> | undefined): ReadonlyArray<string> {
	return doc?.seen ?? [];
}

/** `doc` with `seen` normalized (absent when empty), its new-player fields kept. A copy. */
function withSeenList(doc: Readonly<OnboardingDoc>, seen: ReadonlyArray<string>): OnboardingDoc {
	const list = normalizeSeen(seen);
	const out: OnboardingDoc = { tutorialVersion: doc.tutorialVersion, outcome: doc.outcome, at: doc.at };
	if (list.size() > 0) out.seen = list;
	copyNewPlayerFields(out, doc);
	return out;
}

/** The new-player window's doc fields (TF2): each optional. */
export interface NewPlayerFields {
	firstDay?: number;
	newRuns?: number;
	returned?: boolean;
}

/** A valid `firstDay`: a non-negative integer UTC day number. */
export function isNewPlayerFirstDay(v: unknown): v is number {
	return isNonNegativeInteger(v);
}

/** A valid `newRuns`: an integer 0..NEW_PLAYER.runs. */
export function isNewPlayerRunCount(v: unknown): v is number {
	return isNonNegativeInteger(v) && v <= NEW_PLAYER.runs;
}

/** The valid new-player fields of `doc` (a malformed one is left out). */
export function newPlayerFieldsOf(doc: Readonly<NewPlayerFields>): NewPlayerFields {
	const out: NewPlayerFields = {};
	if (isNewPlayerFirstDay(doc.firstDay)) out.firstDay = doc.firstDay;
	if (isNewPlayerRunCount(doc.newRuns)) out.newRuns = doc.newRuns;
	if (typeIs(doc.returned, "boolean")) out.returned = doc.returned;
	return out;
}

/** Copies `from`'s valid new-player fields onto `to` (in place; fields absent in `from` are left as they are). */
function copyNewPlayerFields(to: NewPlayerFields, from: Readonly<NewPlayerFields>): void {
	const f = newPlayerFieldsOf(from);
	if (f.firstDay !== undefined) to.firstDay = f.firstDay;
	if (f.newRuns !== undefined) to.newRuns = f.newRuns;
	if (f.returned !== undefined) to.returned = f.returned;
}

/** `doc` with `patch`'s valid new-player fields set over its own (every other field kept). A copy. */
export function withNewPlayerFields(doc: Readonly<OnboardingDoc>, patch: Readonly<NewPlayerFields>): OnboardingDoc {
	const out = withSeenList(doc, seenOf(doc));
	copyNewPlayerFields(out, patch);
	return out;
}

/**
 * `doc` with sighting `id` added (EV12): a copy with every tutorial field kept, or `doc` itself when `id` was already
 * seen or is unknown (idempotent: the caller can compare by identity, and PlayerDocCache.set sees no change).
 */
export function withSeenId(doc: OnboardingDoc, id: string): OnboardingDoc {
	const before = seenOf(doc);
	const added = withSighting(before, id);
	if (sameSeen(added, before)) return doc;
	return withSeenList(doc, added);
}

/** True when the player finished (completed or skipped) the current tutorial version or a later one. */
export function isTutorialDone(doc: Readonly<OnboardingDoc>): boolean {
	return doc.tutorialVersion >= ONBOARDING_TUTORIAL_VERSION;
}

export function isTutorialOutcome(v: unknown): v is TutorialOutcome {
	return typeIs(v, "string") && TUTORIAL_OUTCOMES.includes(v as TutorialOutcome);
}

function isFiniteNumber(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

function isNonNegativeInteger(v: unknown): v is number {
	return isFiniteNumber(v) && v >= 0 && v % 1 === 0;
}

export function encodeOnboardingDoc(doc: Readonly<OnboardingDoc>): StoredOnboardingDoc {
	const out: StoredOnboardingDoc = {
		v: ONBOARDING_DOC_VERSION,
		tutorialVersion: doc.tutorialVersion,
		outcome: doc.outcome,
		at: doc.at,
	};
	const seen = normalizeSeen(doc.seen);
	if (seen.size() > 0) out.seen = seen;
	copyNewPlayerFields(out, doc);
	return out;
}

/**
 * A stored value -> document. Missing, another doc version, a non-table, a bad tutorialVersion or outcome: the empty
 * doc (the player is offered the tutorial again, which is the safe direction). A bad `at` alone reads as 0, so a
 * finished player is not sent back through the tutorial over a timestamp. `seen` (EV12) is optional and read on its
 * own: missing or bad reads as nothing seen, unknown ids are dropped (normalizeSeen), and neither ever empties the doc.
 * The new-player fields (TF2) are read the same way, each on its own: malformed = absent.
 */
export function decodeOnboardingDoc(raw: unknown): OnboardingDoc {
	if (!typeIs(raw, "table")) return emptyOnboardingDoc();
	const doc = raw as {
		v?: unknown;
		tutorialVersion?: unknown;
		outcome?: unknown;
		at?: unknown;
		seen?: unknown;
		firstDay?: unknown;
		newRuns?: unknown;
		returned?: unknown;
	};
	if (doc.v !== ONBOARDING_DOC_VERSION) return emptyOnboardingDoc();
	if (!isNonNegativeInteger(doc.tutorialVersion) || !isTutorialOutcome(doc.outcome)) return emptyOnboardingDoc();
	const at = isFiniteNumber(doc.at) && doc.at >= 0 ? doc.at : 0;
	const out: OnboardingDoc = { tutorialVersion: doc.tutorialVersion, outcome: doc.outcome, at };
	const seen = normalizeSeen(doc.seen);
	if (seen.size() > 0) out.seen = seen;
	copyNewPlayerFields(out, doc as NewPlayerFields);
	return out;
}

export function sameOnboardingDoc(a: Readonly<OnboardingDoc>, b: Readonly<OnboardingDoc>): boolean {
	return (
		a.tutorialVersion === b.tutorialVersion &&
		a.outcome === b.outcome &&
		a.at === b.at &&
		sameSeen(seenOf(a), seenOf(b)) &&
		a.firstDay === b.firstDay &&
		a.newRuns === b.newRuns &&
		a.returned === b.returned
	);
}

/** The status for a session's document (`loaded` = the join load succeeded); `seen` only when it lists something. */
export function onboardingStatusOf(doc: Readonly<OnboardingDoc> | undefined, loaded: boolean): OnboardingStatus {
	const status: OnboardingStatus = { loaded, tutorialDone: doc !== undefined && isTutorialDone(doc) };
	const seen = seenOf(doc);
	if (seen.size() > 0) status.seen = [...seen];
	return status;
}

/** PlayerDocCache codec (shared/settings store.ts). */
export const ONBOARDING_CODEC: DocCodec<OnboardingDoc> = {
	decode(raw) {
		return decodeOnboardingDoc(raw);
	},
	encode(doc) {
		return encodeOnboardingDoc(doc);
	},
	equals(a, b) {
		return sameOnboardingDoc(a, b);
	},
	empty() {
		return emptyOnboardingDoc();
	},
};
