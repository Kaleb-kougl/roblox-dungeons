// Turns the plain `docs/NAME.md` a comment or a plan doc cites into a link to that doc's page in the API reference
// (docs/DOC_COMMENTS.md DC11). Pure text in, text out: scripts/typedoc-doc-links.mjs calls it on every piece of
// markdown TypeDoc renders, with the page's own relative URL for each doc.
//
// What is linked: `docs/` followed by a doc's file name (capitals, digits and underscores) and `.md`, in running text.
// What is left alone: a name with no page (urlOf returns undefined), anything inside inline code or a fenced code
// block, and a mention that is already part of a markdown link or a longer path (`worktrees/x/docs/A.md`).
"use strict";

const MENTION = /(?<![\w/.[-]|\]\()docs\/([A-Z][A-Z0-9_]*)\.md(?![\w/]|\.\w)/g;

/** `text` with each `docs/NAME.md` outside code turned into `[docs/NAME.md](url)`; `urlOf(name)` gives the url or undefined. */
function linkDocMentions(text, urlOf) {
	// Odd pieces are code: a fenced block, or an inline span between single backticks on one line.
	const pieces = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
	for (let i = 0; i < pieces.length; i += 2) {
		pieces[i] = pieces[i].replace(MENTION, (whole, name) => {
			const url = urlOf(name);
			return url === undefined ? whole : `[docs/${name}.md](${url})`;
		});
	}
	return pieces.join("");
}

module.exports = { linkDocMentions };
