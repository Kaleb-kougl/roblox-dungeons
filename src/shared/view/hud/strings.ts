/**
 * Every theme string key the HUD, the pause overlay, the post-run panel and the juice settings panel read. The React
 * components take their keys from here, and hud.spec.ts checks each one exists in the placeholder pack, so a missing
 * key fails the build instead of showing the raw key in game.
 */
import { SCORE_SOURCE_NAMES } from "shared/sim";
export const HUD_STRINGS = {
	title: "game.title",
	health: "hud.health",
	armor: "hud.armor",
	flask: "hud.flask",
	ember: "ember.name",
	weaponSet: "hud.weaponSet",
	weaponSwap: "hud.weaponSwap",
	bossPhase: "boss.hud.phase",
	paused: "hud.paused",
	dead: "hud.dead",
	victory: "hud.victory",
	restartAlt: "hud.restartAlt",
	resume: "hud.pause.resume",
	restart: "hud.pause.restart",
	settings: "hud.pause.settings",
	pauseHint: "hud.pause.hint",
	runOver: "playtest.run.over",
	runVictory: "playtest.run.victory",
	time: "playtest.run.time",
	timeVictory: "playtest.run.timeVictory",
	hits: "playtest.run.hits",
	kills: "playtest.run.kills",
	seed: "hud.seed",
	/** Endless mode: the current floor and Depth. */
	floor: "hud.floor",
	info: "hud.info",
	/** The owned-items row's last cell when more are owned than fit (docs/HUD_LAYOUT.md): "+{count}". */
	itemsMore: "hud.items.more",
	noticeFallback: "hud.notice.fallback",
	debug: "hud.debug",
	replayHint: "hud.debug.replayHint",
	replayMatch: "hud.debug.replayMatch",
	replayMismatch: "hud.debug.replayMismatch",
	cap: "fx.cap",
	score: "hud.score",
	combo: "hud.score.combo",
	scorePop: "hud.score.pop",
	maxCombo: "hud.score.maxCombo",
} as const;

/** Results breakdown label per score source, `score.source.<name>` (shared/sim SCORE_SOURCE_NAMES order). */
export const SCORE_SOURCE_KEYS: ReadonlyArray<string> = SCORE_SOURCE_NAMES.map((n) => `score.source.${n}`);

/** "hud.ending.<death|victory|abandoned>". */
export const ENDING_KEYS = ["hud.ending.death", "hud.ending.victory", "hud.ending.abandoned"] as const;
/** "hud.verdict.<status>". */
export const VERDICT_KEYS = [
	"hud.verdict.pending",
	"hud.verdict.accepted",
	"hud.verdict.rejected",
	"hud.verdict.skipped",
] as const;

/** The juice settings panel (web JuiceSettingsPanel keys + the port's reset / close / system / offline lines). */
export const SETTINGS_STRINGS = {
	title: "fx.settings.title",
	healthBars: "fx.settings.healthBars",
	damageNumbers: "fx.settings.damageNumbers",
	freezeFrame: "fx.settings.freezeFrame",
	/** Port (docs/FEEL.md J8): the Screen shake row. */
	screenShake: "fx.settings.screenShake",
	particles: "fx.settings.particles",
	reducedMotion: "fx.settings.reducedMotion",
	on: "fx.settings.on",
	off: "fx.settings.off",
	hint: "fx.settings.hint",
	reset: "fx.settings.reset",
	close: "fx.settings.close",
	system: "fx.settings.system",
	offline: "fx.settings.offline",
	/** Option labels: `fx.settings.healthBars.<mode>`, `fx.settings.particles.<level>`. */
	healthBarsPrefix: "fx.settings.healthBars.",
	particlesPrefix: "fx.settings.particles.",
} as const;

/** The leaderboard panel (M5) and its pause overlay button. */
export const LEADERBOARD_STRINGS = {
	title: "hud.leaderboard.title",
	solo: "hud.leaderboard.solo",
	coop: "hud.leaderboard.coop",
	close: "hud.leaderboard.close",
	loading: "hud.leaderboard.loading",
	empty: "hud.leaderboard.empty",
	unavailable: "hud.leaderboard.unavailable",
	stale: "hud.leaderboard.stale",
	rank: "hud.leaderboard.rank",
	floor: "hud.leaderboard.floor",
	mine: "hud.leaderboard.mine",
	mineRanked: "hud.leaderboard.mineRanked",
	mineNone: "hud.leaderboard.mineNone",
	hint: "hud.leaderboard.hint",
	open: "hud.pause.leaderboard",
	/** Verdict line suffix for ranked runs: `hud.leaderboard.posted.<queued|ineligible|failed>`. */
	postedPrefix: "hud.leaderboard.posted.",
} as const;

/** The leaderboard status words a verdict's `leaderboard` field starts with. */
export const LEADERBOARD_POST_STATUSES = ["queued", "ineligible", "failed"] as const;

/** The verdict-line key for a verdict's `leaderboard` field ("queued", "ineligible:<reason>", "failed"), or undefined. */
export function leaderboardPostKey(status: string | undefined): string | undefined {
	if (status === undefined) return undefined;
	const [head] = string.match(status, "^(%a+)");
	if (head === undefined) return undefined;
	for (const s of LEADERBOARD_POST_STATUSES) if (s === head) return `${LEADERBOARD_STRINGS.postedPrefix}${s}`;
	return undefined;
}

/**
 * The ending key for a run ending ("death" | "victory" | "abandoned" | "ended": a party run the server ended before
 * the wipe); unknown endings read as abandoned.
 */
export function endingKey(ending: string | undefined): string {
	return ending === "death" || ending === "victory" || ending === "ended"
		? `hud.ending.${ending}`
		: "hud.ending.abandoned";
}
