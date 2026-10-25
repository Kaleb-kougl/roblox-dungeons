import { GlobalEvents } from "shared/network";

/**
 * Server-side bound remotes. `createServer` may only run on the server, which is why it lives here and not in
 * shared/network.ts. Rate limits are per player in the services that own each event (RunValidationService,
 * SettingsService), with their budgets in shared data.
 *
 * Usage: `Events.submitRun.connect((player, submission) => ...)`, `Events.runVerdict.fire(player, verdict)`.
 */
export const Events = GlobalEvents.createServer({});
