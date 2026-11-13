import React, { useBinding, useEffect } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectJuice } from "client/store";
import { role, str, textSizeFor, useHudFont, useUiFonts } from "client/ui/theme";
import { CODEX_CHIP, CODEX_HUD_STRINGS, codexChipScale } from "shared/view/codex";
import { HUD_VIEW } from "shared/view/hud";

const HIDDEN = 1;
const CHIP_ROUND = new UDim(0, 3);

/**
 * The Codex's NEW! chip (claude/codex-plan.md CX6, R14): `hud.codex.new` in the background colour on a `uiAccent` pill,
 * at the left of a decorated toast, a first-sighting card or a codex toast. It pops in once when mounted (CODEX_CHIP:
 * scale popScale -> 1 over popSeconds); under Reduced motion it simply appears. Silent (CXD12).
 */
export function CodexChip(props: { order: number; size?: number }) {
	const reduced = useSelector(selectJuice).reducedMotion;
	const font = useHudFont();
	const fonts = useUiFonts();
	const [scale, setScale] = useBinding(codexChipScale(0, reduced));
	useEffect(() => {
		const start = os.clock();
		setScale(codexChipScale(0, reduced));
		if (reduced) return;
		const conn = RunService.RenderStepped.Connect(() => {
			const elapsed = os.clock() - start;
			setScale(codexChipScale(elapsed, false));
			if (elapsed >= CODEX_CHIP.popSeconds) conn.Disconnect();
		});
		return () => conn.Disconnect();
	}, [reduced]);
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundColor3={role("uiAccent")}
			BorderSizePixel={0}
		>
			<uicorner CornerRadius={CHIP_ROUND} />
			<uiscale Scale={scale} />
			<uipadding
				PaddingLeft={new UDim(0, CODEX_CHIP.padX)}
				PaddingRight={new UDim(0, CODEX_CHIP.padX)}
				PaddingTop={new UDim(0, CODEX_CHIP.padY)}
				PaddingBottom={new UDim(0, CODEX_CHIP.padY)}
			/>
			<textlabel
				Size={new UDim2()}
				AutomaticSize={Enum.AutomaticSize.XY}
				BackgroundTransparency={HIDDEN}
				Font={font}
				TextSize={textSizeFor(fonts, props.size ?? HUD_VIEW.smallText)}
				TextColor3={role("background")}
				Text={str(CODEX_HUD_STRINGS.chip)}
			/>
		</frame>
	);
}
