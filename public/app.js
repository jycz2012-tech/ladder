const colors = [
  "#147c72", "#c84c31", "#3559a6", "#9a5c00", "#6f4bb8",
  "#16814a", "#bd3f7b", "#4c6f14", "#7e4d2a", "#1e6b8f"
];

let serverMode = true;

const state = {
  participants: [],
  goals: [],
  participantsDone: false,
  goalsDone: false,
  running: false,
  status: "입력 대기",
  ladder: [],
  routes: [],
  colors,
  canStart: false,
  notice: ""
};

let currentIndex = 0;

const el = {
  participantInput: document.querySelector("#participantInput"),
  goalInput: document.querySelector("#goalInput"),
  addParticipantBtn: document.querySelector("#addParticipantBtn"),
  addGoalBtn: document.querySelector("#addGoalBtn"),
  finishParticipantsBtn: document.querySelector("#finishParticipantsBtn"),
  finishGoalsBtn: document.querySelector("#finishGoalsBtn"),
  participantItems: document.querySelector("#participantItems"),
  goalItems: document.querySelector("#goalItems"),
  participantCount: document.querySelector("#participantCount"),
  goalCount: document.querySelector("#goalCount"),
  startBtn: document.querySelector("#startBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  notice: document.querySelector("#notice"),
  statusPill: document.querySelector("#statusPill"),
  namesRow: document.querySelector("#namesRow"),
  goalsRow: document.querySelector("#goalsRow"),
  ladderSvg: document.querySelector("#ladderSvg"),
  results: document.querySelector("#results"),
  singleWinnerMode: document.querySelector("#singleWinnerMode")
};

function mergeState(nextState) {
  Object.assign(state, nextState);
}

function normalize(value) {
  return value.trim().replace(/\s+/g, " ");
}

function canStartLocal() {
  return state.participantsDone &&
    state.goalsDone &&
    state.participants.length > 0 &&
    state.participants.length === state.goals.length &&
    !state.running;
}

function getNoticeLocal() {
  if (state.running) return "";
  if (!state.participantsDone || !state.goalsDone) return "참여자와 Goal을 각각 완료해 주세요.";
  if (state.participants.length === 0 || state.goals.length === 0) return "입력값이 필요합니다.";
  if (state.participants.length !== state.goals.length) {
    return "참여자 수와 Goal 수를 같게 맞춰 주세요.";
  }
  return "";
}

function refreshDerivedState() {
  state.canStart = canStartLocal();
  state.notice = getNoticeLocal();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  }
  return payload;
}

async function requestState() {
  try {
    mergeState(await api("/api/state"));
  } catch {
    serverMode = false;
    refreshDerivedState();
  }
  render();
}

function setNotice(message) {
  el.notice.textContent = message || "";
}

async function addItem(kind) {
  if (state.running) return;
  const input = kind === "participant" ? el.participantInput : el.goalInput;
  const value = normalize(input.value);
  if (!value) return;

  try {
    if (serverMode) {
      mergeState(await api("/api/items", {
        method: "POST",
        body: JSON.stringify({ kind, value })
      }));
    } else if (kind === "participant") {
      state.participants.push(value);
      state.participantsDone = false;
      state.status = "입력 대기";
      state.ladder = [];
      state.routes = [];
      refreshDerivedState();
    } else {
      state.goals.push(value);
      state.goalsDone = false;
      state.status = "입력 대기";
      state.ladder = [];
      state.routes = [];
      refreshDerivedState();
    }
    input.value = "";
    input.focus();
    clearBoard();
    render();
  } catch (error) {
    setNotice(error.message);
  }
}

async function removeItem(kind, index) {
  if (state.running) return;

  try {
    if (serverMode) {
      mergeState(await api("/api/items", {
        method: "DELETE",
        body: JSON.stringify({ kind, index })
      }));
    } else if (kind === "participant") {
      state.participants.splice(index, 1);
      state.participantsDone = false;
      state.status = "입력 대기";
      state.ladder = [];
      state.routes = [];
      refreshDerivedState();
    } else {
      state.goals.splice(index, 1);
      state.goalsDone = false;
      state.status = "입력 대기";
      state.ladder = [];
      state.routes = [];
      refreshDerivedState();
    }
    clearBoard();
    render();
  } catch (error) {
    setNotice(error.message);
  }
}

