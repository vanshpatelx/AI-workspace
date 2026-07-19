import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MirroredDevice } from "@ai-workspace/protocol";

const run = promisify(execFile);

/**
 * Mirroring a running simulator into the Desktop app.
 *
 * A web dev server can simply be proxied — it *is* an HTTP server. A simulator
 * is not: its UI is a native window, so there is nothing to forward. The only
 * way across the wire is to capture frames and send input back the other way.
 *
 * Both halves are platform-specific, and unevenly supported:
 *
 *   iOS      capture works out of the box via simctl, but Apple ships no tap
 *            injection at all — that needs Meta's `idb`, installed separately.
 *   Android  `adb` does both, so if it is present at all, everything works.
 *
 * Capture is therefore always available and input degrades to unavailable with
 * a reason the UI can show, rather than silently swallowing taps.
 */

/** Frames arrive at roughly 3-4fps, so anything slower than this is a stall. */
const CAPTURE_TIMEOUT_MS = 8000;
const LIST_TIMEOUT_MS = 15_000;
const INPUT_TIMEOUT_MS = 5000;

async function has(tool: string): Promise<boolean> {
  try {
    // `which` rather than a shell builtin: passing a tool name through a shell
    // would make this injectable, and there is no reason to spawn one.
    await run("which", [tool], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Cached because probing the PATH on every frame would dominate capture cost. */
let toolCache: { idb: boolean; adb: boolean; at: number } | null = null;
const TOOL_CACHE_MS = 30_000;

async function tools(now = Date.now()): Promise<{ idb: boolean; adb: boolean }> {
  if (toolCache && now - toolCache.at < TOOL_CACHE_MS) return toolCache;
  const [idb, adb] = await Promise.all([has("idb"), has("adb")]);
  toolCache = { idb, adb, at: now };
  return toolCache;
}

/** Forget probed tools so a fresh `brew install` is picked up without a restart. */
export function forgetTools(): void {
  toolCache = null;
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

/** Booted iOS simulators. Empty (never throws) when Xcode is absent. */
async function listIos(idbPresent: boolean): Promise<MirroredDevice[]> {
  try {
    const { stdout } = await run("xcrun", ["simctl", "list", "devices", "booted", "-j"], {
      timeout: LIST_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as { devices: Record<string, SimctlDevice[]> };
    const out: MirroredDevice[] = [];
    for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
      for (const device of devices) {
        if (device.state !== "Booted") continue;
        out.push({
          id: device.udid,
          platform: "ios",
          name: device.name,
          // "com.apple.CoreSimulator.SimRuntime.iOS-18-6" -> "iOS 18.6":
          // the first dash separates the name, the rest are version dots.
          runtime: runtime.split(".").pop()?.replace("-", " ").replace(/-/g, ".") ?? "iOS",
          canInput: idbPresent,
          inputHint: idbPresent
            ? undefined
            : "Install idb to tap: brew install idb-companion && pip install fb-idb",
        });
      }
    }
    return out;
  } catch {
    return []; // No Xcode, or simctl failed — report nothing rather than guess.
  }
}

/** Attached Android devices and emulators. Empty when adb is absent. */
async function listAndroid(adbPresent: boolean): Promise<MirroredDevice[]> {
  if (!adbPresent) return [];
  try {
    const { stdout } = await run("adb", ["devices", "-l"], { timeout: LIST_TIMEOUT_MS });
    const out: MirroredDevice[] = [];
    for (const line of stdout.split("\n").slice(1)) {
      const [serial, state] = line.trim().split(/\s+/);
      if (!serial || state !== "device") continue;
      const model = line.match(/model:(\S+)/)?.[1]?.replace(/_/g, " ");
      out.push({
        id: serial,
        platform: "android",
        name: model ?? serial,
        runtime: serial.startsWith("emulator-") ? "Emulator" : "Device",
        // adb does capture and input with the same binary: if we can see it, we can tap it.
        canInput: true,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Everything currently mirrorable, across both platforms. */
export async function listDevices(): Promise<MirroredDevice[]> {
  const { idb, adb } = await tools();
  const [ios, android] = await Promise.all([listIos(idb), listAndroid(adb)]);
  return [...ios, ...android];
}

/** A captured frame and the encoding it came back in. */
export interface Frame {
  data: Buffer;
  mime: "image/jpeg" | "image/png";
}

/**
 * One frame.
 *
 * iOS is captured as JPEG deliberately. A PNG home screen is ~3.3MB, which at
 * four frames a second is 13MB/s — fine on loopback and hopeless over a network.
 * The same frame as JPEG is ~430KB, and the artefacts do not matter for looking
 * at a layout. `simctl io screenshot` also only writes to a path (passing `-`
 * creates a file literally named "-"), so it goes through a temp file that is
 * always cleaned up, even on failure.
 *
 * Android has no such choice: `screencap -p` emits PNG only. It streams straight
 * to stdout, so at least there is no temp file.
 */
export async function capture(device: MirroredDevice): Promise<Frame> {
  if (device.platform === "android") {
    const { stdout } = await run("adb", ["-s", device.id, "exec-out", "screencap", "-p"], {
      timeout: CAPTURE_TIMEOUT_MS,
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    });
    return { data: stdout as unknown as Buffer, mime: "image/png" };
  }

  const path = join(tmpdir(), `aiw-frame-${device.id}-${process.pid}.jpg`);
  try {
    await run("xcrun", ["simctl", "io", device.id, "screenshot", "--type=jpeg", path], {
      timeout: CAPTURE_TIMEOUT_MS,
    });
    return { data: await readFile(path), mime: "image/jpeg" };
  } finally {
    await unlink(path).catch(() => {});
  }
}

/**
 * Pixel dimensions of a frame, for PNG and JPEG alike.
 *
 * Needed because taps arrive as a fraction of the displayed image and have to be
 * scaled against the real frame — and the two platforms produce different
 * formats, so reading only one of them would silently break taps on the other.
 */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8-byte signature, then a 4-byte length + "IHDR", then width and height.
  if (buf.length >= 24 && buf.readUInt32BE(12) === 0x49484452) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: a chain of length-prefixed segments. Dimensions live in whichever
  // start-of-frame marker this file happens to use, so walk until one turns up.
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 9 < buf.length) {
    if (buf[at] !== 0xff) return null; // not aligned on a marker: give up
    const marker = buf[at + 1]!;
    // SOF0-3, SOF5-7, SOF9-11, SOF13-15 all carry the dimensions; the gaps
    // (C4/C8/CC) are Huffman and arithmetic-coding tables, not frames.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      // segment: marker(2) length(2) precision(1) height(2) width(2)
      return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
    }
    at += 2 + buf.readUInt16BE(at + 2);
  }
  return null;
}

/**
 * Where a tap lands, in the coordinate space the platform's input tool expects.
 *
 * The Desktop sends a fraction of the displayed image (0..1) rather than pixels,
 * because it renders the frame at whatever size the panel happens to be and has
 * no idea what the device's real geometry is. Resolving that here keeps the one
 * place that knows about pixels-versus-points in the same file as the tools.
 *
 * Android's `input tap` takes raw pixels, which is exactly what screencap gives.
 * iOS `idb ui tap` takes *points*, so the pixel frame must be divided by the
 * display scale — a 3x iPhone frame is 1206 wide but only 402 points across.
 */
export function resolveTap(
  device: MirroredDevice,
  fx: number,
  fy: number,
  frame: { width: number; height: number },
  scale: number,
): { x: number; y: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const divisor = device.platform === "ios" ? scale : 1;
  return {
    x: Math.round((clamp(fx) * frame.width) / divisor),
    y: Math.round((clamp(fy) * frame.height) / divisor),
  };
}

/** Display scale for a simulator, so pixel frames map onto point coordinates. */
async function iosScale(udid: string): Promise<number> {
  try {
    const { stdout } = await run("idb", ["describe", "--udid", udid, "--json"], {
      timeout: INPUT_TIMEOUT_MS,
    });
    const density = (JSON.parse(stdout) as { screen_dimensions?: { density?: number } })
      .screen_dimensions?.density;
    return typeof density === "number" && density > 0 ? density : 3;
  } catch {
    return 3; // Every current iPhone simulator is 3x; a wrong guess only skews taps.
  }
}

/**
 * Send a tap at a fractional position on the last captured frame.
 * Resolves to an error string rather than throwing, so a missing tool surfaces
 * in the UI as a message instead of taking down the Worker.
 */
export async function tap(
  device: MirroredDevice,
  fx: number,
  fy: number,
  frame: { width: number; height: number },
): Promise<string | null> {
  if (!device.canInput) return device.inputHint ?? "input not available for this device";
  try {
    if (device.platform === "android") {
      const { x, y } = resolveTap(device, fx, fy, frame, 1);
      await run("adb", ["-s", device.id, "shell", "input", "tap", String(x), String(y)], {
        timeout: INPUT_TIMEOUT_MS,
      });
      return null;
    }
    const { x, y } = resolveTap(device, fx, fy, frame, await iosScale(device.id));
    await run("idb", ["ui", "tap", "--udid", device.id, String(x), String(y)], {
      timeout: INPUT_TIMEOUT_MS,
    });
    return null;
  } catch (err) {
    return `tap failed: ${(err as Error).message}`;
  }
}

/** Type text into whatever field currently has focus on the device. */
export async function typeText(device: MirroredDevice, text: string): Promise<string | null> {
  if (!device.canInput) return device.inputHint ?? "input not available for this device";
  if (!text) return null;
  try {
    if (device.platform === "android") {
      // `input text` reads spaces as argument separators.
      await run("adb", ["-s", device.id, "shell", "input", "text", text.replace(/ /g, "%s")], {
        timeout: INPUT_TIMEOUT_MS,
      });
      return null;
    }
    await run("idb", ["ui", "text", "--udid", device.id, text], { timeout: INPUT_TIMEOUT_MS });
    return null;
  } catch (err) {
    return `text failed: ${(err as Error).message}`;
  }
}

/** Hardware buttons that have no on-screen equivalent to tap. */
export async function pressKey(
  device: MirroredDevice,
  key: "home" | "back" | "enter" | "backspace",
): Promise<string | null> {
  if (!device.canInput) return device.inputHint ?? "input not available for this device";
  try {
    if (device.platform === "android") {
      const code = { home: "HOME", back: "BACK", enter: "ENTER", backspace: "DEL" }[key];
      await run("adb", ["-s", device.id, "shell", "input", "keyevent", `KEYCODE_${code}`], {
        timeout: INPUT_TIMEOUT_MS,
      });
      return null;
    }
    // iOS has no Back button; the rest map onto idb's named buttons and keys.
    if (key === "back") return "iOS has no back button";
    if (key === "home") {
      await run("idb", ["ui", "button", "--udid", device.id, "HOME"], { timeout: INPUT_TIMEOUT_MS });
      return null;
    }
    const keycode = key === "enter" ? "40" : "42"; // HID usage codes: Return, Backspace
    await run("idb", ["ui", "key", "--udid", device.id, keycode], { timeout: INPUT_TIMEOUT_MS });
    return null;
  } catch (err) {
    return `key failed: ${(err as Error).message}`;
  }
}
