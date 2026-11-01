/**
 * Every theme string key the tutorial reads (docs/TUTORIAL.md): the step prompts (per device), the callouts, the
 * objective card, the TutorialPanel, the outro, the pause overlay, the main menu entry and the verdict line. The client components take
 * their keys from here; hud.spec.ts and tutorial.spec.ts check each one exists in the placeholder pack.
 *
 * Key naming:
 *   tutorial.prompt.<prompt>.<device>   a step's prompt (TutorialStep.prompt; device keyboard | gamepad | touch)
 *   tutorial.callout.<id>               a one-shot callout (TutorialCallout.key)
 *   tutorial.<area>.<name>              the UI chrome below (TUTORIAL_STRINGS)
 */
import { TUTORIAL_CALLOUTS, TUTORIAL_DEVICES, TUTORIAL_FOLLOW_PROMPT, TUTORIAL_STEPS } from "./steps";
import type { TutorialDevice, TutorialStep } from "./steps";

export const TUTORIAL_STRINGS = {
	/** The objective card (lesson 0): a title and two lines; Continue is the step's own prompt (FIRE). */
	objectiveTitle: "tutorial.objective.title",
	objectiveBody: "tutorial.objective.body",
	/** TutorialPanel: progress ("{step} / {count}") and the pause hint ("{key}: pause / skip"). */
	panelProgress: "tutorial.panel.progress",
	panelHint: "tutorial.panel.hint",
	/** The outro card. */
	outroTitle: "tutorial.outro.title",
	outroBody: "tutorial.outro.body",
	outroStart: "tutorial.outro.start",
	outroReplay: "tutorial.outro.replay",
	/** Pause overlay during the tutorial (restart / skip with a confirm). */
	pauseRestart: "tutorial.pause.restart",
	pauseSkip: "tutorial.pause.skip",
	pauseSkipConfirm: "tutorial.pause.skipConfirm",
	pauseSkipYes: "tutorial.pause.skipYes",
	pauseSkipNo: "tutorial.pause.skipNo",
	/** The main menu's replay entry ("Tutorial"). */
	menuOpen: "tutorial.menu.open",
	/** The InfoPanel verdict line of a tutorial run. */
	verdict: "tutorial.verdict",
} as const;

/** The theme key of prompt `prompt` (a TutorialStep, or a prompt id such as TUTORIAL_FOLLOW_PROMPT) on `device`. */
export function tutorialPromptKey(prompt: TutorialStep | string, device: TutorialDevice): string {
	const id = typeIs(prompt, "string") ? prompt : prompt.prompt;
	return `tutorial.prompt.${id}.${device}`;
}

/** Every prompt id the director can show: each step's (and its hold prompt), plus the follow-the-marker prompt. */
export function tutorialPromptIds(): string[] {
	const out: string[] = [TUTORIAL_FOLLOW_PROMPT];
	for (const s of TUTORIAL_STEPS) {
		if (!out.includes(s.prompt)) out.push(s.prompt);
		if (s.holdPrompt !== undefined && !out.includes(s.holdPrompt)) out.push(s.holdPrompt);
	}
	return out;
}

/**
 * Every prompt id the director can show (tutorialPromptIds(), frozen): TutorialStuckReport.prompt is one of them (the
 * server's tutorialStuck validation, docs/TUTORIAL_FUNNEL.md §6).
 */
export const TUTORIAL_PROMPT_IDS: ReadonlyArray<string> = table.freeze(tutorialPromptIds());

/** Every tutorial string key (prompts x devices, callouts, TUTORIAL_STRINGS), each once. */
export function tutorialStringKeys(): string[] {
	const out: string[] = [];
	for (const id of tutorialPromptIds()) for (const d of TUTORIAL_DEVICES) out.push(tutorialPromptKey(id, d));
	for (const c of TUTORIAL_CALLOUTS) out.push(c.key);
	for (const [, key] of pairs(TUTORIAL_STRINGS as unknown as Map<string, string>)) out.push(key);
	return out;
}
