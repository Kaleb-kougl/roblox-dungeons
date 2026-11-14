/**
 * The Credits screen (main menu > Credits): the third-party work the game ships, grouped by section. Required for the
 * CC BY works (the 3D kits and the Old Chest, CC BY 4.0; the fire loop, CC BY 3.0: credit where players see it, the
 * licence named with its address, and a note that it was changed) and the Dungeon Forge (MIT: its copyright notice
 * ships with every copy); the others ask for no credit and are listed anyway. Titles, names and licence names are
 * proper nouns and stay as written in every language (plain data, not theme strings); the section labels, "by {author}"
 * and the change note are strings. Keep this list in step with THIRD_PARTY_NOTICES.md.
 */

export type CreditSection = "art" | "models" | "audio" | "code";

/** Sections in screen order. */
export const CREDIT_SECTIONS: ReadonlyArray<CreditSection> = ["art", "models", "audio", "code"];

export interface CreditEntry {
	readonly section: CreditSection;
	/** The work's title, as its author publishes it. */
	readonly work: string;
	/** The author, with the store when the licence asks for the source. */
	readonly author: string;
	/** The licence line, when the licence wants it shown (its name, and its address for CC BY). */
	readonly license?: string;
	/** The work was changed (CC BY asks for the note). */
	readonly modified?: boolean;
}

export const CREDITS: ReadonlyArray<CreditEntry> = [
	{ section: "art", work: "Lords of Pain - Old School Isometric Assets", author: "Pupkin Assets" },
	{ section: "art", work: "2D Demons - TopDown", author: "SmallScaleInt" },
	{ section: "art", work: "HD 8-Directional Top-Down Character Pack 1 (Knight, Archer)", author: "SmallScaleInt" },
	{ section: "art", work: "UI User Interface Pack - Horror", author: "ToffeeCraft" },
	{ section: "art", work: "Ninja Adventure (effects)", author: "Pixel-boy", license: "CC0" },
	{ section: "art", work: "16Bit Bullets Asset Pack", author: "J i m", modified: true },
	{ section: "art", work: "Free Slimes Asset Pack", author: "heimlich3", modified: true },
	{
		section: "art",
		work: "Isometric Library, Isometric Dungeon",
		author: "Kenney (kenney.nl)",
		license: "CC0",
		modified: true,
	},
	{
		section: "models",
		work: "Dungeon Essential Kit",
		author: "Rakshaan (Sketchfab)",
		license: "CC BY 4.0 - creativecommons.org/licenses/by/4.0",
		modified: true,
	},
	{
		section: "models",
		work: "Dungeon Modular Set V2",
		author: "C. Anastasiadis (Sketchfab)",
		license: "CC BY 4.0 - creativecommons.org/licenses/by/4.0",
		modified: true,
	},
	{
		section: "models",
		work: "Dungeon Assets Pack",
		author: "zver.3d",
		license: "Free for games; credit to zver.3d requested",
		modified: true,
	},
	{
		section: "models",
		work: "Old Chest",
		author: "SebastianSosnowski (Sketchfab)",
		license: "CC BY 4.0 - creativecommons.org/licenses/by/4.0",
		modified: true,
	},
	{ section: "audio", work: "Ninja Adventure (sound and music)", author: "AAA", license: "CC0" },
	{ section: "audio", work: "Glass breaking", author: "DRAGON-STUDIO (Pixabay)" },
	{ section: "audio", work: "Lightning strike", author: "DRAGON-STUDIO (Pixabay)" },
	{ section: "audio", work: "Chomp", author: "Barnaby (Pixabay)" },
	{ section: "audio", work: "Swish swoosh woosh SFX 27", author: "Stereogenic Studio (Pixabay)" },
	{ section: "audio", work: "Power up 01a", author: "EdR (Pixabay)" },
	{ section: "audio", work: "Retro Coin 4", author: "Driken Stan (Pixabay)" },
	{ section: "audio", work: "Pick up sfx", author: "freesound_community (Pixabay)" },
	{ section: "audio", work: "Power down 02", author: "freesound_community (Pixabay)" },
	{ section: "audio", work: "Plate Break 1", author: "freesound_community (Pixabay)" },
	{ section: "audio", work: "Music Jingles", author: "Kenney (kenney.nl)", license: "CC0" },
	{
		section: "audio",
		work: "Level up, power up, Coin get",
		author: "wobbleboxx (WobbleBoxx Workshop)",
		license: "CC0",
	},
	{
		section: "audio",
		work: "Horror Stinger Sound Effects",
		author: "DHSFX",
		license: "Free for games; credit required - soundcloud.com/dhsfx",
		modified: true,
	},
	{
		section: "audio",
		work: "Fire Loop",
		author: "qubodup (OpenGameArt)",
		license: "CC BY 3.0 - creativecommons.org/licenses/by/3.0",
		modified: true,
	},
	{ section: "audio", work: "Impact Sounds", author: "Kenney (kenney.nl)", license: "CC0" },
	{
		section: "audio",
		work: "Their Coming (generic horn sound)",
		author: "StumpyStrust (OpenGameArt)",
		license: "CC0",
	},
	{ section: "audio", work: "open chest SFX", author: "Oiboo (OpenGameArt)", license: "CC0" },
	{ section: "audio", work: "Breaking Rock", author: "themightyglider (OpenGameArt)", license: "CC0" },
	{
		section: "audio",
		work: "8-Bit Sound Effects Library",
		author: "Little Robot Sound Factory (www.littlerobotsoundfactory.com)",
		license: "CC BY 3.0 - creativecommons.org/licenses/by/3.0",
		modified: true,
	},
	{
		section: "code",
		work: "Dungeon Forge (threejs-procedural-dungeon)",
		author: "Majid Manzarpour",
		license: "MIT License - Copyright (c) 2026 Majid Manzarpour",
	},
];

export const CREDIT_STRINGS = {
	/** Main menu button. */
	open: "menu.credits",
	title: "credits.title",
	/** "by {author}". */
	by: "credits.by",
	/** The note under a changed work. */
	modified: "credits.modified",
	section: {
		art: "credits.section.art",
		models: "credits.section.models",
		audio: "credits.section.audio",
		code: "credits.section.code",
	},
} as const;

/** One line of the Credits list, top to bottom. */
export type CreditLine =
	| { readonly kind: "section"; readonly key: string }
	| { readonly kind: "work"; readonly work: string; readonly author: string }
	| { readonly kind: "license"; readonly text: string }
	| { readonly kind: "modified" };

/** The Credits list: each section's label, then its works (title, author, licence line, change note). */
export function creditLines(credits: ReadonlyArray<CreditEntry> = CREDITS): Array<CreditLine> {
	const out = new Array<CreditLine>();
	for (const section of CREDIT_SECTIONS) {
		let first = true;
		for (const c of credits) {
			if (c.section !== section) continue;
			if (first) out.push({ kind: "section", key: CREDIT_STRINGS.section[section] });
			first = false;
			out.push({ kind: "work", work: c.work, author: c.author });
			if (c.license !== undefined) out.push({ kind: "license", text: c.license });
			if (c.modified === true) out.push({ kind: "modified" });
		}
	}
	return out;
}

/** Every string key the Credits screen reads (hud.spec.ts checks them, through menuStringKeys). */
export function creditStringKeys(): Array<string> {
	const keys: string[] = [CREDIT_STRINGS.open, CREDIT_STRINGS.title, CREDIT_STRINGS.by, CREDIT_STRINGS.modified];
	for (const s of CREDIT_SECTIONS) keys.push(CREDIT_STRINGS.section[s]);
	return keys;
}
