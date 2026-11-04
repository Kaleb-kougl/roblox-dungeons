/**
 * The HUD snapshot: the few numbers the HUD shows, copied out of the live sim at ~10 Hz (web SimDriver's store
 * snapshot + playerSnapshot, BossView's syncHud, WeaponView's publishWeaponHud). The sim state itself never goes into
 * UI state; only this flat copy does, and only when it changed (snapshotsEqual).
 *
 * Co-op spectating (docs/SPECTATE.md S2): the vitals (hearts, armor, flask, Embers, weapons, the set in hand) come from
 * SnapshotExtras.vitalsIndex, the watched player while the local player spectates; everything that is the local
 * player's own (the draft, boons / relics / curses, the waiting count, the shrine hint) keeps `playerIndex`. The
 * spectate bar's fields come from SnapshotExtras.spectate.
 */
import {
	COMBO_WINDOW_TICKS,
	DRAFT_MIN_OPEN_TICKS,
	NO_KIND,
	NO_SELECTION,
	NO_WEAPON,
	archetypeAt,
	atShrine,
	countActors,
	HordePhase,
	NO_PACT,
	hordePhase,
	pactAltarAt,
	pactAltarOffered,
	pactDraftKind,
	playerAt,
	teamComboWindowTicks,
	teammatesDrafting,
	weaponAt,
	weaponsAt,
	aegisPips,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { boostEntriesEqual, boostHudEntries, type BoostHudEntry } from "shared/view/boosts";
import type { RunOutcome } from "./liveRun";

export interface GameSnapshot {
	readonly tick: number;
	readonly recordedTicks: number;
	/** Half hearts. */
	readonly hearts: number;
	readonly heartsMax: number;
	readonly armor: number;
	readonly armorMax: number;
	readonly flask: number;
	readonly flaskMax: number;
	readonly embers: number;
	readonly emberMax: number;
	/** Index of the weapon set in hand. */
	readonly activeSet: number;
	/** Weapon id per set ("" = empty set). */
	readonly weapons: ReadonlyArray<string>;
	/** A live boss is engaged (phase > 0): show the boss line. */
	readonly bossVisible: boolean;
	/** Archetype id of the boss (shown, or defeated); "" for none. Display name: theme string `<id>.name`. */
	readonly bossId: string;
	readonly bossHp: number;
	readonly bossHpMax: number;
	readonly bossPhase: number;
	/** Phase thresholds as fractions of the boss's max hp (boss.act1: 0.66, 0.33); empty for none. */
	readonly bossPhaseMarks: ReadonlyArray<number>;
	readonly enemiesAlive: number;
	readonly enemyBullets: number;
	readonly playerBullets: number;
	readonly paused: boolean;
	readonly outcome: RunOutcome;
	/** Run totals for the post-run panel (the run's telemetry counts). */
	readonly kills: number;
	readonly hitsTaken: number;
	/** The tick the run ended on (death / boss kill); the current tick while playing. The post-run panel's time. */
	readonly endTick: number;
	/** Endless mode: the current floor and Depth (both 0 outside endless runs). */
	readonly floor: number;
	readonly depth: number;
	/** M2 scoring: the run is scored (SimConfig.scoring). The score fields below are 0 / empty otherwise. */
	readonly scoring: boolean;
	readonly score: number;
	/** Combo in tenths (10 = x1.0 .. 50 = x5.0). */
	readonly combo: number;
	/** Ticks left before the combo resets (of COMBO_WINDOW_TICKS); 0 when idle. */
	readonly comboTicks: number;
	readonly maxCombo: number;
	/** Points per score source (shared/sim ScoreSource order); empty when unscored. */
	readonly scorePoints: ReadonlyArray<number>;
	/** The combo window in ticks (COMBO_WINDOW_TICKS, or what M2 boons / curses make of it): the meter's full length. */
	readonly comboWindowTicks: number;
	/** M2 boon draft (endless runs): open, the offered boons (Boon indices, left to right), the card under the stick. */
	readonly draftOpen: boolean;
	readonly draftOffers: ReadonlyArray<number>;
	readonly draftSelected: number;
	/** The draft has been open long enough for a confirm to count (DRAFT_MIN_OPEN_TICKS). */
	readonly draftReady: boolean;
	/**
	 * Co-op (M4): teammates whose boon draft is still open (the world stays frozen until every player has confirmed);
	 * 0 in a solo run. The overlay shows "waiting for N teammates" while the local player's own draft is closed.
	 */
	readonly draftWaiting: number;
	/** Owned boons / relics / curses (indices, in the order taken); empty outside endless runs. */
	readonly boons: ReadonlyArray<number>;
	readonly relics: ReadonlyArray<number>;
	readonly curses: ReadonlyArray<number>;
	/**
	 * Builds (docs/BUILDS.md BU10): the level of each owned boon, parallel to `boons` (empty without builds: the HUD
	 * shows no levels), and the duos taken (Duo indices, in the order taken; empty without builds). The local player's.
	 */
	readonly boonLevels: ReadonlyArray<number>;
	readonly duos: ReadonlyArray<number>;
	/**
	 * The player stands in an unused curse shrine's zone, or (pacts, docs/FORTUNE.md: the classic zone is off where the
	 * altars stand) on an altar whose pact is theirs to take (shared/sim pactAltarOffered): the HUD shows the accept
	 * hint and touch the shrine button (SKILL1).
	 */
	readonly atShrine: boolean;
	/**
	 * docs/FORTUNE.md FO7: the altar (shared/sim PactKind) the local player stands on whose pact is theirs to take (the
	 * hint shows that pact's title and accept line instead of the classic curse line), or -1 (none, or the classic
	 * shrine).
	 */
	readonly shrinePact: number;
	/** The local player's open draft is Greed's Legendary deal (shared/sim pactDraftKind; NO_PACT otherwise): its title. */
	readonly draftPact: number;
	/** The Pact of the Horde is armed (taken, no room roused yet): the status corner's chip. Party state. */
	readonly hordeArmed: boolean;
	/** Co-op spectating (docs/SPECTATE.md): the local player is dead and watches a teammate (the spectate bar shows). */
	readonly spectating: boolean;
	/** The watched teammate's display name; "" when not spectating. */
	readonly spectateName: string;
	/** 1-based position of the watched teammate among the living ones, and their count ("2 / 3"); 0 / 0 when not. */
	readonly spectatePosition: number;
	readonly spectateCount: number;
	/**
	 * Boost drops (docs/BOOSTS.md B7): the shown player's running boosts in Boost order (`secondsLeft` in tenths,
	 * rounded up, and the bar's `fraction` in the same steps, so the HUD does not re-render every frame), and their
	 * Aegis pips (the extra armor pip). Empty / 0 without drops.
	 */
	readonly boosts: ReadonlyArray<BoostHudEntry>;
	readonly aegisPips: number;
}

export const EMPTY_SNAPSHOT: GameSnapshot = table.freeze({
	tick: 0,
	recordedTicks: 0,
	hearts: 0,
	heartsMax: 0,
	armor: 0,
	armorMax: 0,
	flask: 0,
	flaskMax: 0,
	embers: 0,
	emberMax: 0,
	activeSet: 0,
	weapons: table.freeze([]) as ReadonlyArray<string>,
	bossVisible: false,
	bossId: "",
	bossHp: 0,
	bossHpMax: 1,
	bossPhase: 0,
	bossPhaseMarks: table.freeze([]) as ReadonlyArray<number>,
	enemiesAlive: 0,
	enemyBullets: 0,
	playerBullets: 0,
	paused: false,
	outcome: "playing" as RunOutcome,
	kills: 0,
	hitsTaken: 0,
	endTick: 0,
	floor: 0,
	depth: 0,
	scoring: false,
	score: 0,
	combo: 0,
	comboTicks: 0,
	maxCombo: 0,
	scorePoints: table.freeze([]) as ReadonlyArray<number>,
	comboWindowTicks: COMBO_WINDOW_TICKS,
	draftOpen: false,
	draftOffers: table.freeze([]) as ReadonlyArray<number>,
	draftSelected: NO_SELECTION,
	draftReady: false,
	draftWaiting: 0,
	boons: table.freeze([]) as ReadonlyArray<number>,
	relics: table.freeze([]) as ReadonlyArray<number>,
	curses: table.freeze([]) as ReadonlyArray<number>,
	boonLevels: table.freeze([]) as ReadonlyArray<number>,
	duos: table.freeze([]) as ReadonlyArray<number>,
	atShrine: false,
	shrinePact: -1,
	draftPact: NO_PACT,
	hordeArmed: false,
	spectating: false,
	spectateName: "",
	spectatePosition: 0,
	spectateCount: 0,
	boosts: table.freeze([]) as ReadonlyArray<BoostHudEntry>,
	aegisPips: 0,
});

const NO_MARKS: ReadonlyArray<number> = EMPTY_SNAPSHOT.bossPhaseMarks;
const NO_POINTS: ReadonlyArray<number> = EMPTY_SNAPSHOT.scorePoints;
const NONE: ReadonlyArray<number> = EMPTY_SNAPSHOT.boons;

/** A boss archetype's phase thresholds (ArchetypeData extended with `phaseHp`, e.g. BossAct1Data), or none. */
export function bossPhaseMarks(kind: number): ReadonlyArray<number> {
	const data = archetypeAt(kind).data as { readonly phaseHp?: ReadonlyArray<number> };
	return data.phaseHp ?? NO_MARKS;
}

/** HP shown to one decimal, rounded up (web syncHud: ceil(hp * 10) / 10). */
const HP_DECIMALS = 10;

/** The first present actor whose archetype is a boss (web BossView findBoss). */
export function findBoss(state: Readonly<SimState>): ActorState | undefined {
	const actors = state.combat.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind !== NO_KIND && archetypeAt(a.kind).data.boss === true) return a;
	}
	return undefined;
}

