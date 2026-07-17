import { PROTOCOL_VERSION, type WorkspaceSummary } from "@ai-workspace/protocol";

/**
 * Worker entrypoint.
 *
 * Runs on every machine. Responsible for launching AI agents, tracking
 * sessions, exposing local resources, and streaming updates to the Desktop
 * app over an encrypted transport.
 *
 * This is a skeleton — the transport server, agent adapters, and session
 * store are stubbed and land in follow-up commits.
 */

function describeSelf(): WorkspaceSummary {
  return {
    workerId: "local",
    hostname: "localhost",
    status: "online",
    repo: null,
    agent: null,
    activeTask: null,
    progress: null,
    cpu: null,
    mem: null,
  };
}

function main(): void {
  console.log(`ai-workspace worker (protocol v${PROTOCOL_VERSION})`);
  console.log("self:", describeSelf());
  console.log("TODO: start transport server, register agent adapters");
}

main();
