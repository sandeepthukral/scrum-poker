const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// rooms[roomId] = { users: { socketId: { name, vote } }, ownerId, revealed, topic }
const rooms = {};

function getRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return null;
  return {
    users: Object.values(room.users).map(({ lastActivity, ...u }) => ({
      ...u,
      isOwner: u.id === room.ownerId,
    })),
    revealed: room.revealed,
    topic: room.topic || '',
  };
}

// Broadcast personalised room-state to every socket in the room,
// each receiving their own isOwner flag.
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
  let currentName = null;

  socket.on('join-room', ({ roomId, name, create }) => {
    if (!roomId || !name) return;
    if (!/^\d{1,20}$/.test(roomId)) return; // reject __proto__ and other dangerous keys

    // Reject joins to non-existent rooms
    if (!create && !rooms[roomId]) {
      socket.emit('join-error', { message: `Room ${roomId} does not exist. Please check the room number and try again.` });
      return;
    }

    // Leave previous room
    if (currentRoom) {
      socket.leave(currentRoom);
      if (rooms[currentRoom]) {
        delete rooms[currentRoom].users[socket.id];
        broadcastRoomState(currentRoom);
      }
    }

    currentRoom = roomId;
    currentName = name;

    if (!rooms[roomId]) {
      // First joiner (creator) becomes the owner
      rooms[roomId] = { users: {}, ownerId: socket.id, revealed: false, topic: '' };
    }

    rooms[roomId].users[socket.id] = {
      id: socket.id,
      name,
      vote: null,
      lastActivity: Date.now(),
    };

    socket.join(roomId);
    socket.emit('joined', { roomId });
    broadcastRoomState(roomId);
  });

  socket.on('cast-vote', ({ vote }) => {
    if (rooms[currentRoom]?.users[socket.id]) rooms[currentRoom].users[socket.id].lastActivity = Date.now();
    if (!currentRoom || !rooms[currentRoom]) return;
    if (rooms[currentRoom].revealed) return; // can't vote after reveal
    rooms[currentRoom].users[socket.id].vote = vote;
    broadcastRoomState(currentRoom);
  });

  socket.on('reveal', () => {
    if (rooms[currentRoom]?.users[socket.id]) rooms[currentRoom].users[socket.id].lastActivity = Date.now();
    const room = rooms[currentRoom];
    if (!room) return;
    if (room.ownerId !== socket.id) return; // owner only
    room.revealed = true;
    broadcastRoomState(currentRoom);
  });

  socket.on('delete-estimates', () => {
    if (rooms[currentRoom]?.users[socket.id]) rooms[currentRoom].users[socket.id].lastActivity = Date.now();
    const room = rooms[currentRoom];
    if (!room) return;
    if (room.ownerId !== socket.id) return; // owner only
    room.revealed = false;
    for (const uid of Object.keys(room.users)) {
      room.users[uid].vote = null;
    }
    broadcastRoomState(currentRoom);
  });

  socket.on('transfer-ownership', ({ targetId }) => {
    if (rooms[currentRoom]?.users[socket.id]) rooms[currentRoom].users[socket.id].lastActivity = Date.now();
    const room = rooms[currentRoom];
    if (!room || room.ownerId !== socket.id) return; // owner only
    if (!room.users[targetId]) return; // target must be in the room
    room.ownerId = targetId;
    broadcastRoomState(currentRoom);
  });

  socket.on('set-topic', ({ topic }) => {
    if (rooms[currentRoom]?.users[socket.id]) rooms[currentRoom].users[socket.id].lastActivity = Date.now();
    if (!currentRoom || !rooms[currentRoom]) return;
    rooms[currentRoom].topic = String(topic || '').slice(0, 200);
    broadcastRoomState(currentRoom);
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    delete room.users[socket.id];
    if (Object.keys(room.users).length === 0) {
      delete rooms[currentRoom];
    } else {
      // Transfer ownership to the next remaining user if the owner left
      if (room.ownerId === socket.id) {
        room.ownerId = Object.keys(room.users)[0];
      }
      broadcastRoomState(currentRoom);
    }
  });
});

const INACTIVITY_MS = 12 * 60 * 60 * 1000;

function cleanupStaleUsers(cutoff = Date.now() - INACTIVITY_MS) {
  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    for (const uid of Object.keys(room.users)) {
      if (room.users[uid].lastActivity < cutoff) {
        delete room.users[uid];
        if (room.ownerId === uid) {
          const remaining = Object.keys(room.users);
          if (remaining.length > 0) room.ownerId = remaining[0];
        }
      }
    }
    if (Object.keys(room.users).length === 0) {
      delete rooms[roomId];
    } else {
      broadcastRoomState(roomId);
    }
  }
}

setInterval(cleanupStaleUsers, 30 * 60 * 1000);

// Generate a random room id
app.get('/api/new-room', (req, res) => {
  const roomId = crypto.randomInt(10000000, 99999999).toString();
  res.json({ roomId });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Scrum Poker running at http://localhost:${PORT}`);
});
