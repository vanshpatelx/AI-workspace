import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { reloadMetro } from "./preview.js";

let server: Server | null = null;

/** A stand-in for the dev server, answering on a port the OS picks for us. */
async function listen(handler: (path: string) => { status: number; body: string }): Promise<number> {
  server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? "/");
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as { port: number }).port;
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = null;
});

describe("reloading a React Native app", () => {
  it("reports success when Metro accepts the reload", async () => {
    const port = await listen((path) =>
      path === "/reload" ? { status: 200, body: "OK" } : { status: 404, body: "" },
    );
    expect(await reloadMetro(port)).toBeNull();
  });

  // The button must not claim success when the server refused.
  it("surfaces the status code when Metro refuses", async () => {
    const port = await listen(() => ({ status: 500, body: "boom" }));
    expect(await reloadMetro(port)).toBe("Metro answered 500");
  });

  // Reaching for a port nothing is listening on is the common mistake, and it
  // has to read as a message rather than an unhandled rejection.
  it("reports a port with nothing on it instead of throwing", async () => {
    // Port 9 (discard) is reserved and never serves HTTP.
    await expect(reloadMetro(9)).resolves.toBe("could not reach Metro on that port");
  });
});
