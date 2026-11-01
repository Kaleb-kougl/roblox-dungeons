// The tutorial director (docs/TUTORIAL.md T4): the step data, every prompt / callout / UI string in the placeholder
// pack, and the tutorial bot (shared/run/testing tutorialBot.ts) playing the tutorial world headlessly through LiveRun:
// every step completes in order, hearts never drop (harmless), the funnel counts 1..N, the floor 2 -> 3 change
// finishes it, and an out-of-order visit still completes. The guidance arrow on the real floors (docs/TUTORIAL_ARROW.md
// A3): every marker target is reachable, and a run steered by the arrow finishes within GUIDE_SLACK of the bot's walk.
// TutorialMetrics (docs/TUTORIAL_FUNNEL.md TF4): the bot's lesson reports pinned (in order, out of order), skips and
// dt-0 frames, scripted stuck episodes, and the guard-late guardHold episode under thresholds around its length.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import { MAX_TUTORIAL_STEP_NAME_CHARS, TUTORIAL_FUNNEL_MAX_STEP } from "shared/onboarding";
import { TileType, pathField, worldToGrid, type Dungeon, type WorldXZ } from "shared/dungeon";
import { TUTORIAL_ROOMS, type TutorialLessonId } from "shared/run";
import { dismissDraft, distanceField, frame, playTutorial, walkDir, type TutorialBotResult } from "shared/run/testing";
import { LiveRun } from "shared/play";
import { TUTORIAL_BOOST_KIND, TUTORIAL_BOOST_LESSON, buildTutorialRunConfig, tutorialRoom } from "shared/run";
import {
	BOSS_ACT1_ID,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	GUARD_LOCK_RELEASED,
	SIM_DT,
	SIM_HZ,
	ScoreSource,
	NO_BOOST,
	archetypeAt,
	archetypeIndex,
	boostTicks,
	dropsGround,
	type BossAct1Data,
	type InputFrame,
} from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import {
	MAX_TUTORIAL_STEP_ID_CHARS,
	TUTORIAL_BOOST_HIGHLIGHT,
	TUTORIAL_CALLOUTS,
	TUTORIAL_HIGHLIGHTS,
	TUTORIAL_DEVICES,
	TUTORIAL_PROMPT_IDS,
	TUTORIAL_STEPS,
	TUTORIAL_STEP_COUNT,
	roundTutorialSeconds,
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
	print(
		`  boost: ${r.dropsLanded} landed (first @${r.dropLandedTick}), ${r.dropsTaken} taken (first @${r.boostTakenTick}), drop marker ${r.dropMarkerFrames} frames ` +
			`(${r.dropMarkerOnDrop} on the drop), boost step current ${
				r.boostCurrentFrames
			} frames; markers ${r.markerKinds.join(",")}; highlights ${r.highlights.join(",")}`,
	);
}

/** The boost step's index (funnel number 6: docs/BOOSTS.md B9, after `hits`). */
const BOOST = tutorialStepIndex("boost");

/** The callout key the boost lesson used before it became a step: gone from the callouts and the pack. */
const OLD_BOOST_CALLOUT_KEY = "tutorial.callout.boost";

/** Opens a harness past the objective card (step `move` current, no lesson room entered). */
function pastTheCard(): ReturnType<typeof harness> {
	const h = harness();
	h.step(0);
	for (let i = 0; i < math.ceil(TUTORIAL.objectiveCardMinSeconds * SIM_HZ); i++) h.step(0);
	h.step(Button.FIRE);
	h.step(0);
	return h;
}

/** Test-only surgery: a Fury lying in ground slot 0 at (x, z), as if a kill had dropped it this tick. */
function lay(h: ReturnType<typeof harness>, x: number, z: number): void {
	const g = h.run.state.drops!.ground[0];
	g.kind = TUTORIAL_BOOST_KIND;
	g.x = x;
	g.z = z;
	g.spawnTick = h.run.state.tick;
	g.ticksLeft = h.run.state.drops!.config.groundTicks;
}

