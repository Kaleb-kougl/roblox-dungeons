import React, { useBinding, useEffect } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import {
	selectJuice,
	selectRunInfo,
	selectSilverRun,
	selectVerdict,
	selectWallet,
	selectWalletGrants,
} from "client/store";
import { str } from "client/ui/theme";
import { SILVER_ROLE } from "shared/theme";
import { HUD_VIEW } from "shared/view/hud";
import {
	SILVER_RECAP,
	silverCountUp,
	silverRecapLines,
	silverRecapModel,
	type SilverRecapLayout,
	type SilverRecapRow,
} from "shared/view/silver";
import { Text } from "./primitives";

const HIDDEN = 1;
/** Between two rows of one line. */
const CELL_GAP = 16;

/** One row's text: the run row's number counting up (its `silver` var from the binding), the rest as they are. */
function RowText(props: { order: number; row: SilverRecapRow; count: React.Binding<number>; dim: boolean }) {
	const r = props.row;
	const color = r.id === "goal" ? "uiTextDim" : SILVER_ROLE;
	const transparency = props.dim ? SILVER_RECAP.dimTransparency : 0;
	return (
		<Text
			key={r.id}
			order={props.order}
			size={HUD_VIEW.smallText}
			color={color}
			transparency={transparency}
			text={r.id === "run" ? props.count.map((n) => str(r.key, { ...r.vars, silver: n })) : str(r.key, r.vars)}
		/>
	);
}

/**
 * The run-over panel's Silver rows (docs/SILVER.md SV8, "Run over"; shared/view/silver silverRecapModel): two rows a
 * line (SILVER_RECAP.perLine), centred: `Silver +46` counting up, the bonus / top-up / Prospector rows only when they apply (compact: one
 * `Bonuses +N`), `Total 310` and the next goal's `to go`; dimmed while they are the client's own figures, settled by
 * the verdict's prediction and then the wallet's grant for the run; `No Silver: unranked run` for a run that cannot
 * pay. Nothing for the tutorial, dev runs, M1 or a run the client froze no figures for (SilverHudController).
 */
export function SilverRecapBlock(props: { order: number; layout: SilverRecapLayout; width: number }) {
	const compact = props.layout === "compact";
	const silverRun = useSelector(selectSilverRun);
	const info = useSelector(selectRunInfo);
	const verdict = useSelector(selectVerdict);
	const grants = useSelector(selectWalletGrants);
	const wallet = useSelector(selectWallet);
	const reduced = useSelector(selectJuice).reducedMotion;
	const [count, setCount] = useBinding(0);
	const current = silverRun !== undefined && silverRun.run === info.run;
	const verdictMine = verdict.run === info.run;
	const runId = silverRun?.runId ?? (verdictMine ? verdict.runId : undefined);
	const model = current
		? silverRecapModel(
				{
					paidWorld: silverRun.paidWorld,
					pays: silverRun.pays,
					verdict: verdictMine ? verdict.status : "pending",
					client: silverRun.client,
					predicted: verdictMine ? verdict.silver : undefined,
					settled: runId !== undefined ? grants.get(runId) : undefined,
					goals: wallet?.goals,
					compact,
				},
				str,
		  )
		: undefined;
	const target = model !== undefined && model.kind === "rows" ? model.runAmount : 0;
	useEffect(() => {
		let t = 0;
		setCount(silverCountUp(0, target, reduced));
		if (reduced || target <= 0) return;
		const conn = RunService.Heartbeat.Connect((dt) => {
			t += dt;
			setCount(silverCountUp(t, target, false));
		});
		return () => conn.Disconnect();
	}, [target, reduced]);
	if (model === undefined || model.kind === "hidden") return undefined;
	if (model.kind === "none") {
		return (
			<Text
				key="SilverNone"
				order={props.order}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={str(model.key)}
			/>
		);
	}
	const lines = silverRecapLines(model.rows, props.layout);
	return (
		<frame
			key="Silver"
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, compact ? 0 : HUD_VIEW.gap / 2)}
			/>
			{lines.map((line, i) => (
				<frame
					key={`Line${i}`}
					LayoutOrder={i + 1}
					Size={new UDim2()}
					AutomaticSize={Enum.AutomaticSize.XY}
					BackgroundTransparency={HIDDEN}
				>
					<uilistlayout
						FillDirection={Enum.FillDirection.Horizontal}
						VerticalAlignment={Enum.VerticalAlignment.Center}
						SortOrder={Enum.SortOrder.LayoutOrder}
						Padding={new UDim(0, CELL_GAP)}
					/>
					{line.map((row, j) => (
						<RowText key={row.id} order={j + 1} row={row} count={count} dim={model.dim} />
					))}
				</frame>
			))}
		</frame>
	);
}
