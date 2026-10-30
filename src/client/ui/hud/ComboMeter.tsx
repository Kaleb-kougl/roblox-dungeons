import React, { useMemo } from "@rbxts/react";
import { role } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import {
	COMBO_BROKEN_ROLE,
	COMBO_DRAW,
	COMBO_VIEW,
	HUD_VIEW,
	comboShardAt,
	comboShardWidth,
	type ComboShardLook,
} from "shared/view/hud";
import { COMBO_METER_Z, COMBO_UI } from "./comboUi";

const HIDDEN = 1;
const HALF = 0.5;
const STROKE = 1;
/** Inside the meter: the fill, the flash over it, the shards over both. */
const FLASH_Z = 2;
const SHARDS_Z = 3;

const FILL_SIZE = COMBO_UI.fill.binding.map((f) => UDim2.fromScale(f, 1));
const FILL_TRANSPARENCY = COMBO_UI.dim.binding.map((d) => (d ? COMBO_DRAW.dimTransparency : 0));
const FLASH_TRANSPARENCY = COMBO_UI.flashAlpha.binding.map((a) => HIDDEN - a);
const SHARDS_VISIBLE = COMBO_UI.shards.binding.map((u) => u >= 0);
/** Every shard is 1 / shards of the whole track (never sized from the fill: it is empty at a break). */
const SHARD_SIZE = UDim2.fromScale(comboShardWidth(COMBO_VIEW.break.shards), 1);

/** One shard's bindings (mapped once at load: the sources are module-level). */
interface ShardBindings {
	readonly position: React.Binding<UDim2>;
	readonly rotation: React.Binding<number>;
	readonly transparency: React.Binding<number>;
}

function shardBindings(i: number): ShardBindings {
	const n = COMBO_VIEW.break.shards;
	const look: ComboShardLook = { xScale: 0, dxPx: 0, dyPx: 0, rotationDeg: 0, transparency: 0 };
	const source = COMBO_UI.shards.binding;
	return {
		position: source.map((u) => {
			const l = comboShardAt(i, n, u, look);
			return new UDim2(l.xScale, l.dxPx, HALF, l.dyPx);
		}),
		rotation: source.map((u) => comboShardAt(i, n, u, look).rotationDeg),
		transparency: source.map((u) => comboShardAt(i, n, u, look).transparency),
	};
}

const SHARDS: ReadonlyArray<ShardBindings> = (() => {
	const out = new Array<ShardBindings>();
	for (let i = 0; i < COMBO_VIEW.break.shards; i++) out.push(shardBindings(i));
	return out;
})();

/**
 * Score panel row 4 (docs/COMBO.md CB6): the combo meter, HUD_VIEW.comboBarHeight tall (CB5). The fill drains per frame
 * from the combo timer (ComboController), in the tier colour (lerp toward combo.broken on a break / lapse, brightened
 * by CARNAGE / DOMINATING's pulse), dimmed by the warning blink; a flash overlay over the whole meter (uiText on a tier
 * up, uiHealth on a crack). The track (the meter's own background, uiPanel) greys toward combo.broken by
 * COMBO_UI.trackGrey: at once on a break, faded in by a lapse (the fill is empty by then: the timer ran out). On a full
 * break the WHOLE track shatters: COMBO_VIEW.break.shards frames, each 1 / shards of the track's width, in the lost
 * tier's colour, fly out, turn and fade (comboShardAt) over the grey track. They are children of the meter frame,
 * absolutely placed (the panel's UIListLayout only arranges the meter itself), drawn over the fill and, by the meter's
 * ZIndex, over row 5; the corner CanvasGroup clips anything past the panel's edge. Every per-frame property is a
 * COMBO_UI binding.
 */
export function ComboMeter(props: { readonly order: number; readonly width: number }) {
	const panel = role("uiPanel");
	const broken = role(COMBO_BROKEN_ROLE as ColorRole);
	const trackColor = useMemo(
		() => COMBO_UI.trackGrey.binding.map((g) => (g > 0 ? panel.Lerp(broken, math.min(g, 1)) : panel)),
		[panel, broken],
	);
	const shards = new Array<React.Element>();
	for (let i = 0; i < SHARDS.size(); i++) {
		const b = SHARDS[i];
		shards.push(
			<frame
				key={`Shard${i}`}
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={b.position}
				Size={SHARD_SIZE}
				Rotation={b.rotation}
				BackgroundColor3={COMBO_UI.shardColor.binding}
				BackgroundTransparency={b.transparency}
				BorderSizePixel={0}
			/>,
		);
	}
	return (
		<frame
			key="ComboMeter"
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, HUD_VIEW.comboBarHeight)}
			BackgroundColor3={trackColor}
			BorderSizePixel={0}
			ZIndex={COMBO_METER_Z}
		>
			<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
			<frame
				key="Fill"
				Size={FILL_SIZE}
				BackgroundColor3={COMBO_UI.fillColor.binding}
				BackgroundTransparency={FILL_TRANSPARENCY}
				BorderSizePixel={0}
			/>
			<frame
				key="Flash"
				Size={UDim2.fromScale(1, 1)}
				BackgroundColor3={COMBO_UI.flashColor.binding}
				BackgroundTransparency={FLASH_TRANSPARENCY}
				BorderSizePixel={0}
				ZIndex={FLASH_Z}
			/>
			<frame
				key="Shards"
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				Visible={SHARDS_VISIBLE}
				ZIndex={SHARDS_Z}
			>
				{shards}
			</frame>
		</frame>
	);
}
