import { createProducer } from "@rbxts/reflex";
import { SOURCE_LOCALE, SOURCE_LOCALE_STATE, sameLocaleState, type LocaleState } from "shared/l10n";

/**
 * Client-local Reflex slice for the locale the client shows (docs/LOCALIZATION.md design 8, L6): its code, whether it
 * came from the Roblox language (Automatic), its script (fonts) and direction, plus `autoCode`, what Automatic picks
 * (Options > Language's "Automatic ({name})"), and `allowHidden`, whether the player may pick hidden locales (a
 * developer: Options lists them). LocaleController resolves it (the Options > Language override, the
 * player's Roblox locale ids, developer access) and dispatches it after switching the theme pack's strings; React
 * roots remount under LocaleRoot when the code changes, and controllers that build text outside React follow it
 * through client/ui/theme onLocaleChanged. Presentation only.
 */
export interface L10nState extends LocaleState {
	/** The locale Automatic resolves to (the code shown when no override applies). */
	readonly autoCode: string;
	/** Hidden locales may be picked (Studio, or a developer: DEV_MODE.allowedAttribute). */
	readonly allowHidden: boolean;
}

const initialState: L10nState = { ...SOURCE_LOCALE_STATE, autoCode: SOURCE_LOCALE, allowHidden: false };

/** Two slice states show the same thing. */
export function sameL10nState(a: Readonly<L10nState>, b: Readonly<L10nState>): boolean {
	return sameLocaleState(a, b) && a.autoCode === b.autoCode && a.allowHidden === b.allowHidden;
}

export const l10nSlice = createProducer(initialState, {
	/** The resolved locale (no change, no new state: subscribers fire only on a real switch). */
	setLocaleState: (state: L10nState, to: L10nState): L10nState => (sameL10nState(state, to) ? state : { ...to }),
});

export const selectL10n = (state: { l10n: L10nState }) => state.l10n;
export const selectLocaleCode = (state: { l10n: L10nState }) => state.l10n.code;
