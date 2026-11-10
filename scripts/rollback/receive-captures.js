#!/usr/bin/env node
/*
 * The rollback spike's receiver (docs/ROLLBACK_SPIKE.md Design 6, task R4): the Studio plugin
 * (plugin/RollbackCapturePlugin.server.lua, "Pull rollback captures") reads KV_RollbackCapture_v1 and
 * KV_RollbackProbe_v1 with Studio's API access and POSTs them here as JSON; this writes them to the gitignored
 * captures/ folder, the way Rojo's plugin talks to `rojo serve`.
 *
 *   node scripts/rollback/receive-captures.js [--port 34880] [--out captures]
 *
 * Requests (127.0.0.1 only; Host must be localhost / 127.0.0.1; POST bodies must be application/json, at most
 * MAX_BODY_BYTES):
 *   GET  /    {"ok":true,...}: the plugin's reachability check
 *   POST /    {"kind":"capture","runId":"<id>","meta":{...},"chunks":["...",...]}
 *             -> captures/<runId>.json = { runId, meta, chunks, receivedAt } (rewritten on every pull)
 *   POST /    {"kind":"probe","rows":[{"key":"<writerId>/<n>","value":{...}},...]}
 *             -> one line per summary appended to captures/probe/<kind>.jsonl = { key, row }: a v2 row (shared/spikes
 *             RollbackProbeRow: one player's summaries of up to a minute, `cpu` / `live` lists) becomes one line per
 *             summary, key "<writerId>/<n>/<kind>/<i>", row { v, kind, at, placeVersion, summary }; a v1 row (one
 *             window, `kind` + `summary`, key "<sessionId>/<kind>/<windowIndex>") one line as it is. A key already in
 *             the file is skipped, so pulling twice adds nothing.
 * The capture is stored exactly as the DataStore holds it: shared/spikes decodeCapture(meta, chunks) reads it.
 *
 * The default port is shared/spikes ROLLBACK_CAPTURE.receiverPort, duplicated here as a literal (and in the plugin);
 * receive-captures.test.js reads the TypeScript source and fails if they drift. Plain Node, no dependencies.
 */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

/** = shared/spikes ROLLBACK_CAPTURE.receiverPort (checked by receive-captures.test.js). */
const DEFAULT_PORT = 34880;
const DEFAULT_OUT = path.resolve(__dirname, "..", "..", "captures");
/** A capture is a few MB of base64 at most (ROLLBACK_CAPTURE.chunkChars x a few chunks); the plugin posts 50 rows. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 1000;
/** = ROLLBACK_CAPTURE.maxIdChars, and its character set (shared/spikes isRollbackKeyId). */
const ID_PATTERN = /^[A-Za-z0-9_{}-]{1,38}$/;
const PROBE_KINDS = new Set(["cpu", "live"]);
const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

class RequestError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

function hostName(host) {
	if (typeof host !== "string") return "";
	if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
	const colon = host.indexOf(":");
	return colon >= 0 ? host.slice(0, colon) : host;
}

function readBody(req, maxBytes) {
	return new Promise((resolve, reject) => {
		const parts = [];
		let size = 0;
		let done = false;
		req.on("data", (chunk) => {
			if (done) return;
			size += chunk.length;
			if (size > maxBytes) {
				done = true;
				reject(new RequestError(413, `body over ${maxBytes} bytes`));
				req.resume();
				return;
			}
			parts.push(chunk);
		});
		req.on("end", () => {
			if (!done) resolve(Buffer.concat(parts).toString("utf8"));
		});
		req.on("error", (err) => {
			if (!done) reject(err);
		});
	});
}

