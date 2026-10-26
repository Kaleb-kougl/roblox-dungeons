// The tutorial director (docs/TUTORIAL.md T4): the step data, every prompt / callout / UI string in the placeholder
// pack, and the tutorial bot (shared/run/testing tutorialBot.ts) playing the tutorial world headlessly through LiveRun:
// every step completes in order, hearts never drop (harmless), the funnel counts 1..N, the floor 2 -> 3 change
// finishes it, and an out-of-order visit still completes. The guidance arrow on the real floors (docs/TUTORIAL_ARROW.md
// A3): every marker target is reachable, and a run steered by the arrow finishes within GUIDE_SLACK of the bot's walk.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { MAX_TUTORIAL_STEP_NAME_CHARS, TUTORIAL_FUNNEL_MAX_STEP } from "shared/onboarding";
import { TileType, pathField, worldToGrid, type Dungeon, type WorldXZ } from "shared/dungeon";
import { TUTORIAL_ROOMS, type TutorialLessonId } from "shared/run";
import { dismissDraft, distanceField, frame, playTutorial, walkDir, type TutorialBotResult } from "shared/run/testing";
import { LiveRun } from "shared/play";
import { buildTutorialRunConfig, tutorialRoom } from "shared/run";
import {
	BOSS_ACT1_ID,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	SIM_DT,
	SIM_HZ,
	ScoreSource,
	archetypeAt,
	archetypeIndex,
	type BossAct1Data,
	type InputFrame,
} from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import {
	MAX_TUTORIAL_STEP_ID_CHARS,
	TUTORIAL_CALLOUTS,
	TUTORIAL_DEVICES,
	TUTORIAL_STEPS,
	TUTORIAL_STEP_COUNT,
	tutorialPromptIds,
	tutorialPromptKey,
	tutorialStepByNumber,
	tutorialStepIndex,
	tutorialStepName,
	tutorialStringKeys,
	TutorialDirector,
	type TutorialView,
} from ".";

/** One frame of `h` with the stick at (mx, mz) (unit floats). */
function stepMove(h: ReturnType<typeof harness>, mx: number, mz: number): TutorialView {
	const input = frame(mx, mz);
	h.run.frame(SIM_DT, input);
	h.frames.push(input.buttons);
	return h.director.update({
		state: h.run.state,
		config: h.setup.config,
		events: h.run.frameEvents,
		buttons: input.buttons,
		dt: SIM_DT,
	});
}

/** A tutorial LiveRun plus a director, stepped one SIM_DT frame at a time. */
function harness() {
	const setup = buildTutorialRunConfig();
	const run = new LiveRun({
		seed: TUTORIAL.runSeed,
		spawnX: setup.spawn!.x,
		spawnZ: setup.spawn!.z,
		config: setup.config,
		atBossDoor: false,
	});
	const director = new TutorialDirector();
	const frames: number[] = [];
	const step = (buttons = 0): TutorialView => {
		const input: InputFrame = { ...EMPTY_INPUT, buttons };
		run.frame(SIM_DT, input);
		frames.push(buttons);
		return director.update({
			state: run.state,
			config: setup.config,
			events: run.frameEvents,
			buttons,
			dt: SIM_DT,
		});
	};
	return { setup, run, director, step, frames };
}

/**
 * The debug boss damage (J) every this many ticks of the Mother Bramble fight; 0 = never. Not needed: the whole
 * bot run (a ~20 s melee boss fight at TUTORIAL.bossHpPercent included) takes about 1 s of spec time.
 */
const BOSS_DEBUG_EVERY = 0;

/** The tutorial boss fight's longest acceptable length (the owner's "the boss should die fast"), sim seconds. */
const BOSS_FIGHT_MAX_SECONDS = 30;

/** A run steered by the guidance arrow may walk at most this much longer than the bot's own (walkTo ticks). */
const GUIDE_SLACK = 1.15;

