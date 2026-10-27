// The stage loader's pure core (docs/STAGE_LOADER.md SL1, SL4, SL0): StageLoad's phase orders (solo start ranked and
// unranked, co-op start, floor change), one covered work item per frame behind a drawn cover, holdSim / blocksInput,
// the minCardSec / assetCapSec / maxCoverSec / coverAckCapSec boundaries, reduced-motion opacity, a monotonic bar,
// stageMerge, floorChangeStaged, pregenTarget / PregenTracker (incl. a missed pre-generation), the SL0 helpers and the
// cover's string keys.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, STAGE_STRING_KEYS, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	PregenTracker,
	STAGE_LOADER,
	STAGE_STRINGS,
	StageLoad,
	floorChangeStaged,
	formatListenerTimes,
	listenerLabel,
	pregenTarget,
	stageMerge,
	type PregenInput,
	type StageLoaderConfig,
	type StagePhase,
} from "shared/view";

const quiet = () => undefined;

/** Binary-exact timings, so the boundaries are exact sums. */
const CFG: StageLoaderConfig = {
	...STAGE_LOADER,
	minCardSec: 0.5,
	minStartSec: 0,
	assetCapSec: 2,
	maxCoverSec: 4,
	fadeSec: 0.25,
	coverAckCapSec: 0.5,
};

/** Reports the cover drawn and runs frames of dt 0 until covered work is due (at most `limit`). */
function untilDue(load: StageLoad, limit = 10): void {
	for (let i = 0; i < limit; i++) {
		if (load.due() !== undefined) return;
		load.frame(0);
	}
}

/** Runs the covered work in order (one item per frame), recording [phase, item] before each, until none is left. */
function runWork(load: StageLoad): Array<string> {
	const seen = new Array<string>();
	for (let i = 0; i < 20; i++) {
		untilDue(load);
		const item = load.due();
		if (item === undefined) break;
		seen.push(`${load.phase()}:${item}`);
		if (item === "forge") load.forged();
		else if (item === "notify") load.built();
		else load.pregenerated();
		expect(load.due()).toBe(undefined); // one item per frame
	}
	return seen;
}

describe("StageLoad: solo run start", () => {
	it("ranked: waits for the server, then forge / notify / pregen one per frame, assets, settle, reveal", () => {
		const load = new StageLoad("runStart", { waitServer: true, forge: true, pregen: true, floor: 1 }, CFG);
		expect(load.phase()).toBe("waitingServer");
		expect(load.label().key).toBe(STAGE_STRINGS.starting);
		load.coverShown();
		for (let i = 0; i < 5; i++) load.frame(1); // a slow server: 5 s, past maxCoverSec, never trips the cap
		expect(load.phase()).toBe("waitingServer");
		expect(load.due()).toBe(undefined);
		expect(load.capped()).toBe(false);
		expect(load.holdSim()).toBe(true);
		load.serverAnswered(1);
		expect(load.phase()).toBe("forging");
		expect(load.label()).toEqual({ key: STAGE_STRINGS.forging, vars: { floor: 1 } });
		expect(load.due()).toBe("forge"); // the cover has been on screen for the whole wait
		expect(runWork(load)).toEqual(["forging:forge", "building:notify", "building:pregen"]);
		expect(load.phase()).toBe("assets");
		expect(load.label().key).toBe(STAGE_STRINGS.building);
		load.assetsDone();
		expect(load.assetWait()).toBe("ready");
		expect(load.phase()).toBe("settling");
		load.frame(0);
		expect(load.phase()).toBe("settling");
		load.frame(0);
		expect(load.phase()).toBe("revealing");
		expect(load.holdSim()).toBe(false);
		expect(load.blocksInput()).toBe(true); // through the fade
		expect(load.capped()).toBe(false);
	});

	it("unranked: the forge waits until the cover was drawn coverDrawFrames frames after its commit", () => {
		const load = new StageLoad("runStart", { forge: true, pregen: true, floor: 1 }, CFG);
		expect(load.phase()).toBe("forging");
		load.frame(0);
		expect(load.due()).toBe(undefined); // not reported yet
		load.coverShown();
		for (let i = 1; i < CFG.coverDrawFrames; i++) {
			load.frame(0);
			expect(load.due()).toBe(undefined);
		}
		load.frame(0);
		expect(load.due()).toBe("forge");
	});

	it("without a commit report the work starts after coverAckCapSec", () => {
		const load = new StageLoad("runStart", { forge: true, floor: 1 }, CFG);
		load.frame(0.25);
		expect(load.due()).toBe(undefined);
		load.frame(0.125);
		expect(load.due()).toBe(undefined);
		load.frame(0.125);
		expect(load.due()).toBe("forge");
	});

	it("no pre-generation asked: assets right after the listeners", () => {
		const load = new StageLoad("runStart", { forge: true, floor: 0 }, CFG);
		load.coverShown();
		expect(runWork(load)).toEqual(["forging:forge", "building:notify"]);
		expect(load.phase()).toBe("assets");
	});

	it("a floor of 0 (the greybox) is labelled Building..., not Forging floor 0...", () => {
		const load = new StageLoad("runStart", { forge: true }, CFG);
		expect(load.label().key).toBe(STAGE_STRINGS.building);
	});

	it("holds the sim until the reveal and blocks the input until the cover is gone", () => {
		const load = new StageLoad("runStart", { forge: true, floor: 1 }, CFG);
		load.coverShown();
		runWork(load);
		load.assetsDone();
		const seen = new Array<string>();
		for (let i = 0; i < 10 && !load.isDone(); i++) {
			seen.push(`${load.phase()} ${load.holdSim()} ${load.blocksInput()}`);
			load.frame(0.125);
		}
		expect(seen[0]).toBe("settling true true");
		expect(seen).toContain("revealing false true");
		expect(load.isDone()).toBe(true);
		expect(load.holdSim()).toBe(false);
		expect(load.blocksInput()).toBe(false);
	});
});

