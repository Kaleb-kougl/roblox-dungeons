/**
 * Sim events -> theme sound IDs (the pure half of the client's AudioController). The web build declared the audio
 * events in its theme contract (sfx.*, music.*) but never played them (`theme.sound()` has no caller @ 42897e2), so
 * this mapping is new; it uses the contract's IDs where one fits and a few Roblox-port additions (PORT_SFX) for the
 * events the contract has no ID for (flask, swap, melee swing, bullet deletion, telegraph, boss death, victory).
 *
 * Inputs per rendered frame: the frame's summed SimEvents (LiveRun.frameEvents: every tick of the frame, so no event
 * is lost on multi-tick frames), the hit tracker's FX events (per-actor hits / kills / boss phases), and the run's
 * enemy-bullet spawn counter (no SimEvent counts enemy shots). Output: the sound IDs to start this frame, each at most
 * once per frame and at most once per its minimum interval (a bow stream or a bullet ring is one sound, not fifty).
 *
 * Presentation only: reads sim state, never writes it.
 */
import type { SimEvents } from "shared/sim";
import type { FxEvent } from "../fx/events";

/** Every sound effect the game plays, by logical ID (theme manifest). */
export const SFX = {
	playerShoot: "sfx.player.shoot",
	playerSwing: "sfx.player.swing",
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
	uiClick: "sfx.ui.click",
	uiConfirm: "sfx.ui.confirm",
} as const;
export type SfxId = (typeof SFX)[keyof typeof SFX];

/** Every SFX ID, in declaration order. */
export const ALL_SFX: ReadonlyArray<SfxId> = [
	SFX.playerShoot,
	SFX.playerSwing,
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
	SFX.uiClick,
	SFX.uiConfirm,
];

/** IDs this port added to the placeholder pack (not in the web contract's AUDIO_EVENTS). */
export const PORT_SFX: ReadonlyArray<SfxId> = [
	SFX.playerSwing,
	SFX.playerFlask,
	SFX.playerSwap,
	SFX.playerDeflect,
	SFX.enemyTelegraph,
	SFX.bossDeath,
	SFX.victory,
];

/** Music tracks by logical ID. */
export const MUSIC = {
	menu: "music.menu",
	boss: "music.boss",
	biomePrefix: "music.biome.",
} as const;

/** Biome music for biome index 1..5 ("music.biome.<n>"). */
export function biomeMusic(biome: number): string {
	return `${MUSIC.biomePrefix}${biome}`;
}

/** Number of biomes with a music track (theme contract BIOMES). */
export const BIOME_MUSIC_COUNT = 5;

/** Every sound ID the audio layer can play (for the "exists in the pack" spec). */
export function allAudioIds(): string[] {
	const out: string[] = [];
	for (const id of ALL_SFX) out.push(id);
	out.push(MUSIC.menu, MUSIC.boss);
	for (let b = 1; b <= BIOME_MUSIC_COUNT; b++) out.push(biomeMusic(b));
	out.sort();
	return out;
}

/**
 * The mapping table, in play order within a frame: sim event field (summed over the frame's ticks) -> sound ID.
 * An entry fires when the field's frame total is > 0.
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
];

/** Shortest gap between two starts of the same sound, seconds (0 = once per frame at most). */
export const SFX_MIN_INTERVAL: Readonly<Partial<Record<SfxId, number>>> = {
	[SFX.playerShoot]: 0.06,
	[SFX.playerSwing]: 0.05,
	[SFX.playerDeflect]: 0.08,
	[SFX.enemyShoot]: 0.08,
	[SFX.enemyTelegraph]: 0.15,
	[SFX.enemyHurt]: 0.05,
	[SFX.enemyDeath]: 0.04,
	[SFX.playerHurt]: 0.1,
	[SFX.breakableHit]: 0.06,
	[SFX.breakableBreak]: 0.05,
};

/** The FX events the mapper reads (the tracker's pooled buffer satisfies it). */
export interface FxEventSource {
	count(): number;
	at(i: number): Pick<FxEvent, "type" | "boss" | "phase">;
}

/** Turns one frame's events into the sound IDs to start. Keeps per-ID cooldowns and the enemy-shot counter. */
export class AudioCueMapper {
	private readonly lastStart = new Map<string, number>();
	private lastEnemySpawned = -1;
	private readonly firedThisFrame = new Set<string>();

	/** A new run: forget the enemy-shot counter (cooldowns keep running on real time). */
	reset(): void {
		this.lastEnemySpawned = -1;
	}

	private cue(id: SfxId, now: number, out: string[]): void {
		if (this.firedThisFrame.has(id)) return;
		const gap = SFX_MIN_INTERVAL[id] ?? 0;
		const last = this.lastStart.get(id);
		if (last !== undefined && gap > 0 && now - last < gap) return;
		this.firedThisFrame.add(id);
		this.lastStart.set(id, now);
		out.push(id);
	}

	/**
	 * One rendered frame at real time `now` (seconds): `events` are the frame's summed SimEvents, `fx` the tracker's
	 * events of the frame, `enemySpawned` the run's enemy-bullet spawn counter. Appends the IDs to start to `out`.
	 */
	frame(now: number, events: Readonly<SimEvents>, fx: FxEventSource, enemySpawned: number, out: string[]): string[] {
		this.firedThisFrame.clear();
		for (const [field, id] of SIM_EVENT_SOUNDS) {
			if (events[field] > 0) this.cue(id, now, out);
		}
		for (let i = 0; i < fx.count(); i++) {
			const e = fx.at(i);
			if (e.type === "reset") this.reset();
			else if (e.type === "hit") this.cue(SFX.enemyHurt, now, out);
			else if (e.type === "killed" && !e.boss) this.cue(SFX.enemyDeath, now, out);
			else if (e.type === "bossPhase" && e.phase >= 2) this.cue(SFX.bossRoar, now, out);
			else if (e.type === "bossDefeated") this.cue(SFX.bossDeath, now, out);
		}
		// Breakables (summed over the frame's ticks): a break plays its own sound; the hit sound only for hits that
		// did not break (breakableHits counts the breaking hit too).
		if (events.breakablesBroken > 0) this.cue(SFX.breakableBreak, now, out);
		if (events.breakableHits > events.breakablesBroken) this.cue(SFX.breakableHit, now, out);
		if (this.lastEnemySpawned >= 0 && enemySpawned > this.lastEnemySpawned) this.cue(SFX.enemyShoot, now, out);
		this.lastEnemySpawned = enemySpawned;
		return out;
	}
}

/** What the music choice depends on (the HUD snapshot carries all of it). */
export interface MusicView {
	readonly outcome: "playing" | "dead" | "victory";
	/** A live boss is engaged. */
	readonly bossVisible: boolean;
	/** The floor's biome index 1..5, or 0 when there is no floor (greybox). */
	readonly biome: number;
}

/** The track that should be playing: none after a death, the boss track during the fight, else the floor's biome. */
export function musicFor(view: MusicView): string | undefined {
	if (view.outcome === "dead") return undefined;
	if (view.outcome === "playing" && view.bossVisible) return MUSIC.boss;
	if (view.biome >= 1 && view.biome <= BIOME_MUSIC_COUNT) return biomeMusic(view.biome);
	return undefined;
}
