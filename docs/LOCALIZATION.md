# Language localization: plan

Goal: the game reads in the player's language. It covers every language Roblox auto-translates: **Arabic, Chinese
(Simplified), Chinese (Traditional), French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese
(Brazil), Russian, Spanish, Thai, Turkish and Vietnamese**, plus English. That is 17 locales on top of the source.

- The player's **Roblox language** picks the locale by default, falling back to English.
- **Options** has a **Language** row that overrides it, live.
- Translations come from Roblox's **cloud localization table**: we export the English table with context as CSV, then
  Roblox auto-translation and any translators fill it in the Creator Hub, and the result is **imported back into the
  repo**. There it is validated headlessly and shipped with the build.

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

**What changes where.** Presentation, input labels and a tooling pipeline only. **No sim, dungeon, lockstep, hash,
replay, fixture, scoring or leaderboard change**: text never reaches `step()`. The server sends no player-facing text
today, and that stays true. The new code:

- `shared/l10n`: locale metadata, picking and formatting.
- generated locale tables under `shared/theme/locales/`.
- one setting.
- a font token per script.
- `AutoLocalize = false` on every GUI we build, so Roblox never translates on top of us.
- node scripts under `scripts/l10n/`.

## Status (2026-11-01)

**Built** on branch `localization` (from `main` @ `62b5263`; merged from `l10n-core`, `l10n-autolocalize`,
`l10n-pipeline`, `l10n-context`, `l10n-integrate`, `l10n-client`, then an independent review and its fixes): L1-L10 and
L14, and the code and docs for L0's spike. Owner answered LD1-LD3 (Kaleb, 2026-11-01) and said to proceed: the build
follows the proposed defaults LD4-LD14 until the owner revises one. Headless: typecheck, lint, both check scripts, the
node specs (art, checks, l10n: 125) and the whole Lune suite (284 spec files, 3,898 tests) pass; `l10n:check` reports
0 errors. Every locale but English is **hidden** and has **no table yet**, so players see exactly today's English (apart
from the reworded strings and display names, below).

**Not done (owner):** L0's spike in Studio and a published place (`KV_L10nSpike`, docs/SPIKES.md: fonts per script, the
Roblox locale codes and CSV header, AutoLocalize, Arabic), then `L10N_FONTS` / `LOCALES.roblox` / `l10n/columns.json`
from its results; L11 (first upload, auto-translate, import), L12 (reviews, go-live per locale), L13 (Creator Hub
settings, store page, invite notification strings); the Studio look (English unchanged, Language row, live switch with
a gamepad, `en-XA`, `KV_LocaleAudit`). The `max` budgets in `l10n/context.json` are estimates until L9 runs.

## What the code gives us

Paths are under `src/` unless they start with `docs/`.