function describeRun(name: string, r: TutorialBotResult): void {
	const steps = TUTORIAL_STEPS.map((s, i) => `${s.id}@${r.stepDoneTicks[i]}`).join(" ");
	print(`[tutorial bot] ${name}: ${r.ticks} ticks = ${string.format("%.1f", r.ticks / SIM_HZ)} s sim; ${steps}`);
	const fight = r.bossDefeatedTick - r.bossEngagedTick;
	print(
		`  boss fight: ${fight} ticks = ${string.format("%.1f", fight / SIM_HZ)} s sim (hpMax ${r.bossHpMax}); ` +
			`phases at ${r.bossPhaseTicks.join(",")}, bar fill ${r.bossPhaseFill
				.map((f) => string.format("%.3f", f))
				.join(",")}`,
	);
	for (const line of r.log) print(`  ${line}`);
}

let inOrder: TutorialBotResult | undefined;
function inOrderRun(): TutorialBotResult {
	if (inOrder === undefined) {
		inOrder = playTutorial({ bossDebugEvery: BOSS_DEBUG_EVERY });
		describeRun("in order", inOrder);
	}
	return inOrder;
}

describe("tutorial steps and strings", () => {
	it("steps: numbered 1..N, unique funnel-safe ids, the funnel's max step is N", () => {
		const ids = new Set<string>();
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) {
			const s = TUTORIAL_STEPS[i];
			expect(s.number).toBe(i + 1);
			expect(s.id.match("^[%w_]+$")[0] !== undefined).toBe(true);
			expect(s.id.size() <= MAX_TUTORIAL_STEP_ID_CHARS).toBe(true);
			expect(ids.has(s.id)).toBe(false);
			ids.add(s.id);
			expect(tutorialStepByNumber(s.number)).toBe(s);
			expect(tutorialStepName(s.number)).toBe(s.id);
			expect(tutorialStepIndex(s.id)).toBe(i);
		}
		expect(TUTORIAL_STEP_COUNT).toBe(15);
		expect(TUTORIAL_FUNNEL_MAX_STEP).toBe(TUTORIAL_STEP_COUNT);
		expect(MAX_TUTORIAL_STEP_ID_CHARS).toBe(MAX_TUTORIAL_STEP_NAME_CHARS);
		expect([tutorialStepName(0), tutorialStepName(TUTORIAL_STEP_COUNT + 1), tutorialStepName(1.5)]).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});

	it("every floor-1 lesson room has its step, in tour order", () => {
		const lessons: TutorialLessonId[] = [];
		for (const s of TUTORIAL_STEPS) if (s.lesson !== undefined) lessons.push(s.lesson);
		const tour = TUTORIAL_ROOMS.map((r) => r.lesson).filter((l) => l !== "entrance");
		expect(lessons).toEqual(tour);
		expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
			"objective",
			"move",
			"flask",
			"attack",
			"hits",
			"roll",
			"guard",
			"bow",
			"ember",
			"relic",
			"curse",
			"stairwell",
			"draft",
			"boss",
			"finish",
		]);
	});

	it("every prompt (each device), callout and UI string key exists in the placeholder pack", () => {
		const warnings: string[] = [];
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
		for (const key of tutorialStringKeys()) expect([key, pack.hasString(key)]).toEqual([key, true]);
		for (const s of TUTORIAL_STEPS) {
			for (const d of TUTORIAL_DEVICES) {
				const key = tutorialPromptKey(s, d);
				expect([key, pack.hasString(key)]).toEqual([key, true]);
			}
			// Touch has no controls yet: its text is the keyboard's.
			expect(pack.str(tutorialPromptKey(s, "touch"))).toBe(pack.str(tutorialPromptKey(s, "keyboard")));
		}
		for (const c of TUTORIAL_CALLOUTS) expect(pack.hasString(c.key)).toBe(true);
		expect(tutorialPromptKey("move", "gamepad")).toBe("tutorial.prompt.move.gamepad");
		// Prompts name keys through templates (the bound keys: shared/view/hud tutorialPromptVars, tutorialHud.spec).
		expect(pack.str(tutorialPromptKey("move", "keyboard"), { move: "WASD" })).toBe("Move: WASD");
		expect(pack.str(tutorialPromptKey("move", "gamepad"), { move: "Left stick" })).toBe("Move: Left stick");
		expect(pack.str("tutorial.verdict")).toBe("Practice: not submitted (tutorial)");
		expect(tutorialPromptIds().size()).toBe(TUTORIAL_STEP_COUNT + 1); // + follow
		expect(warnings).toEqual([]);
	});
});

