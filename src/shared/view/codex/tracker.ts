/**
 * The Codex tracker (claude/codex-plan.md CX4, rules table as amended by decisions R1 / R2 / R5 / R14): per frame, from a
 * CodexFrame (frame.ts), which Codex entries rose for this account, which of those rises toast, and the run's summary.
 * Pure (no Roblox API); the client's CodexController owns one for the session, feeds it every `codexStatus`, starts it
 * per run with the run's eligibility (shared/codex codexEligibility) and sends its rises as `codexClaim`s.
 *
 * What counts (sightings follow the VIEW player, finds are the LOCAL player's own):
 *
 *   category    seen                                            found
 *   boon        dealt to you on a draft card (CardKind NEW /    owned (RunPlayerState.boons, any level)
 *               UPGRADE)
 *   evolution   its EVOLUTION card dealt to you                 the boon's level reaches III (BOON_MAX_LEVEL)
 *   duo         its duo card dealt to you                       owned (builds' duos)
 *   relic       (R1: never shown before the take: seen = found) owned (pedestal or vault chest)
 *   curse       the Pact of Greed card names it to the view     owned (Greed or a shrine; R2)
 *               player (R2)
 *   boost       a drop of that kind near the view player        it runs on you (state, not the snapshot)
 *   enemy       a living one near the view player               one dies while you are in the run (any party
 *                                                               member's kill; a slimelet counts for the Ooze)
 *   affix       an affixed enemy near the view player           an affixed enemy of that kind dies (same rule)
 *   boss        it engages                                      it dies
 *
 * "Near" is SIGHTING_VIEW.radius (readCodexFrame). Turrets, the dummy and the power pellet have no entry (R5, R8).
 *
 * Rises: an entry rises when this frame shows it above its BASELINE tier: the loaded doc (every `receive`, merged up)
 * plus every rise this tracker already reported this session. Each rise is reported once, at its highest tier on that
 * frame (a seen and a found on one frame is one found rise). Nothing rises:
 *   - for a run that cannot claim (eligibility.claims false: M1, dev, debug, stress, unknown worlds);
 *   - before startRun, from the frame the run is over or the local player left (and for the rest of that run);
 *   - before the doc is loaded: the frame's entries are HELD (no rise, no toast, so never a false NEW) and resolved
 *     silently by the `receive` that loads the doc (rises against the loaded doc; a found one still counts as new this
 *     run when the run is the same); a failed load (`receive(undefined)`) drops what was held and stops holding.
 *
 * Toasts (only when eligibility.toasts: never in the tutorial, which claims silently; R8), CXD7 / R14:
 *   - chip: the entry's existing toast this frame gets the NEW! chip: boon found (boon toast), evolution found (the
 *     evolved toast), duo found, a pedestal relic (the relic toast: frame.pedestalRelics), curse found;
 *   - card: a first sighting with a bestiary line (`bestiary.<id>`: the SightingCard shows it later through its own
 *     queue; sightingChip(id) tells the card to wear the chip). Always, outside the budget: a first sighting is new by
 *     definition, and the card plays anyway;
 *   - codex: a codex toast (nothing else toasts): an enemy / affix / boss found, a boost found, a sighting of a kind
 *     with no bestiary line (swarmer, sniper, bruiser), a relic from a vault chest (no relic toast, R1). At most one
 *     codex toast per entry per run (a swarmer's sighting and its first kill would read the same);
 *   - none: a draft card dealt (the card's NEW tag: showsNewTag), a drop seen, a Greed card, a boss engaging.
 * The budget (CXD8): at most CODEX.toastsPerFloor chips and codex toasts per floor, in catalog order; a duo or
 * evolution chip, a boss kill and a chest relic always pass and never use it. Over budget the rise is silent (it still
 * claims and still goes to the run-over line).
 *
 * The run summary (codexRunSummary, R12 / RR's line): the entries found for the FIRST time ever this run, in the order
 * found (one frame's finds rarest first: legendary boon, duo, evolution, boss, rare boon, the rest; then catalog
 * order), this account's found total and the catalog's, and whether the Codex is loaded. Frozen when the run is over
 * (or the local player left, or the run ended).
 */
