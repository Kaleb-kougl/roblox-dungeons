import React from "@rbxts/react";
import { role, themePack } from "client/ui/theme";
import { CHARACTER_ICON_VIEW, characterIcon } from "shared/view/hud";
import { ArtImage } from "./primitives";

/**
 * A character's icon beside a name (docs/ARCHER.md AR9; shared/view/hud characterIcon): the pack's `ui.character.<id>`
 * art fitted into a `size` square, else a flat square in the character's class colour (outlined uiTextDim). Nothing
 * for a value that is no character id (an older board entry, a run built without characters).
 */
export function CharacterIcon(props: {
	character: unknown;
	size: number;
	order?: number;
	position?: UDim2;
	anchor?: Vector2;
	transparency?: number;
}) {
	const icon = characterIcon(props.character, (id) => themePack()?.image(id) !== undefined);
	if (icon === undefined) return undefined;
	const t = props.transparency ?? 0;
	const square = (
		<frame
			key="CharacterIcon"
			LayoutOrder={props.order ?? 0}
			Position={props.position ?? new UDim2()}
			AnchorPoint={props.anchor ?? new Vector2()}
			Size={UDim2.fromOffset(props.size, props.size)}
			BackgroundColor3={role(icon.role)}
			BackgroundTransparency={t}
			BorderSizePixel={0}
		>
			<uistroke Thickness={CHARACTER_ICON_VIEW.stroke} Color={role("uiTextDim")} Transparency={t} />
		</frame>
	);
	if (icon.art === undefined) return square;
	return (
		<ArtImage
			name="CharacterIcon"
			id={icon.art}
			box={new Vector2(props.size, props.size)}
			order={props.order}
			position={props.position}
			anchor={props.anchor}
			transparency={t > 0 ? t : undefined}
			fallback={square}
		/>
	);
}

/** Whether `character` draws an icon (CharacterIcon renders something), for a row's layout. */
export function hasCharacterIcon(character: unknown): boolean {
	return characterIcon(character, () => false) !== undefined;
}