function writeAtomic(file, text) {
	const tmp = `${file}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, file);
}

/**
 * The receiver as an http.Server (not listening yet). `outDir` gets <runId>.json and probe/<kind>.jsonl;
 * `log(line)` hears one line per request handled.
 */
function createReceiver({ outDir = DEFAULT_OUT, maxBodyBytes = MAX_BODY_BYTES, log = console.log } = {}) {
	/** Per probe file: the keys it holds (read once from disk). */
	const probeKeys = new Map();

	function keysOf(file) {
		let keys = probeKeys.get(file);
		if (keys !== undefined) return keys;
		keys = new Set();
		if (fs.existsSync(file)) {
			for (const line of fs.readFileSync(file, "utf8").split("\n")) {
				if (line.trim() === "") continue;
				try {
					const entry = JSON.parse(line);
					if (typeof entry.key === "string") keys.add(entry.key);
				} catch {
					// A torn line: ignored (its key may be written again).
				}
			}
		}
		probeKeys.set(file, keys);
		return keys;
	}

	function capture(body) {
		const { runId, meta, chunks } = body;
		if (typeof runId !== "string" || !ID_PATTERN.test(runId)) throw new RequestError(400, "bad runId");
		if (meta === null || typeof meta !== "object" || Array.isArray(meta)) throw new RequestError(400, "bad meta");
		if (!Array.isArray(chunks) || chunks.length === 0 || !chunks.every((c) => typeof c === "string")) {
			throw new RequestError(400, "bad chunks");
		}
		if (meta.chunks !== chunks.length) throw new RequestError(400, "meta.chunks does not match the chunks sent");
		fs.mkdirSync(outDir, { recursive: true });
		const file = path.join(outDir, `${runId}.json`);
		const doc = { runId, meta, chunks, receivedAt: new Date().toISOString() };
		writeAtomic(file, `${JSON.stringify(doc)}\n`);
		const chars = chunks.reduce((n, c) => n + c.length, 0);
		log(`capture ${runId}: ${meta.ticks} ticks, ${chunks.length} chunk(s), ${chars} chars -> ${file}`);
		return { ok: true, file };
	}

	/** A stored row as its lines: [{ kind, key, row }], or undefined (refused). */
	function linesOf(key, value) {
		if (typeof key !== "string" || key.length > 50 || value === null || typeof value !== "object") return undefined;
		if (value.v === 1) return PROBE_KINDS.has(value.kind) ? [{ kind: value.kind, key, row: value }] : undefined;
		if (value.v !== 2) return undefined;
		const out = [];
		for (const kind of PROBE_KINDS) {
			const list = value[kind];
			if (list === undefined) continue;
			if (!Array.isArray(list)) return undefined;
			list.forEach((summary, i) => {
				const row = { v: value.v, kind, at: value.at, placeVersion: value.placeVersion, summary };
				out.push({ kind, key: `${key}/${kind}/${i}`, row });
			});
		}
		return out;
	}

	function probe(body) {
		const { rows } = body;
		if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new RequestError(400, "bad rows");
		let written = 0;
		let duplicates = 0;
		let rejected = 0;
		const lines = new Map();
		for (const r of rows) {
			const entries = linesOf(r && r.key, r && r.value);
			if (entries === undefined) {
				rejected++;
				continue;
			}
			for (const { kind, key, row } of entries) {
				const file = path.join(outDir, "probe", `${kind}.jsonl`);
				const keys = keysOf(file);
				if (keys.has(key)) {
					duplicates++;
					continue;
				}
				keys.add(key);
				if (!lines.has(file)) lines.set(file, []);
				lines.get(file).push(JSON.stringify({ key, row }));
				written++;
			}
		}
		for (const [file, list] of lines) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.appendFileSync(file, `${list.join("\n")}\n`);
		}
		log(`probe rows: ${written} new, ${duplicates} already kept, ${rejected} refused`);
		return { ok: true, written, duplicates, rejected };
	}

	async function handle(req) {
		if (!LOCAL_ADDRESSES.has(req.socket.remoteAddress)) throw new RequestError(403, "local requests only");
		if (!LOCAL_HOSTS.has(hostName(req.headers.host))) throw new RequestError(403, "bad Host");
		if (req.method === "GET") return { ok: true, service: "kv-rollback-receiver", outDir };
		if (req.method !== "POST") throw new RequestError(405, "GET or POST only");
		const type = String(req.headers["content-type"] || "");
		if (!type.toLowerCase().startsWith("application/json")) throw new RequestError(415, "application/json only");
		const declared = Number(req.headers["content-length"]);
		if (Number.isFinite(declared) && declared > maxBodyBytes) {
			throw new RequestError(413, `body over ${maxBodyBytes} bytes`);
		}
		const text = await readBody(req, maxBodyBytes);
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			throw new RequestError(400, "not JSON");
		}
		if (body === null || typeof body !== "object") throw new RequestError(400, "not an object");
		if (body.kind === "capture") return capture(body);
		if (body.kind === "probe") return probe(body);
		throw new RequestError(400, "kind must be capture or probe");
	}

	return http.createServer((req, res) => {
		handle(req).then(
			(answer) => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(answer));
			},
			(err) => {
				const status = err instanceof RequestError ? err.status : 500;
				log(`refused ${req.method} ${req.url}: ${status} ${err.message}`);
				res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
				res.end(JSON.stringify({ ok: false, error: err.message }));
			},
		);
	});
}

function parseArgs(argv) {
	const out = { port: DEFAULT_PORT, outDir: DEFAULT_OUT };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--port") out.port = Number(argv[++i]);
		else if (argv[i] === "--out") out.outDir = path.resolve(argv[++i]);
		else throw new Error(`unknown argument ${argv[i]} (use --port N, --out DIR)`);
	}
	if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error("bad --port");
	return out;
}

if (require.main === module) {
	const { port, outDir } = parseArgs(process.argv.slice(2));
	const server = createReceiver({ outDir });
	server.listen(port, "127.0.0.1", () => {
		console.log(`rollback receiver on http://127.0.0.1:${server.address().port}/ -> ${outDir}`);
		console.log('In Studio: Plugins > "Pull rollback captures". Ctrl+C to stop.');
	});
}

module.exports = { createReceiver, DEFAULT_PORT, MAX_BODY_BYTES };