import {
	CODEX,
	CODEX_CATALOG,
	CodexTier,
	catalogTotal,
	codexAffixId,
	codexBoonId,
	codexBossId,
	codexBoostId,
	codexCardId,
	codexCurseId,
	codexDuoId,
	codexEnemyId,
	codexEntry,
	codexEvoId,
	codexRelicId,
	seedFromSightings,
	type CodexClaim,
	type CodexDoc,
	type CodexEligibility,
	type CodexEntry,
	type CodexTierId,
} from "shared/codex";
import { BOONS, BOON_MAX_LEVEL, Rarity, type CardKindId } from "shared/sim";
import type { CodexFrame } from "./frame";

/** One rise: the claim CodexController sends (`codexClaim`). `floor` is the frame's floor for a found, 0 for a seen. */
export type CodexRise = CodexClaim;

/** How a rise shows (see the file comment). */
export type CodexToastRoute = "none" | "card" | "chip" | "codex";

export interface CodexToastDecision {
	readonly route: CodexToastRoute;
	/** Outside the budget: a duo / evolution chip, a boss kill, a vault chest's relic. */
	readonly always: boolean;
}

/** What one update reports. One object, reused every frame: read it, never keep it. */
export interface CodexTrackerOutput {
	/** The entries that rose this frame, catalog order: send them as claims. */
	readonly rises: ReadonlyArray<CodexRise>;
	/** Entries to show a codex toast for now (budget applied), catalog order. */
	readonly codexToasts: ReadonlyArray<string>;
	/** Entries whose existing toast this frame wears the NEW! chip (budget applied), catalog order. */
	readonly chips: ReadonlyArray<string>;
}

/** The run-over line's data (R12: RunOverPanel's codex row, RR). */
export interface CodexRunSummary {
	/** Entries found for the first time ever this run, in found order (rarest first on one frame). */
	readonly newIds: ReadonlyArray<string>;
	/** Entries this account has found (the loaded doc plus this session's rises). */
	readonly foundTotal: number;
	/** Every catalog entry: the 100 % mark. */
	readonly catalogTotal: number;
	/** The Codex is loaded (false: hide the line). */
	readonly loaded: boolean;
}

/** The order rarer finds sort first in on one frame (the run-over strip): lower = rarer. */
export const CODEX_SUMMARY_RANK = { legendary: 0, duo: 1, evolution: 2, boss: 3, rare: 4, other: 5 } as const;

/** The summary rank of `entry` (CODEX_SUMMARY_RANK). */
export function codexSummaryRank(entry: Readonly<CodexEntry>): number {
	const R = CODEX_SUMMARY_RANK;
	switch (entry.group) {
		case "boons": {
			const rarity = BOONS[(entry.artRef as { index: number }).index]?.rarity;
			return rarity === Rarity.LEGENDARY ? R.legendary : rarity === Rarity.RARE ? R.rare : R.other;
		}
		case "duos":
			return R.duo;
		case "evolutions":
			return R.evolution;
		case "bosses":
			return R.boss;
		default:
			return R.other;
	}
}

const NONE_ROUTE: CodexToastDecision = table.freeze({ route: "none", always: false });
const CARD_ROUTE: CodexToastDecision = table.freeze({ route: "card", always: true });
const CHIP_ROUTE: CodexToastDecision = table.freeze({ route: "chip", always: false });
const CHIP_ALWAYS: CodexToastDecision = table.freeze({ route: "chip", always: true });
const CODEX_ROUTE: CodexToastDecision = table.freeze({ route: "codex", always: false });
const CODEX_ALWAYS: CodexToastDecision = table.freeze({ route: "codex", always: true });

/** The bestiary tells' key prefix: an entry described by one has a first-sighting card. */
const BESTIARY_PREFIX = "bestiary.";

function hasSightingCard(entry: Readonly<CodexEntry>): boolean {
	return entry.descKey.sub(1, BESTIARY_PREFIX.size()) === BESTIARY_PREFIX;
}

/**
 * How a rise of `entry` to `tier` shows (see the file comment). `pedestal`: the relic's toast is on screen this frame
 * (frame.pedestalRelics); a found relic without one came from a vault chest.
 */
export function codexToastRoute(entry: Readonly<CodexEntry>, tier: CodexTierId, pedestal: boolean): CodexToastDecision {
	const found = tier === CodexTier.FOUND;
	switch (entry.group) {
		case "boons":
		case "curses":
			return found ? CHIP_ROUTE : NONE_ROUTE;
		case "evolutions":
		case "duos":
			return found ? CHIP_ALWAYS : NONE_ROUTE;
		case "relics":
			return !found ? NONE_ROUTE : pedestal ? CHIP_ROUTE : CODEX_ALWAYS;
		case "boosts":
			return found ? CODEX_ROUTE : NONE_ROUTE;
		case "enemies":
		case "champions":
			return found ? CODEX_ROUTE : hasSightingCard(entry) ? CARD_ROUTE : CODEX_ROUTE;
		case "bosses":
			return found ? CODEX_ALWAYS : NONE_ROUTE;
	}
	return NONE_ROUTE;
}