async function finish(kind) {
  if (state.running) return;
  const input = kind === "participant" ? el.participantInput : el.goalInput;
  const pending = normalize(input.value);

  try {
    if (pending) {
      if (serverMode) {
        mergeState(await api("/api/items", {
          method: "POST",
          body: JSON.stringify({ kind, value: pending })
        }));
      } else if (kind === "participant") {
        state.participants.push(pending);
        state.participantsDone = false;
      } else {
        state.goals.push(pending);
        state.goalsDone = false;
      }
      input.value = "";
    }

    if (serverMode) {
      mergeState(await api("/api/finish", {
        method: "POST",
        body: JSON.stringify({ kind })
      }));
    } else if (kind === "participant") {
      state.participantsDone = state.participants.length > 0;
      refreshDerivedState();
    } else {
      state.goalsDone = state.goals.length > 0;
      refreshDerivedState();
    }
    render();
  } catch (error) {
    setNotice(error.message);
  }
}

function renderChips(container, items, kind) {
  container.innerHTML = "";
  items.forEach((item, index) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const label = document.createElement("span");
    label.textContent = item;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "x";
    button.title = "삭제";
    button.setAttribute("aria-label", item + " 삭제");
    button.disabled = state.running;
    button.addEventListener("click", () => removeItem(kind, index));
    chip.append(label, button);
    container.appendChild(chip);
  });
}

function render() {
  el.participantCount.textContent = state.participants.length + "명";
  el.goalCount.textContent = state.goals.length + "개";
  renderChips(el.participantItems, state.participants, "participant");
  renderChips(el.goalItems, state.goals, "goal");

  el.participantInput.disabled = state.running || state.participantsDone;
  el.goalInput.disabled = state.running || state.goalsDone;
  el.addParticipantBtn.disabled = state.running || state.participantsDone;
  el.addGoalBtn.disabled = state.running || state.goalsDone;
  el.finishParticipantsBtn.disabled = state.running || state.participants.length === 0;
  el.finishGoalsBtn.disabled = state.running || state.goals.length === 0;
  el.finishParticipantsBtn.textContent = state.participantsDone ? "완료됨" : "완료";
  el.finishGoalsBtn.textContent = state.goalsDone ? "완료됨" : "완료";
  el.startBtn.disabled = !state.canStart;
  el.notice.textContent = state.notice;

  if (state.running) {
    el.statusPill.textContent = "진행 중";
  } else if (state.status && state.status !== "입력 대기") {
    el.statusPill.textContent = state.status;
  } else if (state.canStart) {
    el.statusPill.textContent = "준비 완료";
  } else {
    el.statusPill.textContent = "입력 대기";
  }
}

function clearBoard() {
  currentIndex = 0;
  el.namesRow.innerHTML = "";
  el.goalsRow.innerHTML = "";
  el.ladderSvg.innerHTML = "";
  el.results.innerHTML = "";
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

function drawBase(columns) {
  el.ladderSvg.innerHTML = "";
  el.ladderSvg.style.setProperty("--columns", columns);
  const rows = Math.max(state.ladder.length, 1);
  const geo = getGeometry(columns, rows);

  for (let col = 0; col < columns; col += 1) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", xFor(col, geo));
    line.setAttribute("x2", xFor(col, geo));
    line.setAttribute("y1", geo.top);
    line.setAttribute("y2", geo.bottom);
    line.setAttribute("class", "base-line");
    el.ladderSvg.appendChild(line);
  }

  state.ladder.forEach((row, rowIndex) => {
    row.forEach((hasBridge, gap) => {
      if (!hasBridge) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", xFor(gap, geo));
      line.setAttribute("x2", xFor(gap + 1, geo));
      line.setAttribute("y1", yFor(rowIndex, geo));
      line.setAttribute("y2", yFor(rowIndex, geo));
      line.setAttribute("class", "base-line");
      el.ladderSvg.appendChild(line);
    });
  });
}

