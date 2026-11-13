/**
 * Census shards: a long census over run seeds 1..total split into `count` spec files of consecutive seeds, so each file
 * runs in its own process within a few minutes (the headless runner filters by file path) and the shards can run side
 * by side. Shard `index` (1-based) of `count` over `total` seeds; the last shard takes any remainder. Test support only.
 */
export function censusShard(index: number, count: number, total: number): readonly [number, number] {
	if (index < 1 || index > count || index % 1 !== 0) error(`census shard ${index} of ${count}`, 0);
	const size = math.floor(total / count);
	const first = (index - 1) * size + 1;
	const last = index === count ? total : index * size;
	return [first, last];
}
