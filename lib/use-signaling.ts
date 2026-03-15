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

// lib/use-signaling.ts
declare global {
  var __signaling_socket: Socket | undefined;
}

export function useSignaling(): UseSignalingReturn {
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

    const conn = new P2PConnection(DEFAULT_RTC_CONFIG, globalThis.__signaling_socket?.id || '', peerId);

    conn.on('connected', () => {
      setConnectedPeers((prev) => [...new Set([...prev, peerId])]);
      setStatus('connected');
    });

    conn.on('disconnected', () => {
      connectionsRef.current.delete(peerId);
      setConnectedPeers((prev) => prev.filter((id) => id !== peerId));
      if (connectionsRef.current.size === 0) setStatus('connected');
    });

    conn.on('progress', (data) => {
      const progress = data as TransferProgress;
      setTransfers((prev) => {
        const next = new Map(prev);
        next.set(progress.fileId, progress);
        if (progress.status === 'completed') {
          setTimeout(() => {
            setTransfers((prevNext) => {
              const newerNext = new Map(prevNext);
              newerNext.delete(progress.fileId);
              if (newerNext.size === 0) setStatus('connected');
              return newerNext;
            });
          }, 2000);
        }
        return next;
      });
      setStatus('transferring');
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
      globalThis.__signaling_socket?.emit('signal', {
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
        globalThis.__signaling_socket?.emit('signal', {
          targetPeerId: peerId,
          signal: { type: 'offer', sdp: offer },
        });
      });
    }

    return conn;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!globalThis.__signaling_socket) {
      globalThis.__signaling_socket = io(SIGNAL_SERVER, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        autoConnect: true,
      });
    }

    const s = globalThis.__signaling_socket;

    const onConnect = () => {
      setMyPeerId(s.id || '');
      setError(null);
    };

    const onConnectError = (err: Error) => {
      setError(`Cannot connect to signaling server: ${err.message}`);
      setStatus('error');
    };

    const onPeerJoined = ({ peerId }: { peerId: string }) => {
      getOrCreateConnection(peerId, true);
    };

    const onPeerLeft = ({ peerId }: { peerId: string }) => {
      const conn = connectionsRef.current.get(peerId);
      if (conn) {
        conn.close();
        connectionsRef.current.delete(peerId);
      }
      setConnectedPeers((prev) => prev.filter((id) => id !== peerId));
    };

    const onSignal = async ({ peerId, signal }: any) => {
      if (signal.type === 'offer') {
        const conn = getOrCreateConnection(peerId, false);
        const answer = await conn.handleOffer(signal.sdp!);
        s.emit('signal', {
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
    };

    const onRoomExpired = () => {
      setError('Room has expired');
      setRoom(null);
      setStatus('disconnected');
    };

    if (s.connected) onConnect();

    s.on('connect', onConnect);
    s.on('connect_error', onConnectError);
    s.on('peer-joined', onPeerJoined);
    s.on('peer-left', onPeerLeft);
    s.on('signal', onSignal);
    s.on('room-expired', onRoomExpired);

    return () => {
      s.off('connect', onConnect);
      s.off('connect_error', onConnectError);
      s.off('peer-joined', onPeerJoined);
      s.off('peer-left', onPeerLeft);
      s.off('signal', onSignal);
      s.off('room-expired', onRoomExpired);
      
      connectionsRef.current.forEach((conn) => conn.close());
      connectionsRef.current.clear();
    };
  }, [getOrCreateConnection]);

  const createRoom = useCallback(
    (options?: { maxPeers?: number; password?: string }): Promise<Room> => {
      return new Promise((resolve, reject) => {
        setStatus('connecting');
        globalThis.__signaling_socket?.emit('create-room', options || {}, (response: { success: boolean; room: Room; error?: string }) => {
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
        globalThis.__signaling_socket?.emit(
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
    globalThis.__signaling_socket?.emit('leave-room');
  }, []);

  const sendFiles = useCallback((files: File[]) => {
    connectionsRef.current.forEach((conn) => {
      conn.sendFiles(files);
    });
    setStatus('transferring');
    globalThis.__signaling_socket?.emit('transfer-start', {
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
