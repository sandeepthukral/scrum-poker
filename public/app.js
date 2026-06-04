/* ── Scrum Poker Client ── */

// ── Constants ──
const CARD_VALUES = ["?", "☕", "0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "100"];

const DURATIONS = {
  TOPIC_DEBOUNCE: 400,
  COPY_TOAST: 1800,
  OUTLIER_FLASH: 3000,
  CONFETTI: 4000,
};

const CONFETTI_COLORS = ["#4db6c1", "#f6c90e", "#ff6b6b", "#a8e063", "#9b59b6", "#3498db", "#fd9644"];

const CSS = {
  ACTIVE: "active",
  HIDDEN: "hidden",
  HAS_TOPIC: "has-topic",
  SELECTED: "selected",
  SHOW: "show",
  OUTLIER_HIGH: "outlier-high",
  OUTLIER_LOW: "outlier-low",
  OUTLIER_FLASH: "outlier-flash",
  CARD_COFFEE: "card-coffee",
  MAKE_ORGANIZER_BTN: "make-organizer-btn",
};

const socket = io();

// ── State ──
let myName = "";
let myRoomId = "";
let myVote = null;
let roomState = null;
let amIOwner = false;
let wasRevealed = false;

// ── DOM Refs ──
const joinScreen       = document.getElementById("join-screen");
const roomScreen       = document.getElementById("room-screen");
const joinError        = document.getElementById("join-error");
const createRoomIdEl   = document.getElementById("create-room-id");
const createNameEl     = document.getElementById("create-name");
const createBtn        = document.getElementById("create-btn");
const joinRoomIdEl     = document.getElementById("join-room-id");
const joinNameEl       = document.getElementById("join-name");
const joinBtn          = document.getElementById("join-btn");
const roomLabel        = document.getElementById("room-label");
const cardsGrid        = document.getElementById("cards-grid");
const resultsBody      = document.getElementById("results-body");
const revealBtn        = document.getElementById("reveal-btn");
const deleteBtn        = document.getElementById("delete-btn");
const statsBar         = document.getElementById("stats-bar");
const statAvg          = document.getElementById("stat-avg");
const statMin          = document.getElementById("stat-min");
const statMax          = document.getElementById("stat-max");
const statConsensus    = document.getElementById("stat-consensus");
const userAvatar       = document.getElementById("user-avatar");
const leaveBtn         = document.getElementById("leave-btn");
const copyBtn          = document.getElementById("copy-room-btn");
const copyToast        = document.getElementById("copy-toast");
const topicInput       = document.getElementById("topic-input");
const topicDisplay     = document.getElementById("topic-display");
const participantCount = document.getElementById("participant-count");
const confettiCanvas   = document.getElementById("confetti-canvas");
const confettiCtx      = confettiCanvas.getContext("2d");

// ── Utility helpers ──

function submitOnEnter(input, btn) {
  input.addEventListener("keydown", e => { if (e.key === "Enter") btn.click(); });
}

function setButtonState(btn, { enabled, opacity, title, text }) {
  btn.disabled = !enabled;
  btn.style.opacity = opacity;
  btn.title = title;
  if (text !== undefined) btn.textContent = text;
}

function getOutlierClass(userName, outliers) {
  if (outliers.high.includes(userName)) return CSS.OUTLIER_HIGH;
  if (outliers.low.includes(userName)) return CSS.OUTLIER_LOW;
  return "";
}

function getRoomUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url;
}

function clearRoomFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
}

function showError(msg) {
  joinError.textContent = msg;
}

function setJoinLoading(loading) {
  createBtn.disabled = loading;
  joinBtn.disabled = loading;
  joinError.textContent = "";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRoomId(id) {
  return id.replace(/(\d{2})(?=\d)/g, "$1 ");
}

function initials(name) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Tab switching ──
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove(CSS.ACTIVE));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove(CSS.ACTIVE));
    btn.classList.add(CSS.ACTIVE);
    document.getElementById("tab-" + btn.dataset.tab).classList.add(CSS.ACTIVE);
    joinError.textContent = "";
  });
});

// ── Create room ──
createBtn.addEventListener("click", async () => {
  const name = createNameEl.value.trim();
  if (!name) { showError("Please enter your name."); return; }
  setJoinLoading(true);
  const prefilledRoomId = createRoomIdEl.value.trim();
  if (prefilledRoomId) {
    requestJoin(prefilledRoomId, name, true);
  } else {
    const res = await fetch("/api/new-room");
    const { roomId } = await res.json();
    requestJoin(roomId, name, true);
  }
});
submitOnEnter(createNameEl, createBtn);