export interface SnapshotExtras {
	readonly paused: boolean;
	readonly outcome: RunOutcome;
	readonly recordedTicks: number;
	readonly kills?: number;
	readonly hitsTaken?: number;
	readonly endTick?: number;
	/** The run's SimConfig (the shrine hint needs the floor's rooms); without it atShrine is false. */
	readonly config?: Readonly<SimConfig>;
	/**
	 * Co-op (M4): this client's player index: whose draft, boons / relics / curses, waiting count and shrine hint the
	 * HUD shows (and, without `vitalsIndex`, whose vitals). Default 0.
	 */
	readonly playerIndex?: number;
	/**
	 * Co-op spectating: whose hearts, armor, flask, Embers and weapon sets the HUD shows (the watched teammate while
	 * the local player spectates). Default `playerIndex`.
	 */
	readonly vitalsIndex?: number;
	/** Co-op spectating: the spectate bar's watched name and "position / count"; absent when not spectating. */
	readonly spectate?: SnapshotSpectate;
}

/** SnapshotExtras.spectate: who the local player watches (SimController's SpectateView + the member's name). */
export interface SnapshotSpectate {
	readonly name: string;
	readonly position: number;
	readonly count: number;
}

export function takeSnapshot(state: Readonly<SimState>, extras: SnapshotExtras): GameSnapshot {
	const me = extras.playerIndex ?? 0;
	const vitals = extras.vitalsIndex ?? me;
	const p = playerAt(state, vitals);
	const c = state.combat;
	const w = weaponsAt(state, vitals);
	const weapons = new Array<string>();
	for (const set of w.sets) weapons.push(set.weapon === NO_WEAPON ? "" : weaponAt(set.weapon).id);
	const boss = findBoss(state);
	const bossVisible = boss !== undefined && boss.alive !== 0 && boss.phase > 0;
	const bossDefeated = boss !== undefined && boss.alive === 0 && boss.phase > 0;
	const score = state.score;
	const mine = state.run?.players[me];
	const build = state.builds?.players[me];
	const drafting = mine !== undefined && mine.draftOpen !== 0;
	const spectate = extras.spectate;
	return {
		tick: state.tick,
		recordedTicks: extras.recordedTicks,
		hearts: p.hearts,
		heartsMax: p.heartsMax,
		armor: p.armor,
		armorMax: p.armorMax,
		flask: p.flask,
		flaskMax: p.flaskMax,
		embers: p.embers,
		emberMax: p.emberMax,
		activeSet: w.activeSet,
		weapons,
		bossVisible,
		bossId: boss !== undefined && (bossVisible || bossDefeated) ? archetypeAt(boss.kind).id : "",
		bossHp: bossVisible ? math.ceil(boss.hp * HP_DECIMALS) / HP_DECIMALS : 0,
		bossHpMax: bossVisible ? boss.hpMax : 1,
		bossPhase: bossVisible ? boss.phase : 0,
		bossPhaseMarks: bossVisible ? bossPhaseMarks(boss.kind) : NO_MARKS,
		enemiesAlive: countActors(c).alive,
		enemyBullets: c.enemyBullets.activeCount,
		playerBullets: c.playerBullets.activeCount,
		paused: extras.paused,
		outcome: extras.outcome,
		kills: extras.kills ?? 0,
		hitsTaken: extras.hitsTaken ?? 0,
		endTick: extras.endTick ?? state.tick,
		floor: state.endless !== undefined ? state.endless.floor : 0,
		depth: state.endless !== undefined ? state.endless.depth : 0,
		scoring: score !== undefined,
		score: score !== undefined ? score.total : 0,
		combo: score !== undefined ? score.combo : 0,
		comboTicks: score !== undefined ? score.comboTimer : 0,
		maxCombo: score !== undefined ? score.maxCombo : 0,
		scorePoints: score !== undefined ? [...score.points] : NO_POINTS,
		comboWindowTicks: teamComboWindowTicks(state),
		draftOpen: drafting,
		draftOffers: drafting ? [...mine.draftOffers] : NONE,
		draftSelected: drafting ? mine.draftSelected : NO_SELECTION,
		draftReady: drafting && mine.draftTicks + 1 >= DRAFT_MIN_OPEN_TICKS,
		draftWaiting: teammatesDrafting(state, me),
		boons: mine !== undefined ? [...mine.boons] : NONE,
		relics: mine !== undefined ? [...mine.relics] : NONE,
		curses: mine !== undefined ? [...mine.curses] : NONE,
		boonLevels: mine !== undefined && build !== undefined ? mine.boons.map((b) => build.levels[b] ?? 0) : NONE,
		duos: build !== undefined ? [...build.duos] : NONE,
		atShrine:
			extras.config !== undefined &&
			(atShrine(state, extras.config, me) || pactAltarOffered(state, extras.config, me)),
		shrinePact:
			extras.config !== undefined && pactAltarOffered(state, extras.config, me) ? pactAltarAt(state, me) : -1,
		draftPact: pactDraftKind(state, me),
		hordeArmed: hordePhase(state) === HordePhase.ARMED,
		spectating: spectate !== undefined,
		spectateName: spectate !== undefined ? spectate.name : "",
		spectatePosition: spectate !== undefined ? spectate.position : 0,
		spectateCount: spectate !== undefined ? spectate.count : 0,
		// docs/BOOSTS.md B7: the vitals' player (the watched teammate while spectating).
		boosts: boostHudEntries(state, vitals),
		aegisPips: aegisPips(state, vitals),
	};
}

