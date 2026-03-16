import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

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

// Interfaces
interface RoomOptions {
  maxPeers?: number;
  password?: string | null;
}

interface Room {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  peers: Map<string, Socket>;
  maxPeers: number;
  password?: string | null;
  isPasswordProtected: boolean;
}

// In-memory room store (use Redis for production)
const rooms = new Map<string, Room>();
const peerToRoom = new Map<string, string>();
const emptyRoomTimeouts = new Map<string, NodeJS.Timeout>();

function createRoom(options: RoomOptions = {}): Room {
  const roomId = uuidv4();
  const code = generateCode();
  const room: Room = {
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

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getRoomInfo(room: Room) {
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

// Rate limiting state
const rateLimits = new Map<string, { count: number; lastReset: number }>();

function isRateLimited(socketId: string, limit: number = 30, windowMs: number = 60000): boolean {
  const now = Date.now();
  const state = rateLimits.get(socketId) || { count: 0, lastReset: now };

  if (now - state.lastReset > windowMs) {
    state.count = 0;
    state.lastReset = now;
  }

  state.count++;
  rateLimits.set(socketId, state);

  return state.count > limit;
}

// Cleanup rate limits every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of rateLimits.entries()) {
    if (now - state.lastReset > 3600000) {
      rateLimits.delete(id);
    }
  }
}, 3600000);

io.on('connection', (socket: Socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // Create a new room
  socket.on('create-room', (options: RoomOptions, callback: (response: any) => void) => {
    if (isRateLimited(socket.id, 10, 60000)) { // Max 10 rooms per minute
      return callback({ success: false, error: 'Rate limit exceeded. Please wait a minute.' });
    }

    // Validate options
    const maxPeers = Math.min(Math.max(2, options.maxPeers || 10), 50); // Hard limit 50 peers
    const room = createRoom({ ...options, maxPeers });
    
    socket.join(room.id);
    room.peers.set(socket.id, socket);
    peerToRoom.set(socket.id, room.id);

    console.log(`[ROOM] Created: ${room.code} (${room.id})`);
    callback({ success: true, room: getRoomInfo(room) });
  });

  // Join an existing room by ID or code
  socket.on('join-room', (data: { roomIdOrCode: string; password?: string }, callback: (response: any) => void) => {
    if (isRateLimited(socket.id, 60, 60000)) { // Max 60 join attempts per minute
      return callback({ success: false, error: 'Rate limit exceeded.' });
    }

    const { roomIdOrCode, password } = data;
    if (!roomIdOrCode) {
      return callback({ success: false, error: 'Room details required' });
    }

    const input = String(roomIdOrCode).trim();
    // Try code (uppercase) first, then original (for UUIDs)
    let room = rooms.get(input.toUpperCase()) || rooms.get(input);

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

    // Check if we are already in this room to avoid double-join logic
    if (room.peers.has(socket.id)) {
      console.log(`[ROOM] ${socket.id} already in room ${room.code}, ignoring redundant join.`);
      return callback({
        success: true,
        room: getRoomInfo(room),
        existingPeers: [...room.peers.keys()].filter((id) => id !== socket.id),
      });
    }

    // Cancel any pending cleanup timeout
    if (emptyRoomTimeouts.has(room.id)) {
      clearTimeout(emptyRoomTimeouts.get(room.id)!);
      emptyRoomTimeouts.delete(room.id);
      console.log(`[ROOM] Cancelled cleanup for ${room.code} (peer re-joined)`);
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
  socket.on('signal', (data: { targetPeerId: string; signal: any }) => {
    const { targetPeerId, signal } = data;
    if (!targetPeerId || !signal) return;

    const roomId = peerToRoom.get(socket.id);
    if (!roomId) {
      console.warn(`[SIGNAL] No room for ${socket.id}`);
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      console.warn(`[SIGNAL] Room ${roomId} not found for ${socket.id}`);
      return;
    }

    const targetSocket = room.peers.get(targetPeerId);
    if (targetSocket) {
      // Basic signal validation - prevent huge signal objects
      if (JSON.stringify(signal).length > 100000) {
        console.warn(`[SIGNAL] Rejected oversized signal from ${socket.id}`);
        return;
      }

      console.log(`[SIGNAL] ${socket.id} -> ${targetPeerId} (${signal.type})`);
      targetSocket.emit('signal', {
        peerId: socket.id,
        signal,
      });
    } else {
      console.warn(`[SIGNAL] Target ${targetPeerId} not found in room ${room.code}`);
    }
  });

  // Broadcast to all peers in room
  socket.on('broadcast-signal', (data: { signal: any }) => {
    const { signal } = data;
    if (!signal) return;

    const roomId = peerToRoom.get(socket.id);
    if (!roomId) return;

    if (JSON.stringify(signal).length > 100000) return;

    socket.to(roomId).emit('signal', {
      peerId: socket.id,
      signal,
    });
  });

  // Get room info
  socket.on('get-room', (data: { roomIdOrCode: string }, callback: (response: any) => void) => {
    const { roomIdOrCode } = data;
    if (!roomIdOrCode) return callback({ success: false });

    const sanitizedIdOrCode = String(roomIdOrCode).toUpperCase().trim().slice(0, 50);
    const room = rooms.get(sanitizedIdOrCode);
    if (!room) {
      return callback({ success: false, error: 'Room not found' });
    }
    callback({ success: true, room: getRoomInfo(room) });
  });

  // Chat message
  socket.on('chat-message', (data: { message: string }) => {
    const { message } = data;
    if (!message || typeof message !== 'string' || message.length > 5000) return;

    const roomId = peerToRoom.get(socket.id);
    if (!roomId) return;

    socket.to(roomId).emit('chat-message', {
      peerId: socket.id,
      message,
      timestamp: Date.now(),
    });
  });

  // Transfer metadata broadcast
  socket.on('transfer-start', (data: { files: any[] }) => {
    const { files } = data;
    if (!Array.isArray(files) || files.length > 100) return;

    const roomId = peerToRoom.get(socket.id);
    if (!roomId) return;

    socket.to(roomId).emit('transfer-start', {
      peerId: socket.id,
      files,
    });
  });

  // Health check
  socket.on('ping', (callback: (response: any) => void) => {
    callback({
      success: true,
      status: 'alive',
      time: Date.now(),
      rooms: rooms.size / 2, // Divided by 2 because we index by both ID and code
      uptime: process.uptime(),
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

        // Remove empty rooms after a grace period
        if (room.peers.size === 0) {
          console.log(`[ROOM] Room ${room.code} is empty, starting 30s grace period...`);
          const timeout = setTimeout(() => {
            const currentRoom = rooms.get(room.id);
            if (currentRoom && currentRoom.peers.size === 0) {
              rooms.delete(room.id);
              rooms.delete(room.code);
              emptyRoomTimeouts.delete(room.id);
              console.log(`[ROOM] Cleanup complete: Removed empty room ${room.code}`);
            }
          }, 30000); // 30 seconds grace period
          emptyRoomTimeouts.set(room.id, timeout);
        }
      }
      peerToRoom.delete(socket.id);
    }

    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

// Error handlers to prevent server crash
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   P2P Share - Signaling Server               ║
║   Listening on port ${PORT}                     ║
╚══════════════════════════════════════════════╝
  `);
});

export { io, httpServer };
