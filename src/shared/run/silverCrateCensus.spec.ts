// Silver in crates census (docs/SILVER.md SC4, the bot half; npm run test:only -- --census run/silverCrateCensus): an honest solo endless descent per run seed
// (shared/run/testing survivalBot.ts: the Knight fights every room with planned spawns and the boss, then takes the
// stairs; it never detours for a barrel or crate), counting per floor the Silver pieces and Silver the floor holds and
// how many the bot's fights break (any source: its swings and arrows, enemy bullets, slams, Chargers, Bombers), and an
// ESTIMATE of the run amount from docs/SILVER.md's earn table (rooms x 2 + crates + floors cleared (5 + n) + bosses
// 40 x the Depth reached + vault 15 + secret 25 + Goldling 30 + kills / 10, topped up to 20 with 2 rooms; shared/silver's
// runSilver is Track W's and not read here), so crates' share of the run amount can be read off the log. Printed with
// loose bounds only. OPT-IN size: without `--census` a smoke sample (run seed 1 to floor 2); with it run seeds 1-8 to
// floor 10 (several minutes).
import { describe, expect, it } from "@rbxts/jest-globals";
import { ScoreSource, SIM_HZ, secretsRunSummary, silverTotalOf, type SimState } from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { censusRequested, survivalRun } from "shared/run/testing";

const FULL = censusRequested();
const SEEDS = FULL ? 8 : 1;
const MAX_FLOOR = FULL ? 10 : 2;

/** docs/SILVER.md's earn table (tune), copied for the estimate only (shared/silver owns the real numbers). */
const EARN = { room: 2, floorBase: 5, bossPerDepth: 40, vault: 15, secret: 25, golden: 30, killsPerSilver: 10 };
const MINIMUM = { rooms: 2, amount: 20 };

const f1 = (x: number) => string.format("%.1f", x);
const pct = (n: number, of: number) => (of > 0 ? string.format("%.1f", (100 * n) / of) : "-");

describe(`Silver in crates: the bot census (SC4; run seeds 1-${SEEDS} to floor ${MAX_FLOOR})`, () => {
	it("Silver pieces broken by an honest bot without detours, and crates' share of the estimated run amount (printed)", () => {
		const t0 = os.clock();
		let pieceTotal = 0;
		let pieceBroken = 0;
		let silverTotal = 0;
		let silverBroken = 0;
		let crateSum = 0;
		let amountSum = 0;
		const shares: number[] = [];
		for (let seed = 1; seed <= SEEDS; seed++) {
			const floors = buildEndlessRunConfig(seed, 1, { characters: ["knight"] });
			let last: Readonly<SimState> | undefined;
			let kills = 0;
			const brokenSlots = new Map<number, number>(); // floor -> Silver pieces broken
			let clutterBroken = 0;
			const r = survivalRun(seed, "knight", {
				maxFloor: MAX_FLOOR,
				onStep: (s) => {
					last = s;
					kills += s.events.enemiesKilled;
					const n = s.silver?.events.breaks.size() ?? 0;
					// A break on a floor change tick belongs to the floor before (pieces are reset after the break line).
					const floor = s.events.floorChanged !== 0 ? s.endless!.floor - 1 : s.endless!.floor;
					if (n > 0) brokenSlots.set(floor, (brokenSlots.get(floor) ?? 0) + n);
					clutterBroken += s.events.breakablesBroken;
				},
			});
			const s = last!;
			const lastFloor = math.min(r.floorReached, MAX_FLOOR);
			let held = 0;
			let heldSilver = 0;
			let broken = 0;
			let clutter = 0;
			for (let f = 1; f <= lastFloor; f++) {
				for (const b of floors.endlessFloor(f).breakables ?? [])
					if (b.kind === "barrel" || b.kind === "crate") clutter++;
				for (const x of floors.endlessFloor(f).breakableSilver ?? []) {
					held++;
					heldSilver += x.amount;
				}
				broken += brokenSlots.get(f) ?? 0;
			}
			const crates = silverTotalOf(s);
			// The estimate (file comment).
			const rooms = s.score!.counts[ScoreSource.ROOMS];
			const descended = s.endless!.floor - 1;
			let floorPay = 0;
			for (let n = 1; n <= descended; n++) floorPay += EARN.floorBase + n;
			let bossPay = 0;
			for (let d = 2; d <= s.endless!.depth; d++) bossPay += EARN.bossPerDepth * d;
			let amount =
				rooms * EARN.room +
				crates +
				floorPay +
				bossPay +
				(s.treasure?.opened ?? 0) * EARN.vault +
				secretsRunSummary(s).found * EARN.secret +
				(s.golden?.caught ?? 0) * EARN.golden +
				math.floor(kills / EARN.killsPerSilver);
			if (rooms >= MINIMUM.rooms && amount < MINIMUM.amount) amount = MINIMUM.amount;
			print(
				`[SilverSC4 bot] seed ${seed}: floor ${r.floorReached}${
					r.died ? ` (died in ${r.deathIn})` : ""
				}, Silver pieces ${broken} / ${held} broken (${pct(
					broken,
					held,
				)} %), crate Silver ${crates} / ${heldSilver}; all pieces broken ${clutterBroken} / ${clutter}; rooms ${rooms}, kills ${kills}, depth ${
					s.endless!.depth
				}; run amount ~${amount}, crates ${pct(crates, amount)} % (were every Silver piece broken: ${pct(
					heldSilver,
					amount - crates + heldSilver,
				)} %, half: ${pct(heldSilver / 2, amount - crates + heldSilver / 2)} %); ${f1(r.ticks / SIM_HZ)} s sim`,
			);
			expect(broken <= held).toBe(true);
			expect(crates <= heldSilver).toBe(true);
			pieceTotal += held;
			pieceBroken += broken;
			silverTotal += heldSilver;
			silverBroken += crates;
			crateSum += crates;
			amountSum += amount;
			if (amount > 0) shares.push(crates / amount);
		}
		shares.sort((a, b) => a < b);
		print(
			`[SilverSC4 bot] total: Silver pieces ${pieceBroken} / ${pieceTotal} broken (${pct(
				pieceBroken,
				pieceTotal,
			)} %), Silver ${silverBroken} / ${silverTotal} (${pct(silverBroken, silverTotal)} %); crates ${pct(
				crateSum,
				amountSum,
			)} % of the summed run amount, per-run median ${pct(shares[math.floor(shares.size() / 2)] ?? 0, 1)} %; ${f1(
				os.clock() - t0,
			)} s`,
		);
		expect(pieceTotal > 0).toBe(true);
	});
});
