import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@ai-workspace/protocol";
import { decode, encode, isServerMessage } from "./frame.js";

export interface TransportClientHandlers {
  onOpen?(): void;
  onMessage?(msg: ServerMessage): void;
  onClose?(): void;
  onError?(err: Error): void;
}

/**
 * WebSocket transport client, used by the Desktop app.
 *
 * Reconnects automatically with a fixed backoff so a Worker restart or a
 * dropped VPN link recovers without user action.
 */
export class TransportClient {
  private socket: WebSocket | null = null;
  private closed = false;
  private readonly outbox: ClientMessage[] = [];

  constructor(
    private url: string,
    private handlers: TransportClientHandlers = {},
    private reconnectMs = 1000,
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.on("open", () => {
      for (const msg of this.outbox.splice(0)) socket.send(encode(msg));
      this.handlers.onOpen?.();
    });

    socket.on("message", (data) => {
      let msg;
      try {
        msg = decode(data.toString());
      } catch (err) {
        this.handlers.onError?.(err as Error);
        return;
      }
      if (isServerMessage(msg)) this.handlers.onMessage?.(msg);
    });

    socket.on("close", () => {
      this.handlers.onClose?.();
      if (!this.closed) setTimeout(() => this.open(), this.reconnectMs);
    });

    socket.on("error", (err) => this.handlers.onError?.(err as Error));
  }

  /** Send a client message, queuing it if the socket is not open yet. */
  send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encode(msg));
    } else {
      this.outbox.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }
}