function pathData(points) {
  return points.map((point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(" ");
}

function renderBoard() {
  const columns = state.participants.length;
  document.documentElement.style.setProperty("--columns", columns);
  el.namesRow.style.setProperty("--columns", columns);
  el.goalsRow.style.setProperty("--columns", columns);
  el.namesRow.innerHTML = "";
  el.goalsRow.innerHTML = "";
  el.results.innerHTML = "";

  state.participants.forEach((name, index) => {
    const tag = document.createElement("div");
    tag.className = "name-tag";
    tag.textContent = name;
    tag.id = "name-" + index;
    el.namesRow.appendChild(tag);
  });

  state.goals.forEach((goal, index) => {
    const tag = document.createElement("div");
    tag.className = "goal-tag";
    tag.textContent = goal;
    tag.id = "goal-" + index;
    el.goalsRow.appendChild(tag);
  });

  drawBase(columns);
}

function addResult(name, goal, color) {
  const result = document.createElement("div");
  result.className = "result";
  result.style.setProperty("--run-color", color);
  const who = document.createElement("strong");
  who.textContent = name;
  const value = document.createElement("span");
  value.textContent = goal;
  result.append(who, value);
  el.results.appendChild(result);
}

function setActive(index, color) {
  document.querySelectorAll(".name-tag").forEach((tag) => {
    tag.classList.remove("active");
    tag.style.removeProperty("--run-color");
  });
  const active = document.querySelector("#name-" + index);
  if (active) {
    active.classList.add("active");
    active.style.setProperty("--run-color", color);
  }
}

function revealGoal(index, color) {
  const goal = document.querySelector("#goal-" + index);
  if (goal) {
    goal.classList.add("open");
    goal.style.setProperty("--run-color", color);
  }
}

function animateRoute(index) {
  if (!state.running) return;
  if (index >= state.participants.length) {
    finishGame("게임 종료");
    return;
  }

  const color = state.colors[index % state.colors.length];
  const route = state.routes[index];
  setActive(index, color);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData(route.points));
  path.setAttribute("class", "run-path");
  path.style.setProperty("--run-color", color);
  el.ladderSvg.appendChild(path);

  const length = path.getTotalLength();
  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(length);
  path.getBoundingClientRect();
  path.style.transition = "stroke-dashoffset 1500ms ease-in-out";
  path.style.strokeDashoffset = "0";

  window.setTimeout(() => {
    const goalText = state.goals[route.endCol];
    revealGoal(route.endCol, color);
    addResult(state.participants[index], goalText, color);

    if (el.singleWinnerMode.checked) {
      finishGame("게임 종료");
      return;
    }

    currentIndex = index + 1;
    window.setTimeout(() => animateRoute(currentIndex), 650);
  }, 1580);
}

async function finishGame(message) {
  state.running = false;
  state.status = message;
  state.notice = "";
  document.querySelectorAll(".name-tag").forEach((tag) => tag.classList.remove("active"));
  render();

  try {
    if (serverMode) {
      const next = await api("/api/complete", {
        method: "POST",
        body: JSON.stringify({ message })
      });
      mergeState(next);
      render();
    } else {
      refreshDerivedState();
    }
  } catch (error) {
    setNotice(error.message);
  }
}

async function startGame() {
  try {
    if (serverMode) {
      mergeState(await api("/api/start", { method: "POST" }));
    } else {
      if (!state.canStart) {
        render();
        return;
      }
      state.running = true;
      state.status = "진행 중";
      state.ladder = generateLadder(state.participants.length);
      state.routes = state.participants.map((_, index) => routeFor(index));
      refreshDerivedState();
    }
    currentIndex = 0;
    renderBoard();
    render();

    if (state.participants.length === 1) {
      revealGoal(0, state.colors[0]);
      addResult(state.participants[0], state.goals[0], state.colors[0]);
      finishGame("게임 종료");
      return;
    }

    window.setTimeout(() => animateRoute(0), 280);
  } catch (error) {
    setNotice(error.message);
  }
}

async function resetAll() {
  try {
    if (serverMode) {
      mergeState(await api("/api/reset", { method: "POST" }));
    } else {
      state.participants = [];
      state.goals = [];
      state.participantsDone = false;
      state.goalsDone = false;
      state.running = false;
      state.status = "입력 대기";
      state.ladder = [];
      state.routes = [];
      refreshDerivedState();
    }
    currentIndex = 0;
    el.participantInput.value = "";
    el.goalInput.value = "";
    el.singleWinnerMode.checked = false;
    clearBoard();
    render();
    el.participantInput.focus();
  } catch (error) {
    setNotice(error.message);
  }
}

el.addParticipantBtn.addEventListener("click", () => addItem("participant"));
el.addGoalBtn.addEventListener("click", () => addItem("goal"));
el.finishParticipantsBtn.addEventListener("click", () => finish("participant"));
el.finishGoalsBtn.addEventListener("click", () => finish("goal"));
el.startBtn.addEventListener("click", startGame);
el.resetBtn.addEventListener("click", resetAll);

el.participantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addItem("participant");
});

el.goalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addItem("goal");
});

requestState();
