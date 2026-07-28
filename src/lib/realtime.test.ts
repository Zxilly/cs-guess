/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  CLOSING_INTENT_TTL_MS,
  cancelQuickMatch,
  clearClosingIntentIfMatches,
  clearCredentialsIfMatches,
  createRoom,
  isAuthoritativeRoomSnapshot,
  joinRoom,
  loadClosingIntent,
  loadCredentials,
  playingCountFor,
  queueCountFor,
  roomSessionErrorMessage,
  saveClosingIntent,
  saveCredentials,
  type MatchmakingQueueCounts,
} from "@/lib/realtime";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("realtime closing intent", () => {
  const credentials = {
    roomCode: "CS-123456",
    playerId: "player-1",
    sessionToken: "secret-token",
    socketIoUrl: "/socket.io",
    mode: "room",
  } as const;

  it("binds a persisted tombstone to the exact credential identity without storing its bearer token", () => {
    saveClosingIntent(credentials, "/");

    const raw = sessionStorage.getItem(
      "cs-guess:realtime-closing-intent",
    )!;
    expect(raw).not.toContain("secret-token");
    expect(loadClosingIntent(credentials)).toMatchObject({
      mode: "room",
      roomCode: "CS-123456",
      playerId: "player-1",
      returnTo: "/",
    });
    expect(
      loadClosingIntent({ ...credentials, sessionToken: "new-token" }),
    ).toBeNull();
  });

  it("retains a mismatched current-session tombstone, clears only its exact owner, and expires stale intents", () => {
    saveClosingIntent(credentials, "/");
    clearClosingIntentIfMatches({
      ...credentials,
      sessionToken: "new-token",
    });
    expect(loadClosingIntent(credentials)).not.toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CLOSING_INTENT_TTL_MS + 1);
    expect(loadClosingIntent()).toBeNull();
  });

  it("does not remove a newer session in another mode when an old leave settles", () => {
    const oldRoom = credentials;
    saveClosingIntent(oldRoom, "/");
    saveCredentials(
      {
        room_code: "CS-654321",
        player_id: "quick-player",
        session_token: "quick-token",
        socket_io_url: "/socket.io",
        snapshot: {},
      },
      "quick",
    );

    expect(loadCredentials("room")).toBeNull();
    clearCredentialsIfMatches(oldRoom);
    expect(loadCredentials("quick")?.credentials).toMatchObject({
      roomCode: "CS-654321",
      sessionToken: "quick-token",
    });
  });
});

describe("matchmaking queue counts", () => {
  it("reports counts for the selected difficulty instead of the aggregate queue", () => {
    const counts = {
      bo3_hidden: 9,
      playing_bo3: 12,
      easy: { bo3_hidden: 2, playing_bo3: 4 },
      full: { bo3_hidden: 3, playing_bo3: 6 },
      hard: { bo3_hidden: 4, playing_bo3: 2 },
    } as unknown as MatchmakingQueueCounts;

    expect(queueCountFor(counts, 2, 3, "hidden", "easy")).toBe(2);
    expect(queueCountFor(counts, 2, 3, "hidden", "hard")).toBe(4);
    expect(playingCountFor(counts, 2, 3, "full")).toBe(6);
  });
});

describe("friend room configuration", () => {
  it("sends the selected difficulty and player limit when creating a room", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          room_code: "CS-123456",
          player_id: "player",
          session_token: "token",
          socket_io_url: "/socket.io",
          snapshot: {
            difficulty: "full",
            max_players: 6,
          },
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createRoom("donk", "hidden", 6, 5, "full");

    const [, request] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(request.body))).toMatchObject({
      identity_id: "donk",
      visibility: "hidden",
      max_players: 6,
      best_of: 5,
      difficulty: "full",
    });
  });

  it("preserves a structured server error code without exposing its English message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "profile_not_found",
            message: "profile lookup failed for internal row 42",
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(joinRoom("CS-123456", "missing-player")).rejects.toMatchObject({
      status: 404,
      code: "profile_not_found",
      message: "当前身份已失效，请重新选择身份。",
    });
  });

  it("preserves unknown server codes while using a safe localized fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "database_shard_moved",
            error: "internal database hostname leaked",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(joinRoom("CS-123456", "donk")).rejects.toMatchObject({
      status: 500,
      code: "database_shard_moved",
      message: "对战服务器暂时无法完成请求，请稍后重试。",
    });
  });

  it("classifies network failures for action-specific recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(joinRoom("CS-123456", "donk")).rejects.toMatchObject({
      code: "network_error",
      message: "无法连接对战服务器，请检查网络后重试。",
    });
  });
});