function listsEqual(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Field-by-field equality (the arrays element-wise), so the store is only written when something changed. */
export function snapshotsEqual(a: GameSnapshot, b: GameSnapshot): boolean {
	if (!listsEqual(a.draftOffers, b.draftOffers) || !listsEqual(a.boons, b.boons)) return false;
	if (!listsEqual(a.relics, b.relics) || !listsEqual(a.curses, b.curses)) return false;
	if (!listsEqual(a.boonLevels, b.boonLevels) || !listsEqual(a.duos, b.duos)) return false;
	if (a.weapons.size() !== b.weapons.size()) return false;
	for (let i = 0; i < a.weapons.size(); i++) if (a.weapons[i] !== b.weapons[i]) return false;
	if (a.scorePoints.size() !== b.scorePoints.size()) return false;
	for (let i = 0; i < a.scorePoints.size(); i++) if (a.scorePoints[i] !== b.scorePoints[i]) return false;
	if (!boostEntriesEqual(a.boosts, b.boosts)) return false;
	if (a.bossPhaseMarks.size() !== b.bossPhaseMarks.size()) return false;
	for (let i = 0; i < a.bossPhaseMarks.size(); i++) if (a.bossPhaseMarks[i] !== b.bossPhaseMarks[i]) return false;
	return (
		a.tick === b.tick &&
		a.recordedTicks === b.recordedTicks &&
		a.hearts === b.hearts &&
		a.heartsMax === b.heartsMax &&
		a.armor === b.armor &&
		a.armorMax === b.armorMax &&
		a.flask === b.flask &&
		a.flaskMax === b.flaskMax &&
		a.embers === b.embers &&
		a.emberMax === b.emberMax &&
		a.activeSet === b.activeSet &&
		a.bossVisible === b.bossVisible &&
		a.bossId === b.bossId &&
		a.bossHp === b.bossHp &&
		a.bossHpMax === b.bossHpMax &&
		a.bossPhase === b.bossPhase &&
		a.enemiesAlive === b.enemiesAlive &&
		a.enemyBullets === b.enemyBullets &&
		a.playerBullets === b.playerBullets &&
		a.paused === b.paused &&
		a.outcome === b.outcome &&
		a.kills === b.kills &&
		a.hitsTaken === b.hitsTaken &&
		a.endTick === b.endTick &&
		a.floor === b.floor &&
		a.depth === b.depth &&
		a.scoring === b.scoring &&
		a.score === b.score &&
		a.combo === b.combo &&
		a.comboTicks === b.comboTicks &&
		a.maxCombo === b.maxCombo &&
		a.comboWindowTicks === b.comboWindowTicks &&
		a.draftOpen === b.draftOpen &&
		a.draftSelected === b.draftSelected &&
		a.draftReady === b.draftReady &&
		a.draftWaiting === b.draftWaiting &&
		a.atShrine === b.atShrine &&
		a.shrinePact === b.shrinePact &&
		a.draftPact === b.draftPact &&
		a.hordeArmed === b.hordeArmed &&
		a.spectating === b.spectating &&
		a.spectateName === b.spectateName &&
		a.spectatePosition === b.spectatePosition &&
		a.spectateCount === b.spectateCount &&
		a.aegisPips === b.aegisPips
	);
}
