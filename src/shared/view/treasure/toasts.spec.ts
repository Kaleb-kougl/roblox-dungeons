// The vault's toasts (docs/TREASURE.md TR8): VaultToastTracker's floor-reveal toast (once per floor, waiting for the
// cover / draft / pause, only while sealed, none without a vault) and its arm toast per armed event (solo UNTOUCHED, the
// party's allowance, the SWIFT countdown), with their keys, vars and lengths; lockToastLine agrees with lockToastText.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, VaultTier } from "shared/dungeon";
import {
	ENDLESS_TREASURE_CONFIG,
	SIM_HZ,
	TREASURE_UNSET,
	VaultStatus,
	createTreasureState,
	treasureRunSummary,
	type SimState,
	type TreasureRunSummary,
	type TreasureState,
} from "shared/sim";
import { TREASURE_STRING_KEYS } from "shared/theme";
import {
	NO_TREASURE_EVENTS,
	TREASURE_TEXT_KEYS,
	TREASURE_VIEW,
	TreasureFrameEvents,
	VaultToastTracker,
	lockToastLine,
	lockToastText,
	type TreasureArmedEvent,
	type VaultToast,
} from ".";

function vault(status: number): TreasureState {
	const t = createTreasureState(ENDLESS_TREASURE_CONFIG, 7, 1);
	t.status = status;
	t.room = 3;
	t.slot = 9;
	t.lock = VaultLock.UNTOUCHED;
	t.startTier = VaultTier.RARE;
	t.tier = VaultTier.RARE;
	return t;
}

function stateOf(floor: number, t: TreasureState | undefined): SimState {
	return { tick: 50, endless: { floor }, treasure: t } as unknown as SimState;
}

function armed(lock: number, allowance: number, ticksLeft: number): TreasureArmedEvent {
	return { room: 3, slot: 9, tick: 50, x: 1, z: 2, lock, tier: VaultTier.RARE, allowance, ticksLeft };
}

function keys(list: ReadonlyArray<VaultToast>): string[] {
	return list.map((t) => t.key);
}

describe("VaultToastTracker: the floor reveal", () => {
	it("shows `hud.toast.vault` once per floor, for floorSec, on the first frame it may show", () => {
		const tr = new VaultToastTracker();
		const s = stateOf(2, vault(VaultStatus.SEALED));
		// Under the stage cover (or a draft, or the pause): it waits.
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: false }).size()).toBe(0);
		const shown = tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: true });
		expect(shown.map((t) => [t.key, t.args, t.seconds])).toEqual([
			[TREASURE_TEXT_KEYS.toastFloor, undefined, TREASURE_VIEW.toast.floorSec],
		]);
		expect(TREASURE_TEXT_KEYS.toastFloor).toBe("hud.toast.vault");
		expect(TREASURE_VIEW.toast.floorSec).toBe(2);
		// Once: later frames of the floor show nothing.
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: true }).size()).toBe(0);
		// The next floor's vault toasts again; so does a new run on the same floor (a restart).
		expect(
			keys(
				tr.frame({
					run: 1,
					state: stateOf(3, vault(VaultStatus.SEALED)),
					frame: NO_TREASURE_EVENTS,
					canShow: true,
				}),
			),
		).toEqual(["hud.toast.vault"]);
		expect(
			keys(
				tr.frame({
					run: 2,
					state: stateOf(3, vault(VaultStatus.SEALED)),
					frame: NO_TREASURE_EVENTS,
					canShow: true,
				}),
			),
		).toEqual(["hud.toast.vault"]);
	});

	it("never on a floor without a vault, without treasure, or once the vault is past sealed", () => {
		const tr = new VaultToastTracker();
		expect(
			tr
				.frame({ run: 1, state: stateOf(2, vault(VaultStatus.NONE)), frame: NO_TREASURE_EVENTS, canShow: true })
				.size(),
		).toBe(0);
		expect(
			tr.frame({ run: 1, state: stateOf(3, undefined), frame: NO_TREASURE_EVENTS, canShow: true }).size(),
		).toBe(0);
		// A floor met with its vault already armed (a spectator's first frame): settled without a toast, even later.
		const s = stateOf(4, vault(VaultStatus.ARMED));
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: true }).size()).toBe(0);
		(s.treasure as TreasureState).status = VaultStatus.SEALED;
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: true }).size()).toBe(0);
	});

	it("a vault that armed while the toast waited never gets it (the arm toast says it all)", () => {
		const tr = new VaultToastTracker();
		const t = vault(VaultStatus.SEALED);
		const s = stateOf(5, t);
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: false }).size()).toBe(0);
		t.status = VaultStatus.ARMED;
		const f = new TreasureFrameEvents();
		f.armed.push(armed(VaultLock.UNTOUCHED, 0, TREASURE_UNSET));
		expect(keys(tr.frame({ run: 1, state: s, frame: f, canShow: true }))).toEqual([
			TREASURE_TEXT_KEYS.toastUntouched,
		]);
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: true }).size()).toBe(0);
	});

	it("reset forgets the settled floor (a run exit)", () => {
		const tr = new VaultToastTracker();
		const s = stateOf(2, vault(VaultStatus.SEALED));
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: true }).size()).toBe(1);
		tr.reset();
		expect(tr.frame({ run: 1, state: s, frame: NO_TREASURE_EVENTS, canShow: true }).size()).toBe(1);
	});
});

