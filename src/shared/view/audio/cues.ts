/**
 * Sim events -> theme sound IDs (the pure half of the client's AudioController). The web build declared the audio
 * events in its theme contract (sfx.*, music.*) but never played them (`theme.sound()` has no caller @ 42897e2), so
 * this mapping is new; it uses the contract's IDs where one fits and the Roblox-port additions (PORT_SFX, the theme's
 * PORT_AUDIO_EVENTS) for the events the contract has no ID for.
 *
 * Inputs per rendered frame: the frame's summed SimEvents (LiveRun.frameEvents: every tick of the frame, so no event
 * is lost on multi-tick frames), the hit tracker's FX events (per-actor hits / kills / boss phases), and the sim state
 * (the enemy-bullet spawn counter; per-player and per-floor edges through AudioStateWatch). Output: the cues to start
 * this frame (sound ID + volume scale), each ID at most once per frame and once per its minimum interval (a bow stream
 * or a bullet ring is one sound, not fifty), at most one jingle (JINGLE_SFX), at most AUDIO_VIEW.maxStartsPerFrame of
 * them, the highest SFX_PRIORITY kept (the player's hurt and the telegraph over enemy shots and hits).
 *
 * Silent IDs: the mapper's `playable` predicate (the controller passes `pack.sound(id).assetId !== undefined`) turns a
 * silent ID into its SFX_FALLBACK when that one plays, else drops it before it is a candidate: a silent sound never
 * takes a per-frame cap slot, the one jingle slot or a cooldown (`resolve`, also used for the menu sounds).
 *
 * Co-op (docs/FX_AUDIO.md X4): the summed events count the whole party, so in a party run the player sounds (hurt,
 * death, roll, flask, swing, finisher) come from the watch's per-player edges instead: the local player's at full
 * volume, a teammate's at AUDIO_VIEW.teammateVolume; shots, swaps and the bow's full charge are the local player's
 * only. The deflect (summed bulletsDeleted: the sim keeps no per-player count) is the local player's at full volume
 * when the local player could have deleted them this frame (guard up, this frame or the last, or a swing:
 * AudioStateWatch.mayDeflect), else a teammate's. A solo run reads the summed events exactly as before (the watch only
 * picks swing vs finisher).
 *
 * Presentation only: reads sim state, never writes it.
 */
import { partySize, type SimEvents, type SimState } from "shared/sim";
import { AMBIENCE_IDS } from "shared/theme";
import type { FxEvent } from "../fx/events";
import { AUDIO_VIEW } from "./config";
import { AudioStateWatch, SwingEdge } from "./watch";

/** Every sound effect the game plays, by logical ID (theme manifest). */
export const SFX = {
	playerShoot: "sfx.player.shoot",
	playerSwing: "sfx.player.swing",
	/** The sword's finisher swing (combat.weapons.swing* with SWORD_V_LAST = SWORD_FINISHER), instead of the swing. */
	playerFinisher: "sfx.player.finisher",
	/** The bow's charge reaches full (the local player's). */
	playerCharged: "sfx.player.charged",
	playerRoll: "sfx.player.roll",
	playerFlask: "sfx.player.flask",
	playerSwap: "sfx.player.swap",
	playerHurt: "sfx.player.hurt",
	playerDeath: "sfx.player.death",
	playerDeflect: "sfx.player.deflect",
	ember: "sfx.ember",
	enemyShoot: "sfx.enemy.shoot",
	enemyTelegraph: "sfx.enemy.telegraph",
	enemyHurt: "sfx.enemy.hurt",
	enemyDeath: "sfx.enemy.death",
	bossRoar: "sfx.boss.roar",
	bossDeath: "sfx.boss.death",
	victory: "sfx.victory",
	/** Breakable barrels / crates (docs/DECOR.md D4; the theme's BREAKABLE_AUDIO_EVENTS, required in every pack). */
	breakableHit: "sfx.breakable.hit",
	breakableBreak: "sfx.breakable.break",
	/** Endless floors (docs/FX_AUDIO.md A3): a combat room cleared, a relic pedestal taken, the curse shrine used. */
	roomClear: "sfx.room.clear",
	relicTake: "sfx.relic.take",
	shrineUse: "sfx.shrine.use",
	/** SimEvents stairwellOpened / floorChanged / depthChanged. */
	stairwellOpen: "sfx.stairwell.open",
	floorEnter: "sfx.floor.enter",
	depthUp: "sfx.depth.up",
	/** The run is over (every player dead): a jingle over the music fading out (X7). */
	gameOver: "sfx.jingle.gameover",
	uiClick: "sfx.ui.click",
	uiConfirm: "sfx.ui.confirm",
	/** Menu back / cancel, and a gamepad focus move (quiet, rate-limited). */
	uiBack: "sfx.ui.back",
	uiMove: "sfx.ui.move",
} as const;
export type SfxId = (typeof SFX)[keyof typeof SFX];