| Fact | Where | Consequence |
|---|---|---|
| Every UI text goes through `str(key, vars)` → `ThemeCore.str`: active locale table, then the default table, then the key itself (warned once) | `shared/theme/core.ts`, `client/ui/theme/index.ts` (`str`, `hudText`) | The lookup and fallback chain already exist. No call site needs a new API. An audit of the client turned up no literal `Text="..."` props |
| Manifests already take optional partial `locales: { <code>: { key: text } }`. The validator checks codes (`xx` / `xx-XX`), that each key exists and that braces are well formed, but **not** that a translation keeps the English placeholder set | `shared/theme/validate.ts` (`LOCALE_PATTERNS`, `templateProblem`) | Keep the mechanism. Add a placeholder-set check: a translation that drops `{score}` must fall back to English, not ship broken |
| `loadThemePack(id, { locale })` exists, but `ThemeController` loads with no locale, and the core's locale table is fixed at construction | `shared/theme/pack.ts`, `client/controllers/game/ThemeController.ts` | Live switching needs `setLocale()` on the pack plus a re-render signal |
| The placeholder pack holds **~730 strings, ~2,700 words, ~14,600 characters**; 171 use placeholders, 22 are all caps. Largest groups: `hud` 109, `boon` 87, `lobby` 79, `tutorial` 74, `options` 66, `daily` 63. `vale` inherits them (`PLACEHOLDER_MANIFEST`) | `shared/theme/packs/placeholder/manifest.ts` | Small enough for one CSV, under Roblox's 1,000-entries-per-upload limit for now. `playtest.*` and the co-op debug line are developer text (LD10) |
| Required keys are built inside a function (`REQUIRED_STRING_KEYS`); `contract.luau` / `validate.luau` sit near Luau's 200 top-level locals | `shared/theme/contract.ts` | Locale data lives in **separate modules**, never as top-level constants in contract / validate |
| One font for all HUD text: `HUD_FONTS.text = "Arcade"` (legacy `Enum.Font`), `mono = "Code"`, resolved once at module load | `shared/view/hud/layout.ts`, `client/ui/theme/index.ts` (`HUD_FONT`, `MONO_FONT`) | Arcade's glyph coverage beyond basic Latin is unknown (accents? Cyrillic?). The font becomes per locale (L4). Player display names already show in Arcade today, whatever script they're in |
| Numbers: `formatThousands` hard-codes the group separator (`DAILY_VIEW.thousandsSeparator`); `formatClock` / `formatCountdown` / `formatCombo` print `m:ss`, `h:mm:ss`, `1.3` | `shared/view/hud/dailyText.ts`, `layout.ts` | Separators become locale data (`1.240` in de, `1 240` in fr / ru). Clocks stay as they are |
| Dates: weekday and month names are already keys (`daily.date.weekday.*`, `daily.date.month.*`), but the code fixes the order | `shared/view/hud/dailyStrings.ts` | Add one template key, `daily.date.format` (`{weekday} {month} {date}`), so the order can be translated |
| Composed text: the roster line joins names with `" · "` (`rosterLine.ts` `separator`); ad hoc plurals (`stage.best.oneToGo`, `hud.draft.waiting` "teammate(s)") | `shared/view/hud/rosterLine.ts`, manifest | The separator becomes a key. Plurals get reworded (LD7). Russian, Polish and Arabic need more than two plural forms |
| Fitting: 81 uses of `TextScaled` / `TextTruncate` / `AutomaticSize` in the client. Some rows are tight on purpose (score panel 158 / 160 px, tabs 126-170 px). `TextScaled` already lets combo names and run-over lines shrink "for a long translation" | `client/ui/**`, docs/HUD_LAYOUT.md | German and Russian run ~30 % longer than English. A runtime audit of `TextFits` finds overflow (L9); headless code can't measure text |
| Text drawn into the world: floor shouts (`ComboController`, `ParryFlashController`), affix name chips, score pops, health bars (SurfaceGui / BillboardGui) | `client/controllers/fx/*`, `render/*` | These need `AutoLocalize = false` too, and must refresh their text when the locale changes |
| Key hints fill `{key}` with raw names (`SETTINGS_HINT` `"O"` / `"B"`, `PAUSE_HINT` `"P"` / `"Start"`) | `shared/view/hud/layout.ts` | Named keys (`Start`, `Space`, `Shift`) get `input.key.<name>` strings, with the raw name as fallback |
| Settings: `DisplaySettings` is overrides-only (only non-defaults stored, doc v2) | `shared/settings/display.ts` | `language: "auto"` follows the same pattern, so no codec bump |
| Invite notifications use Roblox notification String ids (`INVITE.notificationStringIds`) | `shared/invite/config.ts`, `InviteService` | Translated in the Creator Hub, not in the repo (L13) |
| No `AutoLocalize`, `LocalizationService` or `LocalizationTable` anywhere | `git grep` | A clean start. Today any GUI we build has whatever `AutoLocalize` default the engine gives it (L0 confirms) |

### Roblox facts this plan relies on (Creator docs, read 2026-11-01)

- Auto-translation covers exactly the 18 languages above, English included. It assumes source strings are in the
  experience's source language.
- The cloud table: Key, Source (required), Context, Example, one column per locale.
  - Source+Context must be unique, and so must Key.
  - Limits: 10,000 entries, 2 MB, **1,000 added or modified entries per upload**.
  - Up- and downloads as CSV: Creator Hub → Localization → Table Management, or Studio's Localization Tools.
- Automatic Text Capture (ATC) and "Use Translated Content" are Creator Hub toggles, with per-language toggles.
  - ATC only captures text objects with `AutoLocalize` on.
  - `AutoLocalize` applies "to this GuiBase2d and its descendants", and must be true on the object and its ancestors
    for automatic localization. So `false` on a root GUI should cover its whole subtree; L0 confirms.
- `Translator:FormatByKey` takes `{1}` or named `{name}` arguments, plus specifiers (`int`, `num`, `datetime`, ...).
  `GetTranslatorForPlayerAsync` loads the cloud table at runtime. We don't use either at runtime (LD4).
- Locale ids: `LocalizationService.RobloxLocaleId` / `SystemLocaleId` and `Player.LocaleId` are lowercase codes such as
  `en-us`, `pt-br`. The full list of codes, and which one is the player's in-experience language, is an L0 item: the
  docs' language-codes page didn't load.
- **Not in the docs we read:** glyph fallback for fonts without CJK / Thai / Devanagari / Arabic glyphs, Arabic
  shaping and right-to-left rendering, and whether uploaded entries (not captured by ATC) get auto-translated. All
  three are L0 spike items, and each one gates languages (LD12).

## Player experience

1. **First join.** A Brazilian player whose Roblox language is Português sees the loading screen, menus, HUD and
   tutorial in Portuguese, with thousands written `1.240`. A player with an unsupported language, or a language that
   isn't live yet, sees English.
2. **Options → Display → Language.** `Automatic (Português)`, then each live language in its own name and script
   (`English`, `Español`, `Deutsch`, `日本語`, `العربية`, ...). Picking one switches menus and the HUD at once. World
   chips (affix names, floor shouts) switch on their next show. The choice is saved; Automatic is never stored.
3. **In a run.** The same layout, in the locale's font. Long words shrink inside their `TextScaled` slots; nothing
   spills out of a panel or covers a bullet.