describe("StageLoad: co-op start and floor change", () => {
	it("co-op start: notify only, never holds the sim", () => {
		const load = new StageLoad("coopStart", { forge: true, pregen: true, waitServer: true, floor: 1 }, CFG);
		expect(load.phase()).toBe("building"); // forge / pregen / the server wait are run starts' only
		expect(load.holdSim()).toBe(false);
		load.coverShown();
		expect(runWork(load)).toEqual(["building:notify"]);
		load.assetsDone();
		for (let i = 0; i < 3; i++) {
			expect(load.holdSim()).toBe(false);
			load.frame(0);
		}
		expect(load.phase()).toBe("revealing");
	});

	it("floor change: the card, at least minCardSec from the cut", () => {
		const load = new StageLoad("floorChange", { floor: 4 }, CFG);
		expect(load.label()).toEqual({ key: STAGE_STRINGS.floorCard, vars: { floor: 4 } });
		expect(load.holdSim()).toBe(false);
		expect(load.blocksInput()).toBe(true);
		load.coverShown();
		expect(runWork(load)).toEqual(["building:notify"]);
		load.assetsDone();
		load.frame(0);
		load.frame(0);
		expect(load.phase()).toBe("settling"); // settled, but only 0 s of the card
		load.frame(0.25);
		load.frame(0.125);
		load.frame(0.0625);
		expect(load.coverSeconds()).toBe(0.4375);
		expect(load.phase()).toBe("settling");
		load.frame(0.0625);
		expect(load.phase()).toBe("revealing"); // exactly minCardSec
		expect(load.label().key).toBe(STAGE_STRINGS.floorCard);
	});

	it("floor change with the world live (no local draft): rebuild and settle only, no assets wait, no minimum", () => {
		const load = new StageLoad("floorChange", { floor: 3, worldLive: true }, CFG);
		expect(load.waitsForAssets()).toBe(false);
		load.coverShown();
		load.frame(0);
		expect(load.due()).toBe("notify");
		load.built();
		expect(load.phase()).toBe("settling"); // never waited for assets
		expect(load.assetWait()).toBe("skipped");
		load.frame(0);
		expect(load.phase()).toBe("settling");
		load.frame(0);
		expect(load.phase()).toBe("revealing"); // 0 s of card: no minCardSec
		expect(load.coverSeconds()).toBe(0);
		expect(new StageLoad("floorChange", { floor: 3 }, CFG).waitsForAssets()).toBe(true);
		// only a floor change can be live
		const start = new StageLoad("runStart", { forge: true, worldLive: true }, CFG);
		expect(start.waitsForAssets()).toBe(true);
	});

	it("floor change: the settle frames still count after the card's minimum", () => {
		const load = new StageLoad("floorChange", { floor: 2 }, CFG);
		load.frame(1); // the ack cap and the card's minimum both passed
		runWork(load);
		load.assetsDone();
		expect(load.phase()).toBe("settling");
		load.frame(0);
		expect(load.phase()).toBe("settling");
		load.frame(0);
		expect(load.phase()).toBe("revealing");
	});
});