/** Every SFX ID, in declaration order. */
export const ALL_SFX: ReadonlyArray<SfxId> = [
	SFX.playerShoot,
	SFX.playerSwing,
	SFX.playerFinisher,
	SFX.playerCharged,
	SFX.playerRoll,
	SFX.playerFlask,
	SFX.playerSwap,
	SFX.playerHurt,
	SFX.playerDeath,
	SFX.playerDeflect,
	SFX.ember,
	SFX.enemyShoot,
	SFX.enemyTelegraph,
	SFX.enemyHurt,
	SFX.enemyDeath,
	SFX.bossRoar,
	SFX.bossDeath,
	SFX.victory,
	SFX.breakableHit,
	SFX.breakableBreak,
	SFX.roomClear,
	SFX.relicTake,
	SFX.shrineUse,
	SFX.stairwellOpen,
	SFX.floorEnter,
	SFX.depthUp,
	SFX.gameOver,
	SFX.uiClick,
	SFX.uiConfirm,
	SFX.uiBack,
	SFX.uiMove,
];

/** IDs this port added to the placeholder pack (not in the web contract's AUDIO_EVENTS; theme PORT_AUDIO_EVENTS). */
export const PORT_SFX: ReadonlyArray<SfxId> = [
	SFX.playerSwing,
	SFX.playerFlask,
	SFX.playerSwap,
	SFX.playerDeflect,
	SFX.enemyTelegraph,
	SFX.bossDeath,
	SFX.victory,
	SFX.uiBack,
	SFX.uiMove,
	SFX.playerFinisher,
	SFX.playerCharged,
	SFX.roomClear,
	SFX.relicTake,
	SFX.shrineUse,
	SFX.stairwellOpen,
	SFX.floorEnter,
	SFX.depthUp,
	SFX.gameOver,
];

/** Music tracks by logical ID. */
export const MUSIC = {
	menu: "music.menu",
	boss: "music.boss",
	/** The first-run tutorial's track (falls back to the floor's biome track while silent). */
	tutorial: "music.tutorial",
	/** The lobby room's track (falls back to music.menu while silent). */
	lobby: "music.lobby",
	biomePrefix: "music.biome.",
} as const;

/** Biome music for biome index 1..5 ("music.biome.<n>"). */
export function biomeMusic(biome: number): string {
	return `${MUSIC.biomePrefix}${biome}`;
}

/** Number of biomes with a music track and an ambience bed (theme contract BIOMES). */
export const BIOME_MUSIC_COUNT = 5;

/** The ambience bed for biome index 1..5 (theme AMBIENCE_IDS, "amb.b<n>"), or undefined. */
export function biomeAmbience(biome: number): string | undefined {
	return biome >= 1 && biome <= BIOME_MUSIC_COUNT ? AMBIENCE_IDS[biome - 1] : undefined;
}

/** Every sound ID the audio layer can play (for the "exists in the pack" specs and the controller's preload). */
export function allAudioIds(): string[] {
	const out: string[] = [];
	for (const id of ALL_SFX) out.push(id);
	out.push(MUSIC.menu, MUSIC.boss, MUSIC.tutorial, MUSIC.lobby);
	for (let b = 1; b <= BIOME_MUSIC_COUNT; b++) out.push(biomeMusic(b));
	for (const id of AMBIENCE_IDS) out.push(id);
	out.sort();
	return out;
}

/**
 * The summed-event table, in play order within a frame: sim event field (summed over the frame's ticks) -> sound ID.
 * An entry fires when the field's frame total is > 0. In a party run the PLAYER_EVENT_FIELDS rows are replaced by the
 * watch's per-player edges.
 */
