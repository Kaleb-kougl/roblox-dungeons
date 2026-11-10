/**
 * The rollback probe's Parallel Luau worker (docs/ROLLBACK_SPIKE.md Design 5 / 7, tasks R3a / R3 / R4b). Shipped
 * DISABLED (worker.meta.json) under StarterPlayerScripts.TS.rollbackWorker; RollbackSpikeController clones it into an
 * Actor it creates under PlayerScripts (with the reply BindableEvent ROLLBACK_WORKER_TOPIC.replyEventName inside) and
 * enables the clone. Outside an Actor (the template itself, should the meta file not apply) it does nothing.
 *
 * It imports only shared modules and services (a clone's relative requires would break): the imports below are the
 * serial-phase requires at the worker's start (`require` is not allowed while desynchronized). Then:
 *   toWorker topic (BindToMessageParallel): every message re-read (readMainToWorker), queued in the
 *     RollbackWorkerCore and pumped desynchronized; between slices it yields (task.synchronize: the queued posts go
 *     out through the BindableEvent; task.desynchronize: back to a parallel phase); the digest send is timed around its
 *     Fire only
 *   facts topic (BindToMessage, serial): the R3a facts (facts.ts), answered as { kind: "facts", step, ... }
 * Its VM is its own: the mirror's module scratch can never touch the main sim's.
 */
import { RunService } from "@rbxts/services";
import {
	ROLLBACK_SPIKE,
	ROLLBACK_WORKER_TOPIC,
	RollbackWorkerCore,
	buildFactsRun,
	busyWait,
	readBufferProbe,
	readMainToWorker,
	readTableProbe,
	stepFactsRun,
	type RollbackWorkerHost,
} from "shared/lockstep";

const FACTS = ROLLBACK_SPIKE.probe.facts;
const LABELS = ROLLBACK_SPIKE.probe.profileLabels;
const MS = 1000;

function startWorker(owner: Actor): void {
	const reply = owner.WaitForChild(ROLLBACK_WORKER_TOPIC.replyEventName) as BindableEvent;
	let frames = 0;
	RunService.Heartbeat.Connect(() => {
		frames++;
	});
	const outbox: defined[] = [];
	/** Serial phase only: the queued posts to the main thread. */
	const flush = () => {
		for (const m of outbox) reply.Fire(m);
		outbox.clear();
	};
	const host: RollbackWorkerHost = {
		clock() {
			return os.clock();
		},
		frameIndex() {
			return frames;
		},
		gcKb() {
			return gcinfo();
		},
		post(msg) {
			outbox.push(msg as defined);
		},
		sendDigest(data, sentAt) {
			task.synchronize();
			const t0 = os.clock();
			reply.Fire({ kind: "digest", sentAt, data });
			const sec = os.clock() - t0;
			flush();
			task.desynchronize();
			return sec;
		},
		yieldSlice() {
			task.synchronize();
			flush();
			task.desynchronize();
		},
		profileBegin(label) {
			debug.profilebegin(label);
		},
		profileEnd() {
			debug.profileend();
		},
	};
	const core = new RollbackWorkerCore(host);

	owner.BindToMessageParallel(ROLLBACK_WORKER_TOPIC.toWorker, (raw: unknown) => {
		const msg = readMainToWorker(raw, core.partySize());
		if (msg === undefined) {
			core.fail("worker: a malformed message from the main thread");
		} else {
			core.receive(msg);
			const [ok, err] = pcall(() => core.pump());
			if (!ok) core.fail(`worker: ${tostring(err)}`);
		}
		task.synchronize();
		flush();
	});

	owner.BindToMessage(ROLLBACK_WORKER_TOPIC.facts, (step: unknown, payload: unknown) => facts(step, payload));
	reply.Fire({ kind: "ready" });

	/** R3a (serial entry; each step answers through the reply event). */
	function facts(step: unknown, payload: unknown): void {
		const answer = (data: Record<string, unknown>) => reply.Fire({ kind: "facts", step, ...data });
		if (step === "sim") {
			const run = buildFactsRun(); // serial
			task.desynchronize();
			const [ok, res] = pcall(() => stepFactsRun(run, FACTS.stepTicks, () => os.clock()));
			task.synchronize();
			if (ok) answer({ ok: true, ms: res.ms, hash: res.hash });
			else answer({ ok: false, error: tostring(res) });
		} else if (step === "table") {
			answer({ seen: readTableProbe(payload) });
		} else if (step === "buffer") {
			// The answer carries a buffer back through the BindableEvent too.
			const back = buffer.create(1);
			buffer.writeu8(back, 0, FACTS.marker);
			answer({ seen: readBufferProbe(payload), back });
		} else if (step === "shared") {
			let seen = `not a SharedTable (${typeOf(payload)})`;
			if (typeOf(payload) === "SharedTable") {
				const st = payload as SharedTable;
				seen = st.marker === FACTS.marker ? "a SharedTable, content intact" : "a SharedTable, content changed";
				st.marker = FACTS.mutated;
			}
			answer({ seen });
		} else if (step === "profile") {
			const endAt = os.clock() + FACTS.profileSec;
			const conn = RunService.Heartbeat.ConnectParallel(() => {
				debug.profilebegin(LABELS.facts);
				busyWait(FACTS.taskMs[0], () => os.clock());
				debug.profileend();
			});
			task.delay(FACTS.profileSec, () => {
				conn.Disconnect();
				answer({ done: os.clock() >= endAt - 1 / MS });
			});
		} else if (step === "busy" && typeIs(payload, "number")) {
			const conn = RunService.Heartbeat.ConnectParallel(() => busyWait(payload, () => os.clock()));
			task.delay(FACTS.phaseSec, () => {
				conn.Disconnect();
				answer({ done: true });
			});
		} else if (step === "replyActor" && typeIs(payload, "Instance") && payload.IsA("Actor")) {
			const target = payload;
			task.desynchronize();
			const [ok, err] = pcall(() => target.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "fromWorker"));
			task.synchronize();
			answer({ ok, error: ok ? undefined : tostring(err) });
		}
	}
}

// Last: a function declaration compiles to a local assigned in place, so the call comes after it.
const actor = script.GetActor();
if (actor !== undefined) startWorker(actor);
