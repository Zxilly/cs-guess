import { once } from "node:events";
import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import * as msgpackParser from "socket.io-msgpack-parser";

const timeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms),
    ),
  ]);

async function removeEventually(path) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { force: true, recursive: true });
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off(event, handleEvent);
      socket.off("connect_error", handleError);
    };
    const handleEvent = (value) => {
      cleanup();
      resolve(value);
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once(event, handleEvent);
    socket.once("connect_error", handleError);
  });
}

function waitForMatchingEvent(socket, event, predicate) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off(event, handleEvent);
      socket.off("connect_error", handleError);
    };
    const handleEvent = (value) => {
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    socket.on(event, handleEvent);
    socket.once("connect_error", handleError);
  });
}

function createSocket(baseUrl, namespace, auth = undefined, reconnect = false) {
  return io(`${baseUrl}${namespace}`, {
    path: "/socket.io",
    parser: msgpackParser,
    auth,
    forceNew: true,
    reconnection: reconnect,
    reconnectionAttempts: reconnect ? 5 : 0,
    reconnectionDelay: 20,
    reconnectionDelayMax: 100,
    timeout: 3_000,
  });
}

function waitForCompressedWebSocket(socket) {
  const engine = socket.io.engine;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      engine.off("upgrade", inspect);
      engine.off("upgradeError", fail);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const inspect = (transport) => {
      if (transport.name !== "websocket") return;
      cleanup();
      const extensions = transport.ws?.extensions ?? "";
      if (!extensions.includes("permessage-deflate")) {
        reject(new Error(`WebSocket compression was not negotiated: ${extensions || "none"}`));
        return;
      }
      resolve(extensions);
    };

    engine.on("upgrade", inspect);
    engine.on("upgradeError", fail);
    inspect(engine.transport);
  });
}

async function createRoom(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity_id: "0samas",
      visibility: "hidden",
      max_players: 2,
      best_of: 1,
    }),
  });
  if (!response.ok) throw new Error(`create room failed: ${await response.text()}`);
  return response.json();
}