describe("tutorial director", () => {
	it("starts on the objective card; Continue needs a fresh FIRE press after the card's minimum time", () => {
		const h = harness();
		let v = h.step(Button.FIRE); // held from the first frame: no edge counts while the card is too fresh
		expect([v.stepId, v.card, v.prompt, v.marker, v.active]).toEqual([
			"objective",
			"objective",
			"objective",
			undefined,
			true,
		]);
		const minFrames = math.ceil(TUTORIAL.objectiveCardMinSeconds * SIM_HZ);
		for (let i = 0; i < minFrames + 5; i++) v = h.step(Button.FIRE); // still held: no edge
		expect(v.stepId).toBe("objective");
		v = h.step(0);
		v = h.step(Button.FIRE);
		expect([v.stepId, v.card, v.prompt, v.done[0]]).toEqual(["move", undefined, "move", true]);
		expect([...v.newFunnelSteps]).toEqual([1]);
		expect(v.funnelStepReached).toBe(1);
	});

	it("a flask drunk before the card closes still counts (out of order); an unentered room shows follow + its door", () => {
		const h = harness();
		let v = h.step(Button.FLASK);
		v = h.step(0);
		expect([v.stepId, v.done[tutorialStepIndex("flask")], v.highlight]).toEqual(["objective", true, undefined]);
		for (let i = 0; i < math.ceil(TUTORIAL.objectiveCardMinSeconds * SIM_HZ); i++) v = h.step(0);
		v = h.step(Button.FIRE);
		expect([v.stepId, v.prompt]).toEqual(["move", "move"]);
		expect([...v.newFunnelSteps]).toEqual([1]);
		// Walk toward combat A's door until the move lesson is done (well before the room).
		const door = tutorialRoom("combatA").door;
		const field = distanceField(h.setup.dungeon!, door.x, door.z);
		let n = 0;
		while (!v.done[tutorialStepIndex("move")] && n < 600) {
			const p = h.run.state.player;
			const [mx, mz] = walkDir(field, p.x, p.z);
			v = stepMove(h, mx, mz);
			n++;
		}
		expect([...v.newFunnelSteps]).toEqual([2, 3]); // move, and the flask done earlier
		expect([v.stepId, v.prompt, v.highlight]).toEqual(["attack", "follow", undefined]);
		expect(v.marker).toEqual({ kind: "door", x: door.x, z: door.z });
		expect(h.run.state.endless!.roomsEntered[tutorialRoom("combatA").roomId]).toBe(0);
	});

	it("leaving a floor skips its unfinished lessons; the funnel stops at the first skipped one; the draft is current", () => {
		const h = harness();
		// The objective card first (funnel step 1), then the debug floor skip with every other floor 1 lesson open.
		let v = h.step(0);
		for (let i = 0; i < math.ceil(TUTORIAL.objectiveCardMinSeconds * SIM_HZ); i++) v = h.step(0);
		v = h.step(Button.FIRE);
		expect([v.stepId, v.funnelStepReached]).toEqual(["move", 1]);
		v = h.step(DEBUG_FLOOR_BUTTON);
		expect(h.run.state.endless!.floor).toBe(2);
		expect(v.stepId).toBe("draft");
		const skipped = TUTORIAL_STEPS.filter((_s, i) => v.skipped[i]).map((s) => s.id);
		expect(skipped).toEqual(["move", "flask", "attack", "hits", "roll", "guard", "bow", "ember", "relic", "curse"]);
		expect(v.done[tutorialStepIndex("stairwell")]).toBe(true);
		expect(v.skipped[tutorialStepIndex("stairwell")]).toBe(false);
		// Skipped lessons are never credited, and the stairwell done after them does not jump past them.
		expect([...v.newFunnelSteps]).toEqual([]);
		expect(v.funnelStepReached).toBe(1);
		expect([v.prompt, v.marker]).toEqual(["draft", undefined]);
		// Floor 3 (the draft dismissed, then the debug skip): finished, the rest skipped, the funnel still at 1.
		v = h.step(0);
		let funnelAfterSkip = 0;
		for (let i = 0; i < 3 && !v.finished; i++) {
			dismissDraft(h.run.state); // test-only surgery: the frozen draft would swallow the skip
			v = h.step(DEBUG_FLOOR_BUTTON);
			funnelAfterSkip += v.newFunnelSteps.size();
			v = h.step(0);
			funnelAfterSkip += v.newFunnelSteps.size();
		}
		expect(h.run.state.endless!.floor >= 3).toBe(true);
		expect([v.finished, v.active, v.stepId, v.prompt, v.stepIndex]).toEqual([
			true,
			false,
			"",
			"",
			TUTORIAL_STEP_COUNT,
		]);
		expect(v.done[tutorialStepIndex("finish")]).toBe(true);
		expect(v.skipped[tutorialStepIndex("finish")]).toBe(false);
		expect(funnelAfterSkip).toBe(0);
		expect(v.funnelStepReached).toBe(1);
	});

	it("is deterministic: the same frames give the same views", () => {
		const a = harness();
		const b = harness();
		const sig = (v: TutorialView) =>
			`${v.stepIndex}|${v.prompt}|${v.revision}|${v.marker?.x}|${v.marker?.z}|${v.stepsDone}`;
		for (let i = 0; i < 200; i++) {
			const buttons = i === 60 || i === 150 ? Button.FIRE : i % 7 === 0 ? Button.ROLL : 0;
			expect(sig(a.step(buttons))).toBe(sig(b.step(buttons)));
		}
	});
});

