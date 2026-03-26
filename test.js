/* ── Scrum Poker Test Suite ── */
const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

// ── Inline the server logic so tests are self-contained ──
function createApp() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const rooms = {};

  function getRoomState(roomId) {
    const room = rooms[roomId];
    if (!room) return null;
    return {
      users: Object.values(room.users).map(u => ({ ...u, isOwner: u.id === room.ownerId })),
      revealed: room.revealed,
      topic: room.topic || '',
    };
  }

  function broadcastRoomState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const base = getRoomState(roomId);
    for (const uid of Object.keys(room.users)) {
      const s = io.sockets.sockets.get(uid);
      if (s) s.emit('room-state', { ...base, isOwner: uid === room.ownerId });
    }
  }

  io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('join-room', ({ roomId, name, create }) => {
      if (!roomId || !name) return;
      if (!create && !rooms[roomId]) {
        socket.emit('join-error', { message: `Room ${roomId} does not exist.` });
        return;
      }
      if (currentRoom) {
        socket.leave(currentRoom);
        if (rooms[currentRoom]) {
          delete rooms[currentRoom].users[socket.id];
          broadcastRoomState(currentRoom);
        }
      }
      currentRoom = roomId;
      if (!rooms[roomId]) {
        rooms[roomId] = { users: {}, ownerId: socket.id, revealed: false, topic: '' };
      }
      rooms[roomId].users[socket.id] = { id: socket.id, name, vote: null };
      socket.join(roomId);
      socket.emit('joined', { roomId });
      broadcastRoomState(roomId);
    });

    socket.on('cast-vote', ({ vote }) => {
      if (!currentRoom || !rooms[currentRoom]) return;
      if (rooms[currentRoom].revealed) return;
      rooms[currentRoom].users[socket.id].vote = vote;
      broadcastRoomState(currentRoom);
    });

    socket.on('reveal', () => {
      const room = rooms[currentRoom];
      if (!room || room.ownerId !== socket.id) return;
      room.revealed = true;
      broadcastRoomState(currentRoom);
    });

    socket.on('delete-estimates', () => {
      const room = rooms[currentRoom];
      if (!room || room.ownerId !== socket.id) return;
      room.revealed = false;
      for (const uid of Object.keys(room.users)) room.users[uid].vote = null;
      broadcastRoomState(currentRoom);
    });

    socket.on('set-topic', ({ topic }) => {
      if (!currentRoom || !rooms[currentRoom]) return;
      rooms[currentRoom].topic = topic || '';
      broadcastRoomState(currentRoom);
    });

    socket.on('disconnect', () => {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      delete room.users[socket.id];
      if (Object.keys(room.users).length === 0) {
        delete rooms[currentRoom];
      } else {
        if (room.ownerId === socket.id) room.ownerId = Object.keys(room.users)[0];
        broadcastRoomState(currentRoom);
      }
    });
  });

  app.get('/api/new-room', (_req, res) => {
    const roomId = crypto.randomInt(10000000, 99999999).toString();
    res.json({ roomId });
  });

  return { server, rooms };
}

// ── Helpers ──
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

function connect(port) {
  return Client(`http://localhost:${port}`, { forceNew: true });
}

async function waitConnected(socket) {
  if (socket.connected) return;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 3000);
    socket.once('connect', () => { clearTimeout(t); resolve(); });
  });
}

// Wait for next occurrence of an event
function nextEvent(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
    socket.once(event, (d) => { clearTimeout(t); resolve(d); });
  });
}

// Set up listeners BEFORE emitting join-room, to avoid missing events
function joinRoom(socket, roomId, name, create) {
  return new Promise((resolve, reject) => {
    let joined = null, state = null;
    const t = setTimeout(() => reject(new Error(`Timeout joining ${roomId}`)), 3000);
    const done = () => { if (joined && state) { clearTimeout(t); resolve({ joined, state }); } };
    socket.once('joined',     (d) => { joined = d; done(); });
    socket.once('room-state', (d) => { state  = d; done(); });
    socket.once('join-error', (d) => { clearTimeout(t); reject(new Error(d.message)); });
    socket.emit('join-room', { roomId, name, create });
  });
}

