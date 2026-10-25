/**
 * Per-run telemetry derived from the sim's events (Roblox port of project-kaleb-vale src/playtest/telemetry.ts
 * `PlaytestTelemetry.observeTick` / `outcome`, src/playtest/taps.ts `DEFAULT_TAPS` / `hitSourceName` /
 * `KNOWN_EVENT_FIELDS`, and src/playtest/aggregate.mjs `aliveTicks` @ 42897e2).
 *
 * The server feeds it the states of its OWN replay of a submitted recording (validate.ts), so nothing here can be
 * forged by a client: every number comes from re-simulated SimEvents. Pure and Roblox-API-free (headless tests feed
 * it the fixture runs' event streams). The web build's session / storage / export / post-run-screen parts have no
 * Roblox counterpart: AnalyticsService (analytics.ts) replaces the F9 export.
 *
 * Differences from the web record, all deliberate:
 *  - No wall clock, run ids or recordings (the server owns those).
 *  - The end reason knows only what a replay shows: "death", "victory", or "abandoned" (the web build's retry / quit
 *    split is a UI action outside the recording).
 *  - Explicit stats the web build left in counters: weapon swaps, first kill tick, boss engage tick, highest boss
 *    phase, and the death cause (the archetype of the hit that killed the player).
 */
import { SIM_EVENT_FIELDS, archetypeIds, type SimEvents } from "shared/sim";

export type RunEndReason = "death" | "victory" | "abandoned";

/** A named moment of the run (the web build's `Marker`), e.g. `boss.phase` with value 2. */
export interface RunMarker {
	/** SimState.tick after the step that produced it. */
	readonly tick: number;
	readonly name: string;
	readonly value?: number;
}

export interface RunTelemetryRecord {
	/** Sim ticks stepped (includes ticks after death). */
	ticks: number;
	endReason: RunEndReason;
	/** Ticks survived (SimState.tick on the death tick), or undefined. */
	deathTick: number | undefined;
	victoryTick: number | undefined;
	/** Ticks alive: min(ticks, deathTick). */
	aliveTicks: number;
	/** Half hearts lost to hits (heals don't subtract). */
	heartsLostTotal: number;
	hitsTaken: number;
	flasksUsed: number;
	embersUsed: number;
	rollsStarted: number;
	shotsFired: number;
	kills: number;
	enemyHits: number;
	bulletsCleared: number;
	weaponSwaps: number;
	firstKillTick: number | undefined;
	/** Times a boss fight started (`boss.attempt`). */
	bossAttempts: number;
	bossEngagedTick: number | undefined;
	/** Highest boss phase seen (0 = never engaged). */
	bossPhaseReached: number;
	bossDefeated: boolean;
	/** Archetype id of the last hit before death ("unknown" for a debug / stress hit); undefined if alive. */
	deathCause: string | undefined;
	/** Player hits by archetype id (`hitBy.<id>` counters, without the prefix). */
	hitsBySource: Map<string, number>;
	/** The web build's free-form counters: `hitBy.<id>`, `boss.attempt`, `event.<field>` for unmapped SimEvents. */
	counters: Map<string, number>;
	markers: RunMarker[];
}

/** SimEvents fields mapped to fixed stats (the web build's KNOWN_EVENT_FIELDS). */
export const KNOWN_EVENT_FIELDS: ReadonlyArray<keyof SimEvents> = [
	"emberUsed",
	"playerHits",
	"rollStarted",
	"flaskUsed",
	"playerDied",
	"bulletsCleared",
	"shotsFired",
	"enemyHits",
	"enemiesKilled",
];

/** Fields the taps consume (excluded from the automatic `event.<field>` counters, as in the web build). */
export const TAP_EVENT_FIELDS: ReadonlyArray<keyof SimEvents> = [
	"lastHitSource",
	"bossPhase",
	"bossEngaged",
	"bossDefeated",
];

/** Most markers kept per run (the web build's DEFAULT_MAX_MARKERS). */
export const MAX_MARKERS_PER_RUN = 400;

/**
 * A readable name for events.lastHitSource (an archetype INDEX): its archetype id, "unknown" for -1 (debug hit,
 * stress bullets), or the index as text when no archetype has that index.
 */
export function hitSourceName(src: number, names: ReadonlyArray<string>): string {
	if (src < 0) return "unknown";
	return names[src] ?? tostring(src);
}

/** The slice of SimState the telemetry reads (structural, so tests can pass fixture event streams). */
export interface TickView {
	readonly tick: number;
	readonly events: Readonly<Partial<SimEvents>>;
	readonly player: { readonly hearts: number; readonly dead: number };
}

function num(v: number | undefined): number {
	return v !== undefined && v === v && v !== math.huge && v !== -math.huge ? v : 0;
}

function bump(map: Map<string, number>, key: string, by: number): void {
	map.set(key, (map.get(key) ?? 0) + by);
}

/**
 * Accumulates one run. Call `observe` after every step (with the state it produced), then `finish()`.
 * `names` maps archetype indices to ids (default: the sim's registry, `archetypeIds()`).
 */
