import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectRunInfo } from "client/store";
import { role, str, uiImage, useHudFont, useUiArt } from "client/ui/theme";
import { FloorModifier } from "shared/dungeon";
import { FLOOR_MODIFIER_VIEW, modifierCardRows } from "shared/view";
import { FLOOR_MODIFIER_UI } from "./floorModifierUi";
import { ArtImage } from "./primitives";

const STROKE = 1;
const HIDDEN = 1;
const HALF = 0.5;
/** Draw order inside the chip (ZIndexBehavior Sibling): the pulse highlight under the icon and name. */
const Z = { pulse: 1, content: 2 } as const;

/**
 * The current floor's modifier for the HUD (RunInfo.floorModifier, set at each run start and floor change): a kind with
 * a chip (shared/view modifierCardRows), else 0 (FloorModifier.NONE: no chip).
 */
export function useFloorModifier(): number {
	const kind = useSelector(selectRunInfo).floorModifier;
	return modifierCardRows(kind) !== undefined ? kind : FloorModifier.NONE;
}

/**
 * The current floor's modifier (docs/FLOOR_MODIFIERS.md FM6, RunInfo.floorModifier): one chip on a dark panel
 * (FLOOR_MODIFIER_VIEW.chip.fillRole) with an outline in the kind's colour role, the kind's name
 * (`floormod.<key>.name`) in that colour, scaled into the box (capped at `textSize`), the kind's icon left of it when
 * the pack has the art (`ui.floormod.<key>`, all or none). Steady while the floor has a modifier; one pulse when its
 * promise pays off (FloorModifierController: the FLOOR_MODIFIER_UI bindings, a UIScale and a highlight in the role
 * colour; the chip's slot keeps its size, so the pulse never moves its neighbours). `kind` NONE / unknown: nothing.
 * Modelled on HordeChip: the status corner puts it in the boost row (beside the Horde chip), the touch strip at the
 * head of its chip line.
 */
export function FloorModifierChip(props: {
	order: number;
	kind: number;
	width: number;
	height: number;
	textSize: number;
}) {
	useUiArt();
	const hudFont = useHudFont();
	const rows = modifierCardRows(props.kind);
	if (rows === undefined) return undefined;
	const c = FLOOR_MODIFIER_VIEW.chip;
	const iconBox = props.height - 2 * STROKE;
	const icon = uiImage(rows.iconId) !== undefined;
	const color = role(rows.role);
	return (
		<frame
			key="FloorModifierChip"
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, props.height)}
			BackgroundTransparency={HIDDEN}
		>
			<frame
				key="Chip"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromScale(1, 1)}
				BackgroundColor3={role(c.fillRole)}
				BorderSizePixel={0}
			>
				<uiscale Scale={FLOOR_MODIFIER_UI.pulseScale.binding} />
				<uistroke Thickness={STROKE} Color={color} />
				<frame
					key="Pulse"
					ZIndex={Z.pulse}
					Size={UDim2.fromScale(1, 1)}
					BackgroundColor3={color}
					BackgroundTransparency={FLOOR_MODIFIER_UI.pulseTransparency.binding}
					BorderSizePixel={0}
				/>
				<frame key="Content" ZIndex={Z.content} Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN}>
					<uipadding PaddingLeft={new UDim(0, c.pad)} PaddingRight={new UDim(0, c.pad)} />
					<uilistlayout
						FillDirection={Enum.FillDirection.Horizontal}
						HorizontalAlignment={Enum.HorizontalAlignment.Center}
						VerticalAlignment={Enum.VerticalAlignment.Center}
						SortOrder={Enum.SortOrder.LayoutOrder}
						Padding={new UDim(0, c.pad)}
					/>
					{icon ? (
						<ArtImage key="Icon" name="Icon" order={1} id={rows.iconId} box={{ w: iconBox, h: iconBox }} />
					) : undefined}
					<textlabel
						key="Name"
						LayoutOrder={2}
						Size={new UDim2(1, icon ? -(iconBox + c.pad) : 0, 1, 0)}
						BackgroundTransparency={HIDDEN}
						Font={hudFont}
						TextScaled={true}
						TextColor3={color}
						TextStrokeColor3={role("background")}
						TextStrokeTransparency={0}
						Text={str(rows.nameKey)}
					>
						<uitextsizeconstraint MaxTextSize={props.textSize} />
					</textlabel>
				</frame>
			</frame>
		</frame>
	);
}
