// lib/peer-connection.ts
import { v4 as uuidv4 } from 'uuid';
import type {
  FileMetadata,
  TransferProgress,
  TransferStatus,
  ChunkMessage,
  RTCConfig,
} from '@/types';

const CHUNK_SIZE = 256 * 1024; // 256KB chunks
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16MB buffer limit
const BUFFER_THRESHOLD = 8 * 1024 * 1024; // 8MB threshold before pausing

export const DEFAULT_RTC_CONFIG: RTCConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Public TURN servers for relay fallback
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
};

export type PeerEventType =
  | 'connected'
  | 'disconnected'
  | 'progress'
  | 'file-received'
  | 'file-start'
  | 'error'
  | 'ice-candidate'
  | 'offer'
  | 'answer';

type PeerEventCallback = (data: unknown) => void;

export class P2PConnection {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private peerId: string;
  private remotePeerId: string;
  private listeners: Map<PeerEventType, PeerEventCallback[]> = new Map();

  // Send state
  private sendQueue: File[] = [];
  private currentSendFile: File | null = null;
  private currentSendMeta: FileMetadata | null = null;
  private sendPaused = false;
  private totalSent = 0;
  private sendStart = 0;
  private lastSpeedCalc = 0;
  private lastBytesSent = 0;

  // Receive state
  private receiveBuffers: Map<string, ArrayBuffer[]> = new Map();
  private receiveMetas: Map<string, FileMetadata> = new Map();
  private receiveProgress: Map<string, number> = new Map();

  constructor(
    config: RTCConfig = DEFAULT_RTC_CONFIG,
    peerId: string = uuidv4(),
    remotePeerId = ''
  ) {
    this.peerId = peerId;
    this.remotePeerId = remotePeerId;
    this.pc = new RTCPeerConnection(config as RTCConfiguration);
    this.setupPCListeners();
  }

