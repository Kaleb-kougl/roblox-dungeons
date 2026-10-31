import { useEffect, useState } from "@rbxts/react";
import { Players } from "@rbxts/services";

/**
 * Player headshots for the Daily's rank layer (docs/DAILY.md DS10): the friend toasts (ToastPanel) and the run-over row
 * of friends passed (DailyPassedRow), and yesterday's podium on the menu (DailyCard, DS9). One session cache per user id; `Players:GetUserThumbnailAsync` (HeadShot 48x48)
 * yields, so it runs on its own thread, once per id (a failure is cached as "" and never retried this session: the UI
 * then shows the name alone). DailyRankController prefetches the nearest friends at a daily run's start.
 */
const cache = new Map<number, string>();
const waiting = new Map<number, Array<(image: string) => void>>();

/** The cached headshot image of `userId` ("" fetched but failed), or undefined while unknown / in flight. */
export function headshotOf(userId: number): string | undefined {
	return cache.get(userId);
}

/** Fetches `userId`'s headshot once per session; `done` (optional) gets the image (maybe "") when known. */
export function fetchHeadshot(userId: number, done?: (image: string) => void): void {
	const known = cache.get(userId);
	if (known !== undefined) {
		done?.(known);
		return;
	}
	if (userId <= 0) {
		// Test / Studio players (UserId <= 0) have no headshot.
		cache.set(userId, "");
		done?.("");
		return;
	}
	const queue = waiting.get(userId);
	if (queue !== undefined) {
		if (done !== undefined) queue.push(done);
		return;
	}
	const callbacks = new Array<(image: string) => void>();
	if (done !== undefined) callbacks.push(done);
	waiting.set(userId, callbacks);
	task.spawn(() => {
		const [ok, image] = pcall(
			() => Players.GetUserThumbnailAsync(userId, Enum.ThumbnailType.HeadShot, Enum.ThumbnailSize.Size48x48)[0],
		);
		const result = ok && typeIs(image, "string") ? image : "";
		cache.set(userId, result);
		waiting.delete(userId);
		for (const cb of callbacks) cb(result);
	});
}

/** A React hook: `userId`'s headshot image ("" while unknown or failed), fetched on mount. */
export function useHeadshot(userId: number): string {
	const [image, setImage] = useState(() => headshotOf(userId) ?? "");
	useEffect(() => {
		let live = true;
		fetchHeadshot(userId, (img) => {
			if (live) setImage(img);
		});
		return () => {
			live = false;
		};
	}, [userId]);
	return image;
}