4. **Co-op.** Each client shows its own language. Nothing a client sends depends on it.
5. **Store page.** The experience name and description, plus invite notifications, appear in the player's language
   (Roblox-side, L13).

## Design

### 1. Locales (`shared/l10n`, pure)

```
interface LocaleDef {
	code: string;            // pack locale code: "es", "pt-BR", "zh-CN", "zh-TW", "ar", ...
	endonym: string;         // its own name, shown in the picker (not translated)
	roblox: string[];        // Roblox locale ids that map to it ("es-es", "es-mx", ...; L0 fills them)
	script: "latin" | "cyrillic" | "cjk" | "thai" | "devanagari" | "arabic";
	rtl: boolean;
	number: { group: string; decimal: string };
	status: "live" | "hidden";  // only live locales are auto-picked or listed (LD12)
}
```

- **`LOCALES`** (data, `shared/l10n/locales.ts`): `en` (source) and `ar, de, es, fr, hi, id, it, ja, ko, pl, pt-BR, ru,
  th, tr, vi, zh-CN, zh-TW`, plus the pseudo-locale `en-XA` (L8, never live). These codes fit the validator's
  `xx` / `xx-XX` patterns.
- **`pickLocale(robloxIds, override, live)`** resolves in order and returns `{ code, auto }`:
  1. the override, if it's live;
  2. an exact match of `Player.LocaleId` / `RobloxLocaleId` (whichever L0 shows to be the in-experience language);
  3. a language-only match (`es-mx` → `es`, `pt-pt` → `pt-BR`, `zh-hk` → `zh-TW`; the table is in `LOCALES`);
  4. `en`.
- **Formatting.** `formatThousands(n, locale)` and `formatDecimal(tenths, locale)` read `number`. Digits stay ASCII in
  every locale, Arabic included (LD9).

### 2. String tables and staleness

- **Generated modules**: one per locale, `shared/theme/locales/<code>.ts`, written by `l10n:import`, never by hand.
  - Each entry is `key: [text, srcHash]`, where `srcHash` is FNV-1a 32 of the English source it was translated from.
  - Loaded **on demand** through a loader map (`LOCALE_LOADERS[code]()`), so only the active locale's table is
    required.
- **Lookup.** `ThemeCore` takes a `LocaleTable`, not just the manifest's `locales`. The order is:
  1. the pack's own manifest `locales` (a pack may override a translation);
  2. the generated table, used **only if `srcHash` still matches** the active pack's English text;
  3. the English table.

  A stale translation (English changed after translating) falls back to English and is listed by the l10n report and
  the `KV_LocaleAudit` debug view. The player never reads a translation of text that no longer exists.
- **`setLocale(code)`** on `ThemePack` / `ThemeCore` swaps the table and clears no other cache. Colours, sprites and
  sounds don't depend on the locale.
- **Validator** (`validateLocaleTable`, its own module, not `validate.ts`; the Luau locals rule): for each entry:
  - the key exists;
  - the placeholder **multiset** equals the English one;
  - the braces are well formed;
  - for Latin and Cyrillic scripts, a translation of an all-caps English string has no lowercase letters.

  Runtime: a failing entry is dropped (English instead) and warned once. Headless: a spec fails on any failing entry in
  a committed table.

### 3. Context, glossary and budgets (`l10n/`, repo tooling, not shipped)

- `l10n/context.json`: one entry per exported key.
  - `note`: where it shows and what the placeholders mean, e.g. `"Score panel label row; {points} is a number"`.
  - optional `max`: a character budget for tight slots (stamp, shout, tab, button, chip).
  - optional `example`: placeholder values, used to fill the CSV's Example column.

  `test:l10n` fails if a player-facing key has no context entry.
- `l10n/glossary.json`: game terms with their meaning, and the ones never translated (`Kaleb-Vale`, `Ember` if LD11
  says so). They go into Context, because Roblox auto-translate has no glossary, and the review pass (L10) checks
  every locale against them.
- **Developer keys** (`playtest.*`, the co-op debug line, `DevPanel` text): `DEV_ONLY_STRING_PREFIXES`. Never exported
  and English in every locale (LD10).

### 4. The cloud pipeline (`scripts/l10n/`, node)

```
npm run l10n:export   # strings + context -> l10n/out/kv-strings[-N].csv (Key, Source, Context, Example, <locales...>)
   (owner) Creator Hub -> Localization -> Table Management -> upload; auto-translate fills; translators edit there
   (owner) download the table CSV -> l10n/in/
npm run l10n:import -- l10n/in/table.csv   # -> shared/theme/locales/<code>.ts + l10n/report.md
npm run l10n:check    # coverage, stale, placeholder, budget, glossary report (part of verify)
```

- **Export.**
  - One row per player-facing key: Key = our key, Source = English, Example = filled from `example`.
  - Context = `"<key> · <note> · max <n> chars · do not translate: <terms>"`. Including the key keeps Source+Context
    unique: "Saved", "Main menu" and "Pick again" each appear under several keys.
  - Existing translations are written back into their locale columns, so a re-upload never wipes them.
  - Batches stay at 1,000 rows or fewer per file.
  - `--changed` exports only keys whose English changed since the last import.
