// server/signaling-server.js
// Run this separately: node server/signaling-server.js
// For production, deploy this as a standalone service

const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.SIGNAL_PORT || 3001;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8, // 100MB for signaling messages
});

// In-memory room store (use Redis for production)
const rooms = new Map();
const peerToRoom = new Map();

function createRoom(options = {}) {
  const roomId = uuidv4();
  const code = generateCode();
  const room = {
    id: roomId,
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    peers: new Map(),
    maxPeers: options.maxPeers || 10,
    password: options.password || null,
    isPasswordProtected: !!options.password,
  };
  rooms.set(roomId, room);
  rooms.set(code, room); // also index by code
  return room;
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getRoomInfo(room) {
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    peerCount: room.peers.size,
    maxPeers: room.maxPeers,
    isPasswordProtected: room.isPasswordProtected,
  };
}

// Cleanup expired rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, room] of rooms.entries()) {
    if (room.expiresAt < now) {
      // Disconnect all peers
      for (const [peerId, peerSocket] of room.peers.entries()) {
        peerSocket.emit('room-expired');
        peerSocket.leave(room.id);
      }
      rooms.delete(room.id);
      rooms.delete(room.code);
    }
  }
}, 5 * 60 * 1000);

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // Create a new room
  socket.on('create-room', (options, callback) => {
    const room = createRoom(options);
    socket.join(room.id);
    room.peers.set(socket.id, socket);
    peerToRoom.set(socket.id, room.id);

    console.log(`[ROOM] Created: ${room.code} (${room.id})`);
    callback({ success: true, room: getRoomInfo(room) });
  });

  // Join an existing room by ID or code
  socket.on('join-room', ({ roomIdOrCode, password }, callback) => {
    let room = rooms.get(roomIdOrCode);

    if (!room) {
      return callback({ success: false, error: 'Room not found' });
    }

    if (room.expiresAt < Date.now()) {
      rooms.delete(room.id);
      rooms.delete(room.code);
      return callback({ success: false, error: 'Room has expired' });
    }

    if (room.peers.size >= room.maxPeers) {
      return callback({ success: false, error: 'Room is full' });
    }

    if (room.isPasswordProtected && room.password !== password) {
      return callback({ success: false, error: 'Invalid password' });
    }

    socket.join(room.id);
    room.peers.set(socket.id, socket);
    peerToRoom.set(socket.id, room.id);

    // Notify existing peers
    socket.to(room.id).emit('peer-joined', {
      peerId: socket.id,
      peerCount: room.peers.size,
    });

    // Send list of existing peers to the new joiner
    const existingPeers = [...room.peers.keys()].filter((id) => id !== socket.id);

    console.log(`[ROOM] ${socket.id} joined room ${room.code}`);
    callback({
      success: true,
      room: getRoomInfo(room),
      existingPeers,
    });
  });

  // WebRTC Signaling
  socket.on('signal', ({ targetPeerId, signal }) => {
    const roomId = peerToRoom.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const targetSocket = room.peers.get(targetPeerId);
    if (targetSocket) {
      targetSocket.emit('signal', {
        peerId: socket.id,
        signal,
      });
    }
  });

  // Broadcast to all peers in room
  socket.on('broadcast-signal', ({ signal }) => {
    const roomId = peerToRoom.get(socket.id);
    if (!roomId) return;

    socket.to(roomId).emit('signal', {
      peerId: socket.id,
      signal,
    });
  });

  // Get room info
  socket.on('get-room', ({ roomIdOrCode }, callback) => {
    const room = rooms.get(roomIdOrCode);
    if (!room) {
      return callback({ success: false, error: 'Room not found' });
    }
    callback({ success: true, room: getRoomInfo(room) });
  });

  // Chat message
  socket.on('chat-message', ({ message }) => {
    const roomId = peerToRoom.get(socket.id);
    if (!roomId) return;

    socket.to(roomId).emit('chat-message', {
      peerId: socket.id,
      message,
      timestamp: Date.now(),
    });
  });

  // Transfer metadata broadcast
  socket.on('transfer-start', ({ files }) => {
    const roomId = peerToRoom.get(socket.id);
    if (!roomId) return;

    socket.to(roomId).emit('transfer-start', {
      peerId: socket.id,
      files,
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const roomId = peerToRoom.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.peers.delete(socket.id);
        socket.to(roomId).emit('peer-left', {
          peerId: socket.id,
          peerCount: room.peers.size,
        });

        // Remove empty rooms
        if (room.peers.size === 0) {
          rooms.delete(room.id);
          rooms.delete(room.code);
          console.log(`[ROOM] Removed empty room: ${room.code}`);
        }
      }
      peerToRoom.delete(socket.id);
    }

    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   P2P Share - Signaling Server               ║
║   Listening on port ${PORT}                    ║
╚══════════════════════════════════════════════╝
  `);
});

module.exports = { io, httpServer };
