// docs/SWORD_SPACING.md SP0: the contact-hit census's code path, fast (the census itself is swordSpacing.census.<n>,
// opt-in). The probe names a swarmer on the player as a contact hit and restores SimCtx after; the greedy fighter moves
// along the 8 key directions only; a short greedy run steps and tallies.
import { describe, expect, it } from "@rbxts/jest-globals";
import { screenToWorld } from "shared/play";
import {
	EMPTY_INPUT,
	SQRT1_2,
	SimCtx,
	archetypeAt,
	archetypeIndex,
	createSimState,
	quantizeAxis,
	simWorldConfig,
	spawnActor,
	step,
} from "shared/sim";
import { buildEndlessRunConfig } from "./endless";
import { ContactProbe, nearestKeyDir, spacingRun } from "./testing";

describe("sword spacing SP0 census (smoke)", () => {
	it("the probe classifies a swarmer on the player as a contact hit and restores hurtPlayerAt", () => {
		const cls = SimCtx as unknown as { hurtPlayerAt: unknown };
		const before = cls.hurtPlayerAt;
		const setup = buildEndlessRunConfig(1, 1, { characters: ["knight"] });
		const spawn = setup.spawn!;
		const s = createSimState(1, spawn.x, spawn.z, setup.config);
		const ctx = new SimCtx().bind(s, simWorldConfig(s, setup.config), EMPTY_INPUT);
		const a = spawnActor(ctx, archetypeIndex("swarmer"), s.player.x, s.player.z);
		expect(a).toBeDefined();
		const probe = new ContactProbe();
		probe.install();
		let landed = 0;
		let contact = 0;
		let kind = "";
		try {
			for (let k = 0; k < 120 && landed === 0; k++) {
				step(s, EMPTY_INPUT, setup.config);
				for (const h of probe.landed) {
					landed++;
					if (h.cause === "contact") {
						contact++;
						kind = archetypeAt(h.kind).id;
						expect(h.id).toBe(a!.id);
					}
				}
				probe.landed.clear();
			}
		} finally {
			probe.restore();
		}
		expect(landed).toBe(1);
		expect(contact).toBe(1);
		expect(kind).toBe("swarmer");
		expect(cls.hurtPlayerAt).toBe(before);
	});

	it("nearestKeyDir returns one of the 8 keys, and each key returns itself", () => {
		const keys: Array<[number, number]> = [
			[0, 1],
			[SQRT1_2, SQRT1_2],
			[1, 0],
			[SQRT1_2, -SQRT1_2],
			[0, -1],
			[-SQRT1_2, -SQRT1_2],
			[-1, 0],
			[-SQRT1_2, SQRT1_2],
		];
		for (const [right, up] of keys) {
			const w = screenToWorld(right, up);
			const k = nearestKeyDir(w.x, w.z);
			expect(k.x).toBe(w.x);
			expect(k.z).toBe(w.z);
			// 20 degrees off still picks it (a key's sector is 45 degrees wide)
			const c = math.cos(math.rad(20));
			const sn = math.sin(math.rad(20));
			const j = nearestKeyDir(w.x * c - w.z * sn, w.x * sn + w.z * c);
			expect(quantizeAxis(j.x)).toBe(quantizeAxis(w.x));
			expect(quantizeAxis(j.z)).toBe(quantizeAxis(w.z));
		}
	});

	it("a short greedy run steps, fights and tallies", () => {
		const t = spacingRun(1, { fighter: "greedy", label: "smoke", maxFloor: 1 }, 900);
		expect(t.runs).toBe(1);
		expect(t.fightTicks).toBeGreaterThan(0);
		expect(t.ticks[0]).toBeGreaterThan(0);
	});
});