// ── Join room ──
joinBtn.addEventListener("click", () => {
  const roomId = joinRoomIdEl.value.trim().replace(/\s/g, "");
  const name = joinNameEl.value.trim();
  if (!roomId) { showError("Please enter a room number."); return; }
  if (!name) { showError("Please enter your name."); return; }
  setJoinLoading(true);
  requestJoin(roomId, name, false);
});
submitOnEnter(joinRoomIdEl, joinBtn);
submitOnEnter(joinNameEl, joinBtn);

function requestJoin(roomId, name, create) {
  myRoomId = roomId;
  myName = name;
  socket.emit("join-room", { roomId, name, create });
}

function enterRoom(roomId) {
  myVote = null;
  roomLabel.textContent = "Room " + formatRoomId(roomId);
  userAvatar.textContent = initials(myName);
  joinScreen.classList.remove(CSS.ACTIVE);
  roomScreen.classList.add(CSS.ACTIVE);
  buildCards();
  window.history.replaceState({}, "", getRoomUrl(roomId));
}

// ── Copy room link ──
copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(getRoomUrl(myRoomId).toString()).then(() => {
    copyToast.classList.add(CSS.SHOW);
    setTimeout(() => copyToast.classList.remove(CSS.SHOW), DURATIONS.COPY_TOAST);
  });
});

// ── Leave ──
leaveBtn.addEventListener("click", () => {
  socket.disconnect();
  socket.connect();
  myName = "";
  myRoomId = "";
  myVote = null;
  wasRevealed = false;
  roomScreen.classList.remove(CSS.ACTIVE);
  joinScreen.classList.add(CSS.ACTIVE);
  clearRoomFromUrl();
});

// ── Confetti ──
let confettiAnimId = null;

function launchConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  const cx = confettiCanvas.width / 2;
  const cy = confettiCanvas.height / 2;
  const particles = Array.from({ length: 160 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 12;
    return {
      x: cx, y: cy,
      w: 7 + Math.random() * 8,
      h: 3 + Math.random() * 4,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.3,
      opacity: 1,
    };
  });

  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  confettiCanvas.style.display = "block";
  let startTime = null;

  function frame(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.angle += p.spin;
      if (elapsed > DURATIONS.CONFETTI * 0.65) {
        p.opacity = Math.max(0, 1 - (elapsed - DURATIONS.CONFETTI * 0.65) / (DURATIONS.CONFETTI * 0.35));
      }
      confettiCtx.save();
      confettiCtx.globalAlpha = p.opacity;
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.angle);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confettiCtx.restore();
    }
    if (elapsed < DURATIONS.CONFETTI) {
      confettiAnimId = requestAnimationFrame(frame);
    } else {
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      confettiCanvas.style.display = "none";
      confettiAnimId = null;
    }
  }
  confettiAnimId = requestAnimationFrame(frame);
}

// ── Build card deck ──
function buildCards() {
  cardsGrid.innerHTML = "";
  CARD_VALUES.forEach(val => {
    const card = document.createElement("div");
    card.className = "card" + (val === "☕" ? " " + CSS.CARD_COFFEE : "");
    card.textContent = val;
    card.dataset.val = val;
    card.addEventListener("click", () => selectCard(val));
    cardsGrid.appendChild(card);
  });
}

function selectCard(val) {
  if (roomState && roomState.revealed) return;
  myVote = myVote === val ? null : val;
  socket.emit("cast-vote", { vote: myVote });
  updateCardHighlight();
}

function updateCardHighlight() {
  document.querySelectorAll(".card").forEach(card => {
    card.classList.toggle(CSS.SELECTED, card.dataset.val === myVote);
  });
}

// ── Reveal / Delete ──
revealBtn.addEventListener("click", () => socket.emit("reveal"));
deleteBtn.addEventListener("click", () => {
  myVote = null;
  updateCardHighlight();
  socket.emit("delete-estimates");
});

// ── Event delegation for Make organizer button ──
resultsBody.addEventListener("click", e => {
  const btn = e.target.closest("." + CSS.MAKE_ORGANIZER_BTN);
  if (btn) socket.emit("transfer-ownership", { targetId: btn.dataset.targetId });
});

// ── Topic ──
let topicDebounce = null;
topicInput.addEventListener("input", () => {
  clearTimeout(topicDebounce);
  topicDebounce = setTimeout(
    () => socket.emit("set-topic", { topic: topicInput.value.trim() }),
    DURATIONS.TOPIC_DEBOUNCE
  );
});

// ── Socket events ──
socket.on("room-state", state => {
  roomState = state;
  amIOwner = state.isOwner;
  const me = state.users.find(u => u.name === myName);
  if (me && me.vote === null) {
    myVote = null;
    updateCardHighlight();
  }
  renderRoom(state);
});

socket.on("joined", ({ roomId }) => {
  setJoinLoading(false);
  enterRoom(roomId);
});

socket.on("join-error", ({ message }) => {
  setJoinLoading(false);
  showError(message);
});

// ── Render sub-functions ──

