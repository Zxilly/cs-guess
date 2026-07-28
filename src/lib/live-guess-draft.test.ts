/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLiveGuessDraft,
  clearLiveGuessDraftsForRoom,
  liveGuessDraftKey,
  loadLiveGuessDraft,
  saveLiveGuessDraft,
} from "@/lib/live-guess-draft";

describe("live guess draft", () => {
  beforeEach(() => sessionStorage.clear());

  it("isolates lightweight drafts by room and round", () => {
    saveLiveGuessDraft("CS-123456", 1, {
      query: "don",
      selectedId: "donk",
    });
    saveLiveGuessDraft("CS-123456", 2, {
      query: "zyw",
      selectedId: "zywoo",
    });
    saveLiveGuessDraft("CS-654321", 1, {
      query: "niko",
      selectedId: "niko",
    });

    expect(loadLiveGuessDraft("CS-123456", 1)).toEqual({
      query: "don",
      selectedId: "donk",
    });
    expect(loadLiveGuessDraft("CS-123456", 2)).toEqual({
      query: "zyw",
      selectedId: "zywoo",
    });
    expect(loadLiveGuessDraft("CS-654321", 1)).toEqual({
      query: "niko",
      selectedId: "niko",
    });
  });

  it("clears one completed round or every draft for an explicitly exited room", () => {
    saveLiveGuessDraft("CS-123456", 1, { query: "don" });
    saveLiveGuessDraft("CS-123456", 2, { query: "zyw" });
    saveLiveGuessDraft("CS-654321", 1, { query: "niko" });

    clearLiveGuessDraft("CS-123456", 1);
    expect(loadLiveGuessDraft("CS-123456", 1)).toEqual({ query: "" });
    expect(loadLiveGuessDraft("CS-123456", 2).query).toBe("zyw");

    clearLiveGuessDraftsForRoom("CS-123456");
    expect(loadLiveGuessDraft("CS-123456", 2)).toEqual({ query: "" });
    expect(loadLiveGuessDraft("CS-654321", 1).query).toBe("niko");
  });

  it("rejects invalid scopes and malformed persisted values", () => {
    expect(liveGuessDraftKey("bad", 1)).toBeNull();
    expect(liveGuessDraftKey("CS-123456", 0)).toBeNull();
    const key = liveGuessDraftKey("CS-123456", 1)!;
    sessionStorage.setItem(key, "{bad json");

    expect(loadLiveGuessDraft("CS-123456", 1)).toEqual({ query: "" });
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
