// M2 in-run progression (progression.ts, runMods.ts): boon offers (distinct, unowned, rarity weights with the
// per-floor legendary ramp and its cap, deterministic), the draft (frozen world, stick + FIRE, replays identically),
// each boon's effect at its application point, each relic's trigger and effect, the curse shrine (once per floor) and
// each curse, the "run" hash group. Effects are measured in an open endless ARENA (a hand-made EndlessFloorWorld: the
// greybox bounds, no walls, a treasure room and a shrine room), the draft on real Dungeon Forge floors. The full
// recorded endless run with drafts, a relic and a curse is in shared/run slice.spec.ts / endless.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOONS,
	BOON_COUNT,
	BOW_DATA,
	CLASSIC_BOON_COUNT,
	BOW_V_CHARGE,
	Boon,
	BulletKind,
	BulletPayload,
	Button,
	COMBO_WINDOW_TICKS,
	CURSES,
	CURSE_COUNT,
	Curse,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	EMPTY_INPUT,
	ENEMY_BULLET_RADIUS,
	GRAZE_MARGIN,
	GRAZE_MARGIN_BOON,
	HOURGLASS_TICKS,
	HOURGLASS_TIME_SCALE,
	NEUTRAL_RUN_MODS,
	NO_SELECTION,
	PLAYER_RADIUS,
	RELICS,
	AFFIXES_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	TREASURE_SUBSYSTEM,
	BREAKABLES_SUBSYSTEM,
	DROPS_SUBSYSTEM,
	RUN_SUBSYSTEM,
	Rarity,
	Recorder,
	Relic,
	ROLL_IFRAME_TICKS,
	ROLL_RING_COUNT,
	Rng,
	SHRINE_BUTTON,
	SIM_DT,
	SOLO_PLAYER,
	SWORD_DATA,
	SWORD_V_BUSY,
	ScoreSource,
	SimCtx,
	acceptCurse,
	cloneSimState,
	takeTreasureBonusDeals,
	unownedRelics,
	createSimState,
	curseMultiplier,
	draftCardFor,
	draftColumn,
	drawBoonOffers,
	enemyBulletSpeedMultiplier,
	fireBurstRaw,
	grantBoon,
	grantRelic,
	groupValues,
	hashLayout,
	hashState,
	isDraftOpen,
	packPayload,
	rarityForRoll,
	rarityPercents,
	rngInt,
	runMods,
	runReplay,
	scaleTicks,
	step,
	writeHashFields,
	writeWeaponsHash,
	type ActorSpawn,
	type ActorState,
	type BulletSimulation,
	type EncounterRoom,
	type EncounterRoomType,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { frame } from "shared/run/testing";

const SEED = 42;

// ---------------------------------------------------------------------------------------------
// The arena: every floor is the same open greybox square with a treasure room (pedestal at (3, 0)), a shrine room
// (zone at (-3, 0)) and a combat room around (0, 5) whose one swarmer spawns on first entry.

function room(id: number, kind: EncounterRoomType, cx: number, cz: number): EncounterRoom {
	const h = 1;
	return { id, type: kind, depth: 1, cx, cz, minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h, floorTiles: 9 };
}

const ROOMS: EncounterRoom[] = [room(0, "treasure", 3, 0), room(1, "shrine", -3, 0), room(2, "combat", 0, 5)];
const ROOM_SPAWNS: ActorSpawn[][] = [[], [], [{ kind: "swarmer", x: 0, z: 5.5 }]];
const TREASURE = ROOMS[0];
const SHRINE = ROOMS[1];
const COMBAT = ROOMS[2];

const arenaWorlds = new Map<number, EndlessFloorWorld>();
function arenaWorld(floor: number): EndlessFloorWorld {
	let w = arenaWorlds.get(floor);
	if (w === undefined) {
		w = {
			floor,
			config: {
				bounds: DEFAULT_BOUNDS,
				encounter: { spawns: [], rooms: ROOMS, entranceRoom: -1, bossRoom: -1 },
			},
			bossFloor: false,
			spawnX: 0,
			spawnZ: 0,
			// Out of reach: floors end by the debug skip only.
			stairX: 1000,
			stairZ: 1000,
			roomSpawns: ROOM_SPAWNS,
			roomIdAt: (x, z) => {
				for (const r of ROOMS) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.id;
				return -1;
			},
		};
		arenaWorlds.set(floor, w);
	}
	return w;
}

const ARENA: SimConfig = { endless: { runSeed: SEED, worldForFloor: arenaWorld }, scoring: {} };

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
}

/** A fresh arena run (player at the origin), with `boons` and `relics` granted and `curses` accepted. */
function arena(boons: number[] = [], relics: number[] = [], curses: number[] = []): Run {
	const s = createSimState(SEED, 0, 0, ARENA);
	for (const b of boons) grantBoon(s, SOLO_PLAYER, b);
	for (const x of relics) grantRelic(s, SOLO_PLAYER, x);
	for (const c of curses) acceptCurse(s, SOLO_PLAYER, c);
	return { config: ARENA, s };
}

/**
 * A fresh run on the real endless floors of SEED, WITHOUT builds (docs/BUILDS.md: the classic draft these specs pin;
 * builds' card draft is specced in sim/builds builds.spec.ts).
 */
function dungeon(): Run {
	const setup = buildEndlessRunConfig(SEED);
	const spawn = setup.spawn!;
	const config: SimConfig = { ...setup.config, builds: undefined };
	return { config, s: createSimState(SEED, spawn.x, spawn.z, config) };
}