- **Import.**
  - Reads the header the Creator Hub writes (exact columns and locale codes from L0) and maps Roblox codes to ours
    through `LOCALES.roblox`.
  - Rejects entries whose placeholders differ from English and lists them in the report.
  - Writes each table with source hashes, sorted keys and a "generated, do not edit" header.
- **One source of truth for translations: the cloud table** (LD5). Fixes from review are made there (the Creator Hub
  translator UI, or a corrected CSV upload), then re-imported. The repo files are a pinned, validated snapshot of the
  cloud table for each build.
- **Creator Hub settings** (owner, L13):
  - ATC **off**: we never want runtime capture.
  - Auto-translation on for the 17 languages.
  - "Use Translated Content" on for Experience Information (name, description). In-experience text is ours, and
    `AutoLocalize = false` keeps Roblox from replacing it (L0 verifies the combination).

### 5. AutoLocalize off everywhere

- `createKvScreenGui` / `createKvSurfaceGui` / `createKvBillboardGui` (one helper module in `client/ui`) set
  `AutoLocalize = false` on every root GUI we create. Every existing (about 35 today) `new Instance("ScreenGui" | "SurfaceGui" |
  "BillboardGui")` and the React roots move to them.
- `scripts/check-autolocalize.js` (beside `check-asset-ids.js`, part of verify) fails the build on a bare
  `new Instance("ScreenGui"|"SurfaceGui"|"BillboardGui")` outside the helper, and on `<screengui` / `<surfacegui` /
  `<billboardgui` JSX without `AutoLocalize={false}`.
- Why: with ATC or translated content on, Roblox would rewrite any text that matches a Source string. That means
  double translation, half-translated interpolations, and player names caught by accident.

### 6. Fonts per script (`HUD_FONTS` → `fontsFor(locale)`)

- `L10N_FONTS: Record<Script, { text: string; mono: string; name: string }>` in `shared/l10n`:
  - `text`: labels and numbers.
  - `mono`: the debug line.
  - `name`: player display names and endonyms, a font that covers every script.

  Proposed: Latin keeps `Arcade` if L0 shows it draws á ñ ç ã ü ł ğ ş ı ő ạ ề; otherwise the Latin locales use the
  closest pixel-ish font that does. The other scripts use whatever font L0 shows renders that script cleanly (LD8).
- `HUD_FONT` / `MONO_FONT` become bindings read from the locale slice, no longer module-load constants. Every
  `Font={HUD_FONT}` site (about 40) reads `useHudFont()` (React) or `currentHudFont()` (controllers).
- **Display names** (lobby, spectate, podium, friend toasts, leaderboard) always use `name`, so a Korean player's name
  reads correctly on an English client (LD13).
- Text sizes stay in reference pixels. A script whose glyphs read small at HUD sizes (Thai, Devanagari, CJK at 12 px)
  gets `sizeScale` in `L10N_FONTS`, applied by the text primitives.

### 7. Right to left (Arabic)

- Arabic text renders right to left inside its labels, with right alignment where a label is left-aligned in
  left-to-right locales (`rtlAlign()` in the text primitives).
- **The layout is not mirrored** (LD6): panels stay in their corners, bars fill left to right, the minimap is
  unchanged. Mirroring a bullet-hell HUD would move cover zones and the footprint boxes, which docs/HUD_LAYOUT.md
  tuned with care.
- Numbers and player names inside Arabic sentences are left-to-right runs. If L0 shows the engine needs it, the
  formatter wraps placeholders in directional isolates (U+2068 / U+2069).
- Gate: if L0 shows the engine can't shape Arabic or lay out right-to-left runs correctly, `ar` stays hidden and this
  section waits (LD12).

### 8. Live switching

- A Reflex slice `l10n`: `{ code, auto, font }`. `ThemeController` resolves it at init: settings override + the
  player's locale → `pickLocale`, then `pack.setLocale`. `SettingsController` re-resolves it when `language` changes.
- React: the HUD and menu roots read `selectL10n`, and a `LocaleRoot` keyed by `code` remounts its subtree on change.
  That is simpler than threading a dependency through every `str` call; a remount costs one frame, from a menu.
- Controllers that build text (floor shouts, affix chips, health-bar names, toasts, stage card) subscribe to a
  `localeChanged` signal and rebuild their labels, or read `str` on each show (most already do).
- A language change in the middle of a run is allowed (Options opens in runs). The run never notices.

### 9. Settings and strings

- `DisplaySettings.language: "auto" | <code>`. Default `"auto"`; only a code is stored; the doc stays v2; an unknown or
  hidden code reads as `"auto"`.
- New strings:
  - `options.display.language`, `options.display.language.auto` (`Automatic ({name})`);
  - `daily.date.format`, `roster.separator`;
  - `input.key.<name>` for the named keys the HUD prints;
  - reworded plural strings (LD7).
- The endonyms aren't strings: they're `LocaleDef.endonym`, the same in every locale.

