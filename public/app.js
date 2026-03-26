/* ── Scrum Poker Client ── */

const CARD_VALUES = ['?', '☕', '0', '0.5', '1', '2', '3', '5', '8', '13', '20', '40', '100'];

const socket = io();

// ── State ──
let myName = '';
let myRoomId = '';
let myVote = null;
let roomState = null;
let amIOwner = false;

// ── DOM Refs ──
const joinScreen   = document.getElementById('join-screen');
const roomScreen   = document.getElementById('room-screen');
const joinError    = document.getElementById('join-error');
const createRoomIdEl = document.getElementById('create-room-id');
const createNameEl = document.getElementById('create-name');
const createBtn    = document.getElementById('create-btn');
const joinRoomIdEl = document.getElementById('join-room-id');
const joinNameEl   = document.getElementById('join-name');
const joinBtn      = document.getElementById('join-btn');
const roomLabel    = document.getElementById('room-label');
const cardsGrid    = document.getElementById('cards-grid');
const resultsBody  = document.getElementById('results-body');
const revealBtn    = document.getElementById('reveal-btn');
const deleteBtn    = document.getElementById('delete-btn');
const statsBar     = document.getElementById('stats-bar');
const statAvg      = document.getElementById('stat-avg');
const statMin      = document.getElementById('stat-min');
const statMax      = document.getElementById('stat-max');
const statConsensus= document.getElementById('stat-consensus');
const userAvatar   = document.getElementById('user-avatar');
const leaveBtn     = document.getElementById('leave-btn');
const copyBtn      = document.getElementById('copy-room-btn');
const copyToast    = document.getElementById('copy-toast');
const topicInput   = document.getElementById('topic-input');
const topicDisplay = document.getElementById('topic-display');
const participantCount = document.getElementById('participant-count');

// ── Tab switching ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    joinError.textContent = '';
  });
});

// ── Create room ──
createBtn.addEventListener('click', async () => {
  const name = createNameEl.value.trim();
  if (!name) { showError('Please enter your name.'); return; }
  setJoinLoading(true);
  const prefilledRoomId = createRoomIdEl.value.trim();
  if (prefilledRoomId) {
    requestJoin(prefilledRoomId, name, true);
  } else {
    const res = await fetch('/api/new-room');
    const { roomId } = await res.json();
    requestJoin(roomId, name, true);
  }
});
createNameEl.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

// ── Join room ──
joinBtn.addEventListener('click', () => {
  const roomId = joinRoomIdEl.value.trim().replace(/\s/g, '');
  const name   = joinNameEl.value.trim();
  if (!roomId) { showError('Please enter a room number.'); return; }
  if (!name)   { showError('Please enter your name.'); return; }
  setJoinLoading(true);
  requestJoin(roomId, name, false);
});
joinRoomIdEl.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
joinNameEl.addEventListener('keydown',   e => { if (e.key === 'Enter') joinBtn.click(); });

function showError(msg) {
  joinError.textContent = msg;
}

function setJoinLoading(loading) {
  createBtn.disabled = loading;
  joinBtn.disabled   = loading;
  joinError.textContent = '';
}

// ── Request join (waits for server confirmation) ──
function requestJoin(roomId, name, create) {
  myRoomId = roomId;
  myName   = name;
  socket.emit('join-room', { roomId, name, create });
}

// ── Enter room (called after server confirms join) ──
function enterRoom(roomId) {
  myVote = null;

  roomLabel.textContent  = 'Room ' + formatRoomId(roomId);
  userAvatar.textContent = initials(myName);

  joinScreen.classList.remove('active');
  roomScreen.classList.add('active');

  buildCards();

  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);
}

function formatRoomId(id) {
  return id.replace(/(\d{2})(?=\d)/g, '$1 ');
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Copy room link ──
copyBtn.addEventListener('click', () => {
  const url = new URL(window.location.href);
  url.searchParams.set('room', myRoomId);
  navigator.clipboard.writeText(url.toString()).then(() => {
    copyToast.classList.add('show');
    setTimeout(() => copyToast.classList.remove('show'), 1800);
  });
});

// ── Leave ──
leaveBtn.addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  myName = '';
  myRoomId = '';
  myVote = null;
  roomScreen.classList.remove('active');
  joinScreen.classList.add('active');
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url);
});

// ── Build card deck ──
function buildCards() {
  cardsGrid.innerHTML = '';
  CARD_VALUES.forEach(val => {
    const card = document.createElement('div');
    card.className = 'card' + (val === '☕' ? ' card-coffee' : '');
    card.textContent = val;
    card.dataset.val = val;
    card.addEventListener('click', () => selectCard(val, card));
    cardsGrid.appendChild(card);
  });
}

function selectCard(val, el) {
  if (roomState && roomState.revealed) return; // locked after reveal
  if (myVote === val) {
    // deselect
    myVote = null;
    socket.emit('cast-vote', { vote: null });
  } else {
    myVote = val;
    socket.emit('cast-vote', { vote: val });
  }
  updateCardHighlight();
}

function updateCardHighlight() {
  document.querySelectorAll('.card').forEach(card => {
    card.classList.toggle('selected', card.dataset.val === myVote);
  });
}