/** The Codex entry of a first-sighting id (shared/onboarding SIGHTING_IDS: `imp`, `affix.swift`), or undefined. */
export function codexSightingId(sighting: string): string | undefined {
	return seedFromSightings([sighting])[0]?.id;
}

/** Catalog position of every id (rises sort by it). */
const CATALOG_INDEX = ((): ReadonlyMap<string, number> => {
	const m = new Map<string, number>();
	for (let i = 0; i < CODEX_CATALOG.size(); i++) m.set(CODEX_CATALOG[i].id, i);
	return m;
})();

function catalogIndex(id: string): number {
	return CATALOG_INDEX.get(id) ?? CODEX_CATALOG.size();
}

/** The Codex doc's state as the tracker knows it. */
type LoadState = "pending" | "loaded" | "failed";

interface Held {
	tier: CodexTierId;
	floor: number;
	run: number;
}

const NO_ELIGIBILITY: CodexEligibility = table.freeze({ claims: false, toasts: false });

export class CodexTracker {
	private load: LoadState = "pending";
	/** Baseline tier per id: the loaded doc merged up, plus every reported rise. */
	private readonly known = new Map<string, CodexTierId>();
	private foundCount = 0;

	private eligibility: CodexEligibility = NO_ELIGIBILITY;
	/** startRun's serial (held entries remember theirs). 0 = no run yet. */
	private run = 0;
	private inRun = false;
	/** The run is over or the local player left: nothing counts until the next startRun. */
	private ended = false;
	private readonly newIds: string[] = [];
	/** The highest tier each id rose to this run. */
	private readonly risen = new Map<string, CodexTierId>();
	/** Entries that had a codex toast this run. */
	private readonly toasted = new Set<string>();
	private budgetFloor = -1;
	private spent = 0;
	private frozen: CodexRunSummary | undefined;

	/** Entries seen before the doc loaded, in first-seen order. */
	private readonly heldIds: string[] = [];
	private readonly held = new Map<string, Held>();

	/** One frame's observations: ids in first-observed order and their highest tier. */
	private readonly candIds: string[] = [];
	private readonly cand = new Map<string, CodexTierId>();
	private readonly found: string[] = [];
	private readonly rises: CodexRise[] = [];
	private readonly codexToasts: string[] = [];
	private readonly chips: string[] = [];
	private readonly output: CodexTrackerOutput = {
		rises: this.rises,
		codexToasts: this.codexToasts,
		chips: this.chips,
	};

	/**
	 * A `codexStatus` arrived (shared/codex codexDocOfStatus): the doc, or undefined for `loaded: false`. A doc merges
	 * into the baseline (tiers only rise) and resolves the held entries: those above it are returned as rises (silent;
	 * claim them). Undefined before any doc loaded: the Codex is unavailable, the held entries drop and nothing is held
	 * from now on; ignored once a doc loaded.
	 */
	receive(doc: Readonly<CodexDoc> | undefined): CodexRise[] {
		const out: CodexRise[] = [];
		if (doc === undefined) {
			if (this.load !== "loaded") {
				this.load = "failed";
				this.clearHeld();
			}
			return out;
		}
		this.load = "loaded";
		for (const [id, mark] of doc.e) {
			const tier = mark[0] as CodexTierId;
			if (tier > this.tier(id)) this.known.set(id, tier);
		}
		this.countFound();
		this.found.clear();
		for (const id of this.heldIds) {
			const h = this.held.get(id) as Held;
			if (h.tier <= this.tier(id)) continue;
			out.push(this.riseOf(id, h.tier, h.floor));
			if (h.run === this.run && this.run > 0) {
				this.markRisen(id, h.tier);
				if (h.tier === CodexTier.FOUND) this.found.push(id);
			}
		}
		this.pushFound();
		this.clearHeld();
		return out;
	}

	/** A run starts: `eligibility` from shared/codex codexEligibility. Resets the run's summary, budget and toasts. */
	startRun(eligibility: CodexEligibility): void {
		this.run++;
		this.inRun = true;
		this.ended = false;
		this.eligibility = eligibility;
		this.newIds.clear();
		this.risen.clear();
		this.toasted.clear();
		this.budgetFloor = -1;
		this.spent = 0;
		this.frozen = undefined;
	}

