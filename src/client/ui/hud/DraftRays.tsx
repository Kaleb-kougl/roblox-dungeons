import React, { useMemo } from "@rbxts/react";
import { DRAFT_REVEAL_VIEW, draftRayAngle } from "shared/view/hud";

const HALF = 0.5;
const HIDDEN = 1;
/** UIGradient's default runs left to right; a beam is tall, so its gradient runs top to bottom. */
const ALONG_BEAM_DEG = 90;

export interface DraftRaysProps {
	readonly color: Color3;
	readonly visible: React.Binding<boolean>;
	/** The whole ring's transparency (every beam's BackgroundTransparency). */
	readonly transparency: React.Binding<number>;
	readonly scale: React.Binding<number> | number;
	/** The ring's Rotation, degrees (its beams turn with it). */
	readonly rotation: React.Binding<number>;
	readonly zIndex: number;
}

/**
 * A ring of gold rays (docs/DRAFT_REVEAL.md DR5, DRD12: code-drawn, no art): a square holder centred on its parent,
 * DRAFT_REVEAL_VIEW.rays.beams thin Frames through its centre (each two opposite rays), each fading from the centre to
 * clear tips by a UIGradient, the holder turned by `rotation` (children rotate with it) and scaled by a UIScale. It
 * sits behind the card body in the card's slot, larger than the slot, so it draws outside the layout and never moves
 * a card. Used twice per card: the legendary flare's burst and its halo.
 */
export function DraftRays(props: DraftRaysProps) {
	const R = DRAFT_REVEAL_VIEW.rays;
	const fade = useMemo(
		() =>
			new NumberSequence([
				new NumberSequenceKeypoint(0, HIDDEN),
				new NumberSequenceKeypoint(HALF, R.rootTransparency),
				new NumberSequenceKeypoint(1, HIDDEN),
			]),
		[],
	);
	const beams: React.Element[] = [];
	for (let k = 0; k < R.beams; k++) {
		beams.push(
			<frame
				key={`b${k}`}
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromOffset(R.widthPx, R.lengthPx)}
				Rotation={draftRayAngle(k, R.beams)}
				BackgroundColor3={props.color}
				BackgroundTransparency={props.transparency}
				BorderSizePixel={0}
				ZIndex={props.zIndex}
			>
				<uigradient Rotation={ALONG_BEAM_DEG} Transparency={fade} />
			</frame>,
		);
	}
	return (
		<frame
			AnchorPoint={new Vector2(HALF, HALF)}
			Position={UDim2.fromScale(HALF, HALF)}
			Size={UDim2.fromOffset(R.lengthPx, R.lengthPx)}
			Rotation={props.rotation}
			BackgroundTransparency={HIDDEN}
			Visible={props.visible}
			ZIndex={props.zIndex}
		>
			<uiscale Scale={props.scale} />
			{beams}
		</frame>
	);
}
