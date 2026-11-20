/**
 * A frame's secret-room events (docs/SECRET_ROOMS.md SR6, Design 6). The sim's feeds are per TICK and cleared at the
 * start of every tick: the knocks on BreakablesState (`knockSlots` / `knockSources` / `knockPlayers`, SR2: one per
 * wrong-way contact with a crack piece, present without state.secrets too) and `state.secrets.events` (`opened`,
 * `taken`, SR3 / SR4). A rendered frame may run several ticks, so the run views (shared/play LiveRun, shared/lockstep
 * LockstepClient) `collect` them after every tick into one SecretFrameEvents (RunView.secrets) and `reset` it at the
 * start of every frame, as they do the vault's and the Goldling's. SecretViewTracker (the burst, the shout's edge),
 * the cue tracker (the knock, the crumble, the jingle), the first-knock latch (the first-time card), the co-op toast,
 * the Codex frame and the recap read it once per frame. Presentation only: plain numbers copied out of the state,
 * read-only on the sim (unhashed feeds and hashed state, never written), tested headlessly.
 *
 * Every record carries the tick (state.tick at the END of its tick, as the vault's) and the crack's first slot, so a
 * view can tell a secret of the floor before from the current one when a frame ran a floor change. A leaf (shared/sim,
 * shared/dungeon and the vault's grant view type only).
 *
 * @module
 */
import { gridToWorld } from "shared/dungeon";
import { SECRET_UNSET, type SimState } from "shared/sim";
import type { TreasureGrantView } from "../treasure/events";

/** A knock: the crack piece hit the wrong way (no damage), where, by what and whom. */
export interface SecretKnockEvent {
	readonly tick: number;
	/** The knocked crack piece's breakables slot and its cell's centre (world). */
	readonly slot: number;
	readonly x: number;
	readonly z: number;
	/** shared/sim BreakableSource of the contact (MELEE, PLAYER_BULLET, ENEMY_BULLET, SLAM, ROLL, BUILD). */
	readonly source: number;
	/** The party index behind it, or SECRET_UNSET (enemy bullets, slams, a Bomber's blast, a Charger). */
	readonly player: number;
}

/** The crack's open (shared/sim SecretOpened, copied, plus the plan's identity and the chest). */
export interface SecretOpenedEvent {
	readonly tick: number;
	/** shared/sim SecretHow (FINISHER / ROLL / HEAVY / CHARGER). */
	readonly how: number;
	/** The party index credited with it (SECRET_UNSET for a Charger's charge). */
	readonly player: number;
	/** The toast's player: the credited one, or the nearest living present player for a Charger (SECRET_UNSET: none). */
	readonly finder: number;
	/** The crack's first slot, its centre (world, between its cells) and its facing into the room. */
	readonly slot: number;
	readonly x: number;
	readonly z: number;
	readonly fx: number;
	readonly fz: number;
	/** The crack's encounter room and the chest's VaultTier, centre (world). */
	readonly room: number;
	readonly tier: number;
	readonly chestX: number;
	readonly chestZ: number;
	/** SECRET points scored by the open (0 without scoring). */
	readonly points: number;
}

/** The chest's open (shared/sim SecretTaken, copied). */
export interface SecretTakenEvent {
	readonly tick: number;
	/** The crack's first slot (the secret's identity) and the chest's centre (world) and facing. */
	readonly slot: number;
	readonly x: number;
	readonly z: number;
	readonly fx: number;
	readonly fz: number;
	/** The party index who opened it (for the whole party). */
	readonly opener: number;
	/** VaultTier (RARE or LEGENDARY). */
	readonly tier: number;
	/** SECRET points the chest scored (0 without scoring). */
	readonly points: number;
	/** One per living present player, index order (the vault's grant view: relic, bonus deal, boosts, slots). */
	readonly grants: ReadonlyArray<TreasureGrantView>;
}

/** What the views read (SecretFrameEvents satisfies it). Each list is in tick order. */
export interface SecretFrameSource {
	readonly knocks: ReadonlyArray<SecretKnockEvent>;
	readonly opened: ReadonlyArray<SecretOpenedEvent>;
	readonly taken: ReadonlyArray<SecretTakenEvent>;
}

/** The secret-room events of every tick a frame ran, in tick order. */
export class SecretFrameEvents implements SecretFrameSource {
	readonly knocks: SecretKnockEvent[] = [];
	readonly opened: SecretOpenedEvent[] = [];
	readonly taken: SecretTakenEvent[] = [];

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.knocks.clear();
		this.opened.clear();
		this.taken.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return this.knocks.size() + this.opened.size() + this.taken.size();
	}

	/**
	 * After every tick: appends that tick's knocks (no-op without breakables) and opens / takes (no-op without
	 * state.secrets). Copies: the sim reuses its arrays and clears its events every tick.
	 */
	collect(state: Readonly<SimState>): void {
		const tick = state.tick;
		const b = state.breakables;
		if (b !== undefined) {
			for (let i = 0; i < b.knockSlots.size(); i++) {
				const slot = b.knockSlots[i];
				const p = b.pieces[slot];
				if (p === undefined) continue;
				this.knocks.push({
					tick,
					slot,
					x: gridToWorld(p.x),
					z: gridToWorld(p.y),
					source: b.knockSources[i] ?? SECRET_UNSET,
					player: b.knockPlayers[i] ?? SECRET_UNSET,
				});
			}
		}
		const sc = state.secrets;
		if (sc === undefined) return;
		const o = sc.events.opened;
		if (o !== undefined) {
			this.opened.push({
				tick,
				how: o.how,
				player: o.player,
				finder: o.finder,
				slot: o.slot,
				x: o.x,
				z: o.z,
				fx: sc.fx,
				fz: sc.fz,
				room: sc.room,
				tier: sc.tier,
				chestX: sc.x,
				chestZ: sc.z,
				points: o.points,
			});
		}
		const t = sc.events.taken;
		if (t !== undefined) {
			const grants: TreasureGrantView[] = [];
			for (const g of t.grants) {
				grants.push({
					player: g.player,
					relic: g.relic,
					bonusDeal: g.bonusDeal,
					boosts: [...g.boosts],
					slots: [...g.slots],
				});
			}
			this.taken.push({
				tick,
				slot: sc.crackSlot,
				x: sc.x,
				z: sc.z,
				fx: sc.fx,
				fz: sc.fz,
				opener: t.opener,
				tier: t.tier,
				points: t.points,
				grants,
			});
		}
	}
}

/** No events (a run view without secrets, the specs' default). */
export const NO_SECRET_EVENTS: SecretFrameSource = new SecretFrameEvents();
