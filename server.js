const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const colors = [
  "#147c72", "#c84c31", "#3559a6", "#9a5c00", "#6f4bb8",
  "#16814a", "#bd3f7b", "#4c6f14", "#7e4d2a", "#1e6b8f"
];

const state = createInitialState();

function createInitialState() {
  return {
    participants: [],
    goals: [],
    participantsDone: false,
    goalsDone: false,
    running: false,
    status: "입력 대기",
    ladder: [],
    routes: [],
    colors
  };
}

function resetState() {
  const fresh = createInitialState();
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, fresh);
}

function clearGame() {
  state.running = false;
  state.status = "입력 대기";
  state.ladder = [];
  state.routes = [];
}

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function canStart() {
  return state.participantsDone &&
    state.goalsDone &&
    state.participants.length > 0 &&
    state.participants.length === state.goals.length &&
    !state.running;
}

function getNotice() {
  if (state.running) return "";
  if (!state.participantsDone || !state.goalsDone) return "참여자와 Goal을 각각 완료해 주세요.";
  if (state.participants.length === 0 || state.goals.length === 0) return "입력값이 필요합니다.";
  if (state.participants.length !== state.goals.length) {
    return "참여자 수와 Goal 수를 같게 맞춰 주세요.";
  }
  return "";
}

function publicState() {
  return {
    ...state,
    canStart: canStart(),
    notice: getNotice()
  };
}

function generateLadder(columns) {
  if (columns < 2) return [];
  const rowCount = Math.max(7, columns * 2 + 3);
  const ladder = Array.from({ length: rowCount }, () => Array(columns - 1).fill(false));

  for (let row = 0; row < rowCount; row += 1) {
    for (let gap = 0; gap < columns - 1; gap += 1) {
      const leftBlocked = gap > 0 && ladder[row][gap - 1];
      if (!leftBlocked && Math.random() < 0.34) {
        ladder[row][gap] = true;
        gap += 1;
      }
    }
  }

  for (let gap = 0; gap < columns - 1; gap += 1) {
    const hasBridge = ladder.some((row) => row[gap]);
    if (!hasBridge) {
      const row = Math.floor(Math.random() * rowCount);
      const leftBlocked = gap > 0 && ladder[row][gap - 1];
      const rightBlocked = gap < columns - 2 && ladder[row][gap + 1];
      if (!leftBlocked && !rightBlocked) {
        ladder[row][gap] = true;
      }
    }
  }

  return ladder;
}

function getGeometry(columns, rows) {
  const left = 70;
  const right = 830;
  const top = 24;
  const bottom = 396;
  const bridgeTop = 58;
  const bridgeBottom = 362;
  const gapX = columns === 1 ? 0 : (right - left) / (columns - 1);
  const gapY = rows <= 1 ? 0 : (bridgeBottom - bridgeTop) / (rows - 1);
  return { left, right, top, bottom, bridgeTop, bridgeBottom, gapX, gapY };
}

function xFor(col, geo) {
  return geo.left + col * geo.gapX;
}

function yFor(row, geo) {
  return geo.bridgeTop + row * geo.gapY;
}

function routeFor(startCol) {
  const columns = state.participants.length;
  const rows = Math.max(state.ladder.length, 1);
  const geo = getGeometry(columns, rows);
  let col = startCol;
  const points = [{ x: xFor(col, geo), y: geo.top }];

  state.ladder.forEach((row, rowIndex) => {
    const y = yFor(rowIndex, geo);
    points.push({ x: xFor(col, geo), y });

    if (row[col]) {
      col += 1;
      points.push({ x: xFor(col, geo), y });
    } else if (col > 0 && row[col - 1]) {
      col -= 1;
      points.push({ x: xFor(col, geo), y });
    }
  });

  points.push({ x: xFor(col, geo), y: geo.bottom });
  return { points, endCol: col };
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("JSON 형식이 올바르지 않습니다."), { status: 400 });
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, error) {
  sendJson(res, error.status || 500, {
    error: error.message || "서버 오류가 발생했습니다."
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/state") {
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "POST" && pathname === "/api/items") {
    if (state.running) throw Object.assign(new Error("진행 중에는 수정할 수 없습니다."), { status: 409 });
    const { kind, value } = await readJson(req);
    const text = normalize(value);
    if (!text) throw Object.assign(new Error("입력값이 필요합니다."), { status: 400 });

    if (kind === "participant") {
      state.participants.push(text);
      state.participantsDone = false;
    } else if (kind === "goal") {
      state.goals.push(text);
      state.goalsDone = false;
    } else {
      throw Object.assign(new Error("알 수 없는 항목입니다."), { status: 400 });
    }

    clearGame();
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/items") {
    if (state.running) throw Object.assign(new Error("진행 중에는 수정할 수 없습니다."), { status: 409 });
    const { kind, index } = await readJson(req);
    const numericIndex = Number(index);

    if (!Number.isInteger(numericIndex) || numericIndex < 0) {
      throw Object.assign(new Error("삭제 위치가 올바르지 않습니다."), { status: 400 });
    }

    if (kind === "participant" && numericIndex < state.participants.length) {
      state.participants.splice(numericIndex, 1);
      state.participantsDone = false;
    } else if (kind === "goal" && numericIndex < state.goals.length) {
      state.goals.splice(numericIndex, 1);
      state.goalsDone = false;
    } else {
      throw Object.assign(new Error("삭제할 항목을 찾을 수 없습니다."), { status: 404 });
    }

    clearGame();
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "POST" && pathname === "/api/finish") {
    if (state.running) throw Object.assign(new Error("진행 중에는 완료 처리할 수 없습니다."), { status: 409 });
    const { kind } = await readJson(req);

    if (kind === "participant") {
      state.participantsDone = state.participants.length > 0;
    } else if (kind === "goal") {
      state.goalsDone = state.goals.length > 0;
    } else {
      throw Object.assign(new Error("알 수 없는 완료 요청입니다."), { status: 400 });
    }

    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "POST" && pathname === "/api/start") {
    if (!canStart()) throw Object.assign(new Error(getNotice() || "시작할 수 없습니다."), { status: 409 });
    state.running = true;
    state.status = "진행 중";
    state.ladder = generateLadder(state.participants.length);
    state.routes = state.participants.map((_, index) => routeFor(index));
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "POST" && pathname === "/api/complete") {
    const { message } = await readJson(req);
    state.running = false;
    state.status = normalize(message) || "게임 종료";
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "POST" && pathname === "/api/reset") {
    resetState();
    sendJson(res, 200, publicState());
    return;
  }

  sendJson(res, 404, { error: "API를 찾을 수 없습니다." });
}

async function serveStatic(req, res, pathname) {
  let requested = pathname === "/" || pathname === "/ladder.html" ? "/index.html" : pathname;
  requested = decodeURIComponent(requested);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "접근할 수 없습니다." });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("파일을 찾을 수 없습니다.");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ladder C/S server running at http://${HOST}:${PORT}`);
});