function updateTopicDisplay(topic) {
  topicDisplay.classList.toggle(CSS.HAS_TOPIC, !!topic);
  topicDisplay.textContent = topic ? "📌 " + topic : "";
  if (topicInput.value !== (topic || "")) topicInput.value = topic || "";
}

function updateParticipantCount(users) {
  const n = users.length;
  participantCount.textContent = n + " participant" + (n !== 1 ? "s" : "");
}

function updateButtonStates(revealed, isOwner) {
  if (revealed) {
    setButtonState(revealBtn, { enabled: false, opacity: 0.5, title: "", text: "Revealed" });
  } else if (isOwner) {
    setButtonState(revealBtn, { enabled: true, opacity: 1, title: "", text: "Reveal Cards" });
  } else {
    setButtonState(revealBtn, { enabled: false, opacity: 0.4, title: "Only the organiser can reveal cards", text: "Reveal Cards" });
  }
  setButtonState(deleteBtn, isOwner
    ? { enabled: true,  opacity: 1,   title: "" }
    : { enabled: false, opacity: 0.4, title: "Only the organiser can delete estimates" });
}

function updateCardInteractionState(revealed) {
  document.querySelectorAll(".card").forEach(card => {
    card.style.cursor  = revealed ? "not-allowed" : "pointer";
    card.style.opacity = revealed ? "0.7" : "1";
  });
}

function renderResultsTable(users, revealed) {
  const outliers = revealed ? getOutliers(users) : { high: [], low: [] };
  resultsBody.innerHTML = "";
  users.forEach(user => {
    const isMe = user.name === myName;
    const outlierClass = getOutlierClass(user.name, outliers);

    let nameHtml = outlierClass
      ? `<span class="name-outlier ${outlierClass}">${escapeHtml(user.name)}</span>`
      : escapeHtml(user.name);
    if (user.isOwner) nameHtml += '<span class="organizer-label">organizer</span>';
    if (isMe)         nameHtml += '<span class="you-label">you</span>';
    if (amIOwner && !isMe && !user.isOwner)
      nameHtml += `<button class="${CSS.MAKE_ORGANIZER_BTN}" data-target-id="${escapeHtml(user.id)}">Make organizer</button>`;

    let badge;
    if (revealed && user.vote !== null) {
      badge = `<span class="vote-badge revealed${outlierClass ? " " + outlierClass : ""}">${escapeHtml(String(user.vote))}</span>`;
    } else if (!revealed && user.vote !== null) {
      badge = `<span class="vote-badge voted">✓</span>`;
    } else {
      badge = `<span class="vote-badge waiting">waiting</span>`;
    }

    const nameTd = document.createElement("td");
    nameTd.innerHTML = nameHtml;
    const voteTd = document.createElement("td");
    voteTd.innerHTML = badge;
    const tr = document.createElement("tr");
    tr.appendChild(nameTd);
    tr.appendChild(voteTd);
    resultsBody.appendChild(tr);
  });
}

function handleRevealAnimation(users, revealed) {
  if (!revealed || wasRevealed) return;
  document.querySelectorAll(".name-outlier").forEach(el => {
    el.classList.add(CSS.OUTLIER_FLASH);
    setTimeout(() => el.classList.remove(CSS.OUTLIER_FLASH), DURATIONS.OUTLIER_FLASH);
  });
  if (calculateConsensus(users)) launchConfetti();
}

function updateStatsDisplay(users, revealed) {
  statsBar.classList.toggle(CSS.HIDDEN, !revealed);
  if (!revealed) return;
  const numericVotes = getNumericVotes(users);
  if (numericVotes.length > 0) {
    const avg    = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
    const allSame = numericVotes.every(v => v === numericVotes[0]);
    statAvg.textContent      = nearestFibonacci(avg);
    statMin.textContent      = Math.min(...numericVotes);
    statMax.textContent      = Math.max(...numericVotes);
    statConsensus.textContent = allSame ? "✓ Yes" : "✗ No";
    statConsensus.style.color = allSame ? "#38a169" : "#e53e3e";
  } else {
    statAvg.textContent = statMin.textContent = statMax.textContent = "—";
    statConsensus.textContent = "—";
  }
}

function renderRoom(state) {
  const { users, revealed, topic, isOwner } = state;
  updateTopicDisplay(topic);
  updateParticipantCount(users);
  updateButtonStates(revealed, isOwner);
  updateCardInteractionState(revealed);
  renderResultsTable(users, revealed);
  handleRevealAnimation(users, revealed);
  updateStatsDisplay(users, revealed);
  wasRevealed = revealed;
}

// ── Auto-join from URL param ──
(function checkUrlRoom() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) {
    document.querySelector('[data-tab="create"]').click();
    createRoomIdEl.value = room;
    createRoomIdEl.removeAttribute("hidden");
    createNameEl.focus();
  }
})();