export const SIM_EVENT_SOUNDS: ReadonlyArray<readonly [keyof SimEvents, SfxId]> = [
	["playerDied", SFX.playerDeath],
	["playerHits", SFX.playerHurt],
	["emberUsed", SFX.ember],
	["rollStarted", SFX.playerRoll],
	["flaskUsed", SFX.playerFlask],
	["weaponSwapped", SFX.playerSwap],
	["shotsFired", SFX.playerShoot],
	["meleeSwings", SFX.playerSwing],
	["bulletsDeleted", SFX.playerDeflect],
	["telegraphs", SFX.enemyTelegraph],
	["bossEngaged", SFX.bossRoar],
	["bossDefeated", SFX.victory],
	["stairwellOpened", SFX.stairwellOpen],
	["floorChanged", SFX.floorEnter],
	["depthChanged", SFX.depthUp],
];

/** Summed events that say nothing about WHICH player: a party run reads these from the per-player edges. */
export const PLAYER_EVENT_FIELDS: ReadonlyArray<keyof SimEvents> = [
	"playerDied",
	"playerHits",
	"rollStarted",
	"flaskUsed",
	"weaponSwapped",
	"shotsFired",
	"meleeSwings",
	"bulletsDeleted",
];

/** Shortest gap between two starts of the same sound, seconds (0 = once per frame at most). A pack's minInterval wins. */
export const SFX_MIN_INTERVAL: Readonly<Partial<Record<SfxId, number>>> = {
	[SFX.playerShoot]: 0.06,
	[SFX.playerSwing]: 0.05,
	[SFX.playerFinisher]: 0.05,
	[SFX.playerDeflect]: 0.08,
	[SFX.enemyShoot]: 0.08,
	[SFX.enemyTelegraph]: 0.15,
	[SFX.enemyHurt]: 0.05,
	[SFX.enemyDeath]: 0.04,
	[SFX.playerHurt]: 0.1,
	[SFX.breakableHit]: 0.06,
	[SFX.breakableBreak]: 0.05,
	[SFX.uiMove]: 0.08,
};

/**
 * Which sounds survive a busy frame (AUDIO_VIEW.maxStartsPerFrame): higher first. The player's hurt and death, the
 * run-over jingle, the telegraph and the Ember lead; enemy hits and shots go last.
 */
export const SFX_PRIORITY: Readonly<Record<SfxId, number>> = {
	[SFX.playerDeath]: 100,
	[SFX.playerHurt]: 95,
	[SFX.gameOver]: 92,
	[SFX.enemyTelegraph]: 90,
	[SFX.ember]: 88,
	/** Above the victory: an endless boss kill plays the depth jingle, not both (JINGLE_SFX). */
	[SFX.depthUp]: 86,
	[SFX.victory]: 85,
	[SFX.bossDeath]: 84,
	[SFX.bossRoar]: 80,
	[SFX.stairwellOpen]: 75,
	[SFX.roomClear]: 72,
	[SFX.relicTake]: 70,
	[SFX.shrineUse]: 70,
	[SFX.floorEnter]: 68,
	[SFX.playerFlask]: 60,
	[SFX.playerRoll]: 58,
	[SFX.playerFinisher]: 56,
	[SFX.playerCharged]: 55,
	[SFX.playerSwing]: 54,
	[SFX.playerShoot]: 52,
	[SFX.playerSwap]: 50,
	[SFX.playerDeflect]: 50,
	[SFX.uiConfirm]: 45,
	[SFX.uiBack]: 45,
	[SFX.uiClick]: 44,
	[SFX.uiMove]: 43,
	[SFX.breakableBreak]: 40,
	[SFX.enemyDeath]: 35,
	[SFX.breakableHit]: 30,
	[SFX.enemyHurt]: 20,
	[SFX.enemyShoot]: 10,
};

/** A teammate's cue ranks this much lower than the local player's same sound (never over the local telegraph). */
export const TEAMMATE_PRIORITY_DROP = 50;