describe("VaultToastTracker: the arm toast", () => {
	it("one per armed event, for lockSec, whatever canShow says: solo UNTOUCHED, the party's allowance, SWIFT's time", () => {
		const tr = new VaultToastTracker();
		const s = stateOf(2, vault(VaultStatus.ARMED));
		const f = new TreasureFrameEvents();
		f.armed.push(armed(VaultLock.UNTOUCHED, 0, TREASURE_UNSET));
		f.armed.push(armed(VaultLock.UNTOUCHED, 2, TREASURE_UNSET));
		f.armed.push(armed(VaultLock.SWIFT, TREASURE_UNSET, 42 * SIM_HZ));
		const out = tr.frame({ run: 1, state: s, frame: f, canShow: false });
		expect(out.map((t) => [t.key, t.args, t.seconds])).toEqual([
			["hud.toast.vaultLock.untouched", undefined, TREASURE_VIEW.toast.lockSec],
			["hud.toast.vaultLock.untouchedParty", { hits: 2 }, TREASURE_VIEW.toast.lockSec],
			["hud.toast.vaultLock.swift", { time: "0:42" }, TREASURE_VIEW.toast.lockSec],
		]);
		expect(TREASURE_VIEW.toast.lockSec).toBe(2.5);
	});

	it("lockToastLine is what lockToastText looks up; every key is a theme string", () => {
		const fake = (k: string, v?: Readonly<Record<string, string | number>>) =>
			v === undefined ? k : `${k}|${v.hits ?? ""}${v.time ?? ""}`;
		for (const [lock, allowance, ticks] of [
			[VaultLock.UNTOUCHED, 0, TREASURE_UNSET],
			[VaultLock.UNTOUCHED, 3, TREASURE_UNSET],
			[VaultLock.SWIFT, TREASURE_UNSET, 75 * SIM_HZ],
		]) {
			const line = lockToastLine(lock, allowance, ticks);
			expect(lockToastText(fake, lock, allowance, ticks)).toBe(fake(line.key, line.args));
			expect(TREASURE_STRING_KEYS.includes(line.key)).toBe(true);
		}
		expect(TREASURE_STRING_KEYS.includes(TREASURE_TEXT_KEYS.toastFloor)).toBe(true);
		expect(TREASURE_VIEW.toast.idBase < 0).toBe(true);
	});
});

describe("the run recap's chest tally (claude/run-recap-plan.md)", () => {
	it("treasureRunSummary and its type are reachable from the shared/sim barrel (zeros without treasure)", () => {
		const s = { treasure: undefined } as unknown as SimState;
		const summary: TreasureRunSummary = treasureRunSummary(s);
		expect(summary).toEqual({ opened: 0, kept: 0, legendary: 0 });
		const t = vault(VaultStatus.OPENED);
		t.opened = 2;
		t.kept = 1;
		t.legendary = 1;
		expect(treasureRunSummary({ treasure: t } as unknown as SimState)).toEqual({
			opened: 2,
			kept: 1,
			legendary: 1,
		});
	});
});
