/**
 * Window statistics for the rollback probe (docs/ROLLBACK_SPIKE.md Design 5): p50 / p95 / max of the samples taken
 * over one window (ROLLBACK_SPIKE.statsWindowSec), nearest-rank quantiles. Pure.
 */
import type { RollbackProbeStat } from "shared/spikes";

const P50 = 0.5;
const P95 = 0.95;

/** The nearest-rank q-quantile of `sorted` (ascending); 0 for an empty list. */
function rankOf(sorted: ReadonlyArray<number>, q: number): number {
	const n = sorted.size();
	if (n === 0) return 0;
	const rank = math.clamp(math.ceil(q * n), 1, n);
	return sorted[rank - 1];
}

/** Samples of one window (cleared at its end). */
export class WindowSamples {
	private readonly values: number[] = [];
	private sum = 0;

	add(v: number): void {
		this.values.push(v);
		this.sum += v;
	}

	count(): number {
		return this.values.size();
	}

	total(): number {
		return this.sum;
	}

	mean(): number {
		const n = this.values.size();
		return n > 0 ? this.sum / n : 0;
	}

	/** p50 / p95 / max (zeros for an empty window), each scaled by `scale` (seconds -> ms: 1000). */
	stat(scale = 1): RollbackProbeStat {
		const sorted = [...this.values];
		sorted.sort((a, b) => a < b);
		const n = sorted.size();
		if (n === 0) return { p50: 0, p95: 0, max: 0 };
		return { p50: rankOf(sorted, P50) * scale, p95: rankOf(sorted, P95) * scale, max: sorted[n - 1] * scale };
	}

	/** The q-quantile, scaled. */
	quantile(q: number, scale = 1): number {
		const sorted = [...this.values];
		sorted.sort((a, b) => a < b);
		return rankOf(sorted, q) * scale;
	}

	clear(): void {
		this.values.clear();
		this.sum = 0;
	}
}
