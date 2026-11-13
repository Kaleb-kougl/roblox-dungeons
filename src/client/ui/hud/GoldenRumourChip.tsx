import React, { useBinding, useEffect } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectJuice } from "client/store";
import { role, str, useHudFont } from "client/ui/theme";
import { motionScale } from "shared/view/fx";
import { GOLDEN_VIEW, GoldenRumourPhase, goldenRumourChipScale, goldenRumourChipText } from "shared/view/golden";
import { HUD_SKIN } from "shared/view/hud";
import { ArtImage } from "./primitives";

const STROKE = 1;
const HIDDEN = 1;
const PAD = 3;
const HALF = 0.5;
const ROUND = new UDim(HALF, 0);
/** The coin glyph's box: this share of the chip's height. */
const COIN_SHARE = 0.7;
const C = GOLDEN_VIEW.rumour.chip;

/**
 * The Goldling rumour chip (docs/GOLDLING_RUMOURS.md GR7, RD4; snapshot `goldenRumour`, this client's
 * GoldenRumourClock.chip()): `hud.chip.golden.rumour` ("Coins jingling...") from the floor rumour on, then
 * `hud.chip.golden.hiding` ("It's hiding here!") once its room engaged, in `golden.coin` on a dark panel with the coin
 * glyph (ui.icon.coin when the pack has it, else a flat coin), `width` x `height` reference px, its text scaled into the
 * box (capped at `textSize`). It sits beside the Horde chip: the status corner's boost row, the touch strip's chip line.
 * While it reads "hiding" its content pulses gently (shared/view/golden goldenRumourChipScale on a binding: no
 * re-render; reduced motion: still, and no per-frame connection). The clock already hides it under a draft and the stage
 * cover (NONE: the callers render nothing).
 */
export function GoldenRumourChip(props: {
	order: number;
	width: number;
	height: number;
	textSize: number;
	phase: number;
}) {
	const hudFont = useHudFont();
	const motion = motionScale(useSelector(selectJuice));
	const phase = props.phase;
	const [scale, setScale] = useBinding(1);
	useEffect(() => {
		setScale(1);
		if (phase !== GoldenRumourPhase.ROOM || motion <= 0) return undefined;
		const start = os.clock();
		const connection = RunService.Heartbeat.Connect(() =>
			setScale(goldenRumourChipScale(os.clock() - start, phase, motion)),
		);
		return () => connection.Disconnect();
	}, [phase, motion]);
	const coin = math.floor(props.height * COIN_SHARE);
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, props.height)}
			BackgroundColor3={role(C.fillRole)}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role(C.role)} />
			<frame
				key="Content"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
			>
				<uiscale Scale={scale} />
				<uipadding PaddingLeft={new UDim(0, PAD)} PaddingRight={new UDim(0, PAD)} />
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					VerticalAlignment={Enum.VerticalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, PAD)}
				/>
				<ArtImage
					id={HUD_SKIN.ids.coin}
					order={1}
					box={{ w: coin, h: coin }}
					fallback={
						<frame
							key="Coin"
							LayoutOrder={1}
							Size={new UDim2(0, coin, 0, coin)}
							BackgroundColor3={role(C.role)}
							BorderSizePixel={0}
						>
							<uicorner CornerRadius={ROUND} />
							<uistroke Thickness={STROKE} Color={role("background")} />
						</frame>
					}
				/>
				<textlabel
					LayoutOrder={2}
					Size={new UDim2(1, -(coin + PAD), 1, 0)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
					TextColor3={role(C.role)}
					TextStrokeColor3={role("background")}
					TextStrokeTransparency={0}
					Text={goldenRumourChipText((key) => str(key), phase)}
				>
					<uitextsizeconstraint MaxTextSize={props.textSize} />
				</textlabel>
			</frame>
		</frame>
	);
}