## Tasks

- **L0. Spike and audit.**
  - **Spike** (`KV_L10nSpike`, debug attribute, cleaned up with Janitor), in Studio and a published place:
    - (a) Glyph sheet per script in `Arcade`, `Code` and three candidate fonts (accents for all nine Latin locales,
      Cyrillic, kana / hangul / hanzi, Thai, Devanagari, Arabic): tofu, silent fallback or correct?
    - (b) Arabic shaping and right-to-left order in a `TextLabel`, with an embedded number and name; any
      text-direction property.
    - (c) Thai and CJK line breaking with `TextWrapped`.
    - (d) `Player.LocaleId` vs `LocalizationService.RobloxLocaleId` on the client and server for an account set to
      Español and a device set to French; the full list of Roblox locale codes.
    - (e) `AutoLocalize`: its default, and whether `false` on a ScreenGui stops translated content for descendants,
      with "Use Translated Content" on and a cloud entry whose Source matches a label.
    - (f) Upload two keyed entries (one with `{name}`) as CSV: does auto-translate fill them, does it keep the
      placeholders, and what is the exact header of the downloaded CSV?
  - **Audit** (read-only):
    - every root GUI the client creates;
    - every composed string (joins, separators, date order, plurals, `+{n}`);
    - strings cached outside `str` at show time;
    - UI art with baked-in text (ToffeeCraft sheet, draft skin, icons);
    - key-name hints;
    - developer-only strings.

  **Verify:** results in docs/SPIKES.md and this doc: a font table per script, the Roblox code map, the decision on
  `ar` / `hi` / `th`.
- **L1. Source cleanup (English only).**
  - Separator and date-order keys; reworded plurals (LD7); `input.key.*`; `DEV_ONLY_STRING_PREFIXES`.
  - Replace any composed English found by L0 with one template key each.

  **Verify:** view specs for the new templates; the English UI reads the same, except for the reworded plurals (Studio
  look).
- **L2. `shared/l10n`.** `LocaleDef`, `LOCALES`, `pickLocale`, number formatting, `L10N_FONTS` (filled from L0).
  **Verify:** specs:
  - picking: override > exact > language-only > en, and hidden locales are skipped;
  - every `LOCALES.roblox` id is unique;
  - separators per locale (`1,240` / `1.240` / `1 240`) and negatives.
- **L3. Locale tables in the theme.**
  - The generated-module format with source hashes, the loader map, `ThemeCore` lookup with staleness,
    `setLocale`, `validateLocaleTable` (placeholder multiset, caps rule).
  - Keep the manifest `locales` path as the pack override.

  **Verify:** specs: a stale entry falls back; a placeholder-mismatch entry falls back with one warning; a pack
  override wins; `setLocale` round-trips; `contract.luau` / `validate.luau` local counts unchanged (compiled under
  Lune).
- **L4. Fonts.** `fontsFor(locale)`, `useHudFont` / `currentHudFont`, the `name` font for display names, `sizeScale`.
  Move the ~40 `Font={HUD_FONT}` / `MONO_FONT` sites.
  **Verify:** English renders pixel-identical to today (Studio screenshot diff of menu, HUD, run over); `en-XA` and one
  locale per script render with no tofu.
- **L5. AutoLocalize off.** The GUI helpers, every root moved to them, `check-autolocalize.js` in verify.
  **Verify:** the check passes; a Studio walk with ATC on in a test place captures nothing (Localization Tools shows no
  new entries after a run).
- **L6. Setting and live switch.**
  - `DisplaySettings.language`, the Options row (endonyms in the `name` font).
  - The `l10n` slice, `LocaleRoot`, `localeChanged` for world-label controllers.

  **Verify:** settings specs (auto never stored, an unknown code reads auto); switching in a menu and in a run updates
  menus, HUD, stage card, toasts and the next floor shout; no flicker of keys.
- **L7. Context and glossary.**
  - Write `l10n/context.json` for every player-facing key (notes, placeholder meanings, budgets for tight slots) and
    `l10n/glossary.json`.
  - Claude drafts these from the code that shows each key; the owner checks the glossary.

  **Verify:** `test:l10n` fails on a missing context; every key with `max` sits in a slot named by the HUD footprint
  or menu fit specs.
- **L8. Pseudo-locale.** `en-XA` generated from English: accented letters, +40 % padding, `⟦ ⟧` brackets, placeholders
  untouched. Hidden, selectable by developers (`DEV_MODE`) and in Studio.
  **Verify:** spec: placeholders intact, all keys present; in Studio, any English left on screen under `en-XA` is a
  string that bypassed `str` (fix in L1).
- **L9. Fit audit.** `KV_LocaleAudit` walks PlayerGui every 0.5 s and logs each visible `TextLabel` / `TextButton` /
  `TextBox` with `TextFits == false` that is neither `TextScaled` nor truncated on purpose: the instance path, locale
  and text. Walk the menu, lobby, options, tutorial, a run, draft, run over and daily screens under `en-XA`, `de`, `ru`,
  `ja`, `th`, `ar`.
  **Verify:** zero unintended misfits under `en-XA` at 1280 x 720 and phone size, or an owner-accepted list; budgets in
  `context.json` tightened where a slot can't grow.
