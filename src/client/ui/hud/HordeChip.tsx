import React from "@rbxts/react";
import { useHudFont, role, str } from "client/ui/theme";
import { HORDE_CHIP, PACT_STRINGS } from "shared/view/pacts";

const STROKE = 1;
const HIDDEN = 1;
const PAD = 3;

/**
 * The Pact of the Horde armed (docs/FORTUNE.md FO7, snapshot `hordeArmed`): one chip, `hud.chip.horde` ("HORDE · next
 * room x2") in `pact.horde` on a dark panel with the boost cells' outline, `width` x `height` reference px, its text
 * scaled into the box (capped at `textSize`). The status corner puts it in the boost row beside the first running boost
 * (no new always-on panel: docs/HUD_LAYOUT.md); the touch strip at the head of its chip line.
 */
export function HordeChip(props: { order: number; width: number; height: number; textSize: number }) {
	const hudFont = useHudFont();
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, props.height)}
			BackgroundColor3={role(HORDE_CHIP.fillRole)}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role(HORDE_CHIP.role)} />
			<uipadding PaddingLeft={new UDim(0, PAD)} PaddingRight={new UDim(0, PAD)} />
			<textlabel
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextScaled={true}
				TextColor3={role(HORDE_CHIP.role)}
				TextStrokeColor3={role("background")}
				TextStrokeTransparency={0}
				Text={str(PACT_STRINGS.chip)}
			>
				<uitextsizeconstraint MaxTextSize={props.textSize} />
			</textlabel>
		</frame>
	);
}