async function joinRoom(baseUrl, roomCode) {
  const response = await fetch(`${baseUrl}/v1/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity_id: "1nvisiblee" }),
  });
  if (!response.ok) throw new Error(`join room failed: ${await response.text()}`);
  return response.json();
}

async function waitForReady(baseUrl) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Socket.IO test server did not become ready");
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const databasePath = join(tmpdir(), `cs-guess-socketio-e2e-${process.pid}.sqlite`);
const targetDir = join(tmpdir(), `cs-guess-socketio-target-${process.pid}`);
const build = spawn("cargo", ["+1.97.1", "build", "--quiet", "--manifest-path", "server/Cargo.toml"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CARGO_TARGET_DIR: targetDir,
  },
  stdio: "inherit",
});
const [buildCode] = await once(build, "exit");
if (buildCode !== 0) throw new Error(`Socket.IO E2E server build failed with code ${buildCode}`);

const serverBinary = join(
  targetDir,
  "debug",
  process.platform === "win32" ? "cs-guess-server.exe" : "cs-guess-server",
);
const server = spawn(serverBinary, [], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CS_GUESS_BIND_ADDR: `127.0.0.1:${port}`,
    CS_GUESS_PUBLIC_BASE_URL: baseUrl,
    CS_GUESS_DATABASE_PATH: databasePath,
    CS_GUESS_QUEUE_BROADCAST_MS: "10",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let failure = "";
let serverExited = false;
server.once("exit", () => {
  serverExited = true;
});
server.stderr.on("data", (chunk) => { failure += chunk; });

try {
  await waitForReady(baseUrl);

  const queue = createSocket(baseUrl, "/queue");
  const compression = timeout(
    waitForCompressedWebSocket(queue),
    3_000,
    "compressed WebSocket upgrade",
  );
  const counts = await timeout(waitForEvent(queue, "queue_counts"), 3_000, "queue counts");
  if (typeof counts?.total !== "number") throw new Error("queue count payload is invalid");
  await compression;
  queue.disconnect();

  const session = await createRoom(baseUrl);
  if (typeof session.socket_io_url !== "string") throw new Error("missing socket_io_url");
  const auth = { room_code: session.room_code, session_token: session.session_token };
  const room = createSocket(baseUrl, "/room", auth, true);
  const snapshot = await timeout(waitForEvent(room, "message"), 3_000, "initial room snapshot");
  if (snapshot?.type !== "snapshot") throw new Error("room did not send a snapshot");

  const requestId = crypto.randomUUID();
  const command = { type: "set_visibility", request_id: requestId, visibility: "open" };
  const updatePromise = timeout(waitForEvent(room, "message"), 3_000, "command event");
  const first = await timeout(room.timeout(3_000).emitWithAck("command", command), 3_500, "command ack");
  const update = await updatePromise;
  if (update?.type !== "visibility_changed" || update?.visibility !== "open") {
    throw new Error("accepted command did not produce the expected visibility event");
  }

  let duplicateUpdates = 0;
  const countDuplicate = (event) => {
    if (event?.type === "visibility_changed") duplicateUpdates += 1;
  };
  room.on("message", countDuplicate);
  const duplicate = await timeout(room.timeout(3_000).emitWithAck("command", command), 3_500, "duplicate command ack");
  await new Promise((resolve) => setTimeout(resolve, 100));
  room.off("message", countDuplicate);
  if (!first?.accepted || !duplicate?.accepted) throw new Error("command ack was not accepted/idempotent");
  if (duplicateUpdates !== 0) throw new Error("duplicate request_id produced another room event");

  const guestSession = await joinRoom(baseUrl, session.room_code);
  const guest = createSocket(
    baseUrl,
    "/room",
    {
      room_code: guestSession.room_code,
      session_token: guestSession.session_token,
    },
    true,
  );
  await timeout(
    waitForMatchingEvent(guest, "message", (event) => event?.type === "snapshot"),
    3_000,
    "guest initial snapshot",
  );
  const roundStarted = timeout(
    waitForMatchingEvent(room, "message", (event) => event?.type === "round_started"),
    3_000,
    "round start event",
  );
  const startAck = await timeout(
    room.timeout(3_000).emitWithAck("command", {
      type: "start_round",
      request_id: crypto.randomUUID(),
    }),
    3_500,
    "start round ack",
  );
  if (!startAck?.accepted) throw new Error("friend room did not accept start_round");
  await roundStarted;

  const guessRequestId = crypto.randomUUID();
  const guessCommand = {
    type: "guess",
    request_id: guessRequestId,
    player_id: "donk",
  };
  let opponentProgressCount = 0;
  const countProgress = (event) => {
    if (event?.type === "opponent_progress") opponentProgressCount += 1;
  };
  guest.on("message", countProgress);
  const firstGuessEvent = timeout(
    waitForMatchingEvent(
      room,
      "message",
      (event) =>
        event?.type === "guess_accepted" &&
        event?.request_id === guessRequestId,
    ),
    3_000,
    "first guess event",
  );
  const firstGuessAck = await timeout(
    room.timeout(3_000).emitWithAck("command", guessCommand),
    3_500,
    "first guess ack",
  );
  const firstGuess = await firstGuessEvent;
  const duplicateGuessEvent = timeout(
    waitForMatchingEvent(
      room,
      "message",
      (event) =>
        event?.type === "guess_accepted" &&
        event?.request_id === guessRequestId,
    ),
    3_000,
    "replayed guess event",
  );
  const duplicateGuessAck = await timeout(
    room.timeout(3_000).emitWithAck("command", guessCommand),
    3_500,
    "duplicate guess ack",
  );
  const duplicateGuess = await duplicateGuessEvent;
  await new Promise((resolve) => setTimeout(resolve, 100));
  guest.off("message", countProgress);
  if (!firstGuessAck?.accepted || !duplicateGuessAck?.accepted) {
    throw new Error("guess request_id retry was not accepted");
  }
  if (firstGuess?.seq !== duplicateGuess?.seq) {
    throw new Error("guess request_id retry did not replay the original event sequence");
  }
  if (opponentProgressCount !== 1) {
    throw new Error(`guess request_id retry broadcast progress ${opponentProgressCount} times`);
  }

  const reconnectPromise = timeout(waitForEvent(room, "connect"), 3_000, "automatic reconnect");
  if (!room.io.engine?.transport) throw new Error("Socket.IO transport is unavailable");
  room.io.engine.transport.close();
  await reconnectPromise;
  const sync = await timeout(
    room.timeout(3_000).emitWithAck("sync"),
    3_500,
    "reconnect sync ack",
  );
  if (!sync?.accepted || typeof sync?.snapshot?.seq !== "number") {
    throw new Error("reconnect did not restore a sequenced snapshot");
  }
  guest.disconnect();
  room.disconnect();
  console.log("Socket.IO E2E passed: compressed WebSocket upgrade, queue, room auth/snapshot, command and guess idempotency, reconnect snapshot");
} finally {
  if (!serverExited) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  if (!serverExited) {
    server.kill("SIGKILL");
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
  await removeEventually(databasePath);
  await removeEventually(`${databasePath}-wal`);
  await removeEventually(`${databasePath}-shm`);
  await removeEventually(targetDir);
}

if (failure.includes("server stopped with an error")) {
  throw new Error(failure);
}