- **L10. Pipeline.**
  - `l10n:export` (batches, `--changed`, existing translations kept), `l10n:import` (code map, placeholder reject,
    hashes, report), `l10n:check` and `test:l10n` (node:test, in verify).

  **Verify:** node specs: a round trip of export → hand-edited CSV → import reproduces the tables byte for byte; a
  dropped `{score}` is rejected; Source+Context unique across all rows; no developer key exported.
- **L11. First fill.** Owner: upload, enable auto-translate for the 17 languages, download, import.
  - Claude reviews each locale against the glossary and budgets (consistent term per locale, tone, all-caps, length).
  - Fixes go in through the cloud table and a re-import.

  **Verify:** `l10n/report.md` shows 100 % coverage, zero placeholder rejects and zero stale entries for every locale;
  the review notes are written here per locale.
- **L12. Native review and go-live, per language.** A native or fluent player reads each locale in Studio: menu,
  tutorial, a run, draft, run over, daily. Fixes go through the cloud. A locale flips `status: "live"` only after the
  LD12 gate.
  **Verify:** per-locale sign-off in this doc.
- **L13. Roblox-side.** Creator Hub settings (ATC off, auto-translate, translated experience info); name, description
  and thumbnail-text check; badge or pass names if any; invite notification strings translated.
  **Verify:** a test account per script sees the store page and an invite in its language.
