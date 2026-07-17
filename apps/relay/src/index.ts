import { PROTOCOL_VERSION } from "@ai-workspace/protocol";

/**
 * Optional relay.
 *
 * Forwards end-to-end encrypted frames between a Desktop app and a Worker when
 * a direct connection (Tailscale/WireGuard/LAN/SSH) is unavailable.
 *
 * STATELESS BY DESIGN: it never persists repositories, prompts, conversations,
 * terminal history, media, files, or databases. It only pairs sockets and
 * relays opaque bytes.
 */

function main(): void {
  console.log(`ai-workspace relay (protocol v${PROTOCOL_VERSION}) — stateless`);
  console.log("TODO: pair sockets by session token, forward opaque frames");
}

main();
