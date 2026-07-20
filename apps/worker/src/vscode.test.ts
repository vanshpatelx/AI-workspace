import { describe, it, expect } from "vitest";
import { _test } from "./vscode.js";

describe("resolving the VS Code download", () => {
  const { assetName, VERSION } = _test;

  // The asset name must match a real code-server release file, or the download
  // 404s and every Code tab breaks. Pin the exact shapes per platform.
  it("names the macOS arm64 asset", () => {
    expect(assetName("darwin", "arm64")).toBe(`code-server-${VERSION}-macos-arm64.tar.gz`);
  });
  it("names the macOS x64 asset", () => {
    expect(assetName("darwin", "x64")).toBe(`code-server-${VERSION}-macos-amd64.tar.gz`);
  });
  it("names the Linux arm64 asset", () => {
    expect(assetName("linux", "arm64")).toBe(`code-server-${VERSION}-linux-arm64.tar.gz`);
  });
  it("names the Linux x64 asset", () => {
    expect(assetName("linux", "x64")).toBe(`code-server-${VERSION}-linux-amd64.tar.gz`);
  });

  // Windows has no code-server tarball; better to say so than to download a 404.
  it("returns null on an unsupported platform", () => {
    expect(assetName("win32", "x64")).toBeNull();
  });
});
