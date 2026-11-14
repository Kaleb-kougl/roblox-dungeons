// Secret rooms in the run configs (docs/SECRET_ROOMS.md SR5): SimConfig.secrets on endless solo / co-op, the Daily and
// dev, never M1 or the tutorial; every endless floor built with secrets (the same layout on client and server);
// endlessFloorWorld's movers and blockers on the carved dungeon of a secret floor (the Forge's elsewhere); the dev
// world's KV_SecretDebug (parseSecretDebug -> SecretOverride, dev only); a recorded run that opens a secret with the
// Knight's finisher and takes its chest validates on the server's replay.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_FIRST_FLOOR,
	SECRET,
	TileType,
	VaultTier,
	gridToWorld,
	secretCrackCells,
	tileAt,
	worldToGrid,
	type FloorSecret,
} from "shared/dungeon";
import {
	Button,
	SECRETS_CONFIG,
	SecretHow,
	SecretStatus,
	encodeRecording,
	hashState,
	NOT_BROKEN,
	runReplay,
} from "shared/sim";
import { DAILY_WORLD_KIND } from "shared/daily";
import {
	DEFAULT_RUN_LIMITS,
	ENDLESS_WORLD_KIND,
	SECRET_DEBUG_ATTRIBUTE,
	buildDevRunConfig,
	buildEndlessRunConfig,
	buildRunConfig,
	buildTutorialRunConfig,
	buildWorldSetup,
	endlessRunFloor,
	parseSecretDebug,
	validateRun,
	type RunLimits,
	type RunSubmission,
} from "shared/run";
import { Driver, distanceField, frame, walkDir } from "shared/run/testing";

/** The first run seed (from `from`) whose floor `floor` holds a secret (solo), and the plan. */
function secretSeed(floor: number, from = 1): { seed: number; secret: FloorSecret } {
	for (let seed = from; seed < from + 200; seed++) {
		const s = endlessRunFloor(seed, floor).layout.secret;
		if (s !== undefined) return { seed, secret: s };
	}
	error("no secret floor found");
}

describe("secrets: the run configs", () => {
	it("on in endless solo and co-op, the Daily and dev; off in M1 and the tutorial", () => {
		expect(buildEndlessRunConfig(1).config.secrets).toBe(SECRETS_CONFIG);
		expect(buildEndlessRunConfig(1, 3).config.secrets).toBe(SECRETS_CONFIG);
		const opts = { atBossDoor: false };
		expect(buildWorldSetup(ENDLESS_WORLD_KIND, 5, opts).config.secrets).toBe(SECRETS_CONFIG);
		expect(buildWorldSetup(DAILY_WORLD_KIND, 5, opts).config.secrets).toBe(SECRETS_CONFIG);
		expect(buildDevRunConfig(5).config.secrets).toBe(SECRETS_CONFIG);
		expect(buildRunConfig(5, { world: "game" }).config.secrets).toBe(undefined);
		expect(buildTutorialRunConfig().config.secrets).toBe(undefined);
	});

	it("secret floors: the sim world's movers and blockers on the carved dungeon, the layout's dungeon the Forge's", () => {
		const found = secretSeed(3);
		const seed = found.seed;
		let secret = found.secret;
		const w = endlessRunFloor(seed, 3);
		expect([w.secret!.x, w.secret!.y, w.secret!.crackSlot, w.secret!.tier]).toEqual([
			secret.x,
			secret.y,
			secret.crackSlot,
			secret.tier,
		]);
		expect(w.secret).toBe(w.layout.secret);
		secret = w.secret!;
		expect(w.dungeon).toBe(w.layout.dungeon);
		for (const c of secretCrackCells(secret)) {
			expect(tileAt(w.dungeon, c.x, c.y)).toBe(TileType.WALL);
			expect(tileAt(secret.dungeon, c.x, c.y)).toBe(TileType.FLOOR);
			// The bullet blocker reads the carved grid (the crack's pieces stop bullets in the sim, not the grid).
			expect(w.config.isBulletBlocked!(gridToWorld(c.x), gridToWorld(c.y))).toBe(false);
		}
		const chamber = { x: gridToWorld(secret.chestX), z: gridToWorld(secret.chestY) };
		expect(w.config.isBodyBlocked!(chamber.x, chamber.z)).toBe(false);
		expect(w.roomIdAt(chamber.x, chamber.z)).toBe(-1);
		// A floor without one: the Forge's grid (a crack-free floor 1).
		const f1 = endlessRunFloor(seed, ENDLESS_FIRST_FLOOR);
		expect(f1.secret).toBe(undefined);
	});

	it("KV_SecretDebug: parseSecretDebug; the dev world forces a secret on every floor with a candidate, tier fixed", () => {
		expect(SECRET_DEBUG_ATTRIBUTE).toBe("KV_SecretDebug");
		expect(parseSecretDebug(undefined)).toBe(undefined);
		expect(parseSecretDebug("nonsense 7")).toBe(undefined);
		expect(parseSecretDebug("every")).toEqual({ every: true });
		expect(parseSecretDebug(" EVERY, legendary ")).toEqual({ every: true, tier: VaultTier.LEGENDARY });
		expect(parseSecretDebug("legendary rare")).toEqual({ tier: VaultTier.RARE });
		const dev = buildDevRunConfig(11, {
			startFloor: 2,
			invulnerable: true,
			secret: { every: true, tier: VaultTier.LEGENDARY },
		});
		const endless = buildEndlessRunConfig(11);
		let forced = 0;
		for (let floor = 2; floor <= 7; floor++) {
			const s = dev.endlessFloor!(floor).layout.secret;
			if (s !== undefined) {
				forced++;
				expect(s.tier).toBe(VaultTier.LEGENDARY);
			}
			const natural = endless.endlessFloor(floor).layout.secret;
			if (natural !== undefined) expect(s).never.toBe(undefined);
		}
		expect(forced >= 4).toBe(true);
	});
});