/** Sounds that dip the music (AUDIO_VIEW.duck) for their length: the jingles and the Ember. */
export const DUCKING_SFX: ReadonlyArray<SfxId> = [
	SFX.victory,
	SFX.depthUp,
	SFX.gameOver,
	SFX.roomClear,
	SFX.shrineUse,
	SFX.ember,
];

/**
 * Jingles (art/audio.json category "jingle"): at most one starts per frame, the highest SFX_PRIORITY (the others are
 * dropped before the cap and start no cooldown). An endless boss kill raises bossDefeated, depthChanged and
 * stairwellOpened on one tick: the depth jingle plays, not the victory over it (depth.up ranks above victory; M1 has
 * no depth, so its boss kill keeps the victory). sfx.relic.take is a short power-up sound, not a jingle.
 */
export const JINGLE_SFX: ReadonlyArray<SfxId> = [SFX.gameOver, SFX.depthUp, SFX.victory, SFX.roomClear, SFX.shrineUse];

/**
 * A silent sound falls back to another ID: a pack without a finisher clip plays the plain swing there, one without a
 * back clip the click. sfx.ui.move has none on purpose (a click on every gamepad focus move would buzz): it stays
 * silent until it has its own clip.
 */
export const SFX_FALLBACK: Readonly<Partial<Record<SfxId, SfxId>>> = {
	[SFX.playerFinisher]: SFX.playerSwing,
	[SFX.uiBack]: SFX.uiClick,
};

/** Whether a sound ID has a clip in the theme pack (the controller passes `pack.sound(id).assetId !== undefined`). */
export type Playable = (id: string) => boolean;

/** Every ID plays (the specs' default, and musicFor's). */
export const EVERY_ID: Playable = () => true;

/** The FX events the mapper reads (the tracker's pooled buffer satisfies it). */
export interface FxEventSource {
	count(): number;
	at(i: number): Pick<FxEvent, "type" | "boss" | "phase">;
}

/** One frame's cues: parallel id / volume-scale lists, reused frame after frame (no allocation once grown). */
export class AudioCueList {
	private readonly ids = new Array<string>();
	private readonly volumes = new Array<number>();
	private n = 0;

	size(): number {
		return this.n;
	}

	id(i: number): string {
		return this.ids[i];
	}

	/** The cue's volume scale, multiplied into the sound's own volume (1 = as the pack sets it). */
	volume(i: number): number {
		return this.volumes[i];
	}

	clear(): void {
		this.n = 0;
	}

	push(id: string, volume: number): void {
		this.ids[this.n] = id;
		this.volumes[this.n] = volume;
		this.n++;
	}

	/** The IDs in order (specs and logs; allocates). */
	toIds(): string[] {
		const out: string[] = [];
		for (let i = 0; i < this.n; i++) out.push(this.ids[i]);
		return out;
	}
}

function priorityOf(id: string): number {
	return (SFX_PRIORITY as Readonly<Record<string, number>>)[id] ?? 0;
}

function isJingle(id: string): boolean {
	return (JINGLE_SFX as ReadonlyArray<string>).includes(id);
}

/**
 * Turns one frame's events and state into the cues to start. Keeps per-ID cooldowns, the enemy-shot counter and the
 * state watch.
 */
export class AudioCueMapper {
	private readonly lastStart = new Map<string, number>();
	private readonly intervals = new Map<string, number>();
	private lastEnemySpawned = -1;
	readonly watch = new AudioStateWatch();
	// This frame's candidates (parallel lists, reused).
	private readonly pendingIds = new Array<string>();
	private readonly pendingVolumes = new Array<number>();
	private readonly pendingRanks = new Array<number>();
	private pending = 0;
	private now = 0;

	/** `playable`: whether an ID has a clip (silent IDs and their fallbacks; default: every ID plays). */
	constructor(private readonly playable: Playable = EVERY_ID) {}

	/**
	 * The ID that starts for `id`: itself when playable, else its SFX_FALLBACK when that one is, else undefined (silent:
	 * no cue, no cap slot, no cooldown).
	 */
	resolve(id: string): string | undefined {
		if (this.playable(id)) return id;
		const fallback = (SFX_FALLBACK as Readonly<Record<string, string>>)[id];
		return fallback !== undefined && this.playable(fallback) ? fallback : undefined;
	}

