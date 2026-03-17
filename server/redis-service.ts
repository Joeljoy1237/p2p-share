// server/redis-service.ts
import Redis from 'ioredis';

// Interfaces
export interface RoomOptions {
  maxPeers?: number;
  password?: string | null;
}

export interface Room {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  maxPeers: number;
  password?: string | null;
  isPasswordProtected: boolean;
}

export class RedisService {
  private redis: Redis;
  private isConnected: boolean = false;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      this.isConnected = true;
      console.log('[REDIS] Connected to Redis server');
    });

    this.redis.on('error', (err) => {
      console.error('[REDIS] Error:', err.message);
    });

    this.redis.on('close', () => {
      this.isConnected = false;
      console.log('[REDIS] Connection closed');
    });
  }

  public async disconnect() {
    await this.redis.quit();
  }

  // Rate Limiting
  public async isRateLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
    const redisKey = `ratelimit:${key}`;
    const windowSeconds = Math.ceil(windowMs / 1000);
    
    // Use multi statement to ensure atomicity
    const results = await this.redis.multi()
      .incr(redisKey)
      .ttl(redisKey)
      .exec();

    if (!results) return false;

    const count = results[0][1] as number;
    const ttl = results[1][1] as number;

    if (count === 1 || ttl === -1) {
      await this.redis.expire(redisKey, windowSeconds);
    }

    return count > limit;
  }

  // Room Management
  public async saveRoom(room: Room): Promise<void> {
    const ttlSeconds = Math.ceil((room.expiresAt - Date.now()) / 1000);
    
    if (ttlSeconds <= 0) return;

    // Save room data as a Hash
    await this.redis.multi()
      .hset(`room:${room.id}`, {
        id: room.id,
        code: room.code,
        createdAt: room.createdAt.toString(),
        expiresAt: room.expiresAt.toString(),
        maxPeers: room.maxPeers.toString(),
        password: room.password || '',
        isPasswordProtected: room.isPasswordProtected ? 'true' : 'false',
      })
      .expire(`room:${room.id}`, ttlSeconds)
      // Map code to room ID for fast lookup
      .set(`code:${room.code}`, room.id, 'EX', ttlSeconds)
      .exec();
  }

  public async getRoom(roomIdOrCode: string): Promise<Room | null> {
    let roomId = roomIdOrCode;
    
    // Check if it's a code
    if (roomIdOrCode.length === 8 || roomIdOrCode.length === 6) { // support old 6-char codes temporarily if needed
      const mappedId = await this.redis.get(`code:${roomIdOrCode.toUpperCase()}`);
      if (mappedId) {
        roomId = mappedId;
      }
    }

    const data = await this.redis.hgetall(`room:${roomId}`);
    
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      id: data.id,
      code: data.code,
      createdAt: parseInt(data.createdAt, 10),
      expiresAt: parseInt(data.expiresAt, 10),
      maxPeers: parseInt(data.maxPeers, 10),
      password: data.password || null,
      isPasswordProtected: data.isPasswordProtected === 'true',
    };
  }

  public async deleteRoom(roomId: string, code: string): Promise<void> {
    await this.redis.multi()
      .del(`room:${roomId}`)
      .del(`code:${code}`)
      .del(`room_peers:${roomId}`) // Clean up peers set
      .exec();
  }

  // Peer Management in Rooms
  public async addPeerToRoom(roomId: string, peerId: string): Promise<boolean> {
    // Add peer to the set
    const result = await this.redis.sadd(`room_peers:${roomId}`, peerId);
    if (result === 1) {
      // Also map peer to room
      await this.redis.set(`peer_room:${peerId}`, roomId, 'EX', 24 * 60 * 60); // 24h max
      return true;
    }
    return false; // Peer was already in the room
  }

  public async removePeerFromRoom(roomId: string, peerId: string): Promise<void> {
    await this.redis.multi()
      .srem(`room_peers:${roomId}`, peerId)
      .del(`peer_room:${peerId}`)
      .exec();
  }

  public async getRoomPeers(roomId: string): Promise<string[]> {
    return await this.redis.smembers(`room_peers:${roomId}`);
  }

  public async getPeerRoom(peerId: string): Promise<string | null> {
    return await this.redis.get(`peer_room:${peerId}`);
  }

  public async getRoomPeerCount(roomId: string): Promise<number> {
    return await this.redis.scard(`room_peers:${roomId}`);
  }
}