let inOrder: TutorialBotResult | undefined;
function inOrderRun(): TutorialBotResult {
	if (inOrder === undefined) {
		inOrder = playTutorial({ bossDebugEvery: BOSS_DEBUG_EVERY });
		describeRun("in order", inOrder);
	}
	return inOrder;
}

let outOfOrder: TutorialBotResult | undefined;
/** combatC before combatB, and the flask only after combatA. */
function outOfOrderRun(): TutorialBotResult {
	if (outOfOrder === undefined) {
		const order: TutorialLessonId[] = TUTORIAL_ROOMS.map((x) => x.lesson);
		const b = order.indexOf("combatB");
		const c = order.indexOf("combatC");
		order[b] = "combatC";
		order[c] = "combatB";
		outOfOrder = playTutorial({ order, flaskAfter: "combatA", bossDebugEvery: BOSS_DEBUG_EVERY });
		describeRun("out of order", outOfOrder);
	}
	return outOfOrder;
}

/**
 * Metrics shadows of the guard-late run (TutorialBotOptions.shadowStuckSeconds): its guardHold episode lasts 8 ticks
 * (0.133 s), so a 0.1 s threshold reports it and a 0.2 s one does not.
 */
const LATE_STUCK_SHADOWS = [0.1, 0.2];

let late: TutorialBotResult | undefined;
/** Combat D swung first (guardLate): the bruiser held at 1 hp until the block. */
function lateRun(): TutorialBotResult {
	if (late === undefined) {
		late = playTutorial({ guardLate: true, shadowStuckSeconds: LATE_STUCK_SHADOWS });
		describeRun("guard late", late);
		print(`  guard lock: held from @${late.guardHeldTick} for ${late.guardHeldTicks} ticks`);
	}
	return late;
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
		expect(TUTORIAL_STEP_COUNT).toBe(16);
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
			"boost",
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

	it("the boost step (docs/BOOSTS.md B9): number 6, right after hits, floor 1, no room, no highlight, the drop marker", () => {
		const s = TUTORIAL_STEPS[BOOST];
		expect([s.number, TUTORIAL_STEPS[BOOST - 1].id, s.floor, s.lesson, s.prompt, s.highlight, s.card]).toEqual([
			6,
			"hits",
			1,
			undefined,
			"boost",
			undefined,
			undefined,
		]);
		expect(s.marker).toEqual({ kind: "drop" });
		expect(s.rule).toEqual({ kind: "boost" });
		// The funnel numbers before it are the old ones; everything after moved up by one (6..15 -> 7..16).
		expect([1, 2, 3, 4, 5].map((n) => tutorialStepName(n))).toEqual([
			"objective",
			"move",
			"flask",
			"attack",
			"hits",
		]);
		expect([7, 16].map((n) => tutorialStepName(n))).toEqual(["roll", "finish"]);
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
			// Touch prompts name the on-screen controls in words: no placeholder is left in them.
			expect(pack.str(tutorialPromptKey(s, "touch"))).never.toContain("{");
		}
		// The prompts written for touch (MB12) differ from the keyboard's.
		for (const prompt of [
			"objective",
			"move",
			"flask",
			"attack",
			"roll",
			"guard",
			"guardHold",
			"bow",
			"ember",
			"curse",
			"draft",
		]) {
			expect(pack.str(tutorialPromptKey(prompt, "touch"))).never.toBe(
				pack.str(tutorialPromptKey(prompt, "keyboard")),
			);
		}
		for (const c of TUTORIAL_CALLOUTS) expect(pack.hasString(c.key)).toBe(true);
		// docs/BOOSTS.md B9 (P8 reversed): the boost lesson is a step and the pickup's ring, no callout any more.
		expect(TUTORIAL_CALLOUTS.map((c) => c.key).includes(OLD_BOOST_CALLOUT_KEY)).toBe(false);
		expect(pack.hasString(OLD_BOOST_CALLOUT_KEY)).toBe(false);
		expect(tutorialStringKeys().includes(tutorialPromptKey("boost", "gamepad"))).toBe(true);
		expect(TUTORIAL_HIGHLIGHTS.includes(TUTORIAL_BOOST_HIGHLIGHT)).toBe(true);
		expect(TUTORIAL_BOOST_HIGHLIGHT).toBe("boosts");
		expect(tutorialPromptKey("move", "gamepad")).toBe("tutorial.prompt.move.gamepad");
		// Prompts name keys through templates (the bound keys: shared/view/hud tutorialPromptVars, tutorialHud.spec).
		expect(pack.str(tutorialPromptKey("move", "keyboard"), { move: "WASD" })).toBe("Move: WASD");
		expect(pack.str(tutorialPromptKey("move", "gamepad"), { move: "Left stick" })).toBe("Move: Left stick");
		expect(pack.str("tutorial.verdict")).toBe("Practice: not submitted (tutorial)");
		expect(tutorialPromptIds().size()).toBe(TUTORIAL_STEP_COUNT + 2); // + follow, + the block lesson's guardHold
		expect(TUTORIAL_STEPS[tutorialStepIndex("guard")].holdPrompt).toBe("guardHold");
		expect(tutorialStringKeys().includes(tutorialPromptKey("guardHold", "keyboard"))).toBe(true);
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
		expect(skipped).toEqual([
			"move",
			"flask",
			"attack",
			"hits",
			"boost",
			"roll",
			"guard",
			"bow",
			"ember",
			"relic",
			"curse",
		]);
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

	it("a boost out of order (move still current): its prompt and the drop marker (not mid-lesson); done on the pickup", () => {
		const h = pastTheCard();
		let v = h.director.getView();
		expect(v.stepId).toBe("move");
		const p = h.run.state.player;
		// Far enough from the player that it is not taken: the boost step holds up out of order, no callout.
		const [dx, dz] = [p.x + 3, p.z];
		lay(h, dx, dz);
		v = h.step(0);
		expect([...v.callouts]).toEqual([]);
		expect([v.stepId, v.promptStepIndex, v.prompt]).toEqual(["move", BOOST, "boost"]);
		expect(v.marker).toEqual({ kind: "drop", x: dx, z: dz });
		expect([v.done[BOOST], ...v.newFunnelSteps]).toEqual([false]);
		expect(v.highlight).toBe(undefined); // the landing rings nothing (no boost yet; the step has no highlight)
		const revision = v.revision;
		v = h.step(0);
		expect(v.marker?.kind).toBe("drop");
		expect(v.revision).toBe(revision);
		// Mid-lesson (combat A entered, its dummies standing): the fight keeps its prompt and marker (none inside).
		const a = tutorialRoom("combatA");
		p.x = a.center.x;
		p.z = a.center.z;
		p.prevX = p.x;
		p.prevZ = p.z;
		v = h.step(0);
		expect(h.run.state.endless!.roomsEntered[a.roomId]).toBe(1);
		expect(v.done[tutorialStepIndex("attack")]).toBe(false);
		expect(dropsGround(h.run.state)[0].kind).toBe(TUTORIAL_BOOST_KIND);
		expect([v.prompt, v.marker]).toEqual(["attack", undefined]);
		// Walk onto it (test-only: the drop moves under the player): taken, the step done (not skipped), the row rings.
		lay(h, p.x, p.z);
		v = h.step(0);
		expect(dropsGround(h.run.state)[0].kind).toBe(NO_BOOST);
		expect(h.run.state.drops!.players[0].ticks[TUTORIAL_BOOST_KIND]).toBe(boostTicks(TUTORIAL_BOOST_KIND));
		expect([v.done[BOOST], v.skipped[BOOST]]).toEqual([true, false]);
		expect([...v.callouts]).toEqual([]);
		expect(v.highlight).toBe(TUTORIAL_BOOST_HIGHLIGHT);
		expect(v.marker).toBe(undefined);
		for (let i = 0; i < math.ceil(TUTORIAL.calloutHighlightSeconds * SIM_HZ) + 1; i++) v = h.step(0);
		expect(v.highlight === TUTORIAL_BOOST_HIGHLIGHT).toBe(false);
		// A second drop later, back in the entrance (the step done): the current step's prompt (the teleports counted
		// as walking, so the flask is current), no drop marker, no second ring; the funnel did not move past `move`.
		p.x = h.setup.spawn!.x;
		p.z = h.setup.spawn!.z;
		p.prevX = p.x;
		p.prevZ = p.z;
		lay(h, p.x + 3, p.z);
		v = h.step(0);
		expect([v.stepId, v.prompt, v.marker, v.highlight]).toEqual(["flask", "flask", undefined, "flask"]);
		expect(v.funnelStepReached).toBe(tutorialStepIndex("move") + 1);
	});

	it("a boost taken on the frame it lands: the step done on that frame, the boost row rung", () => {
		const h = pastTheCard();
		const p = h.run.state.player;
		lay(h, p.x, p.z);
		const v = h.step(0);
		expect(dropsGround(h.run.state)[0].kind).toBe(NO_BOOST);
		expect([v.done[BOOST], v.skipped[BOOST]]).toEqual([true, false]);
		expect([...v.callouts]).toEqual([]);
		expect(v.highlight).toBe(TUTORIAL_BOOST_HIGHLIGHT);
		expect(v.marker?.kind === "drop").toBe(false);
	});

	it("a boost that fades untaken waives the step (done, not skipped)", () => {
		const h = pastTheCard();
		const p = h.run.state.player;
		lay(h, p.x + 3, p.z);
		let v = h.step(0);
		expect(v.done[BOOST]).toBe(false);
		h.run.state.drops!.ground[0].ticksLeft = 3; // test-only: fade soon
		let n = 0;
		while (dropsGround(h.run.state)[0].kind !== NO_BOOST && n < 10) {
			expect(v.done[BOOST]).toBe(false);
			v = h.step(0);
			n++;
		}
		expect(dropsGround(h.run.state)[0].kind).toBe(NO_BOOST);
		expect(h.run.state.drops!.players[0].ticks[TUTORIAL_BOOST_KIND]).toBe(0);
		expect([v.done[BOOST], v.skipped[BOOST]]).toEqual([true, false]);
		expect([v.prompt, v.marker, v.highlight]).toEqual(["move", undefined, undefined]);
	});

	it("floor 1 left before the boost was taken or faded: the step is skipped", () => {
		const h = pastTheCard();
		const p = h.run.state.player;
		lay(h, p.x + 3, p.z);
		let v = h.step(0);
		expect(v.done[BOOST]).toBe(false);
		v = h.step(DEBUG_FLOOR_BUTTON);
		expect(h.run.state.endless!.floor).toBe(2);
		expect(dropsGround(h.run.state)[0].kind).toBe(NO_BOOST); // the floor change cleared the ground
		expect([v.done[BOOST], v.skipped[BOOST]]).toEqual([true, true]);
		expect(v.stepId).toBe("draft");
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
		expect(r.callouts.includes(OLD_BOOST_CALLOUT_KEY)).toBe(false);
		// The funnel names (the server's tutorialStepName): unchanged before the boost step, then continuous.
		expect(r.funnelSteps.map((n) => tutorialStepName(n))).toEqual(TUTORIAL_STEPS.map((s) => s.id));
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

	it("combat B's last swarmer drops the Fury: the boost step current on that tick, the marker on it, done on the pickup", () => {
		const r = inOrderRun();
		const hits = r.stepDoneTicks[tutorialStepIndex("hits")];
		expect(TUTORIAL_BOOST_LESSON).toBe("combatB");
		// The guarantee: the kill that clears combat B (the `hits` lesson) drops it, and nothing else ever drops.
		expect(r.dropLandedTick).toBe(hits);
		expect(r.boostTakenTick >= r.dropLandedTick).toBe(true);
		expect(r.boostTakenTick - r.dropLandedTick < r.run.state.drops!.config.groundTicks).toBe(true);
		expect([r.dropsLanded, r.dropsTaken]).toEqual([1, 1]);
		// The step: practised (taken, not waived) on the pickup's tick; current from the drop's landing until then.
		expect([r.stepDoneTicks[BOOST], r.view.skipped[BOOST]]).toEqual([r.boostTakenTick, false]);
		expect(r.boostCurrentFrames).toBe(r.boostTakenTick - r.dropLandedTick);
		// Its marker pointed at the drop on every frame it was current (unless it was taken on its landing tick).
		if (r.boostTakenTick > r.dropLandedTick) {
			expect(r.markerKinds.includes("drop")).toBe(true);
			expect(r.boostCurrentOnDrop).toBe(r.boostCurrentFrames);
			expect(r.prompts.includes("boost")).toBe(true);
		}
		expect(r.dropMarkerOnDrop).toBe(r.dropMarkerFrames);
		expect(r.highlights.includes(TUTORIAL_BOOST_HIGHLIGHT)).toBe(true);
	});

	it("a later lesson room visited first still completes (out of order)", () => {
		const r = outOfOrderRun();
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
		// The Fury lands as combat B clears (after C here): the boost step is current then, and the bot takes it.
		expect([r.dropLandedTick, at("boost"), r.view.skipped[BOOST]]).toEqual([at("hits"), r.boostTakenTick, false]);
		// The funnel still only counts up, one step at a time, to the last step (1..N: the boost step included).
		for (let i = 0; i < r.funnelSteps.size(); i++) expect(r.funnelSteps[i]).toBe(i + 1);
		expect(r.funnelSteps.size()).toBe(TUTORIAL_STEP_COUNT);
		expect(r.heartProblems).toEqual([]);
	});
});

describe("the block lesson (combat D, the sim's guard lock)", () => {
	const GUARD = tutorialStepIndex("guard");

	it("swinging first never kills the bruiser: it waits at 1 hp under the guardHold prompt until a block", () => {
		const r = lateRun();
		expect(r.guardHeldTick > 0).toBe(true);
		expect(r.guardHeldTicks > 0).toBe(true);
		expect(r.prompts.includes("guardHold")).toBe(true);
		// The step was practised (never waived or skipped), after the hold began, and a guard cancel scored.
		expect([r.stepDoneTicks[GUARD] > r.guardHeldTick, r.view.skipped[GUARD]]).toEqual([true, false]);
		expect(r.run.state.score!.counts[ScoreSource.GUARD] > 0).toBe(true);
		expect(r.run.state.tutorial!.guardLock).toBe(GUARD_LOCK_RELEASED);
		// The rest of the tutorial plays on as usual.
		expect(r.view.finished).toBe(true);
		expect(r.view.funnelStepReached).toBe(TUTORIAL_STEP_COUNT);
		expect(r.heartProblems).toEqual([]);
	});

	it("guarding first (the tour bot) releases the lock before any hold", () => {
		const r = inOrderRun();
		expect([r.guardHeldTick, r.guardHeldTicks]).toEqual([-1, 0]);
		expect(r.run.state.tutorial!.guardLock).toBe(GUARD_LOCK_RELEASED);
		expect(r.view.skipped[GUARD]).toBe(false);
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

describe("tutorial metrics (docs/TUTORIAL_FUNNEL.md TF4)", () => {
	/** A report as a [step, seconds, hits] row. */
	type Row = [number, number, number];
	const rows = (r: TutorialBotResult): Row[] => r.lessonReports.map((l) => [l.step, l.seconds, l.hits] as Row);

	/** Rounding slack of a sum of n reported seconds (each rounded to 1 / TUTORIAL.metricsResolution). */
	const roundingSlack = (n: number) => (n * 0.5) / TUTORIAL.metricsResolution + 1e-9;

	/**
	 * The relations every bot run holds (no step skipped): a lesson clock runs on every frame until the finish, so the
	 * reported seconds sum to the frames charged (shared frames, an out-of-order prompt step's, count twice) within
	 * rounding; the hits sum to the run's harmless hits, minus those landed on frames no clock ran, plus those landed
	 * on shared frames (charged to both steps).
	 */
	function checkRelations(r: TutorialBotResult): void {
		let seconds = 0;
		let hits = 0;
		for (const l of r.lessonReports) {
			seconds += l.seconds;
			hits += l.hits;
		}
		expect(r.clockFrames).toBe(r.ticks);
		expect(r.unclockedHits).toBe(0);
		const charged = (r.clockFrames + r.sharedClockFrames) * SIM_DT;
		expect([seconds, math.abs(seconds - charged) <= roundingSlack(r.lessonReports.size())]).toEqual([
			seconds,
			true,
		]);
		expect(hits).toBe(r.run.state.tutorial!.harmlessHits - r.unclockedHits + r.sharedHits);
		print(
			`[tutorial metrics] ${r.ticks} ticks (${string.format("%.2f", r.ticks / SIM_HZ)} s), lessons sum ` +
				`${string.format("%.1f", seconds)} s (${r.sharedClockFrames} shared frames), hits ${hits} of ` +
				`${r.run.state.tutorial!.harmlessHits} (+${r.sharedHits} shared)`,
		);
	}

	it("TUTORIAL_PROMPT_IDS lists every prompt the director can show (follow and guardHold too)", () => {
		expect([...TUTORIAL_PROMPT_IDS]).toEqual(tutorialPromptIds());
		expect(TUTORIAL_PROMPT_IDS.size()).toBe(TUTORIAL_STEP_COUNT + 2);
		for (const id of ["follow", "guardHold", "objective", "boost", "finish"]) {
			expect([id, TUTORIAL_PROMPT_IDS.includes(id)]).toEqual([id, true]);
		}
		for (const r of [inOrderRun(), outOfOrderRun(), lateRun()]) {
			for (const p of r.prompts) expect([p, TUTORIAL_PROMPT_IDS.includes(p)]).toEqual([p, true]);
		}
		expect(TUTORIAL.stuckSeconds).toBe(20);
	});

	it("in order: one report per lesson, in step order, at the bot's fixed dt (pinned)", () => {
		const r = inOrderRun();
		// [funnel step, seconds, harmless hits]: the boss fight takes the hits (the player tanks Mother Bramble).
		expect(rows(r)).toEqual([
			[1, 0.8, 0], // objective: the card up 47 frames
			[2, 0.5, 0], // move
			[3, 0, 0], // flask: drunk on the first frames it is current (under 0.05 s)
			[4, 4, 0], // attack
			[5, 2.8, 0], // hits
			[6, 0.1, 0], // boost: the bot stands next to combat B's last swarmer
			[7, 5.2, 0], // roll
			[8, 5.6, 1], // guard
			[9, 5.5, 2], // bow
			[10, 9.3, 1], // ember
			[11, 5, 0], // relic
			[12, 2.8, 0], // curse
			[13, 3.3, 0], // stairwell
			[14, 0.5, 0], // draft
			[15, 24.1, 26], // boss
			[16, 0, 0], // finish: done on the boss kill's tick (the stairwell opens under the bot)
		]);
		expect(r.sharedClockFrames).toBe(0);
		checkRelations(r);
		expect(r.stuckReports).toEqual([]); // the longest episode is 17.8 s (the boss fight between her kills)
	});

	it("out of order: every practised lesson reports once, in completion order (pinned)", () => {
		const r = outOfOrderRun();
		expect(rows(r)).toEqual([
			[1, 0.8, 0],
			[2, 0.5, 0],
			[4, 2.1, 0], // attack before the flask (the flask's clock runs meanwhile: current, attack's prompt shown)
			[3, 3.5, 0],
			[7, 3.1, 1], // roll (combat C) before hits (combat B)
			[5, 13.2, 1], // hits: current from the flask on, so it runs through the walk to and the fight in combat C
			[6, 0.1, 0],
			[8, 8.4, 1],
			[9, 5.5, 2],
			[10, 9.3, 1],
			[11, 5, 0],
			[12, 2.8, 0],
			[13, 3.3, 0],
			[14, 0.5, 0],
			[15, 24.1, 26],
			[16, 0, 0],
		]);
		const steps = r.lessonReports.map((l) => l.step);
		expect(new Set(steps).size()).toBe(TUTORIAL_STEP_COUNT);
		expect(r.sharedClockFrames > 0).toBe(true);
		expect(r.sharedHits).toBe(1);
		checkRelations(r);
		expect(r.stuckReports).toEqual([]);
	});

	it("a step left behind reports nothing; a waived one (the boost faded untaken) reports", () => {
		const h = pastTheCard();
		const p = h.run.state.player;
		lay(h, p.x + 3, p.z);
		let v = h.step(0);
		expect([...v.newLessonReports]).toEqual([]);
		h.run.state.drops!.ground[0].ticksLeft = 3; // test-only: fade soon
		const waived: number[] = [];
		const waivedSeconds: number[] = [];
		for (let n = 0; n < 10 && !v.done[BOOST]; n++) {
			v = h.step(0);
			for (const l of v.newLessonReports) {
				waived.push(l.step);
				waivedSeconds.push(l.seconds);
			}
		}
		expect([v.done[BOOST], v.skipped[BOOST]]).toEqual([true, false]);
		// Its clock ran from the first frame its prompt showed (the frame after the lay) until the fade.
		expect([waived, waivedSeconds]).toEqual([[BOOST + 1], [0.1]]);
		// The debug floor skip: every open floor-1 step is skipped (no report); the stairwell is done by its rule.
		v = h.step(DEBUG_FLOOR_BUTTON);
		expect(h.run.state.endless!.floor).toBe(2);
		expect([...v.newLessonReports]).toEqual([{ step: tutorialStepIndex("stairwell") + 1, seconds: 0, hits: 0 }]);
		expect(v.skipped[tutorialStepIndex("move")]).toBe(true);
	});

	it("a frame with dt 0 (or a paused gap of them) adds nothing", () => {
		const PAUSE_FRAMES = 2;
		const LONG_PAUSE = 600;
		const play = (paused: boolean) => {
			const h = harness();
			const lessons: string[] = [];
			const stuck: string[] = [];
			const rec = (v: TutorialView) => {
				for (const l of v.newLessonReports) lessons.push(`${l.step}:${l.seconds}:${l.hits}`);
				for (const x of v.newStuckReports) stuck.push(`${x.prompt}:${x.seconds}`);
			};
			const still = (frames: number) => {
				if (!paused) return;
				for (let k = 0; k < frames; k++) {
					const input = frame(0, 0);
					h.run.frame(0, input);
					rec(
						h.director.update({
							state: h.run.state,
							config: h.setup.config,
							events: h.run.frameEvents,
							buttons: input.buttons,
							dt: 0,
						}),
					);
				}
			};
			const card = math.ceil(TUTORIAL.objectiveCardMinSeconds * SIM_HZ);
			for (let i = 0; i <= card; i++) {
				rec(h.step(0));
				still(PAUSE_FRAMES);
			}
			rec(h.step(Button.FIRE));
			still(LONG_PAUSE);
			const door = tutorialRoom("combatA").door;
			const field = distanceField(h.setup.dungeon!, door.x, door.z);
			for (let n = 0; n < 600 && !h.director.getView().done[tutorialStepIndex("move")]; n++) {
				const [mx, mz] = walkDir(field, h.run.state.player.x, h.run.state.player.z);
				rec(stepMove(h, mx, mz));
				still(PAUSE_FRAMES);
			}
			// Then stand on the flask prompt past the stuck threshold; the flush ends that episode.
			for (let i = 0; i < (TUTORIAL.stuckSeconds + 1) * SIM_HZ; i++) {
				rec(h.step(0));
				still(PAUSE_FRAMES);
			}
			for (const x of h.director.flushMetrics()) stuck.push(`${x.prompt}:${x.seconds}`);
			return { lessons, stuck };
		};
		const plain = play(false);
		expect(play(true)).toEqual(plain);
		expect(plain.lessons.size()).toBe(2); // objective, move
		expect(plain.stuck).toEqual([`flask:${TUTORIAL.stuckSeconds + 1}`]);
	});

	it("stuck (real threshold, scripted): reported when the episode ends; flushMetrics() for an open one; once per prompt", () => {
		const h = harness();
		const cardFrames = TUTORIAL.stuckSeconds * SIM_HZ + SIM_HZ; // 21 s on the objective card, no progress
		let v = h.step(0);
		for (let i = 1; i < cardFrames; i++) {
			v = h.step(0);
			expect(v.newStuckReports.size()).toBe(0);
		}
		// Continue: the episode ends with the card (its 21 s plus this frame's dt), and the objective reports too.
		v = h.step(Button.FIRE);
		const cardSeconds = roundTutorialSeconds((cardFrames + 1) * SIM_DT);
		expect([...v.newStuckReports]).toEqual([{ prompt: "objective", seconds: cardSeconds }]);
		expect([...v.newLessonReports]).toEqual([{ step: 1, seconds: cardSeconds, hits: 0 }]);
		expect(h.director.flushMetrics()).toEqual([]); // the move prompt just showed
		// Standing still on the move prompt: nothing until flushed (a skip); a second flush returns nothing.
		const standFrames = (TUTORIAL.stuckSeconds + 5) * SIM_HZ;
		for (let i = 0; i < standFrames; i++) {
			v = h.step(0);
			expect(v.newStuckReports.size()).toBe(0);
		}
		expect(h.director.flushMetrics()).toEqual([{ prompt: "move", seconds: TUTORIAL.stuckSeconds + 5 }]);
		expect(h.director.flushMetrics()).toEqual([]);
		// Stuck on `move` again: never a second report for the same prompt id.
		for (let i = 0; i < standFrames; i++) v = h.step(0);
		expect(h.director.flushMetrics()).toEqual([]);
		// A threshold just above an episode reports nothing: the same 21 s card with a 22 s threshold.
		const strict = new TutorialDirector({ stuckSeconds: TUTORIAL.stuckSeconds + 2 });
		const h2 = harness();
		const feed = (buttons: number) => {
			const input: InputFrame = { ...EMPTY_INPUT, buttons };
			h2.run.frame(SIM_DT, input);
			return strict.update({
				state: h2.run.state,
				config: h2.setup.config,
				events: h2.run.frameEvents,
				buttons,
				dt: SIM_DT,
			});
		};
		for (let i = 0; i < cardFrames; i++) feed(0);
		expect([...feed(Button.FIRE).newStuckReports]).toEqual([]);
	});

	it("guard late (sword first): its 8-tick guardHold reports only under a threshold it outlasts", () => {
		const r = lateRun();
		expect(r.guardHeldTicks).toBe(8);
		expect(r.stuckReports).toEqual([]); // the game's 20 s
		const hold = (k: number) => r.shadowStuckReports[k].filter((x) => x.prompt === "guardHold");
		expect(LATE_STUCK_SHADOWS).toEqual([0.1, 0.2]);
		expect(hold(0)).toEqual([{ prompt: "guardHold", seconds: 0.1 }]); // 8 / 60 s >= 0.1
		expect(hold(1)).toEqual([]); // 8 / 60 s < 0.2
		// The guard lesson took 0.6 s less than the tour's (sword first, then the block), same hits.
		expect(rows(r)[tutorialStepIndex("guard")]).toEqual([8, 5, 1]);
		checkRelations(r);
	});

	it("guard late, the block put off 25 s: a guardHold stuck report at the game's threshold (not at 30 s)", () => {
		const delay = 25 * SIM_HZ;
		const r = playTutorial({ guardLate: true, guardHoldDelayTicks: delay, shadowStuckSeconds: [30] });
		expect(r.view.finished).toBe(true);
		expect(r.guardHeldTicks).toBe(1604); // the delay plus the wait for a bullet to block
		expect(r.stuckReports).toEqual([{ prompt: "guardHold", seconds: roundTutorialSeconds(1604 * SIM_DT) }]);
		expect(r.stuckReports[0].seconds).toBe(26.7);
		expect(r.shadowStuckReports[0]).toEqual([]);
		expect(rows(r)[tutorialStepIndex("guard")]).toEqual([8, 31.6, 37]);
		checkRelations(r);
	});
});
