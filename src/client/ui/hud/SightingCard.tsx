import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectInputDevice, selectSighting } from "client/store";
import { str } from "client/ui/theme";
import { HUD_TRANSIENT, HUD_VIEW, SIGHTING_CARD, TOUCH_SIGHTING_BOX } from "shared/view/hud";
import { screenSkin } from "shared/view/menu";
import { CodexChip } from "./CodexChip";
import { Panel, Row, Text } from "./primitives";
import { useTouchStrip } from "./touchStripContext";

/**
 * The first-sighting card (docs/ENEMY_VARIANTS.md EV12): the bestiary line of a new enemy / affix the account has not
 * seen (theme string `bestiary.<id>`), set and expired by SightingController. Not a top-centre toast: that panel hangs
 * over the far side of the room, right where the new enemy walks in. The card sits at the left edge under the status
 * panel (HUD_TRANSIENT.sighting, held out of HUD_CLEAR_ZONE by footprint.spec.ts); on touch at the safe area's top left
 * (TOUCH_SIGHTING_BOX), under the touch strip when the strip hangs below the top bar. It fades under the action on its
 * own occlusion slot (`sighting`, HudOcclusionController).
 *
 * The Codex (claude/codex-plan.md CX6): a card whose entry rose in the Codex this run wears the NEW! chip on a row above
 * its (unchanged) line; a codex toast (`codexId`: a first kill, a vault chest's relic, a boss down) is one line, the chip
 * then `{name} · Codex`. CX7's tile art for the entry goes before the chip there (the `codexId` hook); text only today.
 */
export function SightingCard() {
	const sighting = useSelector(selectSighting);
	const touch = useSelector(selectInputDevice) === "touch";
	const strip = useTouchStrip();
	if (sighting === undefined) return undefined;
	let top = touch ? TOUCH_SIGHTING_BOX.edge : HUD_TRANSIENT.sighting.edge;
	if (touch && strip !== undefined) {
		// The strip's fade group in KV_GameHud's reference px (above the safe area's top when it sits in the top bar).
		const stripBottom = (strip.group.y + strip.group.h - strip.hudOrigin.y) / strip.hudScale;
		top = math.max(top, stripBottom + HUD_VIEW.gap);
	}
	return (
		<Panel
			position={UDim2.fromOffset(HUD_VIEW.margin, top)}
			anchor={new Vector2(0, 0)}
			width={SIGHTING_CARD.width}
			fade="sighting"
			skin={screenSkin("toast")}
			name="Sighting"
		>
			{sighting.codexId !== undefined ? (
				<Row key={`c${sighting.id}`} order={1}>
					<CodexChip order={1} />
					<Text
						order={2}
						size={HUD_VIEW.smallText}
						color="uiAccent"
						text={str(sighting.key, { name: sighting.nameKey !== undefined ? str(sighting.nameKey) : "" })}
					/>
				</Row>
			) : (
				<>
					{sighting.codexNew === true ? <CodexChip key={`n${sighting.id}`} order={1} /> : undefined}
					<Text
						key={`s${sighting.id}`}
						order={2}
						size={HUD_VIEW.smallText}
						color="uiAccent"
						wrap={true}
						text={str(sighting.key)}
					/>
				</>
			)}
		</Panel>
	);
}