	/** The run was left (run exit, back to the menu): nothing counts until the next startRun; the summary freezes. */
	endRun(): void {
		if (this.inRun) this.freeze();
		this.inRun = false;
		this.ended = true;
	}

	/** One frame. The returned object is reused (see CodexTrackerOutput). */
	update(frame: Readonly<CodexFrame>): CodexTrackerOutput {
		this.rises.clear();
		this.codexToasts.clear();
		this.chips.clear();
		if (!this.inRun || this.ended) return this.output;
		if (frame.left || frame.runOver) {
			this.ended = true;
			this.freeze();
			return this.output;
		}
		if (!this.eligibility.claims || this.load === "failed") return this.output;
		this.collect(frame);
		if (this.load === "pending") {
			this.hold(frame.floor);
			return this.output;
		}
		const order = this.candIds;
		order.sort((a, b) => catalogIndex(a) < catalogIndex(b));
		this.found.clear();
		for (const id of order) {
			const tier = this.cand.get(id) as CodexTierId;
			if (tier <= this.tier(id)) continue;
			this.rises.push(this.riseOf(id, tier, frame.floor));
			this.markRisen(id, tier);
			if (tier === CodexTier.FOUND) this.found.push(id);
		}
		this.pushFound();
		if (this.eligibility.toasts) this.decideToasts(frame);
		return this.output;
	}

	/** A doc has loaded (a status with `loaded: true` arrived). */
	isLoaded(): boolean {
		return this.load === "loaded";
	}

	/** The load failed (`loaded: false` before any doc): the Codex is unavailable this session. */
	isUnavailable(): boolean {
		return this.load === "failed";
	}

	/** `id`'s baseline tier: the loaded doc plus this session's rises (CodexTier.NONE when unknown or not loaded). */
	tier(id: string): CodexTierId {
		return this.known.get(id) ?? CodexTier.NONE;
	}

	/**
	 * A draft card for entry `id` wears the NEW tag (CXD9, CX8): the run shows codex toasts, the doc is loaded, and the
	 * entry is not found yet (seen at the deal still counts as not found).
	 */
	showsNewTag(id: string | undefined): boolean {
		if (id === undefined || !this.counting() || !this.eligibility.toasts || this.load !== "loaded") return false;
		return codexEntry(id) !== undefined && this.tier(id) < CodexTier.FOUND;
	}

	/** Entry `id` was found this run for the first time ever (BO's callout line, CX9). */
	codexNewThisRun(id: string): boolean {
		return this.risen.get(id) === CodexTier.FOUND;
	}

	/** The highest tier `id` rose to this run (CodexTier.NONE: it did not). */
	risenThisRun(id: string): CodexTierId {
		return this.risen.get(id) ?? CodexTier.NONE;
	}

	/**
	 * The SightingCard for first-sighting id `sighting` (`imp`, `affix.swift`) wears the NEW! chip: the run shows codex
	 * toasts and the entry rose this run (R11; outside the budget, see the file comment).
	 */
	sightingChip(sighting: string): boolean {
		if (!this.eligibility.toasts) return false;
		const id = codexSightingId(sighting);
		return id !== undefined && this.risenThisRun(id) !== CodexTier.NONE;
	}

	/** The run-over line's data: live during the run, frozen once the run is over (or left / ended). */
	codexRunSummary(): CodexRunSummary {
		return this.frozen ?? this.summaryNow();
	}

	// --- internals ---------------------------------------------------------------------------------------------------

	private counting(): boolean {
		return this.inRun && !this.ended && this.eligibility.claims;
	}

	private summaryNow(): CodexRunSummary {
		return table.freeze({
			newIds: table.freeze([...this.newIds]),
			foundTotal: this.foundCount,
			catalogTotal: catalogTotal(),
			loaded: this.load === "loaded",
		});
	}

	private freeze(): void {
		if (this.frozen === undefined) this.frozen = this.summaryNow();
	}

	private countFound(): void {
		let n = 0;
		for (const [, tier] of this.known) if (tier === CodexTier.FOUND) n++;
		this.foundCount = n;
	}

	private riseOf(id: string, tier: CodexTierId, floor: number): CodexRise {
		if (tier === CodexTier.FOUND && this.tier(id) !== CodexTier.FOUND) this.foundCount++;
		this.known.set(id, tier);
		return table.freeze({ id, tier, floor: tier === CodexTier.FOUND ? floor : 0 });
	}

