import { GlobalEvents } from "shared/network";

/**
 * Client-side bound remotes (task 8). `createClient` may only run on the client, which is why this lives here and not
 * in shared/network.ts.
 *
 * Usage: `Events.submitRun.fire(submission)` to send, `Events.runVerdict.connect((verdict) => ...)` to receive.
 */
export const Events = GlobalEvents.createClient({});
