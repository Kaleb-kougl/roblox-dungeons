/**
 * Afterimages (docs/FEEL.md J7): a roll leaves a few fading ghosts of the knight, and so does the Demon Lord's
 * brimstone charge. Pure: a fixed ring of ghosts per source (GhostTrail); the client copies the sprite's drawn frame into
 * a ghost (SpriteView.snapshot) when one is due and draws the ring from a preallocated pool (ActorRenderController's
 * ghost pool under KV_Actors/Ghosts).
 *
 * While its source is active (a player's rollTicks > 0; the Demon Lord charging), a trail records a ghost on the first
 * active frame and then every FEEL_GHOST.everyTicks sim ticks: where the sprite is drawn that frame (interpolated feet),
 * its frame's image / rect, billboard size and offset. Each ghost lives FEEL_GHOST.lifeSec, its transparency going
 * FEEL_GHOST.startTransparency -> 1; at most FEEL_GHOST.perSource are alive per source (the ring reuses the oldest).
 * Off (every trail cleared) under reduced motion or with the effective particles level `off` (ghostsOn, JD9).
 * Presentation only: nothing here reaches the sim.
 *
 * @module
 */
import type { JuiceSettings } from "shared/settings";
import { BOSS_DEMONLORD_ID, DEMONLORD_V_MARK, DemonlordAttack, DemonlordState, type ActorState } from "shared/sim";
import type { SpriteSet } from "shared/theme";
import { effectiveParticles } from "./juiceRules";
import { FEEL_GHOST } from "./motionFxConfig";

/** What a ghost draws: one sprite frame as its view drew it (SpriteView.snapshot fills it). */
export interface GhostSnapshot {
	image: string;
	/** ImageRectOffset / ImageRectSize, pixels. */
	rectX: number;
	rectY: number;
	rectW: number;
	rectH: number;
	/** BillboardGui size (studs) and StudsOffset (camera space: x right, y up, z toward the camera), as drawn. */
	w: number;
	h: number;
	offsetX: number;
	offsetY: number;
	offsetZ: number;
	resample: SpriteSet["resample"];
	/**
	 * docs/COSMETICS.md CS5: the dye label as drawn (its image, "" for none, and its colour 0..1: the dye x the
	 * sprite's tint), drawn over the ghost's frame like the sprite's.
	 */
	dyeImage: string;
	dyeR: number;
	dyeG: number;
	dyeB: number;
}

/**
 * One afterimage in a GhostTrail's ring: where and when a source's sprite was recorded and the frame it showed. The
 * trail writes it; the client's actor renderer draws each `alive` one from its ghost pool, rewriting the billboard only
 * when `serial` changes and fading it by its age since `bornAt`.
 */
export interface Ghost {
	/** Recorded and not yet faded out. */
	alive: boolean;
	/** Effect-clock seconds when it was recorded. */
	bornAt: number;
	/** Bumped on every recording: the client rewrites its properties when it changes. */
	serial: number;
	/** The source's feet when it was recorded, studs (the sprite anchor's position). */
	x: number;
	y: number;
	z: number;
	readonly snap: GhostSnapshot;
}

/** Ghosts on? Not under reduced motion, not with the particles level (effective) off. */
export function ghostsOn(s: Readonly<JuiceSettings>): boolean {
	return !s.reducedMotion && effectiveParticles(s) !== "off";
}

/** A ghost's transparency `ageSec` after it was recorded: startTransparency -> 1 over lifeSec; 1 outside [0, life). */
export function ghostTransparency(ageSec: number): number {
	const life = FEEL_GHOST.lifeSec;
	if (!(ageSec >= 0) || !(life > 0) || ageSec >= life) return 1;
	const t0 = FEEL_GHOST.startTransparency;
	return t0 + (1 - t0) * (ageSec / life);
}

/** The Demon Lord mid brimstone charge (ACTIVE CHARGE before the impact, v[MARK] 0; read like shared/view sprites.ts). */
export function brimstoneCharging(a: Readonly<ActorState>, archetypeId: string): boolean {
	return (
		archetypeId === BOSS_DEMONLORD_ID &&
		a.alive !== 0 &&
		a.aiState === DemonlordState.ACTIVE &&
		a.attack === DemonlordAttack.CHARGE &&
		a.v[DEMONLORD_V_MARK] === 0
	);
}

function blankGhost(): Ghost {
	return {
		alive: false,
		bornAt: 0,
		serial: 0,
		x: 0,
		y: 0,
		z: 0,
		snap: {
			image: "",
			rectX: 0,
			rectY: 0,
			rectW: 0,
			rectH: 0,
			w: 0,
			h: 0,
			offsetX: 0,
			offsetY: 0,
			offsetZ: 0,
			resample: "Pixelated",
			dyeImage: "",
			dyeR: 1,
			dyeG: 1,
			dyeB: 1,
		},
	};
}

/**
 * One source's ring of ghosts (preallocated, FEEL_GHOST.perSource). Per frame: `due(active, tick, now)` hands out the
 * ghost to fill when one is due (the owner fills x / y / z and snap; `cancel` gives it back when the sprite had no frame
 * to copy), then `transparencyOf(g, now)` for each ghost draws the ring.
 */
export class GhostTrail {
	readonly ghosts: Ghost[] = [];
	private head = 0;
	private active = false;
	/** Sim tick of the last recording (valid while active). */
	private lastTick = 0;
	/** Owner key (e.g. the actor's id for the Demon Lord's trail); a new key clears the trail. */
	private key = 0;

	constructor(readonly capacity: number = FEEL_GHOST.perSource) {
		for (let i = 0; i < capacity; i++) this.ghosts.push(blankGhost());
	}

	/** Drops every ghost (a new run, ghosts turned off, a new owner). */
	clear(): void {
		for (const g of this.ghosts) g.alive = false;
		this.active = false;
	}

	/** Binds the trail to `key` (clearing it when the key changes). */
	bind(key: number): void {
		if (key === this.key) return;
		this.key = key;
		this.clear();
	}

	/**
	 * The ghost to record this frame, or undefined: due on the first frame the source is active, then once
	 * FEEL_GHOST.everyTicks sim ticks passed since the last one (a tick going back, a new run, restarts the count).
	 */
	due(active: boolean, tick: number, now: number): Ghost | undefined {
		if (!active) {
			this.active = false;
			return undefined;
		}
		if (this.active && tick >= this.lastTick && tick - this.lastTick < FEEL_GHOST.everyTicks) return undefined;
		this.active = true;
		this.lastTick = tick;
		const g = this.ghosts[this.head];
		this.head = (this.head + 1) % this.capacity;
		g.alive = true;
		g.bornAt = now;
		g.serial++;
		return g;
	}

	/** Undoes the last `due` (the sprite had nothing to copy): the ghost is not drawn. */
	cancel(g: Ghost): void {
		g.alive = false;
	}

	/** `g`'s transparency at `now` (1: not drawn); a ghost past its life (or from a clock gone back) dies. */
	transparencyOf(g: Ghost, now: number): number {
		if (!g.alive) return 1;
		const t = ghostTransparency(now - g.bornAt);
		if (t >= 1) g.alive = false;
		return t;
	}

	/** Ghosts alive now (tests, the debug line). */
	aliveCount(): number {
		let n = 0;
		for (const g of this.ghosts) if (g.alive) n++;
		return n;
	}
}
