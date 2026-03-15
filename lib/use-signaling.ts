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
  onFileStart?: (peerId: string, fileId: string, metadata: FileMetadata) => void;
  error: string | null;
}

// lib/use-signaling.ts
declare global {
  var __signaling_socket: Socket | undefined;
}

export function useSignaling(options?: { onFileStart?: (peerId: string, fileId: string, metadata: FileMetadata) => void }): UseSignalingReturn {
  const connectionsRef = useRef<Map<string, P2PConnection>>(new Map());
  const optionsRef = useRef(options);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [room, setRoom] = useState<Room | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [pendingPeers, setPendingPeers] = useState<string[]>([]); // New: track peers in handshake
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map());
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const passwordRef = useRef<string>('');

  // Keep room ref in sync
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  // Keep options stable without triggering re-renders
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const getOrCreateConnection = useCallback((peerId: string, isInitiator: boolean) => {
    const s = globalThis.__signaling_socket;
    const myId = s?.id || '';
    
    if (connectionsRef.current.has(peerId)) {
      return connectionsRef.current.get(peerId)!;
    }

    console.log(`[SIGNALING] Creating connection to ${peerId}. Initiator: ${isInitiator}. My ID: ${myId}`);
    setPendingPeers(prev => [...new Set([...prev, peerId])]);

    const conn = new P2PConnection(DEFAULT_RTC_CONFIG, myId, peerId);
    
    // Watchdog to cleanup if connection never establishes
    const watchdog = setTimeout(() => {
      if (connectionsRef.current.get(peerId) === conn && connectedPeers.indexOf(peerId) === -1) {
        console.warn(`[SIGNALING] Connection watchdog timed out for ${peerId}`);
        setPendingPeers(prev => prev.filter(id => id !== peerId));
        setError(`Connection timeout with ${peerId.slice(0, 4)}. Check network/firewall.`);
        conn.close();
        connectionsRef.current.delete(peerId);
      }
    }, 15000);

    conn.on('file-start', (data) => {
      const { fileId, metadata } = data as { fileId: string; metadata: FileMetadata };
      optionsRef.current?.onFileStart?.(peerId, fileId, metadata);
    });

    conn.on('connected', () => {
      console.log(`[SIGNALING] P2P established with ${peerId}`);
      clearTimeout(watchdog);
      setPendingPeers(prev => prev.filter(id => id !== peerId));
      setConnectedPeers((prev) => [...new Set([...prev, peerId])]);
      setStatus('connected');
    });

    conn.on('disconnected', () => {
      console.log(`[SIGNALING] P2P disconnected from ${peerId}`);
      clearTimeout(watchdog);
      connectionsRef.current.delete(peerId);
      setPendingPeers(prev => prev.filter(id => id !== peerId));
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
      const item = data as ReceivedFile;
      setReceivedFiles((prev) => [
        ...prev,
        { ...item, receivedAt: Date.now() },
      ]);
    });

    conn.on('ice-candidate', (data) => {
      globalThis.__signaling_socket?.emit('signal', {
        targetPeerId: peerId,
        signal: { type: 'ice-candidate', candidate: (data as { candidate: RTCIceCandidate }).candidate },
      });
    });

    conn.on('error', (err) => {
      const errMsg = typeof err === 'string' ? err : JSON.stringify(err);
      console.error(`[SIGNALING] P2P error for ${peerId}:`, errMsg);
      
      // Ignore non-fatal flow control errors that might leak through
      if (errMsg.toLowerCase().includes('full') || errMsg.toLowerCase().includes('queue')) {
        console.warn(`[SIGNALING] Ignoring flow-control error for ${peerId}`);
        return;
      }

      clearTimeout(watchdog);
      setPendingPeers(prev => prev.filter(id => id !== peerId));
      setError(`P2P Error: ${errMsg}`);
      
      // Cleanup failed connection
      conn.close();
      connectionsRef.current.delete(peerId);
      setConnectedPeers(prev => prev.filter(id => id !== peerId));
    });

    connectionsRef.current.set(peerId, conn);

    if (isInitiator) {
      console.log(`[SIGNALING] Initiating connection to ${peerId}...`);
      conn.createOffer().then((offer) => {
        globalThis.__signaling_socket?.emit('signal', {
          targetPeerId: peerId,
          signal: { type: 'offer', sdp: offer },
        });
      }).catch(err => {
        console.error(`[SIGNALING] Failed to create offer for ${peerId}:`, err);
        setError(`Local setup failed: ${err.message}`);
      });
    }

    return conn;
  }, [connectedPeers]);

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
      console.log('[SIGNALING] Socket connected:', s.id);
      setMyPeerId(s.id || '');
      setError(null);
      
      if (roomRef.current) {
        console.log('[SIGNALING] Re-joining room:', roomRef.current.code);
        s.emit('join-room', { 
          roomIdOrCode: roomRef.current.code,
          password: passwordRef.current 
        }, (response: any) => {
          if (response.success) {
            console.log('[SIGNALING] Successfully re-joined room');
            const myId = s.id || '';
            response.existingPeers.forEach((peerId: string) => {
              const isInitiator = myId < peerId;
              getOrCreateConnection(peerId, isInitiator);
            });
          }
        });
      }
    };

    const onConnectError = (err: Error) => {
      console.error('[SIGNALING] Socket connect error:', err.message);
      setError(`Cannot connect to signaling server: ${err.message}`);
      setStatus('error');
    };

    const onPeerJoined = ({ peerId }: { peerId: string }) => {
      const myId = s.id || '';
      console.log('[SIGNALING] Peer joined room:', peerId);
      const isInitiator = myId < peerId;
      getOrCreateConnection(peerId, isInitiator);
    };

    const onPeerLeft = ({ peerId }: { peerId: string }) => {
      console.log('[SIGNALING] Peer left room:', peerId);
      const conn = connectionsRef.current.get(peerId);
      if (conn) {
        conn.close();
        connectionsRef.current.delete(peerId);
      }
      setPendingPeers(prev => prev.filter(id => id !== peerId));
      setConnectedPeers((prev) => prev.filter((id) => id !== peerId));
    };

    const onSignal = async ({ peerId, signal }: any) => {
      console.log(`[SIGNALING] Signal received from ${peerId}:`, signal.type);
      try {
        if (signal.type === 'offer') {
          const conn = getOrCreateConnection(peerId, false);
          const answer = await conn.handleOffer(signal.sdp!);
          s.emit('signal', {
            targetPeerId: peerId,
            signal: { type: 'answer', sdp: answer },
          });
        } else if (signal.type === 'answer') {
          const conn = connectionsRef.current.get(peerId);
          if (conn) {
            await conn.handleAnswer(signal.sdp!);
          } else {
            console.warn(`[SIGNALING] Received answer for unknown connection: ${peerId}`);
          }
        } else if (signal.type === 'ice-candidate') {
          const conn = connectionsRef.current.get(peerId);
          if (conn) {
            if (signal.candidate) {
              await conn.addIceCandidate(signal.candidate);
            }
          } else {
            // Queue candidates for unknown connections? We use getOrCreate for offers, 
            // but candidates might arrive before or after specialized glare logic.
            // For now, let's just log it.
            console.log(`[SIGNALING] ICE candidate for unknown peer ${peerId}, ignoring.`);
          }
        }
      } catch (err) {
        console.error(`[SIGNALING] Error processing signal from ${peerId}:`, err);
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
    };
  }, [getOrCreateConnection]);

  // Separate effect for closing connections on unmount ONLY
  useEffect(() => {
    return () => {
      connectionsRef.current.forEach((conn) => conn.close());
      connectionsRef.current.clear();
    };
  }, []);

  const createRoom = useCallback(
    (options?: { maxPeers?: number; password?: string }): Promise<Room> => {
      return new Promise((resolve, reject) => {
        const s = globalThis.__signaling_socket;
        if (!s) return reject(new Error('Signaling not initialized'));
        setStatus('connecting');
        passwordRef.current = options?.password || '';
        s.emit('create-room', options || {}, (response: { success: boolean; room: Room; error?: string }) => {
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
        const s = globalThis.__signaling_socket;
        if (!s) return reject(new Error('Signaling not initialized'));
        setStatus('connecting');
        passwordRef.current = password || '';
        s.emit(
          'join-room',
          { roomIdOrCode: roomIdOrCode.toUpperCase().trim(), password },
          (response: { success: boolean; room: Room; existingPeers: string[]; error?: string }) => {
            if (response.success) {
              setRoom(response.room);
              setStatus('connected');
              const myId = s.id || '';
              // Connect to all existing peers, but only if we are the initiator (by ID)
              response.existingPeers.forEach((peerId) => {
                const isInitiator = myId < peerId;
                getOrCreateConnection(peerId, isInitiator);
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
    globalThis.__signaling_socket?.emit('leave-room');
    setRoom(null);
    setConnectedPeers([]);
    setPendingPeers([]);
    connectionsRef.current.forEach((conn) => conn.close());
    connectionsRef.current.clear();
    setStatus('disconnected');
    passwordRef.current = '';
  }, []);

  const sendFiles = useCallback((files: File[]) => {
    connectionsRef.current.forEach((conn) => {
      conn.sendFiles(files);
    });
  }, []);

  const setFileStream = useCallback((peerId: string, fileId: string, stream: any) => {
    const conn = connectionsRef.current.get(peerId);
    if (conn) {
      conn.setWritableStream(fileId, stream);
    }
  }, []);

  const pauseTransfer = useCallback(() => {
    connectionsRef.current.forEach((conn) => {
      conn.pauseTransfer();
    });
  }, []);

  const resumeTransfer = useCallback(() => {
    connectionsRef.current.forEach((conn) => {
      conn.resumeTransfer();
    });
  }, []);

  return {
    status,
    room,
    myPeerId,
    connectedPeers,
    pendingPeers,
    transfers,
    receivedFiles,
    createRoom,
    joinRoom,
    leaveRoom,
    sendFiles,
    setFileStream,
    pauseTransfer,
    resumeTransfer,
    error,
  };
}
