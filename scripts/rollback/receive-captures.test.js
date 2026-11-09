// node:test spec of the rollback receiver (scripts/rollback/receive-captures.js): a capture and probe rows land in
// their files (rows deduplicated by key), bad requests are refused (runId, Host, content type, body size), and the
// literals the receiver and the Studio plugin repeat match shared/spikes ROLLBACK_CAPTURE.
"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const { createReceiver, DEFAULT_PORT } = require("./receive-captures");

const REPO = path.resolve(__dirname, "..", "..");

function request(port, { method = "POST", body, host, type = "application/json" } = {}) {
	return new Promise((resolve, reject) => {
		const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
		const headers = { Host: host ?? `localhost:${port}` };
		if (data !== undefined) {
			headers["Content-Type"] = type;
			headers["Content-Length"] = Buffer.byteLength(data);
		}
		const req = http.request({ host: "127.0.0.1", port, method, path: "/", headers }, (res) => {
			let text = "";
			res.on("data", (c) => (text += c));
			res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : undefined }));
		});
		req.on("error", reject);
		if (data !== undefined) req.write(data);
		req.end();
	});
}

async function withReceiver(options, fn) {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kv-rollback-"));
	const lines = [];
	const server = createReceiver({ outDir, log: (l) => lines.push(l), ...options });
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		await fn(server.address().port, outDir, lines);
	} finally {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(outDir, { recursive: true, force: true });
	}
}

const META = { v: 1, ticks: 1200, players: 2, chunks: 2, bytes: 9, encoding: "base64" };

test("a capture and probe rows land in captures/", async () => {
	await withReceiver({}, async (port, outDir) => {
		const ping = await request(port, { method: "GET" });
		assert.equal(ping.status, 200);
		assert.equal(ping.body.ok, true);

		const runId = "0f8e2a6c-1d3b-4c5e-9a7f-112233445566";
		const posted = await request(port, { body: { kind: "capture", runId, meta: META, chunks: ["AAAA", "BBBB"] } });
		assert.equal(posted.status, 200);
		const doc = JSON.parse(fs.readFileSync(path.join(outDir, `${runId}.json`), "utf8"));
		assert.deepEqual(doc.meta, META);
		assert.deepEqual(doc.chunks, ["AAAA", "BBBB"]);
		assert.equal(doc.runId, runId);

		const rows = [
			{ key: "s1/cpu/0", value: { v: 1, kind: "cpu", summary: { horizon: 16 } } },
			{ key: "s1/live/0", value: { v: 1, kind: "live", summary: {} } },
			{ key: "s1/cpu/1", value: { v: 1, kind: "cpu", summary: { horizon: 16 } } },
			{ key: "s1/gpu/0", value: { v: 1, kind: "gpu" } },
		];
		const first = await request(port, { body: { kind: "probe", rows } });
		assert.equal(first.status, 200);
		assert.deepEqual([first.body.written, first.body.duplicates, first.body.rejected], [3, 0, 1]);
		const again = await request(port, { body: { kind: "probe", rows } });
		assert.deepEqual([again.body.written, again.body.duplicates, again.body.rejected], [0, 3, 1]);
		const cpu = fs.readFileSync(path.join(outDir, "probe", "cpu.jsonl"), "utf8").trim().split("\n");
		assert.equal(cpu.length, 2);
		assert.equal(JSON.parse(cpu[0]).key, "s1/cpu/0");
		assert.equal(JSON.parse(cpu[0]).row.summary.horizon, 16);
		const liveLines = fs.readFileSync(path.join(outDir, "probe", "live.jsonl"), "utf8").trim().split("\n");
		assert.equal(liveLines.length, 1);
		assert.deepEqual(fs.readdirSync(path.join(outDir, "probe")).sort(), ["cpu.jsonl", "live.jsonl"]);
	});
});

test("a restarted receiver still skips the rows its files hold", async () => {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kv-rollback-"));
	try {
		const row = { key: "s2/live/4", value: { v: 1, kind: "live" } };
		for (const expected of [1, 0]) {
			await new Promise((resolve, reject) => {
				const server = createReceiver({ outDir, log: () => {} });
				server.listen(0, "127.0.0.1", async () => {
					try {
						const r = await request(server.address().port, { body: { kind: "probe", rows: [row] } });
						assert.equal(r.body.written, expected);
						server.close(resolve);
					} catch (err) {
						server.close(() => reject(err));
					}
				});
			});
		}
	} finally {
		fs.rmSync(outDir, { recursive: true, force: true });
	}
});

test("bad requests are refused and write nothing", async () => {
	await withReceiver({ maxBodyBytes: 2048 }, async (port, outDir) => {
		const capture = (runId, extra = {}) => ({ kind: "capture", runId, meta: META, chunks: ["AAAA", "BBBB"], ...extra });
		assert.equal((await request(port, { body: capture("../escape") })).status, 400);
		assert.equal((await request(port, { body: capture("a/b") })).status, 400);
		assert.equal((await request(port, { body: capture("ok", { chunks: ["AAAA"] }) })).status, 400);
		assert.equal((await request(port, { body: capture("ok", { meta: [1] }) })).status, 400);
		assert.equal((await request(port, { body: { kind: "other" } })).status, 400);
		assert.equal((await request(port, { body: "{not json", type: "application/json" })).status, 400);
		assert.equal((await request(port, { body: capture("ok"), type: "text/plain" })).status, 415);
		assert.equal((await request(port, { body: capture("ok"), host: "evil.example:80" })).status, 403);
		assert.equal((await request(port, { method: "PUT", body: capture("ok") })).status, 405);
		const big = capture("ok", { meta: { ...META, chunks: 1 }, chunks: ["A".repeat(4096)] });
		assert.equal((await request(port, { body: big })).status, 413);
		assert.deepEqual(fs.readdirSync(outDir), []);
	});
});

test("the receiver's and the plugin's literals match shared/spikes ROLLBACK_CAPTURE", () => {
	const source = fs.readFileSync(path.join(REPO, "src", "shared", "spikes", "rollbackSpike.ts"), "utf8");
	const field = (name) => {
		const m = source.match(new RegExp(`\\b${name}:\\s*("?)([^",\\n]+)\\1,`));
		assert.ok(m, `ROLLBACK_CAPTURE.${name} not found`);
		return m[2];
	};
	const port = Number(field("receiverPort"));
	assert.equal(DEFAULT_PORT, port);
	const plugin = fs.readFileSync(path.join(REPO, "plugin", "RollbackCapturePlugin.server.lua"), "utf8");
	assert.match(plugin, new RegExp(`local RECEIVER_PORT = ${port}\\b`));
	assert.match(plugin, new RegExp(`local CAPTURE_STORE = "${field("captureStore")}"`));
	assert.match(plugin, new RegExp(`local PROBE_STORE = "${field("probeStore")}"`));
	assert.match(plugin, new RegExp(`local META_SUFFIX = "${field("keySeparator")}${field("metaKey")}"`));
});