describe("friend room error recovery messages", () => {
  const expected = {
    bad_request: {
      join: "房间号或身份信息无效，请检查后重试。",
      create: "房间设置无效，请调整人数、难度或赛制后重试。",
    },
    room_not_found: {
      join: "没有找到这个房间，请检查 6 位房间号后重试。",
      create: "房间已失效，请重新创建。",
    },
    room_full: {
      join: "房间已满或对局已经开始，请向房主确认后重试。",
      create: "房间状态已变化，请重新创建。",
    },
    profile_not_found: {
      join: "当前身份已失效，请先到身份页重新选择身份。",
      create: "当前身份已失效，请先到身份页重新选择身份。",
    },
    idempotency_conflict: {
      join: "加入请求与上次操作冲突，请确认房间号后重试。",
      create: "创建请求与上次设置冲突，请稍候后重新创建。",
    },
    capacity_reached: {
      join: "房间服务当前繁忙，请稍后重新加入。",
      create: "当前房间数量已达上限，请稍后重新创建。",
    },
    rate_limited: {
      join: "加入操作过于频繁，请稍候后重试。",
      create: "创建操作过于频繁，请稍候后重试。",
    },
    unauthorized: {
      join: "当前会话已失效，请刷新页面后重新加入。",
      create: "当前会话已失效，请刷新页面后重新创建。",
    },
    unavailable: {
      join: "对战服务暂时不可用，请稍后重新加入。",
      create: "对战服务暂时不可用，请稍后重新创建。",
    },
    internal_error: {
      join: "对战服务暂时无法加入房间，请稍后重试。",
      create: "对战服务暂时无法创建房间，请稍后重试。",
    },
    network_error: {
      join: "无法连接对战服务器，请检查网络后重新加入。",
      create: "无法连接对战服务器，请检查网络后重新创建。",
    },
    invalid_response: {
      join: "服务器返回了异常数据，请刷新页面后重新加入。",
      create: "服务器返回了异常数据，请刷新页面后重新创建。",
    },
  } as const;

  for (const [code, messages] of Object.entries(expected)) {
    it(`maps ${code} for join and create without leaking the server message`, () => {
      const error = new ApiError(
        "sensitive backend details",
        code === "unavailable" ? 503 : 400,
        code,
      );

      expect(roomSessionErrorMessage(error, "join")).toBe(messages.join);
      expect(roomSessionErrorMessage(error, "create")).toBe(messages.create);
    });
  }

  it("uses action-specific safe fallbacks for unknown failures", () => {
    expect(
      roomSessionErrorMessage(
        new ApiError("sensitive backend details", 500, "unknown_code"),
        "join",
      ),
    ).toBe("加入房间失败，请检查房间号后重试。");
    expect(roomSessionErrorMessage(new Error("unexpected"), "create")).toBe(
      "创建房间失败，请检查房间设置后重试。",
    );
  });
});

describe("realtime session persistence", () => {
  it("derives authoritative validation while keeping legacy credentials migratable", () => {
    const validSnapshot = {
      seq: 1,
      room_code: "CS-123456",
      phase: "waiting",
      self_player_id: "self",
      host_player_id: "self",
      max_players: 2,
      max_guesses: 8,
      best_of: 3,
      difficulty: "hard",
      visibility: "hidden",
      round_number: 0,
      players: [],
    };
    expect(isAuthoritativeRoomSnapshot(validSnapshot)).toBe(true);
    expect(isAuthoritativeRoomSnapshot({ phase: "waiting" })).toBe(false);

    sessionStorage.setItem(
      "cs-guess:realtime-session",
      JSON.stringify({
        credentials: {
          roomCode: "CS-123456",
          playerId: "self",
          sessionToken: "token",
          socketIoUrl: "/socket.io",
          mode: "room",
        },
        snapshot: {},
        startedAt: Date.now(),
      }),
    );

    const migrated = loadCredentials("room");
    expect(migrated?.credentials.sessionToken).toBe("token");
    expect(migrated?.hasAuthoritativeSnapshot).toBe(false);
  });

  it("persists the original matchmaking start time across reloads", () => {
    vi.useFakeTimers();
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const storage = new Map<string, string>();
    vi.mocked(sessionStorage.getItem).mockImplementation(
      (key) => storage.get(key) ?? null,
    );
    vi.mocked(sessionStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, value);
    });
    vi.setSystemTime(new Date("2026-07-28T00:00:00Z"));
    const response = {
      room_code: "CS-123456",
      player_id: "player",
      session_token: "token",
      socket_io_url: "/socket.io",
      snapshot: { phase: "waiting" },
    };

    saveCredentials(response, "quick");
    vi.setSystemTime(new Date("2026-07-28T00:02:00Z"));

    expect(loadCredentials("quick")?.startedAt).toBe(
      new Date("2026-07-28T00:00:00Z").getTime(),
    );
  });

  it("only clears the exact session that completed cancellation", () => {
    const oldTicket = {
      room_code: "CS-123456",
      player_id: "old-player",
      session_token: "old-token",
      socket_io_url: "/socket.io",
      snapshot: {},
    };
    const newTicket = {
      ...oldTicket,
      room_code: "CS-654321",
      player_id: "new-player",
      session_token: "new-token",
    };
    saveCredentials(newTicket, "quick");

    clearCredentialsIfMatches({
      roomCode: oldTicket.room_code,
      playerId: oldTicket.player_id,
      sessionToken: oldTicket.session_token,
      socketIoUrl: oldTicket.socket_io_url,
      mode: "quick",
    });

    expect(loadCredentials("quick")?.credentials.roomCode).toBe("CS-654321");
  });
});

describe("quick match cancellation errors", () => {
  it("preserves server error codes and messages for recovery decisions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "room_not_found",
            message: "ticket expired",
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      cancelQuickMatch({
        roomCode: "CS-123456",
        playerId: "player",
        sessionToken: "token",
        socketIoUrl: "/socket.io",
        mode: "quick",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "room_not_found",
      message: "房间不存在，请检查房间号。",
    });
  });
});