describe("tutorial bot", () => {
	it("completes every step in order, and the director reports finished on the floor 2 -> 3 change", () => {
		const r = inOrderRun();
		expect(r.view.finished).toBe(true);
		expect(r.view.active).toBe(false);
		expect(r.run.state.endless!.floor).toBe(TUTORIAL.lastFloor + 1);
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) {
			expect([TUTORIAL_STEPS[i].id, r.stepDoneTicks[i] >= 0, r.view.skipped[i]]).toEqual([
				TUTORIAL_STEPS[i].id,
				true,
				false,
			]);
			if (i > 0) {
				expect([TUTORIAL_STEPS[i].id, r.stepDoneTicks[i] >= r.stepDoneTicks[i - 1]]).toEqual([
					TUTORIAL_STEPS[i].id,
					true,
				]);
			}
		}
		// The skills were practised, not waived: a guard cancel landed (the guard lesson's waiver never applied).
		expect(r.run.state.score!.counts[ScoreSource.GUARD] > 0).toBe(true);
		expect(r.run.state.run!.players[0].relics.size()).toBe(1);
		expect(r.run.state.run!.players[0].curses.size()).toBe(1);
		// The finish step is done on the very tick the floor became 3.
		expect(r.stepDoneTicks[TUTORIAL_STEP_COUNT - 1]).toBe(r.ticks);
	});

	it("is harmless: hearts never drop below the start (only the flask raises them) and the player never dies", () => {
		const r = inOrderRun();
		expect(r.heartProblems).toEqual([]);
		expect(r.startHearts).toBe(TUTORIAL.startHalfHearts);
		expect(r.run.state.tutorial!.harmlessHits > 0).toBe(true);
	});

	it("funnel steps are strictly increasing 1..N; the callouts fired once each", () => {
		const r = inOrderRun();
		const expected: number[] = [];
		for (let n = 1; n <= TUTORIAL_STEP_COUNT; n++) expected.push(n);
		expect(r.funnelSteps).toEqual(expected);
		expect(r.view.funnelStepReached).toBe(TUTORIAL_STEP_COUNT);
		for (const key of ["tutorial.callout.score", "tutorial.callout.harmlessHit", "tutorial.callout.bossPhase2"]) {
			expect([key, r.callouts.includes(key)]).toEqual([key, true]);
		}
		expect(new Set(r.callouts).size()).toBe(r.callouts.size());
		// Every step's own prompt was shown at some point, but `finish`: the bot melees Mother Bramble on the arena
		// centre, so the stairwell that opens there under it on her death takes it down on that same tick.
		for (const s of TUTORIAL_STEPS) {
			if (s.id === "finish") continue;
			expect([s.prompt, r.prompts.includes(s.prompt)]).toEqual([s.prompt, true]);
		}
		expect(r.prompts.includes("follow")).toBe(true);
	});

	it("Mother Bramble falls fast (TUTORIAL.bossHpPercent): <= 30 s of melee, phases II and III still play", () => {
		const r = inOrderRun();
		const boss = archetypeAt(archetypeIndex(BOSS_ACT1_ID)).data as BossAct1Data;
		expect(r.bossHpMax).toBe((boss.hp * TUTORIAL.bossHpPercent) / 100);
		expect(r.bossEngagedTick > 0).toBe(true);
		expect(r.bossDefeatedTick > r.bossEngagedTick).toBe(true);
		const seconds = (r.bossDefeatedTick - r.bossEngagedTick) / SIM_HZ;
		print(`[tutorial bot] boss fight ${string.format("%.1f", seconds)} s at ${TUTORIAL.bossHpPercent}% hp`);
		expect(seconds <= BOSS_FIGHT_MAX_SECONDS).toBe(true);
		// Every phase started, in order, before she died.
		for (const phase of [1, 2, 3]) expect([phase, r.bossPhaseTicks[phase] > 0]).toEqual([phase, true]);
		expect(r.bossPhaseTicks[1] < r.bossPhaseTicks[2] && r.bossPhaseTicks[2] < r.bossPhaseTicks[3]).toBe(true);
		expect(r.bossPhaseTicks[3] < r.bossDefeatedTick).toBe(true);
		// The HUD boss bar (takeSnapshot: hp / hpMax) stands on its notches (phaseHp) when phases II and III start.
		expect(boss.phaseHp.size()).toBe(2);
		for (let k = 0; k < boss.phaseHp.size(); k++) {
			expect(math.abs(r.bossPhaseFill[k + 2] - boss.phaseHp[k]) < 0.01).toBe(true);
		}
		expect(r.callouts.includes("tutorial.callout.bossPhase3")).toBe(true);
	});

	it("a later lesson room visited first still completes (out of order)", () => {
		const order: TutorialLessonId[] = TUTORIAL_ROOMS.map((x) => x.lesson);
		// combatC before combatB, and the flask only after combatA.
		const b = order.indexOf("combatB");
		const c = order.indexOf("combatC");
		order[b] = "combatC";
		order[c] = "combatB";
		const r = playTutorial({ order, flaskAfter: "combatA", bossDebugEvery: BOSS_DEBUG_EVERY });
		describeRun("out of order", r);
		expect(r.view.finished).toBe(true);
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) {
			expect([TUTORIAL_STEPS[i].id, r.view.done[i], r.view.skipped[i]]).toEqual([
				TUTORIAL_STEPS[i].id,
				true,
				false,
			]);
		}
		const at = (id: string) => r.stepDoneTicks[tutorialStepIndex(id)];
		expect(at("attack") < at("flask")).toBe(true);
		expect(at("roll") < at("hits")).toBe(true);
		// The funnel still only counts up, one step at a time.
		for (let i = 0; i < r.funnelSteps.size(); i++) expect(r.funnelSteps[i]).toBe(i + 1);
		expect(r.heartProblems).toEqual([]);
	});
});

