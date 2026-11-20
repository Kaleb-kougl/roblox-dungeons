/**
 * Data for the localization spike L0 (docs/LOCALIZATION.md L0, docs/SPIKES.md "Spike L0"): the font candidates, one
 * glyph sample per locale / script, a longer wrapped sample per script, and the AutoLocalize probe string. Plain data
 * (headless-safe); the client spike resolves the font names to Enum.Font and draws the sheet.
 *
 * The samples are glyph tests, not shipped strings: they never go through the string tables.
 *
 * @module
 */

/** The scripts the sheet covers (docs/LOCALIZATION.md design 1; `pseudo` is the pseudo-locale's brackets and NBSP). */
export const L10N_SPIKE_SCRIPTS = [
	"latin",
	"cyrillic",
	"japanese",
	"korean",
	"hans",
	"hant",
	"thai",
	"devanagari",
	"arabic",
	"pseudo",
] as const;
/**
 * The script a localization spike sample is tagged with (an `L10N_SPIKE_SCRIPTS` member). Finer than the game's own
 * locale scripts: Japanese, Korean and the two Chinese scripts are separate here, and the pseudo-locale has its own.
 */
export type L10nSpikeScript = (typeof L10N_SPIKE_SCRIPTS)[number];

/** The nine Latin-script locales whose accents the sheet checks one by one. */
export const L10N_SPIKE_LATIN_LOCALES = ["es", "pt", "fr", "de", "it", "pl", "tr", "id", "vi"] as const;

/**
 * Enum.Font names to compare, one sheet row each: the HUD's pixel font (Arcade) and mono font (Code), Roblox's UI font
 * (BuilderSans), and plausible fallbacks with wide coverage (SourceSans, GothamMedium, Ubuntu, Roboto).
 */
export const L10N_SPIKE_FONTS = ["Arcade", "Code", "BuilderSans", "SourceSans", "GothamMedium", "Ubuntu", "Roboto"];

/** One glyph-sheet column: a locale (or script) and a short line with its special characters. */
export interface L10nSpikeSample {
	readonly id: string;
	readonly script: L10nSpikeScript;
	readonly glyphs: string;
}

/** No-break space (U+00A0): the pseudo-locale pads with it, and French puts it before ! ? : ; and inside « ». */
export const NBSP = " ";

/** Glyph-sheet columns, in order. */
export const L10N_SPIKE_SAMPLES: ReadonlyArray<L10nSpikeSample> = [
	{ id: "es", script: "latin", glyphs: "¿Otra vez? ¡Sí! Mañana, más daño Ñ" },
	{ id: "pt", script: "latin", glyphs: "Corações, ações, pão, lição Ã Õ Ç" },
	{ id: "fr", script: "latin", glyphs: `«${NBSP}Élan${NBSP}», très, fenêtre, ça, cœur Œ` },
	{ id: "de", script: "latin", glyphs: "Größe, Übung, Äpfel, schön, Fuß" },
	{ id: "it", script: "latin", glyphs: "È già così, più città, perché" },
	{ id: "pl", script: "latin", glyphs: "Zażółć gęślą jaźń, Łódź, Ćma, Śląsk" },
	{ id: "tr", script: "latin", glyphs: "Işık İstanbul ğ ı İ ş ç ö ü Ğ Ş" },
	{ id: "id", script: "latin", glyphs: "Mainkan lagi, nyawa, skor tertinggi" },
	{ id: "vi", script: "latin", glyphs: "ạ ả ấ ầ ẩ ẫ ậ ơ ư đ ề Đ Chơi lại" },
	{ id: "ru", script: "cyrillic", glyphs: "Съешь же ещё этих мягких булок Ёё" },
	{ id: "ja", script: "japanese", glyphs: "もう一度プレイ？ハイスコア・騎士の剣" },
	{ id: "ko", script: "korean", glyphs: "다시 하기? 최고 점수, 기사의 검" },
	{ id: "zh-hans", script: "hans", glyphs: "再玩一次？最高分：骑士之剑" },
	{ id: "zh-hant", script: "hant", glyphs: "再玩一次？最高分：騎士之劍" },
	{ id: "th", script: "thai", glyphs: "เล่นอีกครั้ง? คะแนนสูงสุด อัศวิน" },
	{ id: "hi", script: "devanagari", glyphs: "फिर से खेलें? सर्वोच्च स्कोर, शूरवीर" },
	{ id: "ar", script: "arabic", glyphs: "مرحبا Kaleb! النتيجة 12450 في الطابق 3" },
	{ id: "pseudo", script: "pseudo", glyphs: `⟦Plåy${NBSP}ågåîñ${NBSP}100${NBSP}%⟧` },
];