  private setupPCListeners() {
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.emit('ice-candidate', { candidate: e.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') this.emit('connected', {});
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.emit('disconnected', { state });
      }
    };

    this.pc.ondatachannel = (e) => {
      this.setupDataChannel(e.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.emit('connected', { channelOpen: true });
    };

    channel.onclose = () => {
      this.emit('disconnected', { channelClosed: true });
    };

    channel.onerror = (e) => {
      this.emit('error', { error: e });
    };

    channel.onmessage = (e) => {
      this.handleMessage(e.data);
    };

    channel.bufferedAmountLowThreshold = BUFFER_THRESHOLD;
    channel.onbufferedamountlow = () => {
      if (this.sendPaused && this.currentSendFile) {
        this.sendPaused = false;
        this.sendNextChunks();
      }
    };
  }

  private handleMessage(data: ArrayBuffer | string) {
    if (typeof data === 'string') {
      try {
        const msg: ChunkMessage = JSON.parse(data);
        this.handleControlMessage(msg);
      } catch {
        // ignore
      }
      return;
    }

    // Binary data — reconstruct with header
    // First 4 bytes: file ID length, next N bytes: file ID, next 4 bytes: chunk index, rest: data
    const view = new DataView(data);
    const idLen = view.getUint32(0, true);
    const idBytes = new Uint8Array(data, 4, idLen);
    const fileId = new TextDecoder().decode(idBytes);
    const chunkIndex = view.getUint32(4 + idLen, true);
    const chunk = data.slice(4 + idLen + 4);

    const buffers = this.receiveBuffers.get(fileId) || [];
    buffers[chunkIndex] = chunk;
    this.receiveBuffers.set(fileId, buffers);

    const meta = this.receiveMetas.get(fileId);
    if (meta) {
      const received = (this.receiveProgress.get(fileId) || 0) + chunk.byteLength;
      this.receiveProgress.set(fileId, received);

      const progress: TransferProgress = {
        fileId,
        fileName: meta.name,
        totalSize: meta.size,
        transferredBytes: received,
        percentage: Math.min(100, (received / meta.size) * 100),
        speed: 0,
        eta: 0,
        status: 'transferring',
      };
      this.emit('progress', progress);
    }
  }

  private handleControlMessage(msg: ChunkMessage) {
    switch (msg.type) {
      case 'file-meta':
        if (msg.metadata) {
          this.receiveMetas.set(msg.fileId, msg.metadata);
          this.receiveBuffers.set(msg.fileId, []);
          this.receiveProgress.set(msg.fileId, 0);
          this.emit('file-start', { fileId: msg.fileId, metadata: msg.metadata });
        }
        break;

      case 'file-end':
        this.assembleFile(msg.fileId);
        break;

      case 'pause':
        this.sendPaused = true;
        break;

      case 'resume':
        if (this.sendPaused) {
          this.sendPaused = false;
          this.sendNextChunks();
        }
        break;

      case 'cancel':
        this.receiveBuffers.delete(msg.fileId);
        this.receiveMetas.delete(msg.fileId);
        this.receiveProgress.delete(msg.fileId);
        break;
    }
  }

  private assembleFile(fileId: string) {
    const buffers = this.receiveBuffers.get(fileId);
    const meta = this.receiveMetas.get(fileId);
    if (!buffers || !meta) return;

    const totalSize = buffers.reduce((acc, b) => acc + (b?.byteLength || 0), 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const buf of buffers) {
      if (buf) {
        combined.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
    }

    const blob = new Blob([combined], { type: meta.type });
    const url = URL.createObjectURL(blob);

    this.receiveBuffers.delete(fileId);
    this.receiveProgress.delete(fileId);

    this.emit('file-received', {
      fileId,
      metadata: meta,
      blob,
      url,
    });
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.dataChannel = this.pc.createDataChannel('file-transfer', {
      ordered: true,
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    try {
      if (this.pc.signalingState !== 'stable') {
        await this.pc.setRemoteDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
      }
      await this.pc.setRemoteDescription(offer);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      return answer;
    } catch (err) {
      console.error('Error handling offer:', err);
      throw err;
    }
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    try {
      if (this.pc.signalingState !== 'have-local-offer') {
        console.warn(`Skipping handleAnswer: state is ${this.pc.signalingState}, expected have-local-offer`);
        return;
      }
      await this.pc.setRemoteDescription(answer);
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      if (!this.pc.remoteDescription) {
        // Queue candidate or wait? For now, we'll just ignore if no remote description yet.
        // Usually, candidates arrive after offer/answer.
        console.warn('Skipping ICE candidate: no remote description yet');
        return;
      }
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }

  sendFiles(files: File[]) {
    this.sendQueue.push(...files);
    if (!this.currentSendFile) {
      this.sendNextFile();
    }
  }

  private sendNextFile() {
    if (this.sendQueue.length === 0) {
      this.currentSendFile = null;
      return;
    }

    this.currentSendFile = this.sendQueue.shift()!;
    this.totalSent = 0;
    this.sendStart = Date.now();
    this.lastSpeedCalc = Date.now();
    this.lastBytesSent = 0;

    const meta: FileMetadata = {
      id: uuidv4(),
      name: this.currentSendFile.name,
      size: this.currentSendFile.size,
      type: this.currentSendFile.type || 'application/octet-stream',
      lastModified: this.currentSendFile.lastModified,
    };
    this.currentSendMeta = meta;

    const metaMsg: ChunkMessage = {
      type: 'file-meta',
      fileId: meta.id,
      metadata: meta,
    };
    this.send(JSON.stringify(metaMsg));
    this.sendNextChunks();
  }

  private async sendNextChunks() {
    if (!this.currentSendFile || !this.currentSendMeta || !this.dataChannel) return;
    if (this.sendPaused) return;
    if (this.dataChannel.readyState !== 'open') return;

    const file = this.currentSendFile;
    const meta = this.currentSendMeta;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    const sendChunk = async (chunkIndex: number): Promise<void> => {
      if (chunkIndex >= totalChunks || this.sendPaused) return;

      if (this.dataChannel!.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        this.sendPaused = true;
        return;
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const sliceBuffer = await file.slice(start, end).arrayBuffer();

      const idBytes = new TextEncoder().encode(meta.id);
      const header = new ArrayBuffer(4 + idBytes.length + 4);
      const headerView = new DataView(header);
      headerView.setUint32(0, idBytes.length, true);
      new Uint8Array(header, 4, idBytes.length).set(idBytes);
      headerView.setUint32(4 + idBytes.length, chunkIndex, true);

      const combined = new Uint8Array(header.byteLength + sliceBuffer.byteLength);
      combined.set(new Uint8Array(header), 0);
      combined.set(new Uint8Array(sliceBuffer), header.byteLength);

      this.dataChannel!.send(combined.buffer);

      this.totalSent += sliceBuffer.byteLength;

      const now = Date.now();
      const elapsed = (now - this.lastSpeedCalc) / 1000;
      let speed = 0;
      if (elapsed > 0.5) {
        speed = (this.totalSent - this.lastBytesSent) / elapsed;
        this.lastBytesSent = this.totalSent;
        this.lastSpeedCalc = now;
      }

      const progress: TransferProgress = {
        fileId: meta.id,
        fileName: meta.name,
        totalSize: file.size,
        transferredBytes: this.totalSent,
        percentage: Math.min(100, (this.totalSent / file.size) * 100),
        speed,
        eta: speed > 0 ? (file.size - this.totalSent) / speed : 0,
        status: 'transferring',
      };
      this.emit('progress', progress);

      if (chunkIndex + 1 < totalChunks && !this.sendPaused) {
        // Use setTimeout to avoid blocking the event loop
        setTimeout(() => sendChunk(chunkIndex + 1), 0);
      } else if (chunkIndex + 1 >= totalChunks) {
        const endMsg: ChunkMessage = {
          type: 'file-end',
          fileId: meta.id,
        };
        this.send(JSON.stringify(endMsg));
        this.emit('progress', { ...progress, percentage: 100, status: 'completed' as TransferStatus });
        this.currentSendFile = null;
        this.currentSendMeta = null;
        setTimeout(() => this.sendNextFile(), 100);
      }
    };

    sendChunk(0);
  }

  pauseTransfer() {
    const msg: ChunkMessage = { type: 'pause', fileId: '' };
    this.send(JSON.stringify(msg));
    this.sendPaused = true;
  }

  resumeTransfer() {
    const msg: ChunkMessage = { type: 'resume', fileId: '' };
    this.send(JSON.stringify(msg));
    this.sendPaused = false;
    this.sendNextChunks();
  }

  private send(data: string | ArrayBuffer) {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(data as never);
    }
  }

  on(event: PeerEventType, callback: PeerEventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: PeerEventType, callback: PeerEventCallback) {
    const cbs = this.listeners.get(event) || [];
    this.listeners.set(event, cbs.filter((cb) => cb !== callback));
  }

  private emit(event: PeerEventType, data: unknown) {
    const cbs = this.listeners.get(event) || [];
    cbs.forEach((cb) => cb(data));
  }

  getConnectionState() {
    return this.pc.connectionState;
  }

  getStats() {
    return this.pc.getStats();
  }

  close() {
    this.dataChannel?.close();
    this.pc.close();
  }

  get id() {
    return this.peerId;
  }
}