describe("guidance arrow on the tutorial floors (docs/TUTORIAL_ARROW.md A3)", () => {
	/**
	 * pathField to `target` over `d`: the FLOOR tiles of rooms `rooms` it does not reach ("x,z"), how many it checked,
	 * and whether the target had to snap (its own tile is not FLOOR).
	 */
	function unreachableFrom(
		d: Dungeon,
		target: WorldXZ,
		rooms: ReadonlySet<number>,
	): { tiles: number; bad: string[]; snapped: boolean } {
		const f = pathField(d, target.x, target.z);
		const bad: string[] = [];
		let tiles = 0;
		for (let i = 0; i < d.W * d.H; i++) {
			if (d.grid[i] !== TileType.FLOOR || !rooms.has(d.roomId[i])) continue;
			tiles++;
			if (f.dist[i] === math.huge) bad.push(`${i % d.W},${math.floor(i / d.W)}`);
		}
		const snapped = f.gx !== worldToGrid(target.x) || f.gy !== worldToGrid(target.z);
		return { tiles, bad, snapped };
	}

	it("every floor-1 target the director names is reachable from every FLOOR tile of its room and every room before it", () => {
		const setup = buildTutorialRunConfig();
		const w = setup.endlessFloor(1);
		const d = w.dungeon;
		const tour = TUTORIAL_ROOMS.map((r) => r.lesson);
		let checked = 0;
		for (const s of TUTORIAL_STEPS) {
			const lesson = s.marker.lesson;
			if (s.floor !== 1 || s.marker.kind === "none" || lesson === undefined) continue;
			const room = tutorialRoom(lesson);
			// Its door (until entered), its centre (wandered out / the pedestal / the shrine), the stairwell.
			const targets: Array<[string, WorldXZ]> = [
				["door", room.door],
				["centre", room.center],
			];
			if (s.marker.kind === "stairwell") targets.push(["stairwell", { x: w.stairX, z: w.stairZ }]);
			const rooms = new Set<number>();
			for (let k = 0; k <= tour.indexOf(lesson); k++) rooms.add(tutorialRoom(tour[k]).roomId);
			for (const [what, t] of targets) {
				const r = unreachableFrom(d, t, rooms);
				expect([s.id, what, r.snapped, r.tiles > 0, r.bad]).toEqual([s.id, what, false, true, []]);
				checked++;
			}
		}
		expect(checked).toBe(2 * 9 + 1); // nine lesson steps (combat A-F, relic, curse, stairwell) + the stairwell
	});

	it("floor 2's stairwell (the boss step's fallback, the finish) is reachable from every FLOOR tile of every room", () => {
		const setup = buildTutorialRunConfig();
		const w = setup.endlessFloor(TUTORIAL.lastFloor);
		const d = w.dungeon;
		const rooms = new Set<number>();
		for (let i = 0; i < d.rooms.size(); i++) rooms.add(i);
		const r = unreachableFrom(d, { x: w.stairX, z: w.stairZ }, rooms);
		expect([r.snapped, r.tiles > 0, r.bad]).toEqual([false, true, []]);
	});

	it("a run steered by the arrow finishes every step, within GUIDE_SLACK of the bot's own walking time", () => {
		const bot = inOrderRun();
		const r = playTutorial({ bossDebugEvery: BOSS_DEBUG_EVERY, steer: "guide" });
		describeRun("guide-steered", r);
		const ratio = r.walkTicks / bot.walkTicks;
		print(
			`[tutorial bot] guide-steered walking ${r.walkTicks} ticks (${r.guidedTicks} by the arrow) vs the bot's ` +
				`${bot.walkTicks}: ${string.format("%.3f", ratio)}x (slack ${GUIDE_SLACK}x)`,
		);
		expect(r.view.finished).toBe(true);
		for (let i = 0; i < TUTORIAL_STEPS.size(); i++) {
			expect([TUTORIAL_STEPS[i].id, r.view.done[i], r.view.skipped[i]]).toEqual([
				TUTORIAL_STEPS[i].id,
				true,
				false,
			]);
		}
		expect(r.heartProblems).toEqual([]);
		// The arrow did the steering (most of every walk), and its target was never unreachable.
		expect(r.guidedTicks * 2 > r.walkTicks).toBe(true);
		expect(r.guideUnreachableTicks).toBe(0);
		expect(bot.guidedTicks).toBe(0);
		expect(ratio <= GUIDE_SLACK).toBe(true);
	});
});
