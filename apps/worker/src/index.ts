/**
 * Worker library surface.
 *
 * The runnable entrypoint is the `aiw` CLI in cli.ts. This module re-exports
 * the pieces other packages (and tests) may want to import directly.
 */
export { startWorker, type RunningWorker } from "./server.js";
export { KeepAwake } from "./keepawake.js";
export { detectAgents, agentLabel, type DetectedAgent } from "./agents.js";
export * from "./config.js";
