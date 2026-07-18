import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@ai-workspace/protocol";
import { decode, encode, isClientMessage } from "./frame.js";

export interface TransportConnection {
  readonly id: string;
  send(msg: ServerMessage): void;
  close(): void;
}

export interface TransportServerHandlers {
  onConnect?(conn: TransportConnection): void;
  onMessage?(conn: TransportConnection, msg: ClientMessage): void;
  onDisconnect?(conn: TransportConnection): void;
  onError?(err: Error): void;
}

export interface TransportServerOptions {
  port: number;
  host?: string;
}

/**
 * WebSocket transport server, hosted by the Worker.
 *
 * Deliberately thin: it only decodes/encodes frames and surfaces typed
 * client messages. All domain logic (agents, sessions, approvals) lives in
 * the Worker's handlers.
 */
export class TransportServer {
  private wss: WebSocketServer;
  private seq = 0;
  private readonly conns = new Map<string, TransportConnection>();

  constructor(opts: TransportServerOptions, private handlers: TransportServerHandlers = {}) {
    this.wss = new WebSocketServer({ port: opts.port, host: opts.host ?? "127.0.0.1" });

    this.wss.on("connection", (socket: WebSocket) => this.accept(socket));
    this.wss.on("error", (err) => this.handlers.onError?.(err as Error));
  }

  /**
   * Treat an already-open socket as an inbound connection.
   *
   * Used for relay mode: the Worker dials out to a relay, and the resulting
   * socket is handed here so every message handler, auth check and broadcast
   * behaves exactly as it does for a direct connection.
   */
  attach(socket: WebSocket): void {
    this.accept(socket);
  }

  private accept(socket: WebSocket): void {
    const id = `c${++this.seq}`;
    const conn: TransportConnection = {
      id,
      send: (msg) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(encode(msg));
      },
      close: () => socket.close(),
    };
    this.conns.set(id, conn);
    this.handlers.onConnect?.(conn);

    socket.on("message", (data) => {
      let msg;
      try {
        msg = decode(data.toString());
      } catch (err) {
        this.handlers.onError?.(err as Error);
        return;
      }
      if (isClientMessage(msg)) {
        // A handler that throws must not tear down the whole Worker process.
        try {
          this.handlers.onMessage?.(conn, msg);
        } catch (err) {
          this.handlers.onError?.(err as Error);
        }
      }
    });

    socket.on("close", () => {
      this.conns.delete(id);
      this.handlers.onDisconnect?.(conn);
    });

    socket.on("error", (err) => this.handlers.onError?.(err as Error));
  }

  /** Send a message to every connected client. */
  broadcast(msg: ServerMessage): void {
    for (const conn of this.conns.values()) conn.send(msg);
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  /**
   * Stop accepting connections and drop existing ones.
   *
   * `wss.close()` only completes once every client socket is gone, so open
   * Desktop connections must be terminated first — otherwise shutdown hangs
   * forever and Ctrl+C appears to do nothing.
   */
  close(): Promise<void> {
    for (const socket of this.wss.clients) socket.terminate();
    this.conns.clear();
    return new Promise((resolve) => {
      const done = setTimeout(resolve, 2000); // never block shutdown
      this.wss.close(() => {
        clearTimeout(done);
        resolve();
      });
    });
  }
}