/** One wrapped-text box: a few sentences of a script, to judge line breaking with TextWrapped. */
export interface L10nSpikeWrapSample {
	readonly id: string;
	readonly script: L10nSpikeScript;
	readonly text: string;
}

/** Wrapped-text boxes, in order: CJK and Thai have no spaces between words; German has one very long word. */
export const L10N_SPIKE_WRAP_SAMPLES: ReadonlyArray<L10nSpikeWrapSample> = [
	{
		id: "de",
		script: "latin",
		text: "Donaudampfschifffahrtsgesellschaftskapitän: Besiege alle Gegner im Raum, um zur nächsten Ebene zu gelangen.",
	},
	{
		id: "vi",
		script: "latin",
		text: "Hiệp sĩ chiến đấu sâu trong hầm ngục để đánh bại Chúa Quỷ. Hãy tiêu diệt mọi kẻ thù trong phòng.",
	},
	{
		id: "ru",
		script: "cyrillic",
		text: "Рыцарь сражался в глубинах подземелья, чтобы победить Повелителя демонов. Победите всех врагов в комнате.",
	},
	{
		id: "ja",
		script: "japanese",
		text: "ダンジョンの奥深くで騎士は魔王を倒すために剣を振るい続けた。次の階に進むには部屋の敵をすべて倒してください。",
	},
	{
		id: "ko",
		script: "korean",
		text: "던전 깊은 곳에서 기사는 마왕을 쓰러뜨리기 위해 검을 휘둘렀습니다. 다음 층으로 가려면 방의 적을 모두 처치하세요.",
	},
	{
		id: "zh-hans",
		script: "hans",
		text: "骑士在地下城深处不断挥剑，只为打败魔王。要前往下一层，请先消灭房间里的所有敌人。",
	},
	{
		id: "zh-hant",
		script: "hant",
		text: "騎士在地下城深處不斷揮劍，只為打敗魔王。要前往下一層，請先消滅房間裡的所有敵人。",
	},
	{
		id: "th",
		script: "thai",
		text: "อัศวินฟันดาบอยู่ลึกในดันเจี้ยนเพื่อเอาชนะจอมมาร ถ้าต้องการไปชั้นถัดไปให้กำจัดศัตรูทั้งหมดในห้องก่อน",
	},
	{
		id: "hi",
		script: "devanagari",
		text: "कालकोठरी की गहराई में शूरवीर राक्षस राजा को हराने के लिए तलवार चलाता रहा। अगली मंज़िल पर जाने के लिए सभी दुश्मनों को हराएँ।",
	},
	{
		id: "ar",
		script: "arabic",
		text: "قاتل الفارس في أعماق الزنزانة لهزيمة ملك الشياطين. اهزم جميع الأعداء في الغرفة للانتقال إلى الطابق 2 يا Kaleb.",
	},
	{
		id: "pseudo",
		script: "pseudo",
		text: `⟦Ŝţåŕţ${NBSP}ţĥé${NBSP}ŕûñ${NBSP}åñð${NBSP}ðéƒéåţ${NBSP}éѵéŕý${NBSP}éñéɱý${NBSP}îñ${NBSP}ţĥé${NBSP}ŕööɱ⟧ ⟦Ţŕý åĝåîñ⟧`,
	},
];

/**
 * The AutoLocalize probe (L0 item e): the three probe labels show exactly this text. Add a cloud-table entry whose
 * Source is this string (docs/SPIKES.md "Spike L0" has the Creator Hub steps).
 */
export const L10N_SPIKE_PROBE_SOURCE = "Localization spike probe: start the run";