	private markRisen(id: string, tier: CodexTierId): void {
		if (tier > this.risenThisRun(id)) this.risen.set(id, tier);
	}

	/** this.found (one batch of finds) -> newIds, rarest first, then catalog order. */
	private pushFound(): void {
		const f = this.found;
		f.sort((a, b) => {
			const ra = codexSummaryRank(codexEntry(a) as CodexEntry);
			const rb = codexSummaryRank(codexEntry(b) as CodexEntry);
			return ra !== rb ? ra < rb : catalogIndex(a) < catalogIndex(b);
		});
		for (const id of f) this.newIds.push(id);
		f.clear();
	}

	private clearHeld(): void {
		this.heldIds.clear();
		this.held.clear();
	}

	private hold(floor: number): void {
		for (const id of this.candIds) {
			const tier = this.cand.get(id) as CodexTierId;
			const h = this.held.get(id);
			if (h === undefined) {
				this.heldIds.push(id);
				this.held.set(id, { tier, floor: tier === CodexTier.FOUND ? floor : 0, run: this.run });
			} else if (tier > h.tier) {
				h.tier = tier;
				h.floor = tier === CodexTier.FOUND ? floor : 0;
				h.run = this.run;
			}
		}
	}

	private observe(id: string | undefined, tier: CodexTierId): void {
		if (id === undefined) return;
		const cur = this.cand.get(id);
		if (cur === undefined) {
			this.candIds.push(id);
			this.cand.set(id, tier);
		} else if (tier > cur) this.cand.set(id, tier);
	}

	/** Every entry the frame shows, at its tier (see the file comment's table). */
	private collect(f: Readonly<CodexFrame>): void {
		this.candIds.clear();
		this.cand.clear();
		const SEEN = CodexTier.SEEN;
		const FOUND = CodexTier.FOUND;
		for (let i = 0; i < f.draftOffers.size(); i++) {
			const kind = f.draftKinds[i] ?? -1;
			this.observe(codexCardId(f.draftOffers[i], kind >= 0 ? (kind as CardKindId) : undefined), SEEN);
		}
		for (const b of f.boons) this.observe(codexBoonId(b), FOUND);
		// every Boon index (a level list may be short or sparse: a missing level is 0)
		for (let b = 0; b < BOONS.size(); b++)
			if ((f.levels[b] ?? 0) >= BOON_MAX_LEVEL) this.observe(codexEvoId(b), FOUND);
		for (const d of f.duos) this.observe(codexDuoId(d), FOUND);
		for (const r of f.relics) this.observe(codexRelicId(r), FOUND);
		for (const c of f.curses) this.observe(codexCurseId(c), FOUND);
		if (f.greedCurse >= 0) this.observe(codexCurseId(f.greedCurse), SEEN);
		for (const k of f.drops) this.observe(codexBoostId(k), SEEN);
		for (const k of f.boosts) this.observe(codexBoostId(k), FOUND);
		for (const a of f.actors) {
			this.observe(codexEnemyId(a.archetype), SEEN);
			this.observe(codexAffixId(a.affix), SEEN);
		}
		for (const a of f.deaths) {
			this.observe(codexEnemyId(a.archetype) ?? codexBossId(a.archetype), FOUND);
			this.observe(codexAffixId(a.affix), FOUND);
		}
		if (f.bossEngaged !== undefined) this.observe(codexBossId(f.bossEngaged), SEEN);
		if (f.bossDefeated !== undefined) this.observe(codexBossId(f.bossDefeated), FOUND);
	}

	private decideToasts(frame: Readonly<CodexFrame>): void {
		if (frame.floor !== this.budgetFloor) {
			this.budgetFloor = frame.floor;
			this.spent = 0;
		}
		for (const rise of this.rises) {
			const entry = codexEntry(rise.id) as CodexEntry;
			const pedestal =
				entry.group === "relics" && frame.pedestalRelics.includes((entry.artRef as { index: number }).index);
			const d = codexToastRoute(entry, rise.tier as CodexTierId, pedestal);
			if (d.route === "none" || d.route === "card") continue;
			if (d.route === "codex" && this.toasted.has(rise.id)) continue;
			if (!d.always) {
				if (this.spent >= CODEX.toastsPerFloor) continue;
				this.spent++;
			}
			if (d.route === "codex") {
				this.toasted.add(rise.id);
				this.codexToasts.push(rise.id);
			} else this.chips.push(rise.id);
		}
	}
}
