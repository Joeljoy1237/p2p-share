// lib/signaling-context.tsx
'use client';

import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { P2PConnection, DEFAULT_RTC_CONFIG } from './peer-connection';
import type { FileMetadata, TransferProgress, Room } from '@/types';
import type { ConnectionStatus, ReceivedFile, UseSignalingReturn } from './use-signaling';

const SIGNAL_SERVER = process.env.NEXT_PUBLIC_SIGNAL_SERVER || 'http://localhost:3001';

const SignalingContext = createContext<UseSignalingReturn | null>(null);

// Global singleton for the socket to survive re-renders and Fast Refresh
declare global {
  var __signaling_socket: Socket | undefined;
}

export function SignalingProvider({ children }: { children: React.ReactNode }) {
  const connectionsRef = useRef<Map<string, P2PConnection>>(new Map());
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [room, setRoom] = useState<Room | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [lastSocketId, setLastSocketId] = useState('');
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [pendingPeers, setPendingPeers] = useState<string[]>([]);
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map());
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const roomRef = useRef<Room | null>(null);
  const statusRef = useRef<ConnectionStatus>('disconnected');
  const passwordRef = useRef<string>('');
  const pendingCreationsRef = useRef<Set<string>>(new Set());

  // Initialize socket singleton if not already present
  if (typeof window !== 'undefined' && !globalThis.__signaling_socket) {
    globalThis.__signaling_socket = io(SIGNAL_SERVER, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      autoConnect: true,
    });
  }

  // Sync refs
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { statusRef.current = status; }, [status]);

  const getOrCreateConnection = useCallback((peerId: string, isInitiator: boolean) => {
    const s = globalThis.__signaling_socket;
    const myId = s?.id || '';
    
    const existing = connectionsRef.current.get(peerId);
    if (existing) {
      const state = existing.getConnectionState();
      if (state !== 'failed' && state !== 'closed') {
        return existing;
      }
      existing.close();
    }

    if (pendingCreationsRef.current.has(peerId)) {
      console.log(`[SIGNALING] Already creating connection for ${peerId}, skipping duplicate.`);
      return connectionsRef.current.get(peerId)!;
    }
    pendingCreationsRef.current.add(peerId);

    try {
      const conn = new P2PConnection(DEFAULT_RTC_CONFIG, myId, peerId);
      console.log(`[SIGNALING] Creating connection [${(conn as any).instanceId}] to ${peerId}. Initiator: ${isInitiator}. My ID: ${myId}`);
      
      connectionsRef.current.set(peerId, conn);
      setPendingPeers(prev => [...new Set([...prev, peerId])]);
      
      const watchdog = setTimeout(() => {
        const activeConn = connectionsRef.current.get(peerId);
        if (activeConn === conn) {
          const state = conn.getConnectionState();
          if (state !== 'connected') {
            console.warn(`[SIGNALING] Watchdog cleanup for ${peerId} [${(conn as any).instanceId}]. State: ${state}`);
            setPendingPeers(prev => prev.filter(id => id !== peerId));
            setError(`Connection timeout with ${peerId.slice(0, 4)}. check network.`);
            conn.close();
            connectionsRef.current.delete(peerId);
            setConnectedPeers(prev => prev.filter(id => id !== peerId));
          }
        } else {
          conn.close();
        }
      }, 45000);

      conn.on('file-start', (data) => {
        const { fileId, metadata } = data as { fileId: string; metadata: FileMetadata };
        setTransfers((prev) => {
          if (prev.has(fileId)) return prev;
          const next = new Map(prev);
          next.set(fileId, {
            fileId,
            fileName: metadata.name,
            totalSize: metadata.size,
            transferredBytes: 0,
            percentage: 0,
            speed: 0,
            eta: 0,
            status: 'transferring',
            fileType: metadata.type,
          });
          return next;
        });
      });

      conn.on('connected', () => {
        console.log(`[SIGNALING] P2P established with ${peerId} [${(conn as any).instanceId}]`);
        clearTimeout(watchdog);
        setPendingPeers(prev => prev.filter(id => id !== peerId));
        setConnectedPeers(prev => [...new Set([...prev, peerId])]);
        setStatus('connected');
      });

      conn.on('disconnected', (data) => {
        console.log(`[SIGNALING] P2P disconnected from ${peerId}`, data);
        clearTimeout(watchdog);
        connectionsRef.current.delete(peerId);
        setPendingPeers(prev => prev.filter(id => id !== peerId));
        setConnectedPeers(prev => prev.filter(id => id !== peerId));
        if (connectionsRef.current.size === 0) setStatus('connected');
        if ((data as any)?.cancelled) setTransfers(new Map());
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
        setReceivedFiles((prev) => {
          if (prev.some(f => f.fileId === item.fileId)) return prev;
          return [...prev, { ...item, receivedAt: Date.now() }];
        });
      });

      conn.on('ice-candidate', (data) => {
        globalThis.__signaling_socket?.emit('signal', {
          targetPeerId: peerId,
          signal: { type: 'ice-candidate', candidate: (data as { candidate: RTCIceCandidate }).candidate },
        });
      });

      conn.on('error', (err) => {
        const errMsg = typeof err === 'string' ? err : (err as any).message || JSON.stringify(err);
        console.error(`[SIGNALING] P2P error for ${peerId}:`, errMsg);
        if (errMsg.toLowerCase().includes('full') || errMsg.toLowerCase().includes('queue')) return;
        clearTimeout(watchdog);
        setPendingPeers(prev => prev.filter(id => id !== peerId));
        setError(`P2P Error: ${errMsg}`);
        conn.close();
        connectionsRef.current.delete(peerId);
        setConnectedPeers(prev => prev.filter(id => id !== peerId));
      });

      if (isInitiator) {
        conn.createOffer().then((offer) => {
          globalThis.__signaling_socket?.emit('signal', { targetPeerId: peerId, signal: { type: 'offer', sdp: offer } });
        });
      }

      pendingCreationsRef.current.delete(peerId);
      return conn;
    } catch (err) {
      pendingCreationsRef.current.delete(peerId);
      throw err;
    }
  }, []);

  useEffect(() => {
    const s = globalThis.__signaling_socket;
    if (!s) return;

    // Remove existing listeners to avoid duplicates on remount
    s.off('connect');
    s.off('peer-joined');
    s.off('peer-left');
    s.off('signal');
    s.off('room-expired');

    s.on('connect', () => {
      const newId = s.id || '';
      console.log('[SIGNALING] Socket connected:', newId);
      if (lastSocketId && lastSocketId !== newId) {
        connectionsRef.current.forEach(c => c.close());
        connectionsRef.current.clear();
        setConnectedPeers([]);
        setPendingPeers([]);
      }
      setLastSocketId(newId);
      setMyPeerId(newId);
      setError(null);

      if (roomRef.current && statusRef.current === 'disconnected') {
        s.emit('join-room', { roomIdOrCode: roomRef.current.code, password: passwordRef.current }, (res: any) => {
          if (res.success) {
            res.existingPeers.forEach((p: string) => getOrCreateConnection(p, s.id! < p));
          }
        });
      }
    });

    s.on('peer-joined', ({ peerId }: { peerId: string }) => {
      getOrCreateConnection(peerId, s.id! < peerId);
    });

    s.on('peer-left', ({ peerId }: { peerId: string }) => {
      const conn = connectionsRef.current.get(peerId);
      if (conn) {
        conn.close();
        connectionsRef.current.delete(peerId);
      }
      setPendingPeers(prev => prev.filter(id => id !== peerId));
      setConnectedPeers(prev => prev.filter(id => id !== peerId));
    });

    s.on('signal', async ({ peerId, signal }: any) => {
      try {
        if (signal.type === 'offer') {
          const conn = getOrCreateConnection(peerId, false);
          const answer = await conn.handleOffer(signal.sdp!);
          if (answer) s.emit('signal', { targetPeerId: peerId, signal: { type: 'answer', sdp: answer } });
        } else if (signal.type === 'answer') {
          connectionsRef.current.get(peerId)?.handleAnswer(signal.sdp!);
        } else if (signal.type === 'ice-candidate') {
          const conn = connectionsRef.current.get(peerId) || getOrCreateConnection(peerId, false);
          if (signal.candidate) await conn.addIceCandidate(signal.candidate);
        }
      } catch (err) {
        console.error(`[SIGNALING] Error processing signal from ${peerId}:`, err);
      }
    });

    s.on('room-expired', () => {
      setError('Room has expired');
      setRoom(null);
      setStatus('disconnected');
    });

    return () => {
      s.off('connect');
      s.off('peer-joined');
      s.off('peer-left');
      s.off('signal');
      s.off('room-expired');
    };
  }, [getOrCreateConnection]);

  const createRoom = useCallback((options?: any): Promise<Room> => {
    return new Promise((resolve, reject) => {
      const s = globalThis.__signaling_socket;
      if (!s) return reject(new Error('Socket not ready'));
      setStatus('connecting');
      passwordRef.current = options?.password || '';
      s.emit('create-room', options || {}, (res: any) => {
        if (res.success) {
          setRoom(res.room);
          setStatus('connected');
          resolve(res.room);
        } else {
          setError(res.error);
          setStatus('error');
          reject(new Error(res.error));
        }
      });
    });
  }, []);

  const joinRoom = useCallback((roomIdOrCode: string, password?: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const s = globalThis.__signaling_socket;
      if (!s) return reject(new Error('Socket not ready'));
      setStatus('connecting');
      passwordRef.current = password || '';
      s.emit('join-room', { roomIdOrCode: roomIdOrCode.trim(), password }, (res: any) => {
        if (res.success) {
          setRoom(res.room);
          setStatus('connected');
          res.existingPeers.forEach((p: string) => getOrCreateConnection(p, s.id! < p));
          resolve();
        } else {
          setError(res.error);
          setStatus('error');
          reject(new Error(res.error));
        }
      });
    });
  }, [getOrCreateConnection]);

  const leaveRoom = useCallback(() => {
    globalThis.__signaling_socket?.emit('leave-room');
    setRoom(null);
    setConnectedPeers([]);
    setPendingPeers([]);
    connectionsRef.current.forEach(c => c.close());
    connectionsRef.current.clear();
    setStatus('disconnected');
    passwordRef.current = '';
  }, []);

  const sendFiles = useCallback((files: File[]) => {
    if (files.length > 0 && connectionsRef.current.size > 0) setStatus('transferring');
    connectionsRef.current.forEach(c => c.sendFiles(files));
  }, []);

  const setFileStream = useCallback((peerId: string, fileId: string, stream: any) => {
    connectionsRef.current.get(peerId)?.setWritableStream(fileId, stream);
  }, []);

  const pauseTransfer = useCallback(() => connectionsRef.current.forEach(c => c.pauseTransfer()), []);
  const resumeTransfer = useCallback(() => connectionsRef.current.forEach(c => c.resumeTransfer()), []);
  const cancelTransfer = useCallback(() => connectionsRef.current.forEach(c => c.cancelTransfer()), []);

  const checkServerHealth = async () => {
    return new Promise<{ alive: boolean; stats?: any }>((resolve) => {
      const s = globalThis.__signaling_socket;
      if (!s?.connected) return resolve({ alive: false });
      const t = setTimeout(() => resolve({ alive: false }), 3000);
      s.emit('ping', (res: any) => {
        clearTimeout(t);
        resolve(res?.success ? { alive: true, stats: res } : { alive: false });
      });
    });
  };

  const value: UseSignalingReturn = {
    status, room, myPeerId, connectedPeers, pendingPeers, transfers, receivedFiles, error,
    createRoom, joinRoom, leaveRoom, sendFiles, setFileStream, pauseTransfer, resumeTransfer, cancelTransfer, checkServerHealth
  };

  return <SignalingContext.Provider value={value}>{children}</SignalingContext.Provider>;
}

export function useSignalingContext() {
  const context = useContext(SignalingContext);
  if (!context) throw new Error('useSignalingContext must be used within a SignalingProvider');
  return context;
}
