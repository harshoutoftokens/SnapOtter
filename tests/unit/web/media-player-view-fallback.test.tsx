// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  getDistinctId: () => null,
  captureHandledError: vi.fn(() => Promise.resolve(null)),
  setSentryTag: vi.fn(),
}));

import { MediaPlayerView } from "@/components/tools/media-player-view";
import { I18nProvider } from "@/contexts/i18n-context";
import { useFileStore } from "@/stores/file-store";

const PROCESSED_URL = "/api/v1/download/job-42/output.ogv";
const PREVIEW_GENERATE_URL = "/api/v1/preview/generate";

beforeEach(() => {
  useFileStore.getState().reset();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:preview",
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  cleanup();
  useFileStore.getState().reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(sourcePayload: () => Promise<unknown>) {
  const fetchMock = vi.fn((input: string) => {
    if (input === PROCESSED_URL) {
      return sourcePayload();
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(["preview-bytes"], { type: "video/mp4" })),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("MediaPlayerView transcode fallback (#1503)", () => {
  it("previews the processed result when processedUrl is present", async () => {
    const inputFile = new File(["original-input-bytes"], "input.mp4", { type: "video/mp4" });
    useFileStore.getState().setFiles([inputFile]);
    useFileStore.getState().updateEntry(0, {
      processedUrl: PROCESSED_URL,
      processedFilename: "output.ogv",
      processedSize: 9999,
    });

    const fetchMock = stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(["processed-ogv-bytes"], { type: "video/ogg" })),
      }),
    );

    render(
      <I18nProvider>
        <MediaPlayerView />
      </I18nProvider>,
    );

    // Trigger unsupported codec fallback (videoWidth === 0)
    const video = screen.getByTestId("media-player-video");
    fireEvent.loadedMetadata(video);

    // The NonNativePreview fallback is now rendered
    const generateBtn = screen.getByRole("button", { name: /generate preview/i });
    expect(generateBtn).toBeTruthy();
    expect(screen.getByText("output.ogv")).toBeTruthy();

    fireEvent.click(generateBtn);
    await act(async () => {});

    // Assert that the processed result was fetched, NOT the input file
    const sourceFetchCalls = fetchMock.mock.calls.filter(([url]) => url === PROCESSED_URL);
    expect(sourceFetchCalls).toHaveLength(1);

    const generateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(PREVIEW_GENERATE_URL),
    );
    expect(generateCalls).toHaveLength(1);

    const formData = generateCalls[0][1]?.body as FormData;
    const uploaded = formData.get("file") as File;
    expect(uploaded.name).toBe("output.ogv");
  });

  it("previews the input file when no processed result exists", async () => {
    const inputFile = new File(["original-input-bytes"], "input.ogv", { type: "video/ogg" });
    useFileStore.getState().setFiles([inputFile]);

    const fetchMock = stubFetch(() => Promise.reject(new Error("Should not fetch source")));

    render(
      <I18nProvider>
        <MediaPlayerView />
      </I18nProvider>,
    );

    const video = screen.getByTestId("media-player-video");
    fireEvent.loadedMetadata(video);

    const generateBtn = screen.getByRole("button", { name: /generate preview/i });
    expect(generateBtn).toBeTruthy();
    expect(screen.getByText("input.ogv")).toBeTruthy();

    fireEvent.click(generateBtn);
    await act(async () => {});

    // Assert no remote source fetch was made
    const sourceFetchCalls = fetchMock.mock.calls.filter(([url]) => url === PROCESSED_URL);
    expect(sourceFetchCalls).toHaveLength(0);

    const generateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(PREVIEW_GENERATE_URL),
    );
    expect(generateCalls).toHaveLength(1);

    const formData = generateCalls[0][1]?.body as FormData;
    const uploaded = formData.get("file") as File;
    expect(uploaded.name).toBe("input.ogv");
  });
});
