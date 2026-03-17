import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RedisService, RoomOptions, Room } from './redis-service';

// Required for environment variables in the standalone server script
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PORT = process.env.SIGNAL_PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN.split(',').map(o => o.trim()),
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB for signaling messages
});

const redisService = new RedisService(REDIS_URL);

async function createRoom(options: RoomOptions = {}): Promise<Room> {
  const roomId = uuidv4();
  let code = await generateCode();
  
  // Ensure code uniqueness (basic collision prevention)
  let attempts = 0;
  while ((await redisService.getRoom(code)) && attempts < 100) {
    code = await generateCode();
    attempts++;
  }

  if (attempts >= 100) {
      throw new Error("Failed to generate a unique room code after 100 attempts.");
  }
  
  const room: Room = {
    id: roomId,
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    maxPeers: options.maxPeers || 10,
    password: options.password || null,
    isPasswordProtected: !!options.password,
  };
  
  await redisService.saveRoom(room);
  return room;
}

async function generateCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  // Increased code length to 8 characters to reduce collision probability
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getRoomInfo(room: Room | null) {
  if (!room) return null;
  const peerCount = await redisService.getRoomPeerCount(room.id);
  return {
    id: room.id,
    code: room.code,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    peerCount: peerCount,
    maxPeers: room.maxPeers,
    isPasswordProtected: room.isPasswordProtected,
  };
}

