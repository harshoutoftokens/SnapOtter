import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtures, readFixture } from "../../fixtures/index.js";

// Load ESM zxing-wasm reader module instance
const { prepareZXingModule, purgeZXingModule, readBarcodes } = await import(
  new URL("../../../apps/api/node_modules/zxing-wasm/dist/es/reader/index.js", import.meta.url).href
);

// Require resolver anchored at barcode-read route
const require = createRequire(
  new URL("../../../apps/api/src/routes/tools/barcode-read.ts", import.meta.url),
);

describe("barcode-read offline wasm loading (#1385)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Ensure module is left in configured state with local wasm
    const wasmBinary = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
    prepareZXingModule({ overrides: { wasmBinary } });
  });

  it("verifies unconfigured zxing-wasm attempts remote fetch to jsdelivr CDN", async () => {
    purgeZXingModule();

    let fetchedUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      fetchedUrl = String(url);
      return Promise.reject(new Error("Network request blocked"));
    });

    const dummyImg = {
      data: new Uint8ClampedArray(16 * 16 * 4).fill(255),
      width: 16,
      height: 16,
    } as ImageData;

    await expect(readBarcodes(dummyImg)).rejects.toThrow();
    expect(fetchedUrl).toContain("fastly.jsdelivr.net/npm/zxing-wasm");
  });

  it("decodes barcodes when fetch throws (100% offline without CDN download)", async () => {
    purgeZXingModule();

    // Prepare with local wasm as done in apps/api/src/routes/tools/barcode-read.ts
    const wasmBinary = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
    prepareZXingModule({ overrides: { wasmBinary } });

    // Stub global fetch to fail unconditionally if any network call is attempted
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Network request blocked in offline environment");
    });

    const buf = readFixture(fixtures.image.code.qrPng);
    const image = sharp(buf);
    const meta = await image.metadata();
    const rawData = await image.ensureAlpha().raw().toBuffer();

    const imageData = {
      data: new Uint8ClampedArray(rawData.buffer, rawData.byteOffset, rawData.length),
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    } as ImageData;

    const results = await readBarcodes(imageData);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toBe("https://snapotter.com");
    expect(results[0].format).toBe("QRCode");
  });
});
