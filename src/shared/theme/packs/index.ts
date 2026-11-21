/**
 * The bundled theme packs, by pack id (the folder name). Add a pack: create
 * `packs/<id>/manifest.ts` exporting a ThemeManifest (copy `placeholder/` as a start), add a barrel,
 * and register it here. `npm test` validates every pack listed (pack.spec.ts).
 *
 * @module
 */
import { PLACEHOLDER_MANIFEST } from "./placeholder";
import { VALE_MANIFEST } from "./vale";
import type { ThemeManifest } from "../types";

/**
 * The bundled packs by pack id, the default set `loadThemePack` and `listThemePacks` choose from. A key must equal its
 * manifest's `id` (the validator checks it at load). Nothing reads the key order (`listThemePacks` sorts).
 */
export const THEME_PACKS: Readonly<Record<string, ThemeManifest>> = {
	placeholder: PLACEHOLDER_MANIFEST,
	vale: VALE_MANIFEST,
};