io.on('connection', (socket: Socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // Create a new room
  socket.on('create-room', async (options: RoomOptions, callback: (response: any) => void) => {
    // Rate limit per IP
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const rateLimitKey = `create_room:${clientIp}`;

    if (await redisService.isRateLimited(rateLimitKey as string, 10, 60000)) { // Max 10 rooms per minute
      return callback({ success: false, error: 'Rate limit exceeded. Please wait a minute.' });
    }

    try {
      // Validate options
      const maxPeers = Math.min(Math.max(2, options.maxPeers || 10), 50); // Hard limit 50 peers
      const room = await createRoom({ ...options, maxPeers });
      
      socket.join(room.id);
      await redisService.addPeerToRoom(room.id, socket.id);

      console.log(`[ROOM] Created: ${room.code} (${room.id})`);
      callback({ success: true, room: await getRoomInfo(room) });
    } catch (error) {
      console.error(`[ROOM] Error creating room`, error);
      callback({ success: false, error: 'Internal server error while creating room.' });
    }
  });

  // Join an existing room by ID or code
  socket.on('join-room', async (data: { roomIdOrCode: string; password?: string }, callback: (response: any) => void) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const rateLimitKey = `join_room:${clientIp}`;

    if (await redisService.isRateLimited(rateLimitKey as string, 60, 60000)) { // Max 60 join attempts per minute
      return callback({ success: false, error: 'Rate limit exceeded.' });
    }

    const { roomIdOrCode, password } = data;
    if (!roomIdOrCode) {
      return callback({ success: false, error: 'Room details required' });
    }

    const input = String(roomIdOrCode).trim();
    
    try {
      const room = await redisService.getRoom(input);

      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }

      if (room.expiresAt < Date.now()) {
        return callback({ success: false, error: 'Room has expired' });
      }

      const peerCount = await redisService.getRoomPeerCount(room.id);
      if (peerCount >= room.maxPeers) {
        return callback({ success: false, error: 'Room is full' });
      }

      if (room.isPasswordProtected && room.password !== password) {
        return callback({ success: false, error: 'Invalid password' });
      }

      // Check if we are already in this room to avoid double-join logic
      const existingPeers = await redisService.getRoomPeers(room.id);
      if (existingPeers.includes(socket.id)) {
        console.log(`[ROOM] ${socket.id} already in room ${room.code}, ignoring redundant join.`);
        return callback({
          success: true,
          room: await getRoomInfo(room),
          existingPeers: existingPeers.filter((id) => id !== socket.id),
        });
      }

      socket.join(room.id);
      const added = await redisService.addPeerToRoom(room.id, socket.id);
      
      const updatedPeers = await redisService.getRoomPeers(room.id);
      const isActuallyNew = added;

      if (isActuallyNew) {
        // Notify existing peers only if this is a fresh join
        socket.to(room.id).emit('peer-joined', {
          peerId: socket.id,
          peerCount: updatedPeers.length,
        });

        console.log(`[ROOM] ${socket.id} joined room ${room.code} (Initial)`);
      } else {
        console.log(`[ROOM] ${socket.id} joined room ${room.code} (Re-join/Redundant)`);
      }

      callback({
        success: true,
        room: await getRoomInfo(room),
        existingPeers: updatedPeers.filter((id) => id !== socket.id),
      });
    } catch (error) {
      console.error(`[ROOM] Error joining room ${input}:`, error);
      callback({ success: false, error: 'Internal server error while joining room.' });
    }
  });

  // WebRTC Signaling
  socket.on('signal', async (data: { targetPeerId: string; signal: any }) => {
    const { targetPeerId, signal } = data;
    if (!targetPeerId || !signal) return;

    try {
      const roomId = await redisService.getPeerRoom(socket.id);
      if (!roomId) {
        console.warn(`[SIGNAL] No room for ${socket.id}`);
        socket.emit('signal-error', { message: 'You are not in a room.' });
        return;
      }

      const roomPeers = await redisService.getRoomPeers(roomId);
      if (!roomPeers.includes(targetPeerId)) {
        console.warn(`[SIGNAL] Target ${targetPeerId} not found in room ${roomId}`);
        socket.emit('signal-error', { 
            targetPeerId, 
            message: 'Target peer not found or disconnected.' 
        });
        return;
      }

      if (JSON.stringify(signal).length > 100000) {
        console.warn(`[SIGNAL] Rejected oversized signal from ${socket.id}`);
        return;
      }

      console.log(`[SIGNAL] ${socket.id} -> ${targetPeerId} (${signal.type})`);
      socket.to(targetPeerId).emit('signal', {
        peerId: socket.id,
        signal,
      });
    } catch (error) {
      console.error(`[SIGNAL] Error routing signal:`, error);
    }
  });

  // Broadcast to all peers in room
  socket.on('broadcast-signal', async (data: { signal: any }) => {
    const { signal } = data;
    if (!signal) return;

    try {
      const roomId = await redisService.getPeerRoom(socket.id);
      if (!roomId) return;
      if (JSON.stringify(signal).length > 100000) return;

      socket.to(roomId).emit('signal', {
        peerId: socket.id,
        signal,
      });
    } catch (error) {
      console.error(`[SIGNAL] Error broadcasting signal:`, error);
    }
  });

  // Get room info
  socket.on('get-room', async (data: { roomIdOrCode: string }, callback: (response: any) => void) => {
    const { roomIdOrCode } = data;
    if (!roomIdOrCode) return callback({ success: false });

    const sanitizedIdOrCode = String(roomIdOrCode).toUpperCase().trim().slice(0, 50);
    try {
      const room = await redisService.getRoom(sanitizedIdOrCode);
      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }
      callback({ success: true, room: await getRoomInfo(room) });
    } catch (error) {
      console.error(`[ROOM] Error getting room info:`, error);
      callback({ success: false, error: 'Internal server error.' });
    }
  });

  // Chat message
  socket.on('chat-message', async (data: { message: string }) => {
    const { message } = data;
    if (!message || typeof message !== 'string' || message.length > 5000) return;

    try {
      const roomId = await redisService.getPeerRoom(socket.id);
      if (!roomId) return;

      socket.to(roomId).emit('chat-message', {
        peerId: socket.id,
        message,
        timestamp: Date.now(),
      });
    } catch (error) {
       console.error(`[CHAT] Error sending message:`, error);
    }
  });

  // Transfer metadata broadcast
  socket.on('transfer-start', async (data: { files: any[] }) => {
    const { files } = data;
    if (!Array.isArray(files) || files.length > 100) return;

    try {
      const roomId = await redisService.getPeerRoom(socket.id);
      if (!roomId) return;

      socket.to(roomId).emit('transfer-start', {
        peerId: socket.id,
        files,
      });
    } catch (error) {
      console.error(`[TRANSFER] Error broadcasting transfer start:`, error);
    }
  });

  // Health check
  socket.on('ping', async (callback: (response: any) => void) => {
    try {
      // verify redis is alive
      await redisService.getRoom('healthcheck');
      callback({
        success: true,
        status: 'alive',
        time: Date.now(),
        uptime: process.uptime(),
        backend: 'redis'
      });
    } catch (error) {
      callback({ success: false, status: 'degraded', error: 'Redis connection failing' });
    }
  });

  const handleDisconnectOrLeave = async () => {
    try {
      const roomId = await redisService.getPeerRoom(socket.id);
      if (roomId) {
        await redisService.removePeerFromRoom(roomId, socket.id);
        socket.leave(roomId);
        
        const peerCount = await redisService.getRoomPeerCount(roomId);
        
        socket.to(roomId).emit('peer-left', {
          peerId: socket.id,
          peerCount: peerCount,
        });

        if (peerCount === 0) {
           console.log(`[ROOM] Room ${roomId} is empty. Scheduling rapid cleanup.`);
           const room = await redisService.getRoom(roomId);
           if (room) {
               setTimeout(async () => {
                   const currentCount = await redisService.getRoomPeerCount(roomId);
                   if (currentCount === 0) {
                       await redisService.deleteRoom(roomId, room.code);
                       console.log(`[ROOM] Deleted empty room ${room.code} (${roomId})`);
                   }
               }, 30000);
           }
        }
      }
    } catch (error) {
      console.error(`[ROOM] Error handling peer leave for socket ${socket.id}:`, error);
    }
  };

  // Leave room
  socket.on('leave-room', async () => {
    await handleDisconnectOrLeave();
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    await handleDisconnectOrLeave();
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

// Graceful Shutdown
function gracefulShutdown() {
  console.log('[SERVER] Received shutdown signal. Notifying clients and exiting...');
  // Notify all connected sockets
  io.emit('server-shutdown', { message: 'Server is shutting down for maintenance or scaling.' });
  
  // Disconnect resources
  redisService.disconnect().then(() => {
    httpServer.close(() => {
      console.log('[SERVER] Closed out remaining connections.');
      process.exit(0);
    });
  }).catch((err) => {
    console.error('[SERVER] Error during Redis disconnect:', err);
    process.exit(1);
  });
  
  // Force close after 10 seconds if not gracefully closed
  setTimeout(() => {
    console.error('[SERVER] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   P2P Share - Signaling Server (Redis)       ║
║   Listening on port ${PORT}                     ║
╚══════════════════════════════════════════════╝
  `);
});

export { io, httpServer };