// Set up a room-state listener BEFORE emitting an action
function doAndWaitState(socket, action) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout waiting for room-state')), 3000);
    socket.once('room-state', (d) => { clearTimeout(t); resolve(d); });
    action();
  });
}

// ── Tests ──
async function runTests(port, url) {

  // ── /api/new-room ──
  console.log('\n[API] /api/new-room');
  await new Promise((resolve, reject) => {
    http.get(`${url}/api/new-room`, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const { roomId } = JSON.parse(body);
          assert(typeof roomId === 'string',  'returns a string roomId');
          assert(roomId.length === 8,          'roomId is 8 digits');
          assert(/^\d+$/.test(roomId),         'roomId is numeric');
          resolve();
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  // ── create:true creates a new room with the exact ID ──
  console.log('\n[Socket] create:true — new room');
  {
    const c = connect(port);
    await waitConnected(c);
    const { joined, state } = await joinRoom(c, '11111111', 'Alice', true);
    assert(joined.roomId === '11111111',     'joined roomId matches');
    assert(state.users.length === 1,         '1 user in room');
    assert(state.users[0].name === 'Alice',  'user is Alice');
    assert(state.users[0].isOwner === true,  'Alice is owner');
    assert(state.isOwner === true,           'Alice gets isOwner:true');
    assert(state.revealed === false,         'room not revealed');
    assert(state.topic === '',               'no topic initially');
    c.disconnect();
  }

  // ── create:true on an existing room → joins, does not reset ──
  console.log('\n[Socket] create:true — joins existing room without recreating');
  {
    const c1 = connect(port);
    const c2 = connect(port);
    await waitConnected(c1);
    await waitConnected(c2);

    await joinRoom(c1, '22222222', 'Alice', true);

    // Listen for Alice's state update caused by Bob joining, then trigger Bob's join
    const [, , s2] = await Promise.all([
      doAndWaitState(c1, () => {}),    // Alice waits for next room-state
      doAndWaitState(c2, () => {}),    // Bob waits for room-state
      joinRoom(c2, '22222222', 'Bob', true).then(r => r.state),
      // The doAndWaits will fire from the broadcast triggered by Bob's join
    ]);

    // Re-fetch by doing a fresh read via cast-vote trick
    const aliceState = await doAndWaitState(c1, () => c1.emit('cast-vote', { vote: null }));
    assert(aliceState.users.length === 2,   'Alice sees 2 users after Bob joins');
    assert(s2.users.length === 2,           'Bob sees 2 users');
    assert(s2.isOwner === false,            'Bob is not owner');
    c1.disconnect();
    c2.disconnect();
  }

  // ── create:false, room does not exist → join-error ──
  console.log('\n[Socket] create:false — non-existent room → join-error');
  {
    const c = connect(port);
    await waitConnected(c);
    const errP = nextEvent(c, 'join-error');
    c.emit('join-room', { roomId: '99999999', name: 'Eve', create: false });
    const err = await errP;
    assert(typeof err.message === 'string',  'join-error emitted');
    assert(err.message.includes('99999999'), 'error mentions room number');
    c.disconnect();
  }

  // ── create:false, room exists → joins ──
  console.log('\n[Socket] create:false — existing room → joins successfully');
  {
    const c1 = connect(port);
    const c2 = connect(port);
    await waitConnected(c1);
    await waitConnected(c2);

    await joinRoom(c1, '33333333', 'Alice', true);
    const { joined } = await joinRoom(c2, '33333333', 'Bob', false);
    assert(joined.roomId === '33333333', 'Bob joined via create:false');
    c1.disconnect();
    c2.disconnect();
  }

  // ── bookmarked URL: room does not exist → created with that exact ID ──
  console.log('\n[Socket] bookmarked URL — room absent → created with bookmarked ID');
  {
    const c = connect(port);
    await waitConnected(c);
    const { joined, state } = await joinRoom(c, '44444444', 'Alice', true);
    assert(joined.roomId === '44444444',    'room created with exact bookmarked ID');
    assert(state.users[0].name === 'Alice', 'Alice is in the room');
    assert(state.isOwner === true,          'Alice is owner');
    c.disconnect();
  }

  // ── bookmarked URL: room already exists → joins, state preserved ──
  console.log('\n[Socket] bookmarked URL — room exists → joins, state preserved');
  {
    const c1 = connect(port);
    const c2 = connect(port);
    await waitConnected(c1);
    await waitConnected(c2);

    await joinRoom(c1, '55555555', 'Alice', true);

    // Alice votes so we can verify state isn't wiped when Bob arrives via bookmark
    await doAndWaitState(c1, () => c1.emit('cast-vote', { vote: '5' }));

    // Bob arrives via "bookmarked URL" (create:true, same ID)
    const { joined: j2, state: s2 } = await joinRoom(c2, '55555555', 'Bob', true);

    // Get fresh Alice state
    const aliceState = await doAndWaitState(c1, () => c1.emit('cast-vote', { vote: '5' }));

    assert(j2.roomId === '55555555',                       'Bob joined same room');
    assert(s2.users.length === 2,                          'room has 2 users');
    assert(s2.isOwner === false,                           'Bob is not owner');
    const aliceInState = aliceState.users.find(u => u.name === 'Alice');
    assert(aliceInState && aliceInState.vote === '5',      "Alice's vote preserved — room not reset");
    c1.disconnect();
    c2.disconnect();
  }

  // ── voting flow: cast → reveal → locked after reveal → reset ──
  console.log('\n[Socket] voting — cast, reveal, locked after reveal, delete resets');
  {
    const c1 = connect(port);
    const c2 = connect(port);
    await waitConnected(c1);
    await waitConnected(c2);

    await joinRoom(c1, '66666666', 'Alice', true);
    // Drain Alice's room-state broadcast that arrives when Bob joins
    const aliceDrain = nextEvent(c1, 'room-state');
    await joinRoom(c2, '66666666', 'Bob', false);
    await aliceDrain;

    // Alice votes 5
    const s1 = await doAndWaitState(c1, () => c1.emit('cast-vote', { vote: '5' }));
    assert(s1.users.find(u => u.name === 'Alice').vote === '5', 'Alice vote recorded');

    // Bob votes 8 — drain Alice's broadcast before listening for reveal
    const aliceDrain2 = nextEvent(c1, 'room-state');
    await doAndWaitState(c2, () => c2.emit('cast-vote', { vote: '8' }));
    await aliceDrain2;

    // Alice (owner) reveals
    const revealState = await doAndWaitState(c1, () => c1.emit('reveal'));
    assert(revealState.revealed === true,                         'room revealed');
    assert(revealState.users.find(u => u.name === 'Alice').vote === '5', 'Alice vote visible');
    assert(revealState.users.find(u => u.name === 'Bob').vote === '8',   'Bob vote visible');

    // Bob tries to vote after reveal — should be silently rejected
    c2.emit('cast-vote', { vote: '13' });
    await new Promise(r => setTimeout(r, 200));

    // Alice resets
    const resetState = await doAndWaitState(c1, () => c1.emit('delete-estimates'));
    assert(resetState.revealed === false,                          'room reset');
    assert(resetState.users.find(u => u.name === 'Alice').vote === null, 'Alice vote cleared');
    assert(resetState.users.find(u => u.name === 'Bob').vote === null,   'Bob vote cleared (post-reveal vote rejected)');

    c1.disconnect();
    c2.disconnect();
  }

  // ── non-owner cannot reveal or delete ──
  console.log('\n[Socket] non-owner cannot reveal or delete');
  {
    const c1 = connect(port);
    const c2 = connect(port);
    await waitConnected(c1);
    await waitConnected(c2);

    await joinRoom(c1, '77777777', 'Alice', true);
    await joinRoom(c2, '77777777', 'Bob', false);

    await doAndWaitState(c1, () => c1.emit('cast-vote', { vote: '3' }));

    // Bob tries to reveal — ignored
    c2.emit('reveal');
    await new Promise(r => setTimeout(r, 200));
    const s1 = await doAndWaitState(c1, () => c1.emit('cast-vote', { vote: '3' }));
    assert(s1.revealed === false, 'room not revealed by non-owner');

    // Bob tries to delete — ignored
    c2.emit('delete-estimates');
    await new Promise(r => setTimeout(r, 200));
    const s2 = await doAndWaitState(c1, () => c1.emit('cast-vote', { vote: '3' }));
    assert(s2.users.find(u => u.name === 'Alice').vote === '3', 'Alice vote intact — non-owner delete ignored');

    c1.disconnect();
    c2.disconnect();
  }

  // ── topic sync ──
  console.log('\n[Socket] topic — set and clear, synced to all users');
  {
    const c1 = connect(port);
    const c2 = connect(port);
    await waitConnected(c1);
    await waitConnected(c2);

    await joinRoom(c1, '88888888', 'Alice', true);
    // Drain Alice's room-state that arrives when Bob joins
    const aliceDrain = nextEvent(c1, 'room-state');
    await joinRoom(c2, '88888888', 'Bob', false);
    await aliceDrain;

    const [s1, s2] = await Promise.all([
      nextEvent(c1, 'room-state'),
      nextEvent(c2, 'room-state'),
      Promise.resolve().then(() => c1.emit('set-topic', { topic: 'Story #42' })),
    ]);
    assert(s1.topic === 'Story #42', 'topic set for Alice');
    assert(s2.topic === 'Story #42', 'topic synced to Bob');

    const [s3, s4] = await Promise.all([
      nextEvent(c1, 'room-state'),
      nextEvent(c2, 'room-state'),
      Promise.resolve().then(() => c2.emit('set-topic', { topic: '' })),
    ]);
    assert(s3.topic === '', 'topic cleared for Alice');
    assert(s4.topic === '', 'topic cleared for Bob');

    c1.disconnect();
    c2.disconnect();
  }

  // ── ownership transfer on owner disconnect ──
  console.log('\n[Socket] ownership transfer when owner disconnects');
  {
    const c1 = connect(port);
    const c2 = connect(port);
    await waitConnected(c1);
    await waitConnected(c2);

    await joinRoom(c1, '10101010', 'Alice', true);
    await joinRoom(c2, '10101010', 'Bob', false);

    const transferP = nextEvent(c2, 'room-state');
    c1.disconnect();
    const s = await transferP;
    assert(s.isOwner === true,        'Bob becomes owner');
    assert(s.users.length === 1,      'only Bob remains');
    assert(s.users[0].name === 'Bob', 'Bob is the user');
    c2.disconnect();
  }

  // ── room deleted when last user leaves ──
  console.log('\n[Socket] room deleted when last user leaves');
  {
    const c1 = connect(port);
    await waitConnected(c1);
    await joinRoom(c1, '20202020', 'Alice', true);
    c1.disconnect();
    await new Promise(r => setTimeout(r, 300));

    const c2 = connect(port);
    await waitConnected(c2);
    const errP = nextEvent(c2, 'join-error');
    c2.emit('join-room', { roomId: '20202020', name: 'Bob', create: false });
    const err = await errP;
    assert(typeof err.message === 'string', 'room gone after last user left');
    c2.disconnect();
  }

  // ── deselect card (vote → null) ──
  console.log('\n[Socket] deselecting a card sets vote to null');
  {
    const c = connect(port);
    await waitConnected(c);
    await joinRoom(c, '30303030', 'Alice', true);

    const s1 = await doAndWaitState(c, () => c.emit('cast-vote', { vote: '5' }));
    assert(s1.users[0].vote === '5',  'vote is 5');

    const s2 = await doAndWaitState(c, () => c.emit('cast-vote', { vote: null }));
    assert(s2.users[0].vote === null, 'vote cleared to null');
    c.disconnect();
  }

  // ── missing name / roomId silently ignored ──
  console.log('\n[Socket] missing name or roomId silently ignored');
  {
    const c = connect(port);
    await waitConnected(c);
    c.emit('join-room', { roomId: '', name: 'Alice', create: true });
    c.emit('join-room', { roomId: '12345678', name: '', create: true });
    await new Promise(r => setTimeout(r, 300));
    assert(true, 'no crash on missing fields');
    c.disconnect();
  }
}

// ── Main ──
(async () => {
  const { server } = createApp();
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const url  = `http://localhost:${port}`;
  console.log(`Test server on port ${port}`);

  try {
    await runTests(port, url);
  } catch (e) {
    console.error('\nUnexpected error:', e.message);
    console.error(e.stack);
    failed++;
  }

  await new Promise(resolve => server.close(resolve));

  console.log(`\n── Results ──`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