describe("StageLoad: caps", () => {
	it("assetCapSec: the wait ends at the cap, marked capped", () => {
		const load = new StageLoad("floorChange", { floor: 5 }, CFG);
		load.coverShown();
		runWork(load);
		expect(load.phase()).toBe("assets");
		load.frame(1);
		load.frame(0.5);
		load.frame(0.25);
		load.frame(0.125);
		expect(load.phase()).toBe("assets"); // 1.875 s
		load.frame(0.125);
		expect(load.phase()).toBe("settling"); // exactly assetCapSec
		expect(load.assetWait()).toBe("capped");
		load.assetsDone(); // late: changes nothing
		expect(load.assetWait()).toBe("capped");
	});

	it("assets ready before the assets phase: it passes at once", () => {
		const load = new StageLoad("floorChange", { floor: 3 }, CFG);
		load.assetsDone();
		load.coverShown();
		runWork(load);
		expect(load.phase()).toBe("settling");
		expect(load.assetWait()).toBe("ready");
	});

	it("maxCoverSec: counted from the server's answer, then every wait is skipped", () => {
		const cfg: StageLoaderConfig = { ...CFG, assetCapSec: 100, minCardSec: 100 };
		const load = new StageLoad("runStart", { waitServer: true, forge: true, floor: 1 }, cfg);
		load.coverShown();
		load.frame(10); // 10 s of server wait: not counted
		load.serverAnswered();
		runWork(load);
		expect(load.phase()).toBe("assets");
		load.frame(2);
		load.frame(1.5);
		expect(load.phase()).toBe("assets");
		expect(load.coverSeconds()).toBe(3.5);
		load.frame(0.5);
		expect(load.capped()).toBe(true);
		expect(load.phase()).toBe("revealing"); // assets and settle skipped at exactly maxCoverSec
	});

	it("maxCoverSec: pending work still runs (one item per frame), then the cover lifts", () => {
		const load = new StageLoad("runStart", { forge: true, pregen: true, floor: 1 }, CFG);
		load.frame(5); // never reported, past the cap
		expect(load.capped()).toBe(true);
		expect(load.due()).toBe("forge");
		load.forged();
		load.frame(0);
		expect(load.due()).toBe("notify");
		load.built();
		load.frame(0);
		expect(load.due()).toBe("pregen");
		load.pregenerated();
		expect(load.phase()).toBe("revealing");
	});
});