// ── Reveal / Delete ──
revealBtn.addEventListener('click', () => {
  socket.emit('reveal');
});

deleteBtn.addEventListener('click', () => {
  myVote = null;
  updateCardHighlight();
  socket.emit('delete-estimates');
});

// ── Topic ──
let topicDebounce = null;
topicInput.addEventListener('input', () => {
  clearTimeout(topicDebounce);
  topicDebounce = setTimeout(() => {
    socket.emit('set-topic', { topic: topicInput.value.trim() });
  }, 400);
});

// ── Socket events ──
socket.on('room-state', (state) => {
  roomState = state;
  amIOwner = state.isOwner;

  // Sync local vote with server — handles delete-estimates resetting our card
  const me = state.users.find(u => u.name === myName);
  if (me && me.vote === null) {
    myVote = null;
    updateCardHighlight();
  }

  renderRoom(state);
});

socket.on('joined', ({ roomId }) => {
  setJoinLoading(false);
  enterRoom(roomId);
});

socket.on('join-error', ({ message }) => {
  setJoinLoading(false);
  showError(message);
});

// ── Render room ──
function renderRoom(state) {
  const { users, revealed, topic, isOwner } = state;

  // Topic display
  if (topic) {
    topicDisplay.textContent = '📌 ' + topic;
    topicDisplay.classList.add('has-topic');
    if (topicInput.value !== topic) topicInput.value = topic;
  } else {
    topicDisplay.textContent = '';
    topicDisplay.classList.remove('has-topic');
    if (topicInput.value !== '') topicInput.value = '';
  }

  // Participant count
  const n = users.length;
  participantCount.textContent = n + ' participant' + (n !== 1 ? 's' : '');

  // Reveal button — only owner can use it
  if (revealed) {
    revealBtn.textContent = 'Revealed';
    revealBtn.disabled = true;
    revealBtn.style.opacity = '0.5';
    revealBtn.title = '';
  } else if (isOwner) {
    revealBtn.textContent = 'Reveal Cards';
    revealBtn.disabled = false;
    revealBtn.style.opacity = '1';
    revealBtn.title = '';
  } else {
    revealBtn.textContent = 'Reveal Cards';
    revealBtn.disabled = true;
    revealBtn.style.opacity = '0.4';
    revealBtn.title = 'Only the organizer can reveal cards';
  }

  // Delete button — only owner can use it
  if (isOwner) {
    deleteBtn.disabled = false;
    deleteBtn.style.opacity = '1';
    deleteBtn.title = '';
  } else {
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.4';
    deleteBtn.title = 'Only the organizer can delete estimates';
  }

  // Card selection availability
  document.querySelectorAll('.card').forEach(card => {
    card.style.cursor = revealed ? 'not-allowed' : 'pointer';
    card.style.opacity = revealed ? '0.7' : '1';
  });

  // Results table
  resultsBody.innerHTML = '';
  users.forEach(user => {
    const tr = document.createElement('tr');
    const isMe = user.name === myName;

    const nameTd = document.createElement('td');
    let nameHtml = escapeHtml(user.name);
    if (user.isOwner) nameHtml += '<span class="organizer-label">organizer</span>';
    if (isMe)        nameHtml += '<span class="you-label">you</span>';
    nameTd.innerHTML = nameHtml;

    const voteTd = document.createElement('td');
    let badge;
    if (revealed && user.vote !== null) {
      badge = `<span class="vote-badge revealed">${escapeHtml(String(user.vote))}</span>`;
    } else if (!revealed && user.vote !== null) {
      badge = `<span class="vote-badge voted">✓</span>`;
    } else {
      badge = `<span class="vote-badge waiting">waiting</span>`;
    }
    voteTd.innerHTML = badge;

    tr.appendChild(nameTd);
    tr.appendChild(voteTd);
    resultsBody.appendChild(tr);
  });

  // Stats after reveal
  if (revealed) {
    const numericVotes = users
      .map(u => u.vote)
      .filter(v => v !== null && v !== '?' && v !== '☕')
      .map(v => parseFloat(v))
      .filter(v => !isNaN(v));

    statsBar.classList.remove('hidden');
    if (numericVotes.length > 0) {
      const avg = (numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length);
      const min = Math.min(...numericVotes);
      const max = Math.max(...numericVotes);
      const allSame = numericVotes.every(v => v === numericVotes[0]);
      statAvg.textContent = nearestFibonacci(avg);
      statMin.textContent = min;
      statMax.textContent = max;
      statConsensus.textContent = allSame ? '✓ Yes' : '✗ No';
      statConsensus.style.color = allSame ? '#38a169' : '#e53e3e';
    } else {
      statAvg.textContent = statMin.textContent = statMax.textContent = '—';
      statConsensus.textContent = '—';
    }
  } else {
    statsBar.classList.add('hidden');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Auto-join from URL param ──
(function checkUrlRoom() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room) {
    // Switch to create tab and pre-fill room number
    document.querySelector('[data-tab="create"]').click();
    createRoomIdEl.value = room;
    createRoomIdEl.removeAttribute('hidden');
    createNameEl.focus();
  }
})();
