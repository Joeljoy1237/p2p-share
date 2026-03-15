// lib/use-signaling.ts
'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { P2PConnection, DEFAULT_RTC_CONFIG } from './peer-connection';
import type { FileMetadata, TransferProgress, Room } from '@/types';

const SIGNAL_SERVER = process.env.NEXT_PUBLIC_SIGNAL_SERVER || 'http://localhost:3001';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'transferring' | 'error';

export interface ReceivedFile {
  fileId: string;
  metadata: FileMetadata;
  blob: Blob;
  url: string;
  receivedAt: number;
}

export interface UseSignalingReturn {
  status: ConnectionStatus;
  room: Room | null;
  myPeerId: string;
  connectedPeers: string[];
  transfers: Map<string, TransferProgress>;
  receivedFiles: ReceivedFile[];
  createRoom: (options?: { maxPeers?: number; password?: string }) => Promise<Room>;
  joinRoom: (roomIdOrCode: string, password?: string) => Promise<void>;
  leaveRoom: () => void;
  sendFiles: (files: File[]) => void;
  cancelTransfer: () => void;
  error: string | null;
}

export function useSignaling(): UseSignalingReturn {
  const socketRef = useRef<Socket | null>(null);
  const connectionsRef = useRef<Map<string, P2PConnection>>(new Map());
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [room, setRoom] = useState<Room | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map());
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const getOrCreateConnection = useCallback((peerId: string, isInitiator: boolean) => {
    if (connectionsRef.current.has(peerId)) {
      return connectionsRef.current.get(peerId)!;
    }

    const conn = new P2PConnection(DEFAULT_RTC_CONFIG, socketRef.current?.id || '', peerId);

    conn.on('connected', () => {
      setConnectedPeers((prev) => [...new Set([...prev, peerId])]);
      setStatus('connected');
    });

    conn.on('disconnected', () => {
      connectionsRef.current.delete(peerId);
      setConnectedPeers((prev) => prev.filter((id) => id !== peerId));
      if (connectionsRef.current.size === 0) setStatus('connected'); // still in room
    });

    conn.on('progress', (data) => {
      const progress = data as TransferProgress;
      setTransfers((prev) => {
        const next = new Map(prev);
        next.set(progress.fileId, progress);
        return next;
      });
      setStatus('transferring');
      if (progress.status === 'completed') {
        setTimeout(() => {
          setTransfers((prev) => {
            const next = new Map(prev);
            next.delete(progress.fileId);
            return next;
          });
          if (transfers.size <= 1) setStatus('connected');
        }, 2000);
      }
    });

    conn.on('file-received', (data) => {
      const { fileId, metadata, blob, url } = data as {
        fileId: string;
        metadata: FileMetadata;
        blob: Blob;
        url: string;
      };
      setReceivedFiles((prev) => [
        ...prev,
        { fileId, metadata, blob, url, receivedAt: Date.now() },
      ]);
    });

    conn.on('ice-candidate', (data) => {
      socketRef.current?.emit('signal', {
        targetPeerId: peerId,
        signal: { type: 'ice-candidate', candidate: (data as { candidate: RTCIceCandidate }).candidate },
      });
    });

    conn.on('error', (err) => {
      setError(`Connection error: ${err}`);
    });

    connectionsRef.current.set(peerId, conn);

    if (isInitiator) {
      conn.createOffer().then((offer) => {
        socketRef.current?.emit('signal', {
          targetPeerId: peerId,
          signal: { type: 'offer', sdp: offer },
        });
      });
    }

    return conn;
  }, [transfers]);

  useEffect(() => {
    const socket = io(SIGNAL_SERVER, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setMyPeerId(socket.id);
      setError(null);
    });

    socket.on('connect_error', (err) => {
      setError(`Cannot connect to signaling server: ${err.message}`);
      setStatus('error');
    });

    socket.on('peer-joined', ({ peerId }: { peerId: string; peerCount: number }) => {
      // We're already in the room, initiate connection to the new peer
      getOrCreateConnection(peerId, true);
    });

    socket.on('peer-left', ({ peerId }: { peerId: string }) => {
      const conn = connectionsRef.current.get(peerId);
      if (conn) {
        conn.close();
        connectionsRef.current.delete(peerId);
      }
      setConnectedPeers((prev) => prev.filter((id) => id !== peerId));
    });

    socket.on('signal', async ({ peerId, signal }: { peerId: string; signal: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      if (signal.type === 'offer') {
        const conn = getOrCreateConnection(peerId, false);
        const answer = await conn.handleOffer(signal.sdp!);
        socket.emit('signal', {
          targetPeerId: peerId,
          signal: { type: 'answer', sdp: answer },
        });
      } else if (signal.type === 'answer') {
        const conn = connectionsRef.current.get(peerId);
        if (conn) await conn.handleAnswer(signal.sdp!);
      } else if (signal.type === 'ice-candidate') {
        const conn = connectionsRef.current.get(peerId);
        if (conn && signal.candidate) await conn.addIceCandidate(signal.candidate);
      }
    });

    socket.on('room-expired', () => {
      setError('Room has expired');
      setRoom(null);
      setStatus('disconnected');
    });

    return () => {
      connectionsRef.current.forEach((conn) => conn.close());
      connectionsRef.current.clear();
      socket.disconnect();
    };
  }, [getOrCreateConnection]);

  const createRoom = useCallback(
    (options?: { maxPeers?: number; password?: string }): Promise<Room> => {
      return new Promise((resolve, reject) => {
        setStatus('connecting');
        socketRef.current?.emit('create-room', options || {}, (response: { success: boolean; room: Room; error?: string }) => {
          if (response.success) {
            setRoom(response.room);
            setStatus('connected');
            resolve(response.room);
          } else {
            setError(response.error || 'Failed to create room');
            setStatus('error');
            reject(new Error(response.error));
          }
        });
      });
    },
    []
  );

  const joinRoom = useCallback(
    (roomIdOrCode: string, password?: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        setStatus('connecting');
        socketRef.current?.emit(
          'join-room',
          { roomIdOrCode: roomIdOrCode.toUpperCase().trim(), password },
          (response: { success: boolean; room: Room; existingPeers: string[]; error?: string }) => {
            if (response.success) {
              setRoom(response.room);
              setStatus('connected');
              // Connect to all existing peers
              response.existingPeers.forEach((peerId) => {
                getOrCreateConnection(peerId, true);
              });
              resolve();
            } else {
              setError(response.error || 'Failed to join room');
              setStatus('error');
              reject(new Error(response.error));
            }
          }
        );
      });
    },
    [getOrCreateConnection]
  );

  const leaveRoom = useCallback(() => {
    connectionsRef.current.forEach((conn) => conn.close());
    connectionsRef.current.clear();
    setConnectedPeers([]);
    setTransfers(new Map());
    setRoom(null);
    setStatus('disconnected');
    socketRef.current?.emit('leave-room');
  }, []);

  const sendFiles = useCallback((files: File[]) => {
    connectionsRef.current.forEach((conn) => {
      conn.sendFiles(files);
    });
    setStatus('transferring');
    socketRef.current?.emit('transfer-start', {
      files: files.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })),
    });
  }, []);

  const cancelTransfer = useCallback(() => {
    connectionsRef.current.forEach((conn) => {
      conn.pauseTransfer();
    });
  }, []);

  return {
    status,
    room,
    myPeerId,
    connectedPeers,
    transfers,
    receivedFiles,
    createRoom,
    joinRoom,
    leaveRoom,
    sendFiles,
    cancelTransfer,
    error,
  };
}