describe("StageLoad: opacity and the bar", () => {
	it("opaque until the reveal, then the fade; a cut under reduced motion", () => {
		const load = new StageLoad("floorChange", { floor: 2 }, CFG);
		expect(load.coverOpacity(false)).toBe(1);
		expect(load.coverOpacity(true)).toBe(1);
		load.frame(1);
		runWork(load);
		load.assetsDone();
		load.frame(0);
		load.frame(0);
		expect(load.phase()).toBe("revealing");
		expect(load.coverOpacity(false)).toBe(1);
		expect(load.coverOpacity(true)).toBe(0);
		load.frame(0.125);
		expect(load.coverOpacity(false)).toBe(0.5);
		expect(load.coverOpacity(true)).toBe(0);
		load.frame(0.125);
		expect(load.isDone()).toBe(true);
		expect(load.coverOpacity(false)).toBe(0);
	});

	it("fraction is monotonic and reaches 1 at the reveal", () => {
		const load = new StageLoad("runStart", { waitServer: true, forge: true, pregen: true, floor: 1 }, CFG);
		const seen = new Array<number>();
		const note = () => seen.push(load.fraction());
		note();
		load.coverShown();
		load.frame(0.5);
		note();
		load.serverAnswered();
		note();
		for (let i = 0; i < 20 && load.phase() !== "assets"; i++) {
			load.frame(0);
			note();
			const item = load.due();
			if (item === "forge") load.forged();
			else if (item === "notify") load.built();
			else if (item === "pregen") load.pregenerated();
			note();
		}
		load.frame(1);
		note();
		load.frame(1);
		note();
		while (!load.isDone()) {
			load.frame(0.125);
			note();
		}
		for (let i = 1; i < seen.size(); i++) expect(seen[i] >= seen[i - 1]).toBe(true);
		expect(seen[0]).toBe(0);
		expect(seen[seen.size() - 1]).toBe(1);
		let sum = 0;
		for (const [, w] of pairs(STAGE_LOADER.weights)) sum += w;
		expect(sum).toBeCloseTo(1, 9);
	});

	it("the real tunables are the plan's", () => {
		expect(STAGE_LOADER.minCardSec).toBe(0.6);
		expect(STAGE_LOADER.minStartSec).toBe(0);
		expect(STAGE_LOADER.assetCapSec).toBe(3);
		expect(STAGE_LOADER.maxCoverSec).toBe(8);
		expect(STAGE_LOADER.settleFrames).toBe(2);
		expect(STAGE_LOADER.fadeSec).toBe(0.25);
	});
});

describe("stageMerge", () => {
	it("continues a waiting run start, absorbs a floor change into pending run-start listeners, else new", () => {
		expect(stageMerge(undefined, "floorChange")).toBe("new");
		const waiting = new StageLoad("runStart", { waitServer: true, forge: true }, CFG);
		expect(stageMerge(waiting, "runStart")).toBe("continue");
		expect(stageMerge(waiting, "coopStart")).toBe("new");
		const coop = new StageLoad("coopStart", {}, CFG);
		expect(stageMerge(coop, "floorChange")).toBe("absorb");
		coop.frame(1);
		coop.built();
		expect(stageMerge(coop, "floorChange")).toBe("new"); // its listeners ran
		const card = new StageLoad("floorChange", { floor: 2 }, CFG);
		expect(stageMerge(card, "floorChange")).toBe("new"); // the newer card's listeners read the newer floor
		const solo = new StageLoad("runStart", { forge: true }, CFG);
		expect(stageMerge(solo, "runStart")).toBe("new"); // a restart under the cover
		const done = new StageLoad("floorChange", { floor: 2 }, CFG);
		done.frame(1);
		done.built();
		done.assetsDone();
		done.frame(0);
		done.frame(0);
		done.frame(1);
		expect(done.isDone()).toBe(true);
		expect(stageMerge(done, "floorChange")).toBe("new");
	});
});

describe("floorChangeStaged", () => {
	it("every floor change but the tutorial's ending one", () => {
		expect(floorChangeStaged(2, false, 2)).toBe(true);
		expect(floorChangeStaged(9, false, 2)).toBe(true);
		expect(floorChangeStaged(2, true, 2)).toBe(true);
		expect(floorChangeStaged(3, true, 2)).toBe(false);
	});
});

describe("pregenTarget", () => {
	const base: PregenInput = {
		floor: 4,
		lastFloor: undefined,
		draftOpen: true,
		draftFrames: 1,
		nextBuilt: false,
		stage: undefined,
	};

	it("floor n + 1 once the draft has been open a rendered frame", () => {
		expect(pregenTarget(base)).toBe(5);
		expect(pregenTarget({ ...base, draftFrames: 0 })).toBe(undefined);
		expect(pregenTarget({ ...base, draftOpen: false })).toBe(undefined);
		expect(pregenTarget({ ...base, nextBuilt: true })).toBe(undefined);
		expect(pregenTarget({ ...base, floor: 0 })).toBe(undefined);
	});

	it("not during covered work or the fade; fine under a covered wait", () => {
		const allowed: Record<StagePhase, boolean> = {
			waitingServer: false,
			forging: false,
			building: false,
			assets: true,
			settling: true,
			revealing: false,
			done: true,
		};
		for (const [phase, ok] of pairs(allowed)) {
			expect([phase, pregenTarget({ ...base, stage: phase })]).toEqual([phase, ok ? 5 : undefined]);
		}
	});

	it("never past the tutorial's last floor", () => {
		expect(pregenTarget({ ...base, floor: 1, lastFloor: 2 })).toBe(2);
		expect(pregenTarget({ ...base, floor: 2, lastFloor: 2 })).toBe(undefined);
	});
});

