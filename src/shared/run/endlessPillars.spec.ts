// Solid pillars in a real endless floor's sim world (docs/DECOR.md D2): a swarmer or bruiser chasing a player who
// hides right behind a pillar rounds it with the floor's actorSteerMover (it would press on the pillar's face and
// give up without it), the pillar is cover (an idle enemy does not see the player through it), and the boss's
// charge never steers (it must stop dead at a wall).
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, gridToWorld, tileAt, type Dungeon } from "shared/dungeon";
import {
	BossAttack,
	BossState,
	EMPTY_INPUT,
	Button,
	START_HALF_HEARTS,
	SWARMER_LAST_X,
	SWARMER_LAST_Z,
	V_AGGRO,
	createSimState,
	engage,
	step,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";

/** The first endless floor (runs 1.., floors 1..6) with a pillar that has open floor 2 tiles all around it. */
function floorWithOpenPillar(): { fl: EndlessRunFloor; px: number; pz: number } {
	for (let run = 1; run <= 40; run++)
		for (let floor = 1; floor <= 6; floor++) {
			const fl = endlessRunFloor(run, floor);
			const d: Dungeon = fl.dungeon;
			for (const p of d.props) {
				if (p.kind !== "pillar") continue;
				let open = tileAt(d, p.x, p.y) === TileType.WALL;
				for (let oy = -2; oy <= 2; oy++)
					for (let ox = -2; ox <= 2; ox++)
						if ((ox !== 0 || oy !== 0) && tileAt(d, p.x + ox, p.y + oy) !== TileType.FLOOR) open = false;
				if (open) return { fl, px: gridToWorld(p.x), pz: gridToWorld(p.y) };
			}
		}
	error("no open pillar");
}

const { fl, px, pz } = floorWithOpenPillar();

function world(kind: string, steer: boolean): SimConfig {
	const c = fl.config;
	const encounter = c.encounter!;
	return {
		...c,
		actorSteerMover: steer ? c.actorSteerMover : undefined,
		encounter: { ...encounter, spawns: [{ kind, x: px - 2, z: pz }] },
	};
}

/** Closest the enemy gets to the player (standing still right behind the pillar) in `ticks`, engaged from the start. */
function chase(kind: string, steer: boolean, ticks: number): number {
	const config = world(kind, steer);
	const s: SimState = createSimState(7, px + 1.5, pz, config);
	const a = s.combat.actors.find((o) => o.alive !== 0)!;
	engage(a);
	a.v[SWARMER_LAST_X] = s.player.x; // a swarmer runs at where it last saw the player (harmless for a bruiser)
	a.v[SWARMER_LAST_Z] = s.player.z;
	let best = math.huge;
	for (let t = 0; t < ticks; t++) {
		step(s, EMPTY_INPUT, config);
		const dx = a.x - s.player.x;
		const dz = a.z - s.player.z;
		best = math.min(best, math.sqrt(dx * dx + dz * dz));
	}
	return best;
}

describe("enemies and solid pillars on an endless floor", () => {
	it("the floor's world has both movers", () => {
		expect(fl.config.actorSteerMover).toBeDefined();
		expect(fl.config.actorMover).toBeDefined();
	});

	it("a swarmer and a bruiser round the pillar to reach a player hiding behind it", () => {
		for (const kind of ["swarmer", "bruiser"]) {
			const near = chase(kind, true, 240);
			expect([kind, near < 1]).toEqual([kind, true]);
		}
	});

	it("without the steering mover they press on the pillar's face instead (what the steering fixes)", () => {
		for (const kind of ["swarmer", "bruiser"]) {
			const near = chase(kind, false, 240);
			expect([kind, near > 1.5]).toEqual([kind, true]);
		}
	});

	it("is cover: an idle swarmer does not notice a player in range right behind it", () => {
		const config = world("swarmer", true);
		const s = createSimState(7, px + 1.5, pz, config);
		const a = s.combat.actors.find((o) => o.alive !== 0)!;
		for (let t = 0; t < 120; t++) step(s, EMPTY_INPUT, config);
		expect(a.v[V_AGGRO]).toBe(0); // still idle
		expect([a.x, a.z]).toEqual([px - 2, pz]);
	});
});

describe("the boss never steers", () => {
	it("Mother Bramble's charge and reposition move with the plain actorMover on an endless boss floor", () => {
		const boss = endlessRunFloor(7919, 5);
		const radii = { steer: [] as number[], plain: [] as number[] };
		const c = boss.config;
		const config: SimConfig = {
			...c,
			actorMover: (x, z, dx, dz, r) => {
				radii.plain.push(r);
				return c.actorMover!(x, z, dx, dz, r);
			},
			actorSteerMover: (x, z, dx, dz, r) => {
				radii.steer.push(r);
				return c.actorSteerMover!(x, z, dx, dz, r);
			},
		};
		const room = c.encounter!.rooms[boss.dungeon.boss];
		const s = createSimState(11, room.cx + 2, room.cz, config);
		const a = s.combat.actors.find((o) => o.alive !== 0 && o.radius > 1)!;
		expect(a).toBeDefined();
		let slamTicks = 0;
		for (let t = 0; t < 3600 && a.alive !== 0; t++) {
			s.player.hearts = START_HALF_HEARTS; // the player only stands there; the boss must keep fighting
			// the debug J press until phase 3 (the slams), as the boss specs do
			const press = a.phase > 0 && a.phase < 3 && t % 20 === 10;
			step(s, press ? { ...EMPTY_INPUT, buttons: Button.DEBUG_BOSS } : EMPTY_INPUT, config);
			if (a.aiState === BossState.ACTIVE && a.attack === BossAttack.SLAM) slamTicks++;
		}
		const bossR = a.radius;
		expect(slamTicks).toBeGreaterThan(0);
		expect(radii.plain.filter((r) => r === bossR).size()).toBeGreaterThan(0);
		expect(radii.steer.filter((r) => r === bossR).size()).toBe(0);
	});
});
