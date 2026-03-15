// types/index.ts

export type TransferStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'transferring'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled';

export type PeerRole = 'sender' | 'receiver';

export type NetworkMode = 'local' | 'internet' | 'unknown';

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  checksum?: string;
}

export interface TransferProgress {
  fileId: string;
  fileName: string;
  totalSize: number;
  transferredBytes: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number;   // estimated seconds remaining
  status: TransferStatus;
  error?: string;
}

export interface PeerInfo {
  peerId: string;
  role: PeerRole;
  roomId: string;
  network: NetworkMode;
  connectedAt: number;
  userAgent?: string;
}

export interface Room {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  peers: PeerInfo[];
  maxPeers: number;
  isPasswordProtected: boolean;
}

export interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave' | 'ready' | 'peer-list' | 'error';
  roomId: string;
  peerId: string;
  targetPeerId?: string;
  payload?: unknown;
  timestamp: number;
}

export interface ChunkMessage {
  type: 'chunk' | 'file-meta' | 'file-start' | 'file-end' | 'pause' | 'resume' | 'cancel' | 'ack';
  fileId: string;
  chunkIndex?: number;
  totalChunks?: number;
  data?: ArrayBuffer;
  metadata?: FileMetadata;
  checksum?: string;
}

export interface TransferSession {
  sessionId: string;
  roomId: string;
  files: FileMetadata[];
  totalSize: number;
  startedAt: number;
  completedAt?: number;
  status: TransferStatus;
  peers: string[];
}

export interface ICEServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RTCConfig {
  iceServers: ICEServer[];
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-bundle' | 'max-compat';
  iceCandidatePoolSize?: number;
}