describe("PregenTracker", () => {
	it("endless: floor 2 at the start, then n + 1 once per draft; a missed one shows as not built", () => {
		const t = new PregenTracker(undefined);
		expect(t.startTargets(1)).toEqual([2]);
		t.markBuilt(2);
		expect(t.startTargets(1)).toEqual([]);
		// floor 1 has no draft: nothing to build
		expect(t.frame(1, false, undefined)).toBe(undefined);
		// floor 2: the draft opens with the floor change; the card is building its views
		expect(t.wasBuilt(2)).toBe(true);
		expect(t.frame(2, true, "building")).toBe(undefined);
		expect(t.frame(2, true, "settling")).toBe(3);
		t.markBuilt(3);
		expect(t.frame(2, true, "done")).toBe(undefined);
		// floor 3: the draft confirmed before any frame without covered work -> floor 4 is missed
		expect(t.frame(3, false, undefined)).toBe(undefined);
		expect(t.wasBuilt(4)).toBe(false);
	});

	it("draft frames count per floor", () => {
		const t = new PregenTracker(undefined);
		expect(t.frame(5, false, undefined)).toBe(undefined);
		expect(t.frame(5, true, undefined)).toBe(6); // the first open frame counts
		const u = new PregenTracker(undefined);
		expect(u.frame(5, true, "building")).toBe(undefined);
		expect(u.frame(6, true, "building")).toBe(undefined); // a new floor restarts the count
		expect(u.frame(6, true, "assets")).toBe(7);
	});

	it("tutorial: every floor up to its last at the start, nothing in its drafts", () => {
		const t = new PregenTracker(2);
		expect(t.startTargets(1)).toEqual([2]);
		t.markBuilt(2);
		expect(t.frame(1, true, undefined)).toBe(undefined);
		expect(t.frame(2, true, undefined)).toBe(undefined);
		const longer = new PregenTracker(4);
		expect(longer.startTargets(1)).toEqual([2, 3, 4]);
		expect(new PregenTracker(undefined).startTargets(0)).toEqual([]);
	});
});

describe("the SL0 listener timing line", () => {
	it("labels a listener by its script without Controller", () => {
		expect(listenerLabel("Players.p.PlayerScripts.TS.controllers.game.WorldController")).toBe("World");
		expect(listenerLabel("ReplicatedStorage.Decor")).toBe("Decor");
		expect(listenerLabel("Controller")).toBe("Controller");
		expect(listenerLabel("")).toBe("");
	});

	it("formats the times in call order", () => {
		expect(
			formatListenerTimes([
				{ label: "World", ms: 38.26 },
				{ label: "Decor", ms: 21 },
			]),
		).toBe("World 38.3 ms, Decor 21.0 ms");
		expect(formatListenerTimes([])).toBe("");
	});
});

describe("the stage cover's strings", () => {
	it("are the contract's required STAGE_STRING_KEYS and exist in every bundled pack", () => {
		const keys = [
			STAGE_STRINGS.starting,
			STAGE_STRINGS.forging,
			STAGE_STRINGS.building,
			STAGE_STRINGS.floorCard,
			STAGE_STRINGS.bossFloor,
		];
		expect(keys).toEqual([...STAGE_STRING_KEYS]);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
			expect(pack.str(STAGE_STRINGS.starting)).toBe("Starting run...");
			expect(pack.str(STAGE_STRINGS.forging, { floor: 1 })).toBe("Forging floor 1...");
			expect(pack.str(STAGE_STRINGS.floorCard, { floor: 4 })).toBe("Floor 4");
			expect(pack.str(STAGE_STRINGS.bossFloor)).toBe("Boss floor");
			expect(pack.str("biome.1.name")).toBe("Ancient Halls");
		}
	});
});