export class RunTelemetry {
	private readonly names: ReadonlyArray<string>;
	private prevHearts: number;
	private ticks = 0;
	private deathTick: number | undefined;
	private victoryTick: number | undefined;
	private heartsLostTotal = 0;
	private hitsTaken = 0;
	private flasksUsed = 0;
	private embersUsed = 0;
	private rollsStarted = 0;
	private shotsFired = 0;
	private kills = 0;
	private enemyHits = 0;
	private bulletsCleared = 0;
	private firstKillTick: number | undefined;
	private bossEngagedTick: number | undefined;
	private bossPhaseReached = 0;
	private bossDefeated = false;
	/** hitBy name of the latest player hit (the death cause when the player dies). */
	private lastHitBy: string | undefined;
	private deathCause: string | undefined;
	private readonly hitsBySource = new Map<string, number>();
	private readonly counters = new Map<string, number>();
	private readonly markers: RunMarker[] = [];
	private markersDropped = 0;

	constructor(startHearts: number, names: ReadonlyArray<string> = archetypeIds()) {
		this.prevHearts = startHearts;
		this.names = names;
	}

	observe(view: TickView): void {
		const e = view.events;
		const tick = view.tick;
		this.ticks = tick;
		const hits = num(e.playerHits);
		this.hitsTaken += hits;
		this.flasksUsed += num(e.flaskUsed);
		this.embersUsed += num(e.emberUsed);
		this.rollsStarted += num(e.rollStarted);
		this.shotsFired += num(e.shotsFired);
		const killed = num(e.enemiesKilled);
		this.kills += killed;
		if (killed > 0 && this.firstKillTick === undefined) this.firstKillTick = tick;
		this.enemyHits += num(e.enemyHits);
		this.bulletsCleared += num(e.bulletsCleared);

		const hearts = num(view.player.hearts);
		if (hearts < this.prevHearts) this.heartsLostTotal += this.prevHearts - hearts;
		this.prevHearts = hearts;

		// Fields nobody maps: summed into counters so new SimEvents show up without code (as in the web build).
		for (const field of SIM_EVENT_FIELDS) {
			if (KNOWN_EVENT_FIELDS.includes(field) || TAP_EVENT_FIELDS.includes(field)) continue;
			const v = num(e[field]);
			if (v !== 0) bump(this.counters, `event.${field}`, v);
		}

		// Taps (DEFAULT_TAPS order): lastHitSource, bossPhase, bossEngaged, bossDefeated.
		if (hits > 0) {
			// Absent = the field's default, -1 (event streams in fixtures omit default values).
			const name = hitSourceName(e.lastHitSource ?? -1, this.names);
			bump(this.counters, `hitBy.${name}`, 1);
			bump(this.hitsBySource, name, 1);
			this.lastHitBy = name;
		}
		const phase = num(e.bossPhase);
		if (phase > 0) {
			this.mark(tick, "boss.phase", phase);
			if (phase > this.bossPhaseReached) this.bossPhaseReached = phase;
		}
		if (num(e.bossEngaged) > 0) {
			bump(this.counters, "boss.attempt", 1);
			this.mark(tick, "boss.engaged");
			if (this.bossEngagedTick === undefined) this.bossEngagedTick = tick;
		}
		if (num(e.bossDefeated) > 0) {
			this.bossDefeated = true;
			this.mark(tick, "boss.defeated");
			if (this.victoryTick === undefined) {
				this.victoryTick = tick;
				this.mark(tick, "run.victory");
			}
		}

		if ((num(e.playerDied) > 0 || num(view.player.dead) > 0) && this.deathTick === undefined) {
			this.deathTick = tick;
			this.deathCause = this.lastHitBy ?? "unknown";
			this.mark(tick, "player.death");
		}
	}

	finish(): RunTelemetryRecord {
		const d = this.deathTick;
		const v = this.victoryTick;
		let endReason: RunEndReason = "abandoned";
		if (v !== undefined && (d === undefined || v <= d)) endReason = "victory";
		else if (d !== undefined) endReason = "death";
		const counters = new Map<string, number>();
		for (const [k, n] of this.counters) counters.set(k, n);
		if (this.markersDropped > 0) counters.set("markersDropped", this.markersDropped);
		const hitsBySource = new Map<string, number>();
		for (const [k, n] of this.hitsBySource) hitsBySource.set(k, n);
		return {
			ticks: this.ticks,
			endReason,
			deathTick: d,
			victoryTick: v,
			aliveTicks: d !== undefined ? math.min(this.ticks, d) : this.ticks,
			heartsLostTotal: this.heartsLostTotal,
			hitsTaken: this.hitsTaken,
			flasksUsed: this.flasksUsed,
			embersUsed: this.embersUsed,
			rollsStarted: this.rollsStarted,
			shotsFired: this.shotsFired,
			kills: this.kills,
			enemyHits: this.enemyHits,
			bulletsCleared: this.bulletsCleared,
			weaponSwaps: counters.get("event.weaponSwapped") ?? 0,
			firstKillTick: this.firstKillTick,
			bossAttempts: counters.get("boss.attempt") ?? 0,
			bossEngagedTick: this.bossEngagedTick,
			bossPhaseReached: this.bossPhaseReached,
			bossDefeated: this.bossDefeated,
			deathCause: this.deathCause,
			hitsBySource,
			counters,
			markers: [...this.markers],
		};
	}

	private mark(tick: number, name: string, value?: number): void {
		if (this.markers.size() >= MAX_MARKERS_PER_RUN) {
			this.markersDropped++;
			return;
		}
		this.markers.push(value !== undefined ? { tick, name, value } : { tick, name });
	}
}
