import React, { useEffect, useMemo, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectStageCover } from "client/store";
import { Text, useHudScale } from "client/ui/hud";
import { str } from "client/ui/theme";
import { LOADING_VIEW, STAGE_STRINGS, STAGE_VIEW } from "shared/view";
import { HUD_VIEW, NEW_BEST_ROLE } from "shared/view/hud";
import { Cover, ProgressBar } from "./parts";

const HALF = 0.5;
const HIDDEN = 1;

export interface StageCardProps {
	/** The ScreenGui's Enabled (StageController sets it synchronously at the cut and at the end). */
	readonly visible: React.Binding<boolean>;
	/** The cover's opacity in [0, 1] (StageController sets it every frame from StageLoad.coverOpacity). */
	readonly opacity: React.Binding<number>;
	/**
	 * The serial of the stage load on screen (set synchronously at the cut): the label rows only show once the Reflex
	 * `stage` slice has caught up with it, so the cut's first frame never shows the previous cover's text.
	 */
	readonly serial: React.Binding<number>;
	/** The slice's cover for load `serial` was committed (a fallback report: StageController reads the ScreenGui itself). */
	readonly onCovered: (serial: number) => void;
	/** The mounted ScreenGui (StageController reads its Enabled back at the cut). */
	readonly onGui: (gui: ScreenGui | undefined) => void;
}

/**
 * The stage loader's cover (docs/STAGE_LOADER.md SL5), its own ScreenGui on the join loading screen's order
 * (LOADING_VIEW.displayOrder: the two never overlap; IgnoreGuiInset, so the opaque `background` reaches under the top
 * bar), the same look (the shared Cover and ProgressBar, SD6). Reads the Reflex `stage` slice; the ScreenGui is only
 * Enabled while a cover is up (the `visible` binding). Centre column under the HUD's UIScale (useHudScale):
 *
 *   run start    the label (`stage.starting` "Starting run...", `stage.forging` "Forging floor {floor}...",
 *                `stage.building` "Building...") over a slim bar (STAGE_VIEW.barHeight, StageLoad.fraction)
 *   floor change the card: `stage.floorCard` ("Floor 4") in big text, the biome line (`biome.<n>.name`, "Ancient
 *                Halls"), on a boss floor `stage.bossFloor` ("Boss floor") and, on a ranked run with a floor record,
 *                the new-best line (docs/NEW_BEST.md NB8: `Deepest: floor 9 · 2 to go`, `Record floor`, `NEW DEEPEST`
 *                / `Deepest yet` in the newBest gold); no bar
 *
 * Drawn in the frame of the cut: Enabled, the fade and the rows' visibility are bindings StageController sets
 * synchronously (the slice reaches React only on Reflex's Heartbeat flush, after that frame's render), so the first
 * frame shows the bare opaque cover and the text follows a frame later. The fade is the `opacity` binding (no
 * re-render per frame; a cut under reduced motion). `onGui` hands the ScreenGui over on mount, `onCovered(serial)`
 * reports a committed cover (fallback). The cover is Active, so clicks and taps go nowhere; keys and the pad are kept
 * from the game by selectMenuOpen (client/store), which also keeps the gamepad selection off the layers under it.
 */
export function StageCard(props: StageCardProps) {
	const stage = useSelector(selectStageCover);
	const scale = useHudScale();
	const guiRef = useRef<ScreenGui>();
	const fade = useMemo(() => props.opacity.map((o) => 1 - o), [props.opacity]);
	const rowsVisible = useMemo(
		() => props.serial.map((s) => stage.shown && s === stage.serial),
		[props.serial, stage.shown, stage.serial],
	);

	useEffect(() => {
		props.onGui(guiRef.current);
		return () => props.onGui(undefined);
	}, []);

	useEffect(() => {
		if (stage.shown && !stage.revealing) props.onCovered(stage.serial);
	}, [stage.shown, stage.serial]);

	const width = STAGE_VIEW.width;
	const rows = new Array<React.Element>();
	if (stage.card) {
		rows.push(
			<Text
				key="Title"
				order={1}
				width={width}
				size={HUD_VIEW.bigText}
				color="uiAccent"
				align={Enum.TextXAlignment.Center}
				transparency={fade}
				text={str(stage.labelKey, { floor: stage.floor })}
			/>,
		);
		if (stage.biomeKey !== "") {
			rows.push(
				<Text
					key="Biome"
					order={2}
					width={width}
					color="uiText"
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(stage.biomeKey)}
				/>,
			);
		}
		if (stage.boss) {
			rows.push(
				<Text
					key="Boss"
					order={3}
					width={width}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(STAGE_STRINGS.bossFloor)}
				/>,
			);
		}
		const best = stage.best;
		if (best !== undefined) {
			rows.push(
				<Text
					key="Best"
					order={4}
					width={width}
					color={best.gold ? NEW_BEST_ROLE : "uiTextDim"}
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(best.key, best.args)}
				/>,
			);
		}
	} else {
		rows.push(
			<Text
				key="Label"
				order={1}
				width={width}
				color="uiAccent"
				align={Enum.TextXAlignment.Center}
				transparency={fade}
				text={stage.labelKey !== "" ? str(stage.labelKey, { floor: stage.floor }) : ""}
			/>,
		);
		rows.push(
			<ProgressBar
				key="Bar"
				order={2}
				width={width}
				height={STAGE_VIEW.barHeight}
				fraction={stage.fraction}
				transparency={fade}
			/>,
		);
	}

	return (
		<screengui
			key="KV_Stage"
			ref={guiRef}
			ResetOnSpawn={false}
			Enabled={props.visible}
			DisplayOrder={LOADING_VIEW.displayOrder}
			IgnoreGuiInset={true}
			ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
		>
			<Cover transparency={fade} />
			<frame
				key="Column"
				Visible={rowsVisible}
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={new UDim2(0, width, 0, 0)}
				AutomaticSize={Enum.AutomaticSize.Y}
				BackgroundTransparency={HIDDEN}
			>
				<uiscale Scale={scale} />
				<uilistlayout
					FillDirection={Enum.FillDirection.Vertical}
					HorizontalAlignment={Enum.HorizontalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, STAGE_VIEW.gap)}
				/>
				{rows}
			</frame>
		</screengui>
	);
}