function tick(r: Run, input: Readonly<InputFrame> = EMPTY_INPUT): void {
	step(r.s, input, r.config);
}

function ctxOf(r: Run): SimCtx {
	return new SimCtx().bind(r.s, r.config.endless!.worldForFloor(r.s.endless!.floor).config, EMPTY_INPUT);
}

function spawnAt(r: Run, kind: string, x: number, z: number): ActorState {
	return ctxOf(r).spawnActor(kind, x, z)!;
}

/** One enemy bullet from (x, z) along the unit direction (dirX, dirZ) at `speed`. */
function enemyBullet(r: Run, x: number, z: number, dirX: number, dirZ: number, speed: number): void {
	const c = r.s.combat;
	c.enemySpawned += fireBurstRaw(c.enemyBullets, 0, x, z, dirX, dirZ, 1, 0, speed, 5, packPayload(1, 5, 0));
}

function onlyBullet(sim: BulletSimulation): number {
	let slot = -1;
	sim.forEachActive((i) => {
		slot = i;
		return false;
	});
	return slot;
}

/** Debug-skips one floor (press, release); a draft that opens stays open. */
function skipFloor(r: Run): void {
	tick(r, frame(0, 0, DEBUG_FLOOR_BUTTON));
}

const me = (s: SimState) => s.run!.players[SOLO_PLAYER];

// ---------------------------------------------------------------------------------------------

describe("boon offers", () => {
	it("12 classic boons: 7 common, 3 rare, 2 legendary, 4 per category; 4 relics, 4 curses", () => {
		// docs/BUILDS.md BU1: three on-kill boons appended after them (builds-only; drawBoonOffers never sees them).
		expect([CLASSIC_BOON_COUNT, BOON_COUNT]).toEqual([12, 15]);
		const classic = BOONS.filter((_, i) => i < CLASSIC_BOON_COUNT);
		const by = (rarity: number) => classic.filter((b) => b.rarity === rarity).size();
		expect([by(Rarity.COMMON), by(Rarity.RARE), by(Rarity.LEGENDARY)]).toEqual([7, 3, 2]);
		for (const c of ["offense", "defense", "score"]) expect(classic.filter((b) => b.category === c).size()).toBe(4);
		expect([RELICS.size(), CURSES.size()]).toEqual([4, 4]);
	});

	it("rarity weights 70 / 25 / 5, legendary +1 point per floor (from common), capped at 15", () => {
		expect(rarityPercents(1)).toEqual([70, 25, 5]);
		expect(rarityPercents(2)).toEqual([69, 25, 6]);
		expect(rarityPercents(6)).toEqual([65, 25, 10]);
		expect(rarityPercents(11)).toEqual([60, 25, 15]);
		expect(rarityPercents(40)).toEqual([60, 25, 15]);
		for (let f = 1; f <= 20; f++) {
			const w = rarityPercents(f);
			expect(w[0] + w[1] + w[2]).toBe(100);
		}
		// Roll boundaries on floor 1: [0, 5) legendary, [5, 30) rare, [30, 100) common; on floor 11 [0, 15) legendary.
		expect([0, 4, 5, 29, 30, 99].map((roll) => rarityForRoll(roll, 1))).toEqual([2, 2, 1, 1, 0, 0]);
		expect([14, 15, 39, 40].map((roll) => rarityForRoll(roll, 11))).toEqual([2, 1, 1, 0]);
	});

	it("draws 3 distinct unowned boons: one rarity roll and one pick per card, deterministic for a seed", () => {
		for (let seed = 1; seed <= 200; seed++) {
			const owned: number[] = seed % 3 === 0 ? [Boon.SHARPENED, Boon.EMBER_WAKE] : [];
			const floor = 1 + (seed % 14);
			const rng = new Rng(seed);
			const twin = new Rng(seed);
			const offers = drawBoonOffers(rng, owned, floor);
			expect(offers.size()).toBe(DRAFT_OFFER_COUNT);
			// The same algorithm by hand on a twin generator.
			const left: number[] = [];
			for (let b = 0; b < CLASSIC_BOON_COUNT; b++) if (!owned.includes(b)) left.push(b);
			const want: number[] = [];
			for (let k = 0; k < DRAFT_OFFER_COUNT; k++) {
				const rarity = rarityForRoll(rngInt(twin, 0, 99), floor);
				let pool = left.filter((b) => BOONS[b].rarity === rarity);
				if (pool.size() === 0) pool = left;
				const pick = pool[rngInt(twin, 0, pool.size() - 1)];
				want.push(pick);
				left.remove(left.indexOf(pick));
			}
			expect([seed, ...offers]).toEqual([seed, ...want]);
			expect(rng.getState()).toBe(twin.getState());
			for (const b of offers) expect(owned.includes(b)).toBe(false);
			expect(new Set(offers).size()).toBe(DRAFT_OFFER_COUNT);
			expect(drawBoonOffers(new Rng(seed), owned, floor)).toEqual(offers);
		}
	});

	it("the first card's rarity follows the weights (20,000 drafts each on floor 1 and floor 11)", () => {
		const cases: Array<[number, number[]]> = [
			[1, [70, 25, 5]],
			[11, [60, 25, 15]],
		];
		for (const [floor, pct] of cases) {
			const n = 20000;
			const counts = [0, 0, 0];
			const rng = new Rng(floor);
			for (let i = 0; i < n; i++) counts[BOONS[drawBoonOffers(rng, [], floor)[0]].rarity] += 1;
			const got = counts.map((c) => (c * 100) / n);
			print(`[progression] floor ${floor}: first-card rarity % ${got.join(" / ")} (want ${pct.join(" / ")})`);
			for (let k = 0; k < 3; k++) expect([floor, k, math.abs(got[k] - pct[k]) < 1.5]).toEqual([floor, k, true]);
		}
	});

	it("an exhausted rarity falls back to every remaining boon; 3 or fewer left: all of them, no rng", () => {
		const rng = new Rng(7);
		for (let i = 0; i < 500; i++) {
			const offers = drawBoonOffers(rng, [Boon.EMBER_WAKE, Boon.COMPOSURE], 11);
			expect(offers.size()).toBe(3);
			for (const b of offers) expect(BOONS[b].rarity).never.toBe(Rarity.LEGENDARY);
		}
		const owned: number[] = [];
		for (let b = 0; b < CLASSIC_BOON_COUNT - 2; b++) owned.push(b);
		const quiet = new Rng(9);
		const before = quiet.getState();
		expect(drawBoonOffers(quiet, owned, 3)).toEqual([CLASSIC_BOON_COUNT - 2, CLASSIC_BOON_COUNT - 1]);
		expect(quiet.getState()).toBe(before);
		owned.push(CLASSIC_BOON_COUNT - 2, CLASSIC_BOON_COUNT - 1);
		expect(drawBoonOffers(quiet, owned, 3)).toEqual([]);
	});

	it("the stick picks the card: screen-right / left beyond the dead zone, else the centre; 2 cards sit left / right", () => {
		const right = frame(DRAFT_SCREEN_RIGHT_X, DRAFT_SCREEN_RIGHT_Z);
		const left = frame(-DRAFT_SCREEN_RIGHT_X, -DRAFT_SCREEN_RIGHT_Z);
		const up = frame(-DRAFT_SCREEN_RIGHT_X, -DRAFT_SCREEN_RIGHT_X); // screen-up: no horizontal component
		const weak = frame(DRAFT_SCREEN_RIGHT_X * 0.4, DRAFT_SCREEN_RIGHT_Z * 0.4);
		expect([right, left, up, weak, EMPTY_INPUT].map((f) => draftColumn(f))).toEqual([2, 0, 1, 1, 1]);
		expect([0, 1, 2].map((c) => draftCardFor(c, 3))).toEqual([0, 1, 2]);
		expect([0, 1, 2].map((c) => draftCardFor(c, 2))).toEqual([0, NO_SELECTION, 1]);
		expect([0, 1, 2].map((c) => draftCardFor(c, 1))).toEqual([0, 0, 0]);
	});
});

