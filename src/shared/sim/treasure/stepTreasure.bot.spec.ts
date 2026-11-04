// The UNTOUCHED lock and PERFECT agree in real fights (docs/TREASURE.md TR3 Verify): a sword bot (the pellet census's
// "ignore" fight: walk at the nearest member of the room, swing) fights the vault room of every floor 2-11 of 20 run
// seeds solo (200 rooms; every floor holds an UNTOUCHED vault through the dev override), the enemies free to hit it.
// For each room: the chest is kept (unlocked, and opened when the bot ends next to it, never cracked) exactly when the
// clear paid PERFECT. Test-only shortcuts:
// hearts topped up every tick, a teleport into the vault room, members still alive after FIGHT_TICKS killed through
// SimCtx, the debug floor skip with its draft dismissed.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, bulletBlocker, gridToWorld, lineOfSight, worldToGrid } from "shared/dungeon";
import {
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	NO_KIND,
	SIM_HZ,
	ScoreSource,
	SimCtx,
	TREASURE_UNSET,
	VaultStatus,
	createSimState,
	isDraftOpen,
	simWorldConfig,
	step,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildVaultRunConfig, dismissDraft, distanceField, frame, walkDir, type Field } from "shared/run/testing";
import type { EndlessRunSetup } from "shared/run";

const SEEDS = 20;
const FIRST_FLOOR = 2;
const FLOORS = 10;
const FIGHT_TICKS = 20 * SIM_HZ;
const MELEE_RANGE = 1.2;

function unit(dx: number, dz: number): [number, number] {
	const len = math.sqrt(dx * dx + dz * dz);
	return len > 1e-9 ? [dx / len, dz / len] : [0, 0];
}

function liveMembers(s: SimState): ActorState[] {
	const t = s.treasure!;
	const r = s.score!.rooms[t.record];
	const out: ActorState[] = [];
	for (let k = 0; k < r.memberSlots.size(); k++) {
		const a: ActorState | undefined = s.combat.actors[r.memberSlots[k]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === r.memberIds[k] && a.alive !== 0) out.push(a);
	}
	return out;
}

function tick(s: SimState, config: SimConfig, input: InputFrame): void {
	s.player.hearts = s.player.heartsMax;
	step(s, input, config);
	if (isDraftOpen(s)) dismissDraft(s);
}

/** Fights the vault room of the current floor; returns [kept, perfect]. */
function fightVault(setup: EndlessRunSetup, s: SimState): [boolean, boolean] {
	const config = setup.config;
	const t = s.treasure!;
	expect(t.status).toBe(VaultStatus.SEALED);
	const world = setup.endlessFloor(s.endless!.floor);
	const blocked = bulletBlocker(world.dungeon);
	const perfect0 = s.score!.counts[ScoreSource.PERFECT];
	const fields = new Map<number, Field>();
	const fieldTo = (x: number, z: number): Field => {
		const gx = worldToGrid(x);
		const gz = worldToGrid(z);
		const key = gz * world.dungeon.W + gx;
		let f = fields.get(key);
		if (f === undefined) {
			f = distanceField(world.dungeon, gridToWorld(gx), gridToWorld(gz));
			fields.set(key, f);
		}
		return f;
	};
	const p = s.player;
	p.x = t.x + t.fx;
	p.z = t.z + t.fz;
	tick(s, config, EMPTY_INPUT);
	expect(t.status === VaultStatus.ARMED || t.status === VaultStatus.CRACKED).toBe(true);
	const rec = s.score!.rooms[t.record];
	for (let n = 0; n < FIGHT_TICKS && rec.cleared === 0; n++) {
		const live = liveMembers(s);
		let best: ActorState | undefined;
		let bestD = math.huge;
		for (const a of live) {
			const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
			if (d < bestD) {
				bestD = d;
				best = a;
			}
		}
		if (best === undefined) {
			tick(s, config, EMPTY_INPUT);
			continue;
		}
		const [ax, az] = unit(best.x - p.x, best.z - p.z);
		const near = bestD <= MELEE_RANGE * MELEE_RANGE;
		let move: [number, number] = [0, 0];
		if (!near)
			move = lineOfSight(blocked, p.x, p.z, best.x, best.z)
				? [ax, az]
				: walkDir(fieldTo(best.x, best.z), p.x, p.z);
		tick(s, config, frame(move[0], move[1], Button.FIRE, ax, az));
	}
	if (rec.cleared === 0) {
		const ctx = new SimCtx().bind(s, simWorldConfig(s, config), EMPTY_INPUT);
		for (let pass = 0; pass < 8 && liveMembers(s).size() > 0; pass++)
			for (const a of liveMembers(s)) if (a.alive !== 0) ctx.killActor(a);
		tick(s, config, EMPTY_INPUT);
	}
	expect([rec.cleared, t.status === VaultStatus.UNLOCKED || t.status === VaultStatus.OPENED]).toEqual([1, true]);
	const kept = t.crackTick === TREASURE_UNSET;
	const perfect = s.score!.counts[ScoreSource.PERFECT] > perfect0;
	return [kept, perfect];
}

describe("treasure lock: UNTOUCHED agrees with PERFECT on 200 bot rooms (solo)", () => {
	it("kept exactly when the clear paid PERFECT, both outcomes seen", () => {
		let rooms = 0;
		let kept = 0;
		let cracked = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const setup = buildVaultRunConfig(seed, 1, {
				override: { every: true, lock: VaultLock.UNTOUCHED },
				startFloor: FIRST_FLOOR,
			});
			const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
			for (let f = 0; f < FLOORS; f++) {
				const [k, perfect] = fightVault(setup, s);
				expect([seed, s.endless!.floor, k]).toEqual([seed, s.endless!.floor, perfect]);
				rooms++;
				if (k) kept++;
				else cracked++;
				tick(s, setup.config, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON });
				tick(s, setup.config, EMPTY_INPUT);
			}
		}
		print(`[treasure bot] ${rooms} UNTOUCHED vault rooms: ${kept} kept (= PERFECT), ${cracked} cracked`);
		expect(rooms).toBe(SEEDS * FLOORS);
		expect(kept > 0 && cracked > 0).toBe(true);
	});
});