	/** A new run: forget the enemy-shot counter and the watched state (cooldowns keep running on real time). */
	reset(): void {
		this.lastEnemySpawned = -1;
		this.watch.reset();
	}

	/** A pack's per-sound minimum interval (SoundRef.minInterval), overriding SFX_MIN_INTERVAL; undefined clears it. */
	setMinInterval(id: string, seconds: number | undefined): void {
		if (seconds === undefined) this.intervals.delete(id);
		else this.intervals.set(id, seconds);
	}

	/** The minimum interval of `id`, seconds. */
	intervalOf(id: string): number {
		return this.intervals.get(id) ?? (SFX_MIN_INTERVAL as Readonly<Record<string, number>>)[id] ?? 0;
	}

	private coolingDown(id: string, now: number): boolean {
		const gap = this.intervalOf(id);
		const last = this.lastStart.get(id);
		return last !== undefined && gap > 0 && now - last < gap;
	}

	/**
	 * A menu sound outside the frame (sfx.ui.*): true when it may start now (it, or its fallback, is playable and its
	 * minimum interval has passed); a true answer counts as a start. A gamepad's focus moves go through here so holding
	 * the stick does not buzz.
	 */
	uiCue(now: number, id: string): boolean {
		if (this.resolve(id) === undefined || this.coolingDown(id, now)) return false;
		this.lastStart.set(id, now);
		return true;
	}

	/**
	 * A candidate for this frame (`id` resolved: a silent ID is its fallback or nothing): once per ID (the louder volume
	 * and higher rank win), never inside its interval.
	 */
	private cue(soundId: SfxId, volume: number, rank: number = priorityOf(soundId)): void {
		const id = this.resolve(soundId);
		if (id === undefined) return;
		for (let i = 0; i < this.pending; i++) {
			if (this.pendingIds[i] === id) {
				if (volume > this.pendingVolumes[i]) this.pendingVolumes[i] = volume;
				if (rank > this.pendingRanks[i]) this.pendingRanks[i] = rank;
				return;
			}
		}
		if (this.coolingDown(id, this.now)) return;
		this.pendingIds[this.pending] = id;
		this.pendingVolumes[this.pending] = volume;
		this.pendingRanks[this.pending] = rank;
		this.pending++;
	}

	/** A player sound of player `i`: full volume for the local player, AUDIO_VIEW.teammateVolume for a teammate. */
	private playerCue(id: SfxId, i: number, localIndex: number): void {
		if (i === localIndex) this.cue(id, 1);
		else this.cue(id, AUDIO_VIEW.teammateVolume, priorityOf(id) - TEAMMATE_PRIORITY_DROP);
	}

	/** Removes candidate `at`, keeping the order of the rest. */
	private dropPending(at: number): void {
		for (let i = at; i < this.pending - 1; i++) {
			this.pendingIds[i] = this.pendingIds[i + 1];
			this.pendingVolumes[i] = this.pendingVolumes[i + 1];
			this.pendingRanks[i] = this.pendingRanks[i + 1];
		}
		this.pending--;
	}

	/** Keeps one jingle (JINGLE_SFX): the highest-ranked (the earlier one on a tie); drops the others. */
	private keepOneJingle(): void {
		let best = -1;
		for (let i = 0; i < this.pending; i++) {
			if (isJingle(this.pendingIds[i]) && (best < 0 || this.pendingRanks[i] > this.pendingRanks[best])) best = i;
		}
		if (best < 0) return;
		let i = 0;
		while (i < this.pending) {
			if (i !== best && isJingle(this.pendingIds[i])) {
				this.dropPending(i);
				if (i < best) best--;
			} else i++;
		}
	}

	/** Drops the lowest-ranked candidates (the later one on a tie) down to the per-frame cap. */
	private applyCap(): void {
		const cap = AUDIO_VIEW.maxStartsPerFrame;
		while (this.pending > cap) {
			let worst = 0;
			for (let i = 1; i < this.pending; i++) {
				if (this.pendingRanks[i] <= this.pendingRanks[worst]) worst = i;
			}
			this.dropPending(worst);
		}
	}

