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

export const THEME_PACKS: Readonly<Record<string, ThemeManifest>> = {
	placeholder: PLACEHOLDER_MANIFEST,
	vale: VALE_MANIFEST,
};
