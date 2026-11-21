import React, { useRef } from "@rbxts/react";
import { useFocusScope, type FocusScopeOptions } from "./scope";

/**
 * `FocusScope`'s props: a focus scope's options (its id, layer, pad surface, default button, memory and pad handler:
 * see `FocusScopeOptions`) plus the root frame's name and the surface to wrap.
 */
export interface FocusScopeProps extends FocusScopeOptions {
	/** The root frame's Name (memory paths and LocaleRoot's selection paths run through it). */
	readonly name: string;
	readonly children?: React.ReactNode;
}

/**
 * A focus scope around a surface that has no root frame of its own (a menu screen's MenuFit, the run-over panel, the
 * invite toasts): a transparent frame filling its parent (so MenuFit measures the same area) registered with
 * useFocusScope.
 */
export function FocusScope(props: FocusScopeProps) {
	const rootRef = useRef<Frame>();
	useFocusScope(rootRef, props);
	return (
		<frame
			key={props.name}
			ref={rootRef}
			Size={UDim2.fromScale(1, 1)}
			BackgroundTransparency={1}
			BorderSizePixel={0}
		>
			{props.children}
		</frame>
	);
}
