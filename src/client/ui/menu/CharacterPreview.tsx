import React, { useBinding, useEffect } from "@rbxts/react";
import { RunService } from "@rbxts/services";
import { requestUiContent, role, themePack, uiContentReady, useUiArt } from "client/ui/theme";
import { PLAYER_OUTLINE } from "shared/view";
import { cosmeticClockSec, cosmeticRgb8 } from "shared/view/cosmetics";
import {
	CHARACTER_VIEW,
	characterPreviewFacing,
	characterPreviewFrame,
	characterPreviewSize,
	previewTurnFacing,
} from "shared/view/menu";
import type { ColorRole, SpriteFrame } from "shared/theme";

const HIDDEN = 1;
const HALF = 0.5;
const IDLE = "idle";
const V = CHARACTER_VIEW;
/** The stacked labels (the frame's ZIndexBehavior is the ScreenGui's Sibling): rim under the body, dye over it. */
const Z = { rim: 1, body: 2, dye: 3 } as const;

/** A cosmetic item's colour at `t` seconds (reduced motion: its first stop) as a Color3, or `fallback`. */
function itemColor3(itemId: string | undefined, t: number, reduced: boolean, fallback: Color3): Color3 {
	const c = cosmeticRgb8(itemId, cosmeticClockSec(t, reduced));
	return c !== undefined ? Color3.fromRGB(c.r, c.g, c.b) : fallback;
}

/**
 * A character's idle animation drawn from its theme sprite set (`class.vanguard` / `class.ranger`) and fitted into a
 * `box` square (shared/view/menu characterPreviewFacing / Frame / Size): the character screen's cards (docs/ARCHER.md
 * AR7) and the Armory's live preview (docs/COSMETICS.md CS6). Without a sprite set with an idle animation (the
 * placeholder pack) the class colour's capsule. The clock runs on Heartbeat through bindings (no re-render per frame);
 * reduced motion holds frame 0, the camera-facing row and a Prismatic dye's first stop.
 *
 * Cosmetics, stacked UI ImageLabels with the body's rect: `dyeItem` (a dye of THIS set, the caller's dyeForVisual)
 * over the body from the frame's dye sheet tinted by the dye's colour, drawn only once that sheet has downloaded
 * (uiContentReady; the sheets are asked for on the front lane: no preload tier holds them) and never faked over the
 * whole sprite; `rim` draws the baked outline under the body in `outlineItem`'s colour (else playerOutline's); `turn`
 * steps through every facing (previewTurnFacing).
 */
export function CharacterPreview(props: {
	visualId: string;
	color: ColorRole;
	box: number;
	reducedMotion: boolean;
	/** docs/SILVER.md SV18: a locked character's art is dimmed (0 = full). */
	dim?: number;
	/** docs/COSMETICS.md CS6: a dye of this set worn or tried on. */
	dyeItem?: string;
	/** The rim (the in-run outline), in `outlineItem`'s colour or playerOutline's. */
	rim?: boolean;
	outlineItem?: string;
	/** Turn through the facings. */
	turn?: boolean;
	/** LayoutOrder in the parent's list (default 1). */
	order?: number;
}) {
	useUiArt(); // a dye sheet landing re-renders (its label's Visible)
	const dim = props.dim ?? 0;
	const pack = themePack();
	const set = pack?.sprites(props.visualId);
	const idle = set !== undefined && set.has(IDLE) ? set.animation(IDLE) : undefined;
	const [clock, setClock] = useBinding(0);
	const fps = idle?.fps ?? 0;
	const frames = idle?.frames ?? 0;
	const reduced = props.reducedMotion;
	const moving = !reduced && (frames > 1 || props.turn === true || props.dyeItem !== undefined);
	useEffect(() => {
		setClock(0);
		if (!moving) return;
		let t = 0;
		const conn = RunService.Heartbeat.Connect((dt) => {
			t += dt;
			setClock(t);
		});
		return () => conn.Disconnect();
	}, [fps, frames, moving]);
	// docs/COSMETICS.md CS6: the set's dye sheets are loaded only for a preview that wears a dye of it.
	useEffect(() => {
		if (props.dyeItem === undefined || pack === undefined) return;
		requestUiContent(pack.dyeContentIds(props.visualId), `preview dye ${props.visualId}`);
	}, [props.visualId, props.dyeItem !== undefined]);
	const box = props.box;
	const outer = (children: React.ReactNode) => (
		<frame
			key="Preview"
			LayoutOrder={props.order ?? 1}
			Size={UDim2.fromOffset(box, box)}
			BackgroundTransparency={HIDDEN}
		>
			{children}
		</frame>
	);
	if (set === undefined || idle === undefined) {
		return outer(
			<frame
				key="Capsule"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromOffset(math.floor(box * V.capsule.w), math.floor(box * V.capsule.h))}
				BackgroundColor3={role(props.color)}
				BackgroundTransparency={dim}
				BorderSizePixel={0}
			>
				<uicorner CornerRadius={new UDim(HALF, 0)} />
				<uistroke Thickness={V.stroke} Color={role("uiTextDim")} />
			</frame>,
		);
	}
	const turn = props.turn === true;
	const frameAt = (t: number): SpriteFrame => {
		const facing = turn ? previewTurnFacing(t, set.facings, reduced) : characterPreviewFacing(set.facings);
		return set.frame(IDLE, facing, characterPreviewFrame(t, fps, frames, reduced));
	};
	const first = frameAt(0);
	const size = characterPreviewSize(first.size.X, first.size.Y, box);
	const place = {
		AnchorPoint: new Vector2(HALF, HALF),
		Position: UDim2.fromScale(HALF, HALF),
		Size: UDim2.fromOffset(size.w, size.h),
		BackgroundTransparency: HIDDEN,
		ResampleMode: Enum.ResamplerMode[set.resample],
		ImageTransparency: dim,
	};
	const dyeItem = props.dyeItem;
	const outlineItem = props.outlineItem;
	const rimFallback = role(PLAYER_OUTLINE.role);
	return outer(
		<>
			{props.rim === true ? (
				<imagelabel
					key="Rim"
					{...place}
					ZIndex={Z.rim}
					Image={clock.map((t) => frameAt(t).outlineImage ?? "")}
					Visible={clock.map((t) => frameAt(t).outlineImage !== undefined)}
					ImageRectSize={clock.map((t) => frameAt(t).size)}
					ImageRectOffset={clock.map((t) => frameAt(t).offset)}
					ImageColor3={clock.map((t) => itemColor3(outlineItem, t, reduced, rimFallback))}
				/>
			) : undefined}
			<imagelabel
				key="Sprite"
				{...place}
				ZIndex={Z.body}
				Image={clock.map((t) => frameAt(t).image)}
				ImageRectSize={clock.map((t) => frameAt(t).size)}
				ImageRectOffset={clock.map((t) => frameAt(t).offset)}
			/>
			{dyeItem !== undefined ? (
				<imagelabel
					key="Dye"
					{...place}
					ZIndex={Z.dye}
					Image={clock.map((t) => frameAt(t).dyeImage ?? "")}
					Visible={clock.map((t) => {
						const image = frameAt(t).dyeImage;
						return image !== undefined && uiContentReady(image);
					})}
					ImageRectSize={clock.map((t) => frameAt(t).size)}
					ImageRectOffset={clock.map((t) => frameAt(t).offset)}
					ImageColor3={clock.map((t) => itemColor3(dyeItem, t, reduced, rimFallback))}
				/>
			) : undefined}
		</>,
	);
}
