// First sightings (docs/ENEMY_VARIANTS.md EV12): which new enemies / affixes the watched view shows (living actors near
// the view player; a slimelet is an Ooze; affixes by kind), and the one-toast-at-a-time queue over the account's seen
// set (nothing before a loaded status, a later status never forgets, a run exit drops what was never shown).
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, type FloorPellets } from "shared/dungeon";
import { SIGHTING_IDS } from "shared/onboarding";
import {
	AFFIXES_CONFIG,
	NO_KIND,
	PELLETS_CONFIG,
	PelletPhase,
	affixesOnSpawn,
	archetypeAt,
	createSimState,
	playerAt,
	type ActorSpawn,
	type SimConfig,
	type SimState,
} from "shared/sim";
import {
	ARCHETYPE_SIGHTINGS,
	POWER_PELLET_SIGHTING,
	SIGHTING_VIEW,
	SightingQueue,
	affixSighting,
	sightingsInView,
} from ".";

function config(spawns: ActorSpawn[], extra: Partial<SimConfig> = {}): SimConfig {
	return { encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 }, ...extra };
}

function slotOf(s: SimState, id: string): number {
	const actors = s.combat.actors;
	for (let i = 0; i < actors.size(); i++)
		if (actors[i].kind !== NO_KIND && archetypeAt(actors[i].kind).id === id) return i;
	error(`no ${id}`, 0);
}

const NEAR = SIGHTING_VIEW.radius - 1;
const FAR = SIGHTING_VIEW.radius + 1;

describe("sightingsInView", () => {
	it("the power pellet (docs/PELLETS.md PL14): only untaken in a live room, within the radius", () => {
		expect(SIGHTING_IDS).toContain(POWER_PELLET_SIGHTING);
		const floor: FloorPellets = {
			tiles: [
				{ x: NEAR, z: 0 },
				{ x: 1, z: 1 },
			],
			room: [0, 0],
			power: 0,
		};
		const s = createSimState(1, 0, 0, { pellets: { ...PELLETS_CONFIG, floor } });
		const p = s.pellets!;
		// A sandbox has no score records: give the two pellets one room by hand.
		p.rec[0] = 0;
		p.rec[1] = 0;
		p.rooms.push({ first: 0, span: 2, count: 1, left: 1, phase: PelletPhase.DORMANT, swept: 0 });
		expect(sightingsInView(s, 0, [])).toEqual([]);
		p.rooms[0].phase = PelletPhase.LIVE;
		expect(sightingsInView(s, 0, [])).toEqual([POWER_PELLET_SIGHTING]);
		expect(sightingsInView(s, 0, [], NEAR - 1)).toEqual([]);
		p.taken[0] = 1;
		expect(sightingsInView(s, 0, [])).toEqual([]);
		p.taken[0] = 0;
		p.rooms[0].phase = PelletPhase.GONE;
		expect(sightingsInView(s, 0, [])).toEqual([]);
	});

	it("names the living new archetypes near the view player, canonical order, each once", () => {
		const s = createSimState(
			1,
			0,
			0,
			config([
				{ kind: "summoner", x: NEAR, z: 0 },
				{ kind: "imp", x: 0, z: NEAR },
				{ kind: "imp", x: 1, z: 1 },
				{ kind: "slime", x: FAR, z: 0 }, // too far
				{ kind: "swarmer", x: 2, z: 0 }, // no sighting
			]),
		);
		expect(sightingsInView(s, 0, [])).toEqual(["imp", "summoner"]);
		// Dead ones do not count.
		s.combat.actors[slotOf(s, "summoner")].alive = 0;
		expect(sightingsInView(s, 0, [])).toEqual(["imp"]);
	});

	it("the Goldling (docs/FORTUNE.md FO8): its first sighting is `golden`, in canonical order before the affixes", () => {
		expect(ARCHETYPE_SIGHTINGS.get("golden")).toBe("golden");
		const s = createSimState(
			1,
			0,
			0,
			config([
				{ kind: "golden", x: NEAR, z: 0 },
				{ kind: "reaper", x: 1, z: 0 },
			]),
		);
		expect(sightingsInView(s, 0, [])).toEqual(["reaper", "golden"]);
		s.combat.actors[slotOf(s, "golden")].alive = 0;
		expect(sightingsInView(s, 0, [])).toEqual(["reaper"]);
		expect(SIGHTING_IDS.indexOf("golden") < SIGHTING_IDS.indexOf("affix.hulking")).toBe(true);
	});

	it("a slimelet is an Ooze; the radius is a circle", () => {
		const d = NEAR / math.sqrt(2);
		const s = createSimState(1, 0, 0, config([{ kind: "slime.small", x: d, z: -d }]));
		expect(sightingsInView(s, 0, [])).toEqual(["slime"]);
		expect(sightingsInView(s, 0, [], 1)).toEqual([]);
		expect(ARCHETYPE_SIGHTINGS.get("slime.small")).toBe("slime");
		for (const [, id] of ARCHETYPE_SIGHTINGS) expect(SIGHTING_IDS).toContain(id);
	});

	it("names an affixed enemy's affix (any archetype), by AffixKind", () => {
		const s = createSimState(1, 0, 0, config([{ kind: "bruiser", x: 3, z: 0 }], { affixes: AFFIXES_CONFIG }));
		const slot = slotOf(s, "bruiser");
		expect(sightingsInView(s, 0, [])).toEqual([]);
		affixesOnSpawn(s, slot, s.combat.actors[slot], AffixKind.SHIELDED);
		expect(sightingsInView(s, 0, [])).toEqual(["affix.shielded"]);
		expect([1, 2, 3, 4].map(affixSighting)).toEqual([
			"affix.hulking",
			"affix.swift",
			"affix.shielded",
			"affix.vengeful",
		]);
		expect([0, 5, 1.5].map(affixSighting)).toEqual([undefined, undefined, undefined]);
		// A stale affix slot (another actor's id) is not this actor's affix.
		s.affixes!.slots[slot].actorId = -1;
		expect(sightingsInView(s, 0, [])).toEqual([]);
	});

	it("an affixed new archetype names both, canonical order", () => {
		const s = createSimState(1, 0, 0, config([{ kind: "imp", x: 3, z: 0 }], { affixes: AFFIXES_CONFIG }));
		const slot = slotOf(s, "imp");
		affixesOnSpawn(s, slot, s.combat.actors[slot], AffixKind.SWIFT);
		const out = ["stale"];
		expect(sightingsInView(s, 0, out)).toEqual(["imp", "affix.swift"]);
		expect(out).toEqual(["imp", "affix.swift"]); // filled in place, cleared first
	});

	it("co-op: measured from the view player (a spectated teammate); an index outside the party is player 0", () => {
		const s = createSimState(1, 0, 0, config([{ kind: "imp", x: 30, z: 0 }], { party: { size: 2 } }));
		const mate = playerAt(s, 1);
		mate.x = 30 - NEAR;
		mate.z = 0;
		expect(sightingsInView(s, 0, [])).toEqual([]);
		expect(sightingsInView(s, 1, [])).toEqual(["imp"]);
		expect(sightingsInView(s, 5, [])).toEqual([]);
	});
});

