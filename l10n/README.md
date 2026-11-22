# l10n: translator context

Repo tooling for the localization pipeline (docs/LOCALIZATION.md, design 3 and task L7). Nothing here ships in the
game. `npm run l10n:export` reads both files to fill the cloud table's Context and Example columns.

## Files

- **`context.json`**: one entry for every translatable key of the placeholder pack's `strings` table
  (`src/shared/theme/packs/placeholder/manifest.ts`), keys sorted. A key is translatable when
  `isTranslatableStringKey` (`src/shared/l10n/devStrings.ts`) says so: developer keys (`isDevOnlyStringKey`:
  `playtest.*` and `hud.debug*`, except the run-over labels in `DEV_ONLY_STRING_EXCEPTIONS`) and
  `UNTRANSLATED_STRING_KEYS` (`fx.cap`, drawn with a digit font that only has `0-9 + - C A P !`) have no entry: they
  always show English and are never exported (LD10). The Lune dump writes the game's own verdict per key
  (`devOnlyKeys` / `untranslatedKeys` in `l10n/build/source.json`), so the node scripts never re-implement the rule.

  ```json
  "hud.best.toGo": {
  	"note": "Score panel target row (...): points still needed to beat the personal best. {points} is a formatted number. ALL CAPS in English.",
  	"max": 22,
  	"example": { "points": "12,340" }
  }
  ```

  - `note` (required, one line): where the text shows, what kind of text it is (button, tab, shout, sentence...),
    what each `{placeholder}` holds, tone, and whether the English is all caps.
  - `max` (optional): a character budget for a tight slot (button, tab, stamp, floor shout, chip, fixed-width column).
  - `example` (required when the English has placeholders): a realistic value for every placeholder, so the CSV's
    Example column shows a filled sentence. Values are what the code passes (formatted numbers are strings: `"12,340"`).
- **`glossary.json`**: `{ "terms": [{ "term", "meaning", "translate", "keys" }] }`, the game's vocabulary a translator
  must keep consistent (classes, enemies, bosses, boons, combo tiers, floor / run / Daily...). `translate: false` only
  for names that are never translated: the brand `Roblox Dungeons` (LD11) and the
  platform name `Roblox`. `keys` lists the keys whose English uses the term, for the review pass (L11).

## Adding or changing a string

1. Add the English to the placeholder manifest as usual.
2. Add its entry to `context.json` in the same commit: a note written for a translator who has never seen the game
   (read the component that shows it), an `example` for each placeholder, and a `max` if the slot is tight.
3. If it introduces a game term, add the term (or the key to an existing term's `keys`) in `glossary.json`.
4. Changed the meaning of an English string? Update its note too: the old translation goes stale anyway (design 2).

`npm run l10n:check` (scripts/l10n) enforces coverage: every exported key has a context entry; it warns when an
entry names an unknown, developer or untranslated key.

## Budgets

- Give `max` only where the slot can't grow, wrap or shrink its text readably: buttons, tabs, stamps and floor
  shouts, chips, compact score-panel rows, icon labels, fixed label columns. Leave it out for wrapping text (tutorial
  prompts, toasts, card descriptions, notices).
- `max` counts characters of the translation **as written**, with each `{placeholder}` token counted literally (the
  same way the English was measured), so `"{points} TO BEST"` is 16. It is never below the English length.
- Rule of thumb: English length x 1.3-1.6, capped by the slot (HUD tunables in `src/shared/view/hud/layout.ts`,
  `options.ts`, `progression.ts`, `src/shared/view/menu/config.ts`; footprints in docs/HUD_LAYOUT.md). The L9 fit
  audit tightens or loosens budgets from what actually overflows in Studio.
