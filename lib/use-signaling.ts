// lib/use-signaling.ts
'use client';
import type { FileMetadata, TransferProgress, Room } from '@/types';
import { useSignalingContext } from './signaling-context';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'transferring' | 'error';

export interface ReceivedFile {
  fileId: string;
  metadata: FileMetadata;
  blob?: Blob;
  url?: string;
  receivedAt: number;
  streamed?: boolean;
}

export interface UseSignalingReturn {
  status: ConnectionStatus;
  room: Room | null;
  myPeerId: string;
  connectedPeers: string[];
  pendingPeers: string[];
  transfers: Map<string, TransferProgress>;
  receivedFiles: ReceivedFile[];
  createRoom: (options?: { maxPeers?: number; password?: string }) => Promise<Room>;
  joinRoom: (roomIdOrCode: string, password?: string) => Promise<void>;
  leaveRoom: () => void;
  sendFiles: (files: File[]) => void;
  setFileStream: (peerId: string, fileId: string, stream: any) => void;
  pauseTransfer: () => void;
  resumeTransfer: () => void;
  cancelTransfer: () => void;
  checkServerHealth: () => Promise<{ alive: boolean; stats?: any }>;
  onFileStart?: (peerId: string, fileId: string, metadata: FileMetadata) => void;
  error: string | null;
}

export function useSignaling(options?: { onFileStart?: (peerId: string, fileId: string, metadata: FileMetadata) => void }): UseSignalingReturn {
  const context = useSignalingContext();
  
  // Note: the original hook allowed passing onFileStart here. 
  // In a singleton pattern, this is trickier. 
  // For now, we return the context but we might want to handle local callbacks if needed.
  // Most callers don't actually use this parameter in the current codebase.

  return context as UseSignalingReturn;
}
