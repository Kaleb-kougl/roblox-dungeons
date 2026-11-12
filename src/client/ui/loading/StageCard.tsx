import React, { useEffect, useMemo, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectStageCover } from "client/store";
import { ArtImage, Text, useHudScale } from "client/ui/hud";
import { str, textSizeFor, uiImage, useUiArt, useUiFonts } from "client/ui/theme";
import { LOADING_STRINGS, LOADING_VIEW, STAGE_STRINGS, STAGE_VIEW, modifierCardRows } from "shared/view";
import { HUD_VIEW, NEW_BEST_ROLE } from "shared/view/hud";
import { Cover, ProgressBar } from "./parts";

const HALF = 0.5;
const HIDDEN = 1;
/** Text box height = text size + this (the Text primitive's room for the stroke). */
const LINE_SLACK = 4;
/** The column's rows in order (the banner after the boss row, before the second line). */
const ROW = { title: 1, biome: 2, boss: 3, banner: 4, line: 5 } as const;
/** The run-start cover's rows. */
const START_ROW = { label: 1, bar: 2, assets: 3, banner: 4, line: 5 } as const;

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
	/**
	 * The floor modifier banner's text transparency (docs/FLOOR_MODIFIERS.md FM5: shared/view modifierBannerLook times
	 * the cover's fade) and its stamp's scale, both set by StageController every frame.
	 */
	readonly bannerTransparency: React.Binding<number>;
	readonly bannerScale: React.Binding<number>;
}

/**
 * The floor modifier banner (docs/FLOOR_MODIFIERS.md FM5, shared/view modifierCardRows): the kind's name in its colour
 * role (`floorMod.<key>`: gold boons, the blood-red twist) at HUD_VIEW.titleText, the kind's icon left of it when the
 * pack has the art (`ui.floormod.<key>`, all or none), and its line under it in uiText. The stamp scales the two rows
 * through a UIScale inside a box of their resting height, so the rows around the banner never move while it lands.
 */
function ModifierBanner(props: {
	order: number;
	kind: number;
	width: number;
	transparency: React.Binding<number>;
	scale: React.Binding<number>;
}) {
	useUiArt();
	const fonts = useUiFonts();
	const rows = modifierCardRows(props.kind);
	if (rows === undefined) return undefined;
	const nameH = textSizeFor(fonts, HUD_VIEW.titleText) + LINE_SLACK;
	const lineH = textSizeFor(fonts, HUD_VIEW.textSize) + LINE_SLACK;
	const icon = uiImage(rows.iconId) !== undefined;
	return (
		<frame
			key="Banner"
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, nameH + STAGE_VIEW.gap + lineH)}
			BackgroundTransparency={HIDDEN}
		>
			<frame
				key="Stamp"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
			>
				<uiscale Scale={props.scale} />
				<uilistlayout
					FillDirection={Enum.FillDirection.Vertical}
					HorizontalAlignment={Enum.HorizontalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, STAGE_VIEW.gap)}
				/>
				<frame
					key="Name"
					LayoutOrder={1}
					Size={new UDim2(0, 0, 0, nameH)}
					AutomaticSize={Enum.AutomaticSize.X}
					BackgroundTransparency={HIDDEN}
				>
					<uilistlayout
						FillDirection={Enum.FillDirection.Horizontal}
						HorizontalAlignment={Enum.HorizontalAlignment.Center}
						VerticalAlignment={Enum.VerticalAlignment.Center}
						SortOrder={Enum.SortOrder.LayoutOrder}
						Padding={new UDim(0, HUD_VIEW.gap)}
					/>
					{icon ? (
						<ArtImage
							key="Icon"
							name="Icon"
							order={1}
							id={rows.iconId}
							box={{ w: nameH, h: nameH }}
							transparency={props.transparency}
						/>
					) : undefined}
					<Text
						key="Text"
						order={2}
						size={HUD_VIEW.titleText}
						color={rows.role}
						transparency={props.transparency}
						text={str(rows.nameKey)}
					/>
				</frame>
				<Text
					key="Line"
					order={2}
					width={props.width}
					color="uiText"
					align={Enum.TextXAlignment.Center}
					transparency={props.transparency}
					text={str(rows.lineKey)}
				/>
			</frame>
		</frame>
	);
}