- **L14. Telemetry (optional, LD14).** A `locale` field (bucketed: the live codes plus `other`) on the session-start
  event, so we can see which languages are played.
  **Verify:** analytics specs (field values fixed, within Roblox's custom-field limits).
- **L15. Docs.** docs/LOCALIZATION.md (this plan as built), the CLAUDE.md decision log and docs table, the theme
  README's locale section, the workflow for adding a string ("add English + context; export `--changed`; import after
  the cloud fills").
  **Verify:** owner sign-off.

Order:

1. L0 first: it decides fonts, codes and which scripts ship.
2. L1-L6: the plumbing, safe to merge while every locale is hidden.
3. L7-L9: context, pseudo-locale and fit audit.
4. L10-L11: the pipeline and the first fill.
5. L12 per language. Suggested go-live waves: Latin and Cyrillic (es, pt-BR, fr, de, it, pl, tr, id, vi, ru), then CJK
   (ja, ko, zh-CN, zh-TW), then th, hi, ar.
6. L13-L15 alongside.

## As built (2026-11-01)

Paths under `src/` unless they start with `docs/`, `l10n/` or `scripts/`.

- **Locales and picking (L2).** `shared/l10n`: `LOCALES` (19: `en`, the 17 targets, `en-XA`; only `en` live; `roblox`
  ids are guesses until L0), `pickLocale` (override if live or `allowHidden`; exact id; language-only with
  `LANGUAGE_FALLBACKS` for zh variants; else `en`; ids case-insensitive, `_` = `-`; never auto-picks `en-XA`),
  `liveLocales`, `resolveLocaleState` (the client's state; `allowHidden` applies to the Options override only: the
  automatic pick is live-only for everyone, developers included). Numbers: `setNumberLocale` / `numberLocale` (module
  state, set by the pack's `setLocale`), `formatThousands`, `formatDecimal`, `formatTenths`; the daily texts,
  `formatCombo` and damage-number decimals use them (`DAILY_VIEW.thousandsSeparator` is gone); fr / pl / ru group with a
  no-break space. `pseudoLocalize` (accents, ~40 % padding, `⟦ ⟧`, placeholders intact), `charCount` (`utf8.len`).
  `L10N_FONTS` / `fontsFor` / `scaledTextSize`: provisional (Latin Arcade / Code, names BuilderSans; other scripts
  BuilderSans) until L0.
- **Translatable keys.** `DEV_ONLY_STRING_PREFIXES` (`playtest.`, `hud.debug`) minus `DEV_ONLY_STRING_EXCEPTIONS` (the
  six `playtest.run.*` run-over labels players see), plus `UNTRANSLATED_STRING_KEYS` (`fx.cap`: its pixel font has only
  `0-9 + - C A P !`); one predicate `isTranslatableStringKey`. Non-translatable keys are English in every locale and
  never exported. Today: 792 keys, 767 translatable.
- **Tables in the theme (L3, L8).** `shared/theme/locales/index.ts` (`LOCALE_TABLES`, generated; **static imports**, not
  the lazy loaders design 2 described); a table is `key -> [text, sourceHash(English)]`. `ThemeCore` / `ThemePack`
  `setLocale(code | undefined)` resolves every key once (manifest `locales` override, then the table entry if its hash
  matches the current English and its placeholders match, then English; `en-XA` = pseudo of the English); a bad entry
  falls back **silently** and is listed by `localeReport()` (`stale`, `mismatched`, `unknown`) instead of warning.
  `validateLocaleTable` (`localeCheck.ts`): unknown / dev / untranslated keys, entry shape, UTF-8, braces, and for
  current (non-stale) entries the placeholder multiset and the all-caps rule (`LOWERCASE_RANGES`; ß and ĸ pass); a spec
  runs it on every generated table. `validate.ts` checks manifest `locales` placeholders too (`validate.luau` 199,
  `contract.luau` 183 top-level locals).
- **English cleanup (L1).** New keys: `daily.date.format` (was `daily.date`), `roster.separator`, `input.separator`,
  `hud.combo.shout`, `hud.combo.bestNamed`, `daily.podium.row`, `hud.verdict.withPost`, 51 `input.key.<KeyCode>` labels
  (`inputLabel`, `settingsHint`, `pauseHint`, ... take an optional `str`). Reworded (LD7): `hud.draft.waiting` "Teammates
  choosing: {count}", `hud.toast.fang` "Vampire Fang: half hearts +{amount}", `daily.result.entrants` /
  `daily.board.total` "Players: {total}", `stage.best.toGo` "Deepest: floor {floor} · floors to go: {n}"
  (`stage.best.oneToGo` removed); `lobby.room.you` is now "{name} (you)" and `fx.parry.count` "{text} x{n}" (same
  English output). Score-pop width and the tutorial's one-character key test count characters, not bytes.
- **AutoLocalize off (L5).** `client/ui/gui.ts` `createKvScreenGui` / `createKvSurfaceGui` / `createKvBillboardGui` (26
  sites) and `AutoLocalize={false}` on the 9 `<screengui>` roots; `scripts/check-autolocalize.js` (`check:autolocalize`,
  specs in `test:checks`, both in verify) also bans `.upper(` in client and shared/view; allow comment
  `// check-autolocalize: allow (reason)`.
- **Client (L4, L6, L9).** `LocaleController` (loadOrder 0): `[Player.LocaleId, LocalizationService.RobloxLocaleId]` +
  `DisplaySettings.language` (`"auto"` or a code; only a code stored; doc v2) + developer flag (Studio or
  `KV_DevAllowed`) -> `resolveLocaleState` -> `pack.setLocale` -> Reflex slice `l10n`; re-resolves on the setting, either
  id or the attribute. `LocaleRoot` remounts the HUD / menu, loading and stage-card roots on a code change and restores
  the gamepad selection. Outside React: `onLocaleChanged` in DamageNumber, HealthBar (affix chips), ScorePop, Combo,
  ParryFlash, TouchControls, NewBest, DailyRank. Fonts: `useHudFont` / `useMonoFont` / `useNameFont` / `currentHudFont`
  (39 sites + 6 controllers); display names always use the `name` font (BuilderSans today, LD13: **a visible change in
  English**); `sizeScale` and right alignment for RTL in the shared text primitives only. Options > Display > Language
  is a `< value >` stepper ("Automatic ({name})", then endonyms; developers also see hidden locales marked " [dev]").
  `KV_LocaleAudit` (`LocaleAuditController`, `shared/l10n` `fitAudit.ts`): misfit labels and `localeReport()` lines.
- **Telemetry (L14).** No session-start event exists, so the `RunStarted` funnel step carries field01 = the shown locale
  (live codes or `other`, resolved like the client) and field02 = the Roblox language bucket (as if every locale were
  live: demand before go-live). The server reads `Player.LocaleId`, the stored setting (`SettingsService`) and the
  developer attribute.
- **Pipeline (L7, L10).** `l10n/context.json` (767 notes, budgets on tight slots, examples for every placeholder),
  `l10n/glossary.json` (63 terms; `translate: false` for Kaleb-Vale and Roblox), `l10n/README.md`, `l10n/columns.json`
  (CSV header -> locale code, guesses until L0 f). `scripts/l10n`: `dump-strings.luau` (the built game's own strings,
  hashes, translatable flags and locales -> `l10n/build/source.json`; needs `npm run build`), `export.js`
  (`l10n/out/kv-strings[-N].csv`, <= 1,000 rows, Key / Source / Context / Example + locale columns with current
  translations, `--changed`), `import.js` (always the whole cloud download at once; rejects placeholder / brace / caps
  problems; writes tables + index + `l10n/report.md`), `check.js` (errors only on structure and missing context;
  coverage / stale / budget / glossary are warnings). npm: `l10n:dump`, `l10n:export`, `l10n:import`, `l10n:check`,
  `test:l10n` (in verify).
- **Spike L0 code.** `L10nSpikeController` (`KV_L10nSpike`): glyph sheet (7 fonts x 18 scripts with TextFits /
  TextBounds), wrapped text per script, Arabic with TextDirection variants, locale ids and AutoLocalize defaults,
  AutoLocalize probe labels; data in `shared/spikes/l10nSpike.ts`; how-to and checklist in docs/SPIKES.md.

## Edge cases

- **New strings after go-live.** A new English key has no translation and shows English until the next fill. An edited
  English string goes stale and shows English, never the old meaning. `l10n:check` lists both; nothing blocks a build.
- **Interpolated values** (`{name}`, `{score}`, `{key}`): player names are never translated; numbers go through the
  locale formatter before interpolation; key names go through `input.key.*`.
- **All-caps strings** (`NEW BEST`, `TOP 10!`): translators supply the caps form. Code never calls `upper()` on
  translated text (Luau's `string.upper` is ASCII only). `check-autolocalize.js` also flags `:upper()` on a `str`
  result.
- **Byte length.** Luau strings are UTF-8 bytes: `.size()` is never a display length, and no code truncates
  translated text by bytes (L0 audit; today only debug text is cut).
- **Co-op.** Each client has its own locale. Lobby text the server sends is data (names, counts), never prose.
- **Tutorial.** Prompts that name on-screen controls use `input.key.*` and the touch strings. Its lock specs don't
  cover text.
- **Studio offline.** The tables ship in the build, so Studio and offline tests see translations without the cloud.
- **Theme pack switch.** Locale tables are keyed by string key, and staleness by the active pack's English, so a pack
  that rewrites an English string falls back for that key only.

## Decisions

Owner (2026-11-01, Kaleb):

- **LD1. Target languages: all 17 non-English languages Roblox auto-translates**, Arabic (right to left), Hindi and Thai
  included. Each still goes live behind the LD12 gate.
- **LD2. Translations come from the Roblox cloud localization table**: export with context, auto-translate and
  translators there, import back into the repo.
- **LD3. Player's Roblox language by default, with a Language override in Options**, live, stored in the settings doc.

Proposed (defaults to confirm):

- **LD4. Snapshot import, no runtime cloud fetch.** The build ships validated tables; `GetTranslatorForPlayerAsync` is
  not used.
  - Why: headless validation, Studio parity, and a bad cloud edit can never break a live server.
  - Alternative: fetch at runtime for instant translation hotfixes, at the cost of no placeholder validation and
    `FormatByKey` throwing on bad entries.
- **LD5. The cloud table is the only place translations are edited**; repo tables are generated. Alternative: repo as
  the master after the first fill, re-exported to the cloud for review only.
- **LD6. Arabic text renders right to left; the HUD layout isn't mirrored.**
- **LD7. Plurals by rewording, not a plural engine.** Counted nouns become label: value (`Teammates choosing: {count}`,
  `Floors to go: {n}`). Alternative: CLDR plural keys (`.one` / `.few` / `.many` / `.other`), which needs entries with
  no English source of their own in the cloud table.
- **LD8. Fonts per script, from the L0 spike.** Latin keeps the pixel look if a pixel font covers the accents; other
  scripts use the cleanest font that renders them. Pixel fonts for CJK / Thai / Arabic are out of scope.
- **LD9. ASCII digits in every locale**, locale group and decimal separators. Clock and countdown formats unchanged.
- **LD10. Developer text (`playtest.*`, debug lines, DEV panel) stays English** and is never exported.
- **LD11. Never translated: the game title "Kaleb-Vale"** (the brand). Class, enemy, boss, boon and affix names **are**
  translated, through the glossary, so each locale keeps one term per thing.
- **LD12. Go-live gate per locale:**
  - L0 says the script renders, and for Arabic that right-to-left text works;
  - 100 % of player-facing keys translated, with zero placeholder rejects and zero stale entries;
  - L9 fit audit clean;
  - Claude review (L11) and a native read (L12) done.

  Until then the locale is hidden from auto-pick and the picker.
- **LD13. Player display names always use a font that covers every script**, whatever the locale.
- **LD14. Add a bucketed `locale` field to telemetry.**

## Risks

- **Glyph coverage.** If Roblox doesn't fall back for missing glyphs and no available font covers a script, that
  language can't ship (L0 decides; LD12 gates).
- **Auto-translate quality for game terms** ("Boon", "Ooze", "Curse", "Graze") and all-caps shouts. Mitigation: Context
  with notes and do-not-translate terms, the glossary review, native reads. Without native reviewers, a locale may ship
  with machine text that has only had Claude's review: an owner call per language.
- **Text expansion** in fixed rows (score panel 158 / 160 px, tabs, chips). Mitigation: `TextScaled` where it already
  exists, budgets, the L9 audit. Some slots may need wider boxes, which means touching docs/HUD_LAYOUT.md's footprint
  boxes (spec-checked).
- **Arabic right to left** may only half-work in the engine (bidi with numbers and names). Gated.
- **Cloud upload limits:** 1,000 changed entries per upload; the export batches. A future string count above ~10,000
  entries (17 locale columns don't count as entries) is far off.
- **Owner-only steps** (Creator Hub uploads and toggles) sit on the critical path of every fill.
- **`contract.luau` locals:** locale code stays out of contract / validate, and L3 compiles them under Lune.

## Out of scope

- Voice or audio localization; translated sound effects or jingles.
- Mirroring the HUD for right to left; vertical CJK text.
- Pixel fonts for non-Latin scripts.
- Player-to-player chat translation (Roblox's own).
- Translating text baked into art (L0 lists any; replacing it is a follow-up).
- Locale-specific gameplay or content.