describe("SightingQueue", () => {
	const LOADED = { loaded: true, tutorialDone: true };

	it("queues nothing before a loaded status (a failed join load: no toast at all)", () => {
		const q = new SightingQueue();
		q.observe(["imp"]);
		expect(q.next(0, true)).toBe(undefined);
		q.receive({ loaded: false, tutorialDone: false });
		q.observe(["imp"]);
		expect([q.isLoaded(), q.next(0, true)]).toEqual([false, undefined]);
		q.receive(LOADED);
		q.observe(["imp"]);
		expect(q.next(0, true)).toBe("imp");
	});

	it("one toast at a time, oldest first, each id once; seen ids never queue", () => {
		const q = new SightingQueue();
		q.receive({ ...LOADED, seen: ["slime"] });
		q.observe(["imp", "slime", "affix.swift"]);
		q.observe(["imp", "affix.swift"]); // already queued
		expect(q.pending()).toEqual(["imp", "affix.swift"]);
		expect(q.next(10, true)).toBe("imp");
		expect(q.isSeen("imp")).toBe(true);
		const ready = 10 + SIGHTING_VIEW.toastSeconds + SIGHTING_VIEW.gapSeconds;
		expect(q.next(ready - 0.01, true)).toBe(undefined);
		expect(q.next(ready, false)).toBe(undefined); // the caller's gate (a draft open, paused)
		expect(q.next(ready, true)).toBe("affix.swift");
		q.observe(["imp", "affix.swift"]);
		expect(q.pending()).toEqual([]);
		expect(q.next(ready * 2, true)).toBe(undefined);
	});

	it("a later status adds its sightings (dropping them from the queue) and never forgets local ones", () => {
		const q = new SightingQueue();
		q.receive(LOADED);
		q.observe(["imp", "summoner"]);
		expect(q.next(0, true)).toBe("imp");
		q.receive({ ...LOADED, seen: ["summoner"] }); // e.g. the answer after a tutorial finish, from the server
		expect(q.pending()).toEqual([]);
		expect([q.isSeen("imp"), q.isSeen("summoner")]).toEqual([true, true]);
		q.receive(LOADED); // a status without seen forgets nothing
		expect(q.isSeen("imp")).toBe(true);
	});

	it("a run exit drops the queued ids that were never shown: they are found again", () => {
		const q = new SightingQueue();
		q.receive(LOADED);
		q.observe(["imp", "slime"]);
		expect(q.next(0, true)).toBe("imp");
		q.clear();
		expect(q.pending()).toEqual([]);
		expect(q.isSeen("slime")).toBe(false);
		q.observe(["imp", "slime"]);
		expect(q.pending()).toEqual(["slime"]);
	});

	it("co-op: each client's own set (a teammate who has seen it gets no toast)", () => {
		const veteran = new SightingQueue();
		const rookie = new SightingQueue();
		veteran.receive({ ...LOADED, seen: ["imp"] });
		rookie.receive(LOADED);
		for (const q of [veteran, rookie]) q.observe(["imp"]);
		expect([veteran.next(0, true), rookie.next(0, true)]).toEqual([undefined, "imp"]);
	});
});