/**
 * The stage loader's cover (docs/STAGE_LOADER.md SL5), its own ScreenGui on the join loading screen's order
 * (LOADING_VIEW.displayOrder: the two never overlap; IgnoreGuiInset, so the opaque `background` reaches under the top
 * bar), the same look (the shared Cover and ProgressBar, SD6). Reads the Reflex `stage` slice; the ScreenGui is only
 * Enabled while a cover is up (the `visible` binding). Centre column under the HUD's UIScale (useHudScale):
 *
 *   run start    the label (`stage.starting` "Starting run...", `stage.forging` "Forging floor {floor}...",
 *                `stage.building` "Building...") over a slim bar (STAGE_VIEW.barHeight, StageLoad.fraction), during the
 *                asset soft wait (docs/STAGE_ASSETS.md SA5 / SA19, only past showProgressAfterSec with something
 *                missing) the join screen's `loading.progress` "Loading {done} / {total}" and, once the run is built,
 *                floor 1's seeded roster under it (docs/DAILY.md DS2: `Swarmer · Bruiser`)
 *   floor change the card: `stage.floorCard` ("Floor 4") in big text, the biome line (`biome.<n>.name`, "Ancient
 *                Halls"), on a boss floor `stage.bossFloor` ("Boss floor") and one second line (shared/view/hud
 *                stageCardLine, docs/DAILY.md DSD13): the roster's `New: Imp` on a floor where kinds join, else, on a
 *                ranked run with a floor record, the new-best line (docs/NEW_BEST.md NB8: `Deepest: floor 9 · 2 to
 *                go`, `Record floor`, `NEW DEEPEST` / `Deepest yet` in the newBest gold; NEW DEEPEST outranks the
 *                roster); no bar. On a floor modifier's floor (docs/FLOOR_MODIFIERS.md FM5, the slice's `modifier`) the
 *                banner between the boss row and that line: the name (`Gilded`, in its role) over its line (`A
 *                Goldling is certain`), stamped in by the `bannerTransparency` / `bannerScale` bindings
 *                (ModifierBanner); a run start past floor 1 (a dev run) shows it under the bar, before the roster line
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
	const banner = (order: number, kind: number) => (
		<ModifierBanner
			key="Banner"
			order={order}
			kind={kind}
			width={width}
			transparency={props.bannerTransparency}
			scale={props.bannerScale}
		/>
	);
	if (stage.card) {
		rows.push(
			<Text
				key="Title"
				order={ROW.title}
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
					order={ROW.biome}
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
					order={ROW.boss}
					width={width}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(STAGE_STRINGS.bossFloor)}
				/>,
			);
		}
		if (stage.modifier !== undefined) {
			rows.push(banner(ROW.banner, stage.modifier));
		}
		const line = stage.line;
		if (line !== undefined) {
			rows.push(
				<Text
					key="Line"
					order={ROW.line}
					width={width}
					color={line.gold ? NEW_BEST_ROLE : "uiTextDim"}
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(line.key, line.args)}
				/>,
			);
		}
	} else {
		rows.push(
			<Text
				key="Label"
				order={START_ROW.label}
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
				order={START_ROW.bar}
				width={width}
				height={STAGE_VIEW.barHeight}
				fraction={stage.fraction}
				transparency={fade}
			/>,
		);
		const assets = stage.assets;
		if (assets !== undefined) {
			rows.push(
				<Text
					key="Assets"
					order={START_ROW.assets}
					width={width}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(LOADING_STRINGS.progress, { done: assets.done, total: assets.total })}
				/>,
			);
		}
		if (stage.modifier !== undefined) {
			rows.push(banner(START_ROW.banner, stage.modifier));
		}
		const line = stage.line;
		if (line !== undefined) {
			rows.push(
				<Text
					key="Line"
					order={START_ROW.line}
					width={width}
					color={line.gold ? NEW_BEST_ROLE : "uiTextDim"}
					align={Enum.TextXAlignment.Center}
					transparency={fade}
					text={str(line.key, line.args)}
				/>,
			);
		}
	}

	return (
		<screengui
			key="KV_Stage"
			ref={guiRef}
			ResetOnSpawn={false}
			AutoLocalize={false}
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