	/**
	 * One rendered frame at real time `now` (seconds): `events` are the frame's summed SimEvents, `fx` the tracker's
	 * events of the frame, `state` the run's state after the frame, `localIndex` this client's player (0 solo).
	 * Appends the cues to start to `out` (in table order) and returns it.
	 */
	frame(
		now: number,
		events: Readonly<SimEvents>,
		fx: FxEventSource,
		state: Readonly<SimState>,
		localIndex: number,
		out: AudioCueList,
	): AudioCueList {
		this.now = now;
		this.pending = 0;
		for (let i = 0; i < fx.count(); i++) {
			if (fx.at(i).type === "reset") this.reset();
		}
		const w = this.watch;
		w.update(state, localIndex);
		const party = partySize(state) > 1;

		for (const [field, id] of SIM_EVENT_SOUNDS) {
			if (party && PLAYER_EVENT_FIELDS.includes(field)) continue;
			if (!(events[field] > 0)) continue;
			// Solo: the swing that was the sword's finisher plays the finisher instead.
			if (id === SFX.playerSwing && w.swingEdge[localIndex] === SwingEdge.finisher)
				this.cue(SFX.playerFinisher, 1);
			else this.cue(id, 1);
		}
		if (party) {
			for (let i = 0; i < w.players(); i++) {
				if (w.deathEdge[i]) {
					this.playerCue(SFX.playerDeath, i, localIndex);
					this.playerCue(SFX.playerHurt, i, localIndex); // the lethal hit, as a solo death plays both
				}
				if (w.hurtEdge[i]) this.playerCue(SFX.playerHurt, i, localIndex);
				if (w.rollEdge[i]) this.playerCue(SFX.playerRoll, i, localIndex);
				if (w.flaskEdge[i]) this.playerCue(SFX.playerFlask, i, localIndex);
				const swing = w.swingEdge[i];
				if (swing === SwingEdge.finisher) this.playerCue(SFX.playerFinisher, i, localIndex);
				else if (swing === SwingEdge.swing) this.playerCue(SFX.playerSwing, i, localIndex);
			}
			if (w.swapEdge[localIndex]) this.cue(SFX.playerSwap, 1);
			if (events.shotsFired > 0 && w.localShot) this.cue(SFX.playerShoot, 1);
			// Deflects: the local player's when they could have made them, else a teammate's (quiet).
			if (events.bulletsDeleted > 0) {
				if (w.mayDeflect[localIndex]) this.cue(SFX.playerDeflect, 1);
				else
					this.cue(
						SFX.playerDeflect,
						AUDIO_VIEW.teammateVolume,
						priorityOf(SFX.playerDeflect) - TEAMMATE_PRIORITY_DROP,
					);
			}
		}
		if (w.localCharged) this.cue(SFX.playerCharged, 1);
		if (w.roomCleared) this.cue(SFX.roomClear, 1);
		if (w.relicTaken) this.cue(SFX.relicTake, 1);
		if (w.shrineUsed) this.cue(SFX.shrineUse, 1);
		if (w.wiped) this.cue(SFX.gameOver, 1);

		for (let i = 0; i < fx.count(); i++) {
			const e = fx.at(i);
			if (e.type === "hit") this.cue(SFX.enemyHurt, 1);
			else if (e.type === "killed" && !e.boss) this.cue(SFX.enemyDeath, 1);
			else if (e.type === "bossPhase" && e.phase >= 2) this.cue(SFX.bossRoar, 1);
			else if (e.type === "bossDefeated") this.cue(SFX.bossDeath, 1);
		}
		// Breakables (summed over the frame's ticks): a break plays its own sound; the hit sound only for hits that
		// did not break (breakableHits counts the breaking hit too).
		if (events.breakablesBroken > 0) this.cue(SFX.breakableBreak, 1);
		if (events.breakableHits > events.breakablesBroken) this.cue(SFX.breakableHit, 1);
		const enemySpawned = state.combat.enemySpawned;
		if (this.lastEnemySpawned >= 0 && enemySpawned > this.lastEnemySpawned) this.cue(SFX.enemyShoot, 1);
		this.lastEnemySpawned = enemySpawned;

		this.keepOneJingle();
		this.applyCap();
		for (let i = 0; i < this.pending; i++) {
			const id = this.pendingIds[i];
			this.lastStart.set(id, now);
			out.push(id, this.pendingVolumes[i]);
		}
		return out;
	}
}
