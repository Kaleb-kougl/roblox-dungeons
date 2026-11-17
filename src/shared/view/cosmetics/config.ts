/**
 * Tunables of cosmetics on screen (docs/COSMETICS.md CS5-CS7; logic in looks.ts and preview.ts). Presentation only:
 * nothing here reaches the sim, the lockstep wire, a hash or the wallet. Roblox-port choices, no web source.
 */
export const COSMETIC_VIEW = {
	/** The largest channel value: colours are written as whole 0..255 channels (a Prismatic dye only on a change). */
	channelMax: 255,
	/** The Armory's live preview (CS6). */
	preview: {
		/** The preview box, reference px: desktop, and a landscape phone / upright (smaller, the detail sheet scrolls). */
		box: 112,
		compactBox: 80,
		/** Seconds per facing while the preview turns (every facing of the set, in turn order). */
		facingSec: 1.2,
		/** The swatch chip shown beside the preview (a trail / spark / outline colour; a dye whose sheet is not in). */
		swatch: 18,
		/** The bought row's flash: seconds and the stamp's scale at its start (eased back to 1). */
		flashSec: 0.6,
		flashScale: 1.15,
	},
	/** A row's swatch on the Cosmetics tab, reference px. */
	rowSwatch: 16,
	/** The lobby row's dye chip (CS7): its side as a share of the character icon, at the icon's bottom-right corner. */
	lobbyChipShare: 0.42,
} as const;