const LIMITS: RunLimits = { ...DEFAULT_RUN_LIMITS, world: "endless", allowDebugInput: true };

/** Walks the driver's player toward world (tx, tz) on the carved grid round the intact pieces, until `done()`. */
function walk(drv: Driver, secret: FloorSecret, tx: number, tz: number, done: () => boolean, max: number): void {
	const s = drv.state;
	const d = secret.dungeon;
	// Round the intact pieces (an opened crack is broken: walkable).
	const cells = new Set<number>();
	for (const b of s.breakables!.pieces) if (b.brokenTick === NOT_BROKEN) cells.add(b.y * d.W + b.x);
	const field = distanceField(d, tx, tz, undefined, cells);
	for (let n = 0; n < max && !done() && s.player.dead === 0; n++) {
		const p = s.player;
		let [mx, mz] = walkDir(field, p.x, p.z);
		if (worldToGrid(p.x) === worldToGrid(tx) && worldToGrid(p.z) === worldToGrid(tz)) {
			const dx = tx - p.x;
			const dz = tz - p.z;
			const len = math.sqrt(dx * dx + dz * dz);
			[mx, mz] = len > 0.05 ? [dx / len, dz / len] : [0, 0];
		}
		drv.tick(frame(mx, mz, drv.assisted(0)));
	}
}

describe("secrets: a recorded run that opens one validates on the server", () => {
	// A Knight run: debug-skip to floor 2 (a secret floor), walk to the crack, hold FIRE (swings knock, the finisher
	// opens), walk into the chamber to the chest. The room's enemies may join in: the run is honest either way.
	const { seed, secret } = secretSeed(2);
	const setup = buildEndlessRunConfig(seed, 1, { characters: ["knight"] });
	const drv = new Driver(setup, seed);
	drv.skipFloor();
	const s = drv.state;
	const crack = secretCrackCells(secret);
	const cx = (gridToWorld(crack[0].x) + gridToWorld(crack[crack.size() - 1].x)) / 2;
	const cz = (gridToWorld(crack[0].y) + gridToWorld(crack[crack.size() - 1].y)) / 2;
	const fx = secret.fx;
	const fz = secret.fz;
	// One and a half cells in front of the crack: in the front box, the swings in reach.
	walk(drv, secret, cx + fx * 1.5, cz + fz * 1.5, () => false, 1200);
	for (let t = 0; t < 240 && s.secrets!.status === SecretStatus.HIDDEN && s.player.dead === 0; t++)
		drv.tick(frame(0, 0, drv.assisted(Button.FIRE), -fx, -fz));
	const opened = s.secrets!.status !== SecretStatus.HIDDEN;
	const chestX = gridToWorld(secret.chestX) + fx;
	const chestZ = gridToWorld(secret.chestY) + fz;
	walk(drv, secret, chestX, chestZ, () => s.secrets!.status === SecretStatus.TAKEN, 1200);
	for (let t = 0; t < 30; t++) drv.tick(frame(0, 0));
	const recording = drv.recorder.getRecording();
	const finalHash = hashState(s);

	it("the secret opened (the finisher) and its chest was taken", () => {
		print(
			`[secrets] run ${seed} floor 2: crack (${secret.x},${secret.y}) ${secret.fx},${secret.fz} ${secret.along}x${
				secret.depth
			}, opened ${opened} how ${s.secrets!.openHow} at ${s.secrets!.openTick}, status ${
				s.secrets!.status
			}, ${recording.frames.size()} ticks, dead ${s.player.dead}`,
		);
		expect(opened).toBe(true);
		expect(s.secrets!.openHow).toBe(SecretHow.FINISHER);
		expect(s.secrets!.status).toBe(SecretStatus.TAKEN);
		expect(s.secrets!.found).toBe(1);
		expect(SECRET.fromFloor <= 2).toBe(true);
	});

	it("replays to the same hash and validates in the endless world (debug input allowed for the skip)", () => {
		expect(hashState(runReplay(recording, buildEndlessRunConfig(seed, 1, { characters: ["knight"] }).config))).toBe(
			finalHash,
		);
		const submission: RunSubmission = {
			seed,
			atBossDoor: false,
			recording: encodeRecording(recording),
			claimedHash: finalHash,
			claimed: { ticks: s.tick, kills: 0, bossDefeated: false, died: s.player.dead !== 0 },
			characterId: "knight",
		};
		const probe = validateRun(submission, LIMITS);
		expect(probe.serverHash).toBe(finalHash);
		const ok = validateRun({ ...submission, claimed: probe.summary }, LIMITS);
		expect([ok.ok, ok.code]).toEqual([true, undefined]);
	});
});
