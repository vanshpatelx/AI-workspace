import { describe, it, expect } from "vitest";
import type { MirroredDevice } from "@ai-workspace/protocol";
import { imageSize, resolveTap } from "./devices.js";

const iphone: MirroredDevice = {
  id: "UDID",
  platform: "ios",
  name: "iPhone 16 Pro",
  runtime: "iOS 18.6",
  canInput: true,
};
const pixel: MirroredDevice = {
  id: "emulator-5554",
  platform: "android",
  name: "Pixel 8",
  runtime: "Emulator",
  canInput: true,
};

/** A minimal but valid PNG header: signature + IHDR length/type + dimensions. */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/**
 * A JPEG carrying one table segment before the frame header, so the parser has
 * to actually walk the segment chain rather than assume a fixed offset.
 */
function jpegHeader(width: number, height: number): Buffer {
  const table = Buffer.alloc(10);
  table.writeUInt16BE(0xffdb, 0); // DQT
  table.writeUInt16BE(8, 2); // segment length, covering the 6 bytes after it
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); // SOF0
  sof.writeUInt16BE(9, 2);
  sof.writeUInt8(8, 4); // sample precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), table, sof]);
}

describe("reading frame dimensions", () => {
  // Android capture is PNG.
  it("reads width and height from a PNG header", () => {
    expect(imageSize(pngHeader(1080, 2400))).toEqual({ width: 1080, height: 2400 });
  });

  // iOS capture is JPEG, and dimensions sit behind a variable run of segments.
  it("reads width and height from a JPEG, walking past earlier segments", () => {
    expect(imageSize(jpegHeader(1206, 2622))).toEqual({ width: 1206, height: 2622 });
  });

  // Anything that is not a frame must not produce a bogus coordinate space.
  it("returns null for data that is neither PNG nor JPEG", () => {
    expect(imageSize(Buffer.from("not an image at all, but long enough to read"))).toBeNull();
  });

  it("returns null for a truncated frame", () => {
    expect(imageSize(pngHeader(100, 100).subarray(0, 16))).toBeNull();
  });

  // A JPEG that ends before any frame header must not loop or misread.
  it("returns null for a JPEG with no frame header", () => {
    const truncated = jpegHeader(100, 100).subarray(0, 12);
    expect(imageSize(truncated)).toBeNull();
  });
});

describe("mapping a tap onto the device", () => {
  const frame = { width: 1206, height: 2622 };

  // Android's `input tap` speaks the same pixels that screencap produces.
  it("uses raw pixels on Android", () => {
    expect(resolveTap(pixel, 0.5, 0.5, { width: 1080, height: 2400 }, 1)).toEqual({
      x: 540,
      y: 1200,
    });
  });

  // idb speaks points, so a 3x frame must be divided down. Tapping the centre
  // of a 1206px-wide frame means point 201, not 603 — which would be off-screen.
  it("converts pixels to points on iOS", () => {
    expect(resolveTap(iphone, 0.5, 0.5, frame, 3)).toEqual({ x: 201, y: 437 });
  });

  it("maps the corners to the edges of the device", () => {
    expect(resolveTap(iphone, 0, 0, frame, 3)).toEqual({ x: 0, y: 0 });
    expect(resolveTap(iphone, 1, 1, frame, 3)).toEqual({ x: 402, y: 874 });
  });

  // A drag that leaves the panel, or a rounding overshoot, must not produce a
  // coordinate outside the screen where the tap would simply be swallowed.
  it("clamps positions outside the frame", () => {
    expect(resolveTap(iphone, 1.4, -0.2, frame, 3)).toEqual({ x: 402, y: 0 });
  });

  it("keeps the two axes independent", () => {
    const { x, y } = resolveTap(pixel, 0.25, 0.75, { width: 1000, height: 2000 }, 1);
    expect({ x, y }).toEqual({ x: 250, y: 1500 });
  });
});
