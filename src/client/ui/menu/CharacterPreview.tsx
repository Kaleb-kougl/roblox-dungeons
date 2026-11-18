import React, { useBinding, useEffect } from "@rbxts/react";
import { RunService } from "@rbxts/services";
import { requestUiContent, role, themePack, uiContentReady, useUiArt } from "client/ui/theme";
import { PLAYER_OUTLINE } from "shared/view";
import { cosmeticClockSec, cosmeticRgb8 } from "shared/view/cosmetics";
import { COSMETIC_VIEW } from "shared/view/cosmetics";
import { FEEL_GHOST, NEAR_MISS_VIEW } from "shared/view/fx";
import {
	CHARACTER_VIEW,
	characterPreviewFacing,
	characterPreviewFrame,
	characterPreviewSize,
	previewActionAnim,
	previewActionPhase,
	previewActionSec,
	previewBurstAt,
	previewBurstOrigin,
	previewGhosts,
	previewRollAngleDeg,
	previewRollOffset,
	previewTurnFacing,
	type PreviewAction,
	type PreviewActionPhase,
} from "shared/view/menu";
import { facingIndex } from "shared/view";
import type { ColorRole, SpriteFrame } from "shared/theme";

const HIDDEN = 1;
const HALF = 0.5;
const IDLE = "idle";
const V = CHARACTER_VIEW;
/** The stacked labels (the frame's ZIndexBehavior is the ScreenGui's Sibling): ghosts, rim, body, dye, then the burst. */
const Z = { ghost: 0, ghostDye: 1, rim: 2, body: 3, dye: 4, burst: 5 } as const;
const WHITE = new Color3(1, 1, 1);
const ACTION = COSMETIC_VIEW.preview.action;

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
	/**
	 * docs/COSMETICS.md "Preview actions": act a trail or spark item out (shared/view/menu cosmeticAction.ts): "roll"
	 * slides across the box with ghosts in `trailItem`'s colour, "attack" throws the parry burst in `sparkItem`'s colour.
	 * Ignored under reduced motion or when the set has no such animation (the idle is drawn).
	 */
	action?: PreviewAction;
	trailItem?: string;
	sparkItem?: string;
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
	const actionAnimName =
		set !== undefined && !reduced ? previewActionAnim(props.action ?? "idle", (a) => set.has(a)) : undefined;
	const actionDef = actionAnimName !== undefined ? set!.animation(actionAnimName) : undefined;
	const action = actionDef !== undefined ? props.action ?? "idle" : "idle";
	const actFps = actionDef?.fps ?? 0;
	const actFrames = actionDef?.frames ?? 0;
	const actLen = previewActionSec(actFps, actFrames);
	const moving = !reduced && (frames > 1 || props.turn === true || props.dyeItem !== undefined || action !== "idle");
	useEffect(() => {
		setClock(0);
		if (!moving) return;
		let t = 0;
		const conn = RunService.Heartbeat.Connect((dt) => {
			t += dt;
			setClock(t);
		});
		return () => conn.Disconnect();
	}, [fps, frames, moving, action]);
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
	const turn = props.turn === true && action === "idle";
	const phaseAt = (t: number): PreviewActionPhase => previewActionPhase(t, actFps, actFrames);
	/** The facing an action holds on `phase`'s cycle (a roll faces where it goes, an attack its fixed angle). */
	const actionFacing = (phase: PreviewActionPhase): number =>
		facingIndex(action === "roll" ? previewRollAngleDeg(phase.cycle) : ACTION.attackAngleDeg, set.facings);
	const frameAt = (t: number): SpriteFrame => {
		if (action !== "idle" && actionAnimName !== undefined) {
			const phase = phaseAt(t);
			const facing = actionFacing(phase);
			if (phase.acting) return set.frame(actionAnimName, facing, phase.frame);
			return set.frame(IDLE, facing, characterPreviewFrame(t, fps, frames, reduced));
		}
		const facing = turn ? previewTurnFacing(t, set.facings, reduced) : characterPreviewFacing(set.facings);
		return set.frame(IDLE, facing, characterPreviewFrame(t, fps, frames, reduced));
	};
	/** The sprite's horizontal shift at `t`, reference px (a roll slides; otherwise 0). */
	const shiftAt = (t: number): number => {
		if (action !== "roll") return 0;
		const phase = phaseAt(t);
		return math.floor(previewRollOffset(phase.acting, phase.actSec, actLen, phase.cycle) * box);
	};
	const first = frameAt(0);
	const size = characterPreviewSize(first.size.X, first.size.Y, box);
	const place = {
		AnchorPoint: new Vector2(HALF, HALF),
		Position:
			action === "roll" ? clock.map((t) => new UDim2(HALF, shiftAt(t), HALF, 0)) : UDim2.fromScale(HALF, HALF),
		Size: UDim2.fromOffset(size.w, size.h),
		BackgroundTransparency: HIDDEN,
		ResampleMode: Enum.ResamplerMode[set.resample],
		ImageTransparency: dim,
	};
	const dyeItem = props.dyeItem;
	const outlineItem = props.outlineItem;
	const rimFallback = role(PLAYER_OUTLINE.role);
	/** Reference px per art px and per tile at the fitted size (the burst is in tiles, its sparks in art px). */
	const artScale = first.size.X > 0 ? size.w / first.size.X : 1;
	const pxPerTile = set.pixelsPerTile * artScale;

	// --- the roll's ghosts (docs/COSMETICS.md "Preview actions"; in-run FEEL_GHOST) --------------------------------
	const period = ACTION.restSec + actLen;
	/** Ghost slot `j` at `t`: the frame, shift and transparency, or undefined (no ghost in that slot). */
	const ghostAt = (t: number, j: number) => {
		const phase = phaseAt(t);
		const inCycle = t - phase.cycle * period;
		// resting: the previous cycle's ghosts fade out (cycle 0's rest has none)
		const cycle = phase.acting ? phase.cycle : phase.cycle - 1;
		if (cycle < 0 || actionAnimName === undefined) return undefined;
		const ghosts = previewGhosts(phase.acting, phase.actSec, actLen, cycle, phase.acting ? 0 : inCycle);
		const g = ghosts[j];
		if (g === undefined) return undefined;
		const facing = facingIndex(previewRollAngleDeg(cycle), set.facings);
		const frame = set.frame(actionAnimName, facing, math.min(actFrames - 1, math.floor(g.recordedSec * actFps)));
		return { frame, shift: math.floor(g.offset * box), transparency: math.max(g.transparency, dim) };
	};
	const ghostLabels = new Array<React.Element>();
	if (action === "roll") {
		const trailItem = props.trailItem;
		const trailColor = (t: number) => itemColor3(trailItem, t, reduced, WHITE);
		for (let j = 0; j < FEEL_GHOST.perSource; j++) {
			const ghost = (dye: boolean) => (
				<imagelabel
					key={`Ghost${j}${dye ? "Dye" : ""}`}
					{...place}
					ZIndex={dye ? Z.ghostDye : Z.ghost}
					Position={clock.map((t) => new UDim2(HALF, ghostAt(t, j)?.shift ?? 0, HALF, 0))}
					Visible={clock.map((t) => {
						const g = ghostAt(t, j);
						if (g === undefined) return false;
						if (!dye) return true;
						const image = g.frame.dyeImage;
						return image !== undefined && uiContentReady(image);
					})}
					Image={clock.map((t) => {
						const g = ghostAt(t, j);
						return g === undefined ? "" : dye ? g.frame.dyeImage ?? "" : g.frame.image;
					})}
					ImageRectSize={clock.map((t) => ghostAt(t, j)?.frame.size ?? Vector2.zero)}
					ImageRectOffset={clock.map((t) => ghostAt(t, j)?.frame.offset ?? Vector2.zero)}
					ImageTransparency={clock.map((t) => ghostAt(t, j)?.transparency ?? HIDDEN)}
					ImageColor3={clock.map((t) => {
						const c = trailColor(t);
						if (!dye) return c;
						const d = itemColor3(dyeItem, t, reduced, WHITE);
						return new Color3(c.R * d.R, c.G * d.G, c.B * d.B);
					})}
				/>
			);
			ghostLabels.push(ghost(false));
			if (dyeItem !== undefined) ghostLabels.push(ghost(true));
		}
	}

	// --- the attack's burst (in-run NEAR_MISS_VIEW.parry) ----------------------------------------------------------
	const burstLabels = new Array<React.Element>();
	if (action === "attack") {
		const sparkItem = props.sparkItem;
		const sparkColor = (t: number) => itemColor3(sparkItem, t, reduced, role("nearMiss.parry"));
		const origin = previewBurstOrigin(ACTION.attackAngleDeg);
		const burstAt = (t: number) => previewBurstAt(t, actFps, actFrames, ACTION.attackAngleDeg);
		const at = (x: number, y: number) =>
			new UDim2(HALF, math.floor((origin.x + x) * pxPerTile), HALF, math.floor((origin.y + y) * pxPerTile));
		for (let i = 0; i < NEAR_MISS_VIEW.parry.sparkCount; i++) {
			burstLabels.push(
				<frame
					key={`Spark${i}`}
					AnchorPoint={new Vector2(HALF, HALF)}
					BorderSizePixel={0}
					ZIndex={Z.burst}
					Visible={clock.map((t) => burstAt(t) !== undefined)}
					Position={clock.map((t) => {
						const sp = burstAt(t)?.sparks[i];
						return sp === undefined ? at(0, 0) : at(sp.x, sp.y);
					})}
					Size={clock.map((t) => {
						const sp = burstAt(t)?.sparks[i];
						// the in-run small / large spark, staged at menu size (COSMETIC_VIEW.preview.action.sparkPx)
						const px =
							sp !== undefined && sp.sizePx > NEAR_MISS_VIEW.parry.sparkMinPx
								? ACTION.sparkPx.large
								: ACTION.sparkPx.small;
						return UDim2.fromOffset(px, px);
					})}
					BackgroundColor3={clock.map(sparkColor)}
					BackgroundTransparency={clock.map((t) =>
						math.max(burstAt(t)?.sparks[i]?.transparency ?? HIDDEN, dim),
					)}
				/>,
			);
		}
		const ringPx = (t: number) => math.floor(2 * (burstAt(t)?.ring.radius ?? 0) * pxPerTile);
		burstLabels.push(
			<frame
				key="Ring"
				AnchorPoint={new Vector2(HALF, HALF)}
				BackgroundTransparency={HIDDEN}
				ZIndex={Z.burst}
				Visible={clock.map((t) => burstAt(t) !== undefined)}
				Position={at(0, 0)}
				Size={clock.map((t) => UDim2.fromOffset(ringPx(t), ringPx(t)))}
			>
				<uicorner CornerRadius={new UDim(HALF, 0)} />
				<uistroke
					Thickness={ACTION.ringStrokePx}
					Color={clock.map(sparkColor)}
					Transparency={clock.map((t) => math.max(burstAt(t)?.ring.transparency ?? HIDDEN, dim))}
				/>
			</frame>,
		);
	}
	return outer(
		<>
			{ghostLabels}
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
			{burstLabels}
		</>,
	);
}
