import { keyDevice } from "shared/play";
import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectTutorial, selectTutorialPromptKey } from "client/store";
import { str } from "client/ui/theme";
import { TUTORIAL_STRINGS, tutorialDeviceFor } from "shared/tutorial";
import { HUD_VIEW, PAUSE_HINT, TUTORIAL_VIEW, tutorialPromptVars } from "shared/view/hud";
import { Panel, Text } from "./primitives";

const HALF = 0.5;

/**
 * Lower centre, during a tutorial run (docs/TUTORIAL.md "Throughout"): the step's prompt in the last-used device's
 * words (tutorial.prompt.<id>.<device>, naming the player's bound keys: tutorialPromptVars), the progress ("{step} / {count}": steps done) and the pause hint
 * ("P: pause / skip", "Start" on a gamepad). Hidden while the objective card is up (it carries its own prompt), when
 * no prompt shows, and once the tutorial ended.
 */
export function TutorialPanel() {
	const t = useSelector(selectTutorial);
	const promptKey = useSelector(selectTutorialPromptKey);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	if (!t.active || t.ended || t.card !== undefined || promptKey === "") return undefined;
	return (
		<Panel
			position={new UDim2(HALF, 0, 1, -TUTORIAL_VIEW.panelBottom)}
			anchor={new Vector2(HALF, 1)}
			width={TUTORIAL_VIEW.panelWidth}
			align={Enum.HorizontalAlignment.Center}
			name="Tutorial"
		>
			<Text
				order={1}
				align={Enum.TextXAlignment.Center}
				wrap={true}
				text={str(promptKey, tutorialPromptVars(tutorialDeviceFor(device), bindings))}
			/>
			<Text
				fill={true}
				order={2}
				size={HUD_VIEW.smallText}
				color="uiAccent"
				align={Enum.TextXAlignment.Center}
				text={str(TUTORIAL_STRINGS.panelProgress, {
					step: math.min(t.stepsDone, t.stepCount),
					count: t.stepCount,
				})}
			/>
			<Text
				fill={true}
				order={3}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={str(TUTORIAL_STRINGS.panelHint, { key: PAUSE_HINT[keyDevice(device)] })}
			/>
		</Panel>
	);
}
