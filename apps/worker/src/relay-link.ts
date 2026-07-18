import { WebSocket } from "ws";
import type { TransportServer } from "@ai-workspace/transport";
import { log } from "./log.js";

/**
 * Outbound link to a relay.
 *
 * The Worker dials the relay instead of waiting to be dialled, which is what
 * makes it reachable from behind NAT without a VPN. The resulting socket is
 * attached to the same TransportServer that serves direct connections, so
 * pairing-code auth and every message handler apply identically — a relayed
 * Desktop gets no more trust than a local one.
 */
export class RelayLink {
  private socket: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private relayUrl: string,
    private workerId: string,
    private server: TransportServer,
  ) {}

  /** The URL a Desktop should use to reach this Worker through the relay. */
  clientUrl(): string {
    return `${this.relayUrl.replace(/\/$/, "")}/client?id=${encodeURIComponent(this.workerId)}`;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const url = `${this.relayUrl.replace(/\/$/, "")}/worker?id=${encodeURIComponent(this.workerId)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on("open", () => {
      this.attempt = 0;
      log.relay(`connected · reachable at ${this.clientUrl()}`);
      // Hand the socket to the transport so it behaves like any other client.
      this.server.attach(socket);
    });

    socket.on("close", (code, reason) => {
      if (this.closed) return;
      const detail = reason.toString() || String(code);
      // Back off so a relay that is down doesn't get hammered.
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
      log.relay(`disconnected (${detail}) · retrying in ${delay / 1000}s`);
      this.timer = setTimeout(() => this.connect(), delay);
    });

    socket.on("error", (err) => {
      log.error(`relay: ${err.message}`);
    });
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
  }
}
