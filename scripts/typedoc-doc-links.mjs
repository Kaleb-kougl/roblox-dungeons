// TypeDoc plugin (typedoc.json "plugin"; docs/DOC_COMMENTS.md DC11): every `docs/NAME.md` cited in a doc comment or
// in a plan doc becomes a link to that doc's page (the docs are in the site through "projectDocuments"). The text
// rule is scripts/doc-links.js; this file only finds each document's page and its URL relative to the page being
// rendered. It runs before TypeDoc's own markdown parser (a higher priority on the same event). It imports nothing
// from "typedoc" (the event by its name, a document by its `variant`), so it never loads a second copy of TypeDoc.
import { createRequire } from "node:module";

const { linkDocMentions } = createRequire(import.meta.url)("./doc-links.js");

/** MarkdownEvent.PARSE: the renderer triggers it for every piece of markdown it turns into HTML. */
const PARSE_MARKDOWN = "parseMarkdown";
/** Before TypeDoc's markdown parser, which listens at the default priority 0. */
const BEFORE_PARSER = 100;

export function load(app) {
	let project;
	let documents = new Map();
	app.renderer.on(
		PARSE_MARKDOWN,
		(event) => {
			const page = event.page;
			if (page === undefined || page.project === undefined) return;
			if (page.project !== project) {
				project = page.project;
				documents = new Map();
				for (const reflection of Object.values(project.reflections)) {
					if (reflection.variant === "document") documents.set(reflection.name, reflection);
				}
			}
			event.parsedText = linkDocMentions(event.parsedText, (name) => {
				const doc = documents.get(name);
				return doc === undefined || doc === page.model
					? undefined
					: app.renderer.router.relativeUrl(page.model, doc);
			});
		},
		BEFORE_PARSER,
	);
}
