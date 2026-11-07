import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectInputDevice } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, Panel, Row, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { keyDevice } from "shared/play";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import {
	CREDIT_STRINGS,
	MENU_BACK_HINT,
	MENU_FIT,
	MENU_STRINGS,
	MENU_VIEW,
	creditLines,
	screenSkin,
	type CreditLine,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { ScrollList } from "./widgets";

const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);

/** One line of the list: a section label, a work and its author, its licence line, the change note. */
function CreditText(props: { line: CreditLine; order: number }) {
	const line = props.line;
	if (line.kind === "section") {
		return <Text order={props.order} fill={true} color="uiAccent" text={str(line.key)} />;
	}
	if (line.kind === "work") {
		return (
			<Text
				order={props.order}
				wrap={true}
				text={`${line.work}  ${str(CREDIT_STRINGS.by, { author: line.author })}`}
			/>
		);
	}
	return (
		<Text
			order={props.order}
			wrap={true}
			size={HUD_VIEW.smallText}
			color="uiTextDim"
			text={line.kind === "license" ? line.text : str(CREDIT_STRINGS.modified)}
		/>
	);
}

/**
 * The Credits screen (main menu > Credits; shared/view/menu credits.ts): the third-party art, 3D models, sound and
 * code, by section, in a scrolling list (a gamepad selects the list and scrolls it with the stick), then Back and
 * its key hint. Fitted into the safe area on touch (MenuFit: the list is the flexible part). A `screen` focus scope
 * (docs/GAMEPAD_MENUS.md GM2): a gamepad starts on Back; B goes back.
 */
export function CreditsScreen() {
	const actions = useMenuActions();
	const device = useSelector(selectInputDevice);
	const backRef = useRef<TextButton>();
	const lines = creditLines();
	return (
		<FocusScope
			name="CreditsScope"
			id="credits"
			layer="screen"
			surface="credits"
			defaultRef={backRef}
			onPadAction={(action) => {
				if (action.kind === "back") actions.screenBack();
			}}
		>
			<MenuFit
				flex={{ min: MENU_FIT.listMin, max: MENU_VIEW.listHeight }}
				render={(layout) => (
					<Panel
						width={MENU_VIEW.creditsWidth}
						padding={HUD_VIEW.pad * 2}
						skin={screenSkin("credits")}
						name="Credits"
					>
						<Text
							fill={true}
							order={1}
							size={HUD_VIEW.titleText}
							color="uiAccent"
							text={str(CREDIT_STRINGS.title)}
						/>
						<ScrollList order={2} height={layout.flex} selectable={true}>
							{lines.map((line, i) => (
								<CreditText key={`Line${i}`} line={line} order={i + 1} />
							))}
						</ScrollList>
						<Row order={3} align={Enum.HorizontalAlignment.Center}>
							<MenuButton
								ref={backRef}
								order={1}
								name="Back"
								size={SMALL}
								textSize={HUD_VIEW.smallText}
								text={str(MENU_STRINGS.back)}
								onActivated={() => {
									actions.playUi(SFX.uiBack);
									actions.back();
								}}
							/>
						</Row>
						{device === "touch" ? undefined : (
							<Text
								fill={true}
								order={4}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								align={Enum.TextXAlignment.Center}
								text={str(MENU_STRINGS.backHint, { key: MENU_BACK_HINT[keyDevice(device)] })}
							/>
						)}
					</Panel>
				)}
			/>
		</FocusScope>
	);
}
