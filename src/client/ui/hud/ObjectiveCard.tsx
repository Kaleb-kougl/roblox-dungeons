import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectTutorial, selectTutorialPromptKey } from "client/store";
import { str } from "client/ui/theme";
import { TUTORIAL_STRINGS, tutorialDeviceFor } from "shared/tutorial";
import { HUD_VIEW, TUTORIAL_VIEW, tutorialPromptVars } from "shared/view/hud";
import { MenuFit } from "./MenuFit";
import { Panel, Text } from "./primitives";
import { screenSkin } from "shared/view/menu";

/**
 * Centre, the tutorial's first step (docs/TUTORIAL.md lesson 0): the objective card ("Practice Descent", what a run
 * is) and its Continue line in the last-used device's words ("Click: Continue" / "RT: Continue": the objective
 * step's prompt, with the bound attack input). The director dismisses it on a FIRE press once it has been up TUTORIAL.objectiveCardMinSeconds.
 */
export function ObjectiveCard() {
	const t = useSelector(selectTutorial);
	const promptKey = useSelector(selectTutorialPromptKey);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	if (!t.active || t.ended || t.card !== "objective") return undefined;
	return (
		<MenuFit
			render={() => (
				<Panel
					width={TUTORIAL_VIEW.cardWidth}
					align={Enum.HorizontalAlignment.Center}
					padding={HUD_VIEW.pad * 2}
					skin={screenSkin("objectiveCard")}
					name="ObjectiveCard"
				>
					<Text
						fill={true}
						order={1}
						size={HUD_VIEW.bigText}
						color="uiAccent"
						align={Enum.TextXAlignment.Center}
						text={str(TUTORIAL_STRINGS.objectiveTitle)}
					/>
					<Text
						order={2}
						size={HUD_VIEW.titleText}
						align={Enum.TextXAlignment.Center}
						wrap={true}
						text={str(TUTORIAL_STRINGS.objectiveBody)}
					/>
					{promptKey !== "" ? (
						<Text
							fill={true}
							order={3}
							size={HUD_VIEW.smallText}
							color="uiTextDim"
							align={Enum.TextXAlignment.Center}
							text={str(promptKey, tutorialPromptVars(tutorialDeviceFor(device), bindings, str))}
						/>
					) : undefined}
				</Panel>
			)}
		/>
	);
}