// ---------------------------------------------------------------------------------------------

describe("the draft", () => {
	it("opens on every floor change with offers from the sim rng (floor just cleared), only in endless runs", () => {
		const r = dungeon();
		expect(r.s.run).never.toBe(undefined);
		expect(me(r.s).draftOpen).toBe(0);
		const rngBefore = r.s.rngState;
		skipFloor(r);
		expect(r.s.events.floorChanged).toBe(2);
		expect(isDraftOpen(r.s)).toBe(true);
		expect(r.s.run!.events.draftOpened).toBe(3);
		expect(me(r.s).draftOffers).toEqual(drawBoonOffers({ rngState: rngBefore }, [], 1));
		expect(me(r.s).draftSelected).toBe(DRAFT_COLUMN_CENTRE);
		const plain = createSimState(SEED, 0, 0, { scoring: {} });
		expect(plain.run).toBe(undefined);
	});

	it("freezes the world for its whole duration: no actor, bullet, timer or hit moves", () => {
		const r = dungeon();
		skipFloor(r);
		const s = r.s;
		const p = s.player;
		// Things that would act: a bruiser next to the player, a bullet about to hit, a running combo, i-frames.
		spawnAt(r, "bruiser", p.x + 1.2, p.z);
		enemyBullet(r, p.x - 1, p.z, 1, 0, 6);
		s.score!.combo = 20;
		s.score!.comboTimer = 50;
		p.iframeTicks = 5;
		const before = hashLayout(s);
		const weaponsBefore: number[] = [];
		writeWeaponsHash(s.combat.weapons, weaponsBefore);
		const p0 = { ...p };
		const steps0 = s.combat.enemyBullets.stepCount;
		// 40 ticks of every button pressed / released, the stick swept, aim held. FIRE only before the draft may be
		// confirmed (an early confirm is ignored), so the draft stays open throughout.
		const others = bit32.bor(Button.ALT, Button.ROLL, Button.EMBER, Button.FLASK, Button.SWAP, Button.SKILL1);
		for (let i = 0; i < 40; i++) {
			let b = i % 2 === 0 ? others : 0;
			if (i % 2 === 0 && i < 20) b = bit32.bor(b, Button.FIRE, Button.DEBUG_HIT);
			const side = i < 20 ? 1 : -1;
			tick(r, frame(side * DRAFT_SCREEN_RIGHT_X, side * DRAFT_SCREEN_RIGHT_Z, b, 1, 0));
		}
		expect(isDraftOpen(s)).toBe(true);
		const after = hashLayout(s);
		for (const g of ["combatHeader", "actors", "enemyBullets", "playerBullets", "endless", "score"]) {
			const was = groupValues(before, before.groups.find((x) => x.name === g)!);
			const now = groupValues(after, after.groups.find((x) => x.name === g)!);
			expect([g, ...now]).toEqual([g, ...was]);
		}
		const weaponsNow: number[] = [];
		writeWeaponsHash(s.combat.weapons, weaponsNow);
		weaponsNow[1] = weaponsBefore[1]; // prevButtons follows the input
		expect(weaponsNow).toEqual(weaponsBefore);
		expect({ ...p, prevButtons: 0 }).toEqual({ ...p0, prevButtons: 0 });
		expect(s.combat.enemyBullets.stepCount).toBe(steps0);
		expect([s.tick, me(s).draftTicks, me(s).draftSelected]).toEqual([41, 40, DRAFT_COLUMN_LEFT]);
	});

	it("a FIRE press once open DRAFT_MIN_OPEN_TICKS takes the selected card; the world resumes; held buttons stay quiet", () => {
		const r = dungeon();
		skipFloor(r);
		const offers = [...me(r.s).draftOffers];
		const leftStick = frame(-DRAFT_SCREEN_RIGHT_X, -DRAFT_SCREEN_RIGHT_Z);
		tick(r, { ...leftStick, buttons: Button.FIRE }); // too early: ignored
		tick(r, leftStick);
		while (me(r.s).draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) tick(r, leftStick);
		expect([isDraftOpen(r.s), me(r.s).draftSelected]).toEqual([true, DRAFT_COLUMN_LEFT]);
		// Confirm with ROLL held too: the roll must not start on the first tick after the draft.
		tick(r, { ...leftStick, buttons: bit32.bor(Button.FIRE, Button.ROLL) });
		expect(isDraftOpen(r.s)).toBe(false);
		expect(r.s.run!.events.draftChosen).toBe(offers[0] + 1);
		expect(me(r.s).boons).toEqual([offers[0]]);
		expect([me(r.s).draftOffers.size(), me(r.s).draftSelected, me(r.s).draftTicks]).toEqual([0, NO_SELECTION, 0]);
		const steps = r.s.combat.enemyBullets.stepCount;
		tick(r, frame(1, 0, Button.ROLL));
		expect(r.s.events.rollStarted).toBe(0);
		expect(r.s.combat.enemyBullets.stepCount).toBe(steps + 1); // the world runs again
	});

	it("replays identically; another selection is another run", () => {
		const setup = buildEndlessRunConfig(SEED);
		const spawn = setup.spawn!;
		const record = (column: number) => {
			const rec = new Recorder(SEED, spawn.x, spawn.z);
			const side = column === DRAFT_COLUMN_RIGHT ? 1 : column === DRAFT_COLUMN_LEFT ? -1 : 0;
			const stick = frame(side * DRAFT_SCREEN_RIGHT_X, side * DRAFT_SCREEN_RIGHT_Z);
			rec.record(frame(0, 0, DEBUG_FLOOR_BUTTON));
			for (let i = 0; i < DRAFT_MIN_OPEN_TICKS + 5; i++) rec.record(stick);
			rec.record({ ...stick, buttons: Button.FIRE });
			for (let i = 0; i < 30; i++) rec.record(frame(0.6, 0.8));
			return rec.getRecording();
		};
		const a = runReplay(record(DRAFT_COLUMN_RIGHT), setup.config);
		const b = runReplay(record(DRAFT_COLUMN_RIGHT), buildEndlessRunConfig(SEED).config);
		const c = runReplay(record(DRAFT_COLUMN_CENTRE), setup.config);
		expect(hashState(a)).toBe(hashState(b));
		expect(me(a).boons).toEqual(me(b).boons);
		expect(me(a).boons.size()).toBe(1);
		expect(me(c).boons.size()).toBe(1);
		expect(me(c).boons).never.toEqual(me(a).boons);
		expect(hashState(c)).never.toBe(hashState(a));
	});

	it("no draft once every boon is owned", () => {
		const r = arena();
		for (let b = 0; b < BOON_COUNT; b++) grantBoon(r.s, SOLO_PLAYER, b);
		skipFloor(r);
		expect(r.s.events.floorChanged).toBe(2);
		expect(isDraftOpen(r.s)).toBe(false);
		expect(r.s.run!.events.draftOpened).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------

describe("boons, each at its application point", () => {
	it("no boons: every accessor is neutral (and outside endless runs too); tick rounding", () => {
		expect(runMods(arena().s, SOLO_PLAYER)).toEqual(NEUTRAL_RUN_MODS);
		const plain = createSimState(1, 0, 0, {});
		expect(runMods(plain, SOLO_PLAYER)).toBe(NEUTRAL_RUN_MODS);
		expect([scaleTicks(12, 80), scaleTicks(21, 80), scaleTicks(12, 150), scaleTicks(7, 100)]).toEqual([
			10, 17, 18, 7,
		]);
	});

	/** One sword swing (FIRE held one tick) at a bruiser in front: damage dealt and the swing's recovery. */
	const swing = (boons: number[]) => {
		const r = arena(boons);
		const p = r.s.player;
		spawnAt(r, "bruiser", p.faceX, p.faceZ);
		tick(r, frame(0, 0, Button.FIRE));
		return { dealt: r.s.events.damageDealt, busy: r.s.combat.weapons.sets[0].v[SWORD_V_BUSY] };
	};

	it("Sharpened: damage x 1.25 when it hits (sword 3 -> 3.75; a bow arrow 1 -> 1.25)", () => {
		expect(swing([]).dealt).toBe(SWORD_DATA.damage);
		expect(swing([Boon.SHARPENED]).dealt).toBe(3.75);
		const arrow = (boons: number[]) => {
			const r = arena(boons);
			spawnAt(r, "bruiser", 2, 0);
			tick(r, frame(0, 0, Button.SWAP));
			let dealt = 0;
			for (let i = 0; i < 20 && dealt === 0; i++) {
				tick(r, frame(0, 0, i === 0 ? Button.FIRE : 0, 1, 0));
				dealt = r.s.events.damageDealt;
			}
			return dealt;
		};
		expect([arrow([]), arrow([Boon.SHARPENED])]).toEqual([BOW_DATA.damage, 1.25]);
	});

	it("Swift Strikes: sword recovery 14 -> 11 ticks; bow stream cooldown 12 -> 10", () => {
		expect(swing([]).busy).toBe(SWORD_DATA.swingRecoveryTicks);
		expect(swing([Boon.SWIFT_STRIKES]).busy).toBe(11);
		const bowCooldown = (boons: number[]) => {
			const r = arena(boons);
			tick(r, frame(0, 0, Button.SWAP));
			tick(r, frame(0, 0, Button.FIRE, 1, 0));
			return r.s.combat.weapons.sets[1].cooldown;
		};
		expect([bowCooldown([]), bowCooldown([Boon.SWIFT_STRIKES])]).toEqual([BOW_DATA.cooldownTicks, 10]);
	});

	it("Piercing Arrows: stream arrows pierce 1 (0 without), the heavy arrow 3 (2 without)", () => {
		const pierce = (boons: number[], heavy: boolean) => {
			const r = arena(boons);
			tick(r, frame(0, 0, Button.SWAP));
			if (heavy) {
				while (r.s.combat.weapons.sets[1].v[BOW_V_CHARGE] < BOW_DATA.chargeTicks) {
					tick(r, frame(0, 0, Button.ALT, 1, 0));
				}
				tick(r, frame(0, 0, 0, 1, 0));
			} else {
				tick(r, frame(0, 0, Button.FIRE, 1, 0));
			}
			const sim = r.s.combat.playerBullets;
			expect(sim.activeCount).toBe(1);
			return BulletPayload.get(sim.payloadAt(onlyBullet(sim)), "pierce");
		};
		expect([pierce([], false), pierce([Boon.PIERCING_ARROWS], false)]).toEqual([0, 1]);
		expect([pierce([], true), pierce([Boon.PIERCING_ARROWS], true)]).toEqual([2, 3]);
	});

	it("Ember Wake: a roll start fires a ring of 16 player bullets", () => {
		const ring = (boons: number[]) => {
			const r = arena(boons);
			tick(r, frame(1, 0, Button.ROLL));
			expect(r.s.events.rollStarted).toBe(1);
			return r.s.combat.playerBullets.activeCount;
		};
		expect([ring([]), ring([Boon.EMBER_WAKE])]).toEqual([0, ROLL_RING_COUNT]);
	});

	it("Hearty, Deep Flask, Warding: +1 heart, +1 flask charge, +1 armor pip (max and current); each owned once", () => {
		const r = arena();
		const p = r.s.player;
		p.hearts = 3;
		grantBoon(r.s, SOLO_PLAYER, Boon.HEARTY);
		grantBoon(r.s, SOLO_PLAYER, Boon.DEEP_FLASK);
		grantBoon(r.s, SOLO_PLAYER, Boon.WARDING);
		expect([p.hearts, p.heartsMax, p.flask, p.flaskMax, p.armor, p.armorMax]).toEqual([5, 8, 4, 4, 1, 1]);
		grantBoon(r.s, SOLO_PLAYER, Boon.HEARTY);
		expect([p.heartsMax, me(r.s).boons.size()]).toEqual([8, 3]);
	});

	it("Warding: the armor pip refills when a room's enemies spawn", () => {
		const r = arena([Boon.WARDING]);
		const p = r.s.player;
		tick(r, frame(0, 0, Button.DEBUG_HIT));
		expect([p.armor, p.hearts]).toEqual([0, 6]); // the pip took the hit
		p.x = COMBAT.cx;
		p.z = COMBAT.cz;
		tick(r);
		expect(r.s.events.roomEntered).toBe(COMBAT.id + 1);
		expect(p.armor).toBe(1);
		// Without the boon nothing refills.
		const plain = arena();
		plain.s.player.armorMax = 1;
		plain.s.player.x = COMBAT.cx;
		plain.s.player.z = COMBAT.cz;
		tick(plain);
		expect(plain.s.player.armor).toBe(0);
	});

	it("Slippery: roll i-frames 12 -> 18 ticks", () => {
		const iframes = (boons: number[]) => {
			const r = arena(boons);
			tick(r, frame(1, 0, Button.ROLL));
			return r.s.player.iframeTicks;
		};
		expect([iframes([]), iframes([Boon.SLIPPERY])]).toEqual([ROLL_IFRAME_TICKS, 18]);
	});

	it("Lingering: a kill refills the combo timer to 540 ticks (9 s) instead of 360", () => {
		const timer = (boons: number[]) => {
			const r = arena(boons);
			ctxOf(r).killActor(spawnAt(r, "swarmer", 4, 4));
			return r.s.score!.comboTimer;
		};
		expect([timer([]), timer([Boon.LINGERING])]).toEqual([COMBO_WINDOW_TICKS, 540]);
	});

	it("Daredevil: a bullet passing 1.1 tiles from the player's centre grazes only with the 0.75-tile margin", () => {
		expect(runMods(arena().s, SOLO_PLAYER).grazeMargin).toBe(GRAZE_MARGIN);
		const pass = (boons: number[]) => {
			const r = arena(boons);
			enemyBullet(r, -3, 1.1, 1, 0, 6);
			for (let i = 0; i < 70; i++) tick(r);
			return [r.s.score!.counts[ScoreSource.GRAZES], r.s.player.hearts];
		};
		const hit = PLAYER_RADIUS + ENEMY_BULLET_RADIUS;
		expect(hit + GRAZE_MARGIN < 1.1 && 1.1 < hit + GRAZE_MARGIN_BOON).toBe(true);
		expect([pass([]), pass([Boon.DAREDEVIL])]).toEqual([
			[0, 6],
			[1, 6],
		]);
		const g = hit + GRAZE_MARGIN_BOON;
		expect(runMods(arena([Boon.DAREDEVIL]).s, SOLO_PLAYER).grazeR2).toBe(g * g);
	});

	it("Bounty: kill points x 1.10 (a swarmer at x1.0 on floor 1: 50 -> 55)", () => {
		const points = (boons: number[]) => {
			const r = arena(boons);
			ctxOf(r).killActor(spawnAt(r, "swarmer", 4, 4));
			return r.s.score!.points[ScoreSource.KILLS];
		};
		expect([points([]), points([Boon.BOUNTY])]).toEqual([50, 55]);
	});

	it("Composure: a landed hit cuts the combo by a quarter instead of a half (x5.0 -> x3.7, not x2.5)", () => {
		const cut = (boons: number[]) => {
			const r = arena(boons);
			r.s.score!.combo = 50;
			tick(r, frame(0, 0, Button.DEBUG_HIT));
			return r.s.score!.combo;
		};
		expect([cut([]), cut([Boon.COMPOSURE])]).toEqual([25, 37]);
	});
});

// ---------------------------------------------------------------------------------------------

describe("relics", () => {
	it("a TREASURE room's pedestal gives one relic drawn from the unowned set (sim rng), once", () => {
		const r = arena([], [Relic.HOURGLASS]);
		const s = r.s;
		expect(s.run!.pedestalRooms).toEqual([TREASURE.id]);
		const twin = { rngState: s.rngState };
		const unowned = [Relic.MIRROR_CLOAK, Relic.VAMPIRE_FANG, Relic.SECOND_WIND];
		const want = unowned[rngInt(twin, 0, unowned.size() - 1)];
		s.player.x = TREASURE.cx + 0.3;
		s.player.z = TREASURE.cz;
		tick(r);
		expect(s.run!.events.relicCollected).toBe(want + 1);
		expect(me(s).relics).toEqual([Relic.HOURGLASS, want]);
		expect(s.run!.pedestalTaken).toEqual([1]);
		expect(s.rngState).toBe(twin.rngState);
		tick(r);
		expect([s.run!.events.relicCollected, me(s).relics.size()]).toEqual([0, 2]);
		// The next floor has a fresh pedestal; with every relic owned it stays (inert).
		skipFloor(r);
		expect(s.run!.pedestalTaken).toEqual([0]);
		for (let k = 0; k < RELICS.size(); k++) grantRelic(s, SOLO_PLAYER, k);
		s.run!.players[SOLO_PLAYER].draftOpen = 0;
		s.player.x = TREASURE.cx;
		s.player.z = TREASURE.cz;
		tick(r);
		expect([s.run!.events.relicCollected, s.run!.pedestalTaken[0]]).toEqual([0, 0]);
	});

	it("unownedRelics (the pedestal's pool, a Rare chest's too): relic index order; empty without run state", () => {
		const r = arena([], [Relic.MIRROR_CLOAK]);
		expect(unownedRelics(r.s, SOLO_PLAYER)).toEqual([Relic.HOURGLASS, Relic.VAMPIRE_FANG, Relic.SECOND_WIND]);
		expect(unownedRelics(r.s, 1)).toEqual([]);
		const m1 = createSimState(SEED, 0, 0, {});
		expect(unownedRelics(m1, SOLO_PLAYER)).toEqual([]);
	});

	it("no treasure bonus deal: a floor's draft deals as before (takeTreasureBonusDeals 0 without treasure)", () => {
		const r = arena([], []);
		expect(r.s.treasure).toBe(undefined);
		expect(takeTreasureBonusDeals(r.s, SOLO_PLAYER)).toBe(0);
	});

	it("Mirror Cloak: a bullet the guard erases comes back as a player bullet, the opposite way, same speed", () => {
		const reflect = (relics: number[]) => {
			const r = arena([], relics);
			tick(r, frame(0, 0, 0, 1, 0)); // face +X
			enemyBullet(r, 1.5, 0, -1, 0, 4);
			tick(r, frame(0, 0, Button.ALT, 1, 0)); // the guard
			expect(r.s.events.bulletsDeleted).toBe(1);
			return r.s.combat.playerBullets;
		};
		expect(reflect([]).activeCount).toBe(0);
		const sim = reflect([Relic.MIRROR_CLOAK]);
		expect(sim.activeCount).toBe(1);
		const i = onlyBullet(sim);
		const v = sim.velocityAt(i);
		expect([v.x, v.z === 0]).toEqual([4, true]); // the erased bullet flew at (-4, 0)
		expect(BulletPayload.get(sim.payloadAt(i), "kind")).toBe(BulletKind.PLAYER);
	});

	it("Hourglass: for 1 s after a landed hit enemy bullets move at 70 % speed", () => {
		const r = arena([], [Relic.HOURGLASS]);
		const s = r.s;
		enemyBullet(r, 6, 4, 0, 1, 3); // flies away from the player
		const sim = s.combat.enemyBullets;
		const slot = onlyBullet(sim);
		const dz = (input: Readonly<InputFrame> = EMPTY_INPUT) => {
			const z0 = sim.positionAt(slot).z;
			tick(r, input);
			return sim.positionAt(slot).z - z0;
		};
		expect(dz()).toBeCloseTo(3 * SIM_DT, 12); // a normal tick
		// The debug hit lands in stepPlayer, before this tick's bullets move: 60 slowed steps from this one on (a
		// bullet or contact hit lands after the move, so its 60 start on the next tick).
		const slow = 3 * SIM_DT * HOURGLASS_TIME_SCALE;
		expect(dz(frame(0, 0, Button.DEBUG_HIT))).toBeCloseTo(slow, 12);
		expect(me(s).hourglassTicks).toBe(HOURGLASS_TICKS - 1);
		for (let i = 1; i < HOURGLASS_TICKS; i++) expect(dz()).toBeCloseTo(slow, 12);
		expect(me(s).hourglassTicks).toBe(0);
		expect(dz()).toBeCloseTo(3 * SIM_DT, 12);
		// Without the relic a hit slows nothing.
		const plain = arena();
		tick(plain, frame(0, 0, Button.DEBUG_HIT));
		expect(me(plain.s).hourglassTicks).toBe(0);
	});

	it("Vampire Fang: every 25 kills heal one half heart (up to the maximum); reviving turrets never count", () => {
		const r = arena([], [Relic.VAMPIRE_FANG]);
		const s = r.s;
		s.player.hearts = 3;
		const ctx = ctxOf(r);
		for (let i = 0; i < 5; i++) ctx.killActor(spawnAt(r, "turret.caster", 4, 4));
		expect(me(s).fangKills).toBe(0);
		for (let i = 0; i < 24; i++) ctx.killActor(spawnAt(r, "swarmer", 4, -4));
		expect(s.player.hearts).toBe(3);
		ctx.killActor(spawnAt(r, "swarmer", 4, -4));
		expect([s.player.hearts, me(s).fangKills, s.run!.events.fangHealed]).toEqual([4, 0, 1]);
		s.player.hearts = s.player.heartsMax;
		for (let i = 0; i < 25; i++) ctx.killActor(spawnAt(r, "swarmer", 4, -4));
		expect(s.player.hearts).toBe(s.player.heartsMax);
	});

	it("Second Wind: once per floor a lethal hit leaves one half heart", () => {
		const r = arena([], [Relic.SECOND_WIND]);
		const s = r.s;
		const p = s.player;
		p.hearts = 1;
		tick(r, frame(0, 0, Button.DEBUG_HIT));
		expect([p.hearts, p.dead, s.run!.events.secondWind, me(s).secondWindUsed]).toEqual([1, 0, 1, 1]);
		for (let i = 0; i < 50; i++) tick(r); // past the post-hit invulnerability
		tick(r, frame(0, 0, Button.DEBUG_HIT));
		expect([p.hearts, p.dead]).toEqual([0, 1]);
		// A new floor re-arms it.
		const r2 = arena([], [Relic.SECOND_WIND]);
		me(r2.s).secondWindUsed = 1;
		skipFloor(r2);
		expect(me(r2.s).secondWindUsed).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------

describe("curse shrines", () => {
	it("SKILL1 in the SHRINE room's zone accepts a curse: +0.25 score multiplier and one unused curse; once", () => {
		const r = arena();
		const s = r.s;
		expect(s.run!.shrineRoom).toBe(SHRINE.id);
		s.player.x = SHRINE.cx + 3; // outside the zone: nothing
		s.player.z = SHRINE.cz;
		tick(r, frame(0, 0, SHRINE_BUTTON));
		tick(r);
		expect(me(s).curses.size()).toBe(0);
		s.player.x = SHRINE.cx + 0.5;
		const twin = { rngState: s.rngState };
		const want = rngInt(twin, 0, CURSE_COUNT - 1);
		tick(r, frame(0, 0, SHRINE_BUTTON));
		expect(s.run!.events.curseAccepted).toBe(want + 1);
		expect(me(s).curses).toEqual([want]);
		expect([s.score!.curses, curseMultiplier(s.score!), s.run!.shrineUsed]).toEqual([1, 1.25, 1]);
		tick(r);
		tick(r, frame(0, 0, SHRINE_BUTTON)); // used: nothing
		expect([me(s).curses.size(), s.score!.curses]).toEqual([1, 1]);
		// Held into the zone (no press edge): nothing either, on a fresh run.
		const held = arena();
		tick(held, frame(0, 0, SHRINE_BUTTON));
		held.s.player.x = SHRINE.cx;
		tick(held, frame(0, 0, SHRINE_BUTTON));
		expect(me(held.s).curses.size()).toBe(0);
	});

	it("at most one shrine per floor, each floor's usable again; with every curse taken it is inert", () => {
		const r = arena();
		const s = r.s;
		s.player.x = SHRINE.cx;
		s.player.z = SHRINE.cz;
		tick(r, frame(0, 0, SHRINE_BUTTON));
		expect(s.run!.shrineUsed).toBe(1);
		skipFloor(r);
		s.run!.players[SOLO_PLAYER].draftOpen = 0;
		expect([s.run!.shrineRoom, s.run!.shrineUsed]).toEqual([SHRINE.id, 0]);
		s.player.x = SHRINE.cx;
		s.player.z = SHRINE.cz;
		tick(r);
		tick(r, frame(0, 0, SHRINE_BUTTON));
		expect([me(s).curses.size(), s.score!.curses]).toEqual([2, 2]);
		for (let c = 0; c < CURSE_COUNT; c++) acceptCurse(s, SOLO_PLAYER, c);
		expect(s.score!.curses).toBe(CURSE_COUNT);
		skipFloor(r);
		s.run!.players[SOLO_PLAYER].draftOpen = 0;
		s.player.x = SHRINE.cx;
		s.player.z = SHRINE.cz;
		tick(r);
		tick(r, frame(0, 0, SHRINE_BUTTON));
		expect([s.run!.shrineUsed, s.score!.curses]).toEqual([0, CURSE_COUNT]);
	});

	it("Frailty: -1 max heart, never below 1 heart; Thirst: -1 max flask charge, never below 1", () => {
		const r = arena([], [], [Curse.FRAILTY, Curse.THIRST]);
		const p = r.s.player;
		expect([p.hearts, p.heartsMax, p.flask, p.flaskMax]).toEqual([4, 4, 2, 2]);
		const low = arena();
		low.s.player.heartsMax = 2;
		low.s.player.hearts = 2;
		low.s.player.flaskMax = 1;
		low.s.player.flask = 1;
		acceptCurse(low.s, SOLO_PLAYER, Curse.FRAILTY);
		acceptCurse(low.s, SOLO_PLAYER, Curse.THIRST);
		expect([low.s.player.heartsMax, low.s.player.flaskMax]).toEqual([2, 1]);
		expect([r.s.score!.curses, low.s.score!.curses]).toEqual([2, 2]);
	});

	it("Haste: enemy bullets x 1.15 on top of the floor scaling, still capped at 1.4", () => {
		const speed = (curses: number[], floor: number) => {
			const r = arena([], [], curses);
			r.s.endless!.floor = floor;
			const shooter = spawnAt(r, "sniper", 4, 4);
			r.s.combat.enemyBullets.clear();
			ctxOf(r).fireEnemy(shooter, 0, 1, {
				count: 1,
				spread: 0,
				speed: 5,
				life: 1,
				damage: 1,
				kind: BulletKind.ENEMY,
			});
			const sim = r.s.combat.enemyBullets;
			return sim.velocityAt(onlyBullet(sim)).z;
		};
		expect(speed([], 1)).toBe(5);
		expect(speed([Curse.HASTE], 1)).toBe(5 * 1.15);
		expect(speed([Curse.HASTE], 3)).toBe(5 * (enemyBulletSpeedMultiplier(3) * 1.15));
		expect(speed([Curse.HASTE], 21)).toBe(5 * 1.4);
		expect(speed([], 21)).toBe(5 * 1.4);
	});

	it("Impatience: the combo window 6 s -> 4 s (with Lingering 7 s)", () => {
		const r = arena([], [], [Curse.IMPATIENCE]);
		expect(runMods(r.s, SOLO_PLAYER).comboWindowTicks).toBe(240);
		ctxOf(r).killActor(spawnAt(r, "swarmer", 4, 4));
		expect(r.s.score!.comboTimer).toBe(240);
		grantBoon(r.s, SOLO_PLAYER, Boon.LINGERING);
		expect(runMods(r.s, SOLO_PLAYER).comboWindowTicks).toBe(420);
	});
});

// ---------------------------------------------------------------------------------------------

describe("the run hash group", () => {
	it("is appended after score (breakables after it), covers the draft, dumps a name per value; clone copies it", () => {
		const r = dungeon();
		const pristine = cloneSimState(r.s);
		expect(hashState(pristine)).toBe(hashState(r.s));
		grantBoon(pristine, SOLO_PLAYER, Boon.BOUNTY);
		expect(me(r.s).boons.size()).toBe(0); // independent
		expect(runMods(pristine, SOLO_PLAYER).killPointsPercent).toBe(110);
		expect(runMods(cloneSimState(pristine), SOLO_PLAYER).killPointsPercent).toBe(110);
		skipFloor(r);
		const layout = hashLayout(r.s, true);
		// Endless runs end with the breakables group (docs/DECOR.md D4), then drops (docs/BOOSTS.md B4), then affixes;
		// "run" comes right before breakables, after "score"; pellets (docs/PELLETS.md PL5; no builds here), then
		// treasure last (docs/TREASURE.md TR5).
		expect(layout.groups[layout.groups.size() - 1].name).toBe(TREASURE_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 2].name).toBe(PELLETS_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 3].name).toBe(AFFIXES_SUBSYSTEM); // docs/ENEMY_VARIANTS.md EV7
		expect(layout.groups[layout.groups.size() - 4].name).toBe(DROPS_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 5].name).toBe(BREAKABLES_SUBSYSTEM);
		const g = layout.groups[layout.groups.size() - 6];
		expect(g.name).toBe(RUN_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 7].name).toBe("score");
		expect(layout.names.size()).toBe(layout.values.size());
		expect(layout.values).toEqual(writeHashFields(r.s, []));
		const values = groupValues(layout, g);
		const names: string[] = [];
		for (let i = g.start; i < g.finish; i++) names.push(layout.names[i]);
		const at = (n: string) => values[names.indexOf(n)];
		expect(at("run.players.length")).toBe(1);
		expect(at("run.players[0].draftOpen")).toBe(1);
		expect(at("run.players[0].draftOffers.length")).toBe(3);
		expect(at("run.players[0].draftOffers[0]")).toBe(me(r.s).draftOffers[0]);
		// Moving the stick during the draft changes the hash (draftSelected), and nothing in the world.
		const before = hashState(r.s);
		tick(r, frame(DRAFT_SCREEN_RIGHT_X, DRAFT_SCREEN_RIGHT_Z));
		expect(me(r.s).draftSelected).toBe(DRAFT_COLUMN_RIGHT);
		expect(hashState(r.s)).never.toBe(before);
	});
});

export {};
