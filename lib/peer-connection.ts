// lib/peer-connection.ts
import { v4 as uuidv4 } from 'uuid';
import type {
  FileMetadata,
  TransferProgress,
  TransferStatus,
  ChunkMessage,
  RTCConfig,
} from '@/types';

const CHUNK_SIZE = 128 * 1024; // 128KB chunks (safer for SCTP limits)
const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024; // 4MB buffer limit (safer)
const BUFFER_THRESHOLD = 2 * 1024 * 1024; // 2MB threshold before resuming (half of max)

export const DEFAULT_RTC_CONFIG: RTCConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    // Public TURN servers
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
  iceCandidatePoolSize: 10,
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
  private isSending = false;
  private totalSent = 0;
  private sendStart = 0;
  private lastSpeedCalc = 0;
  private lastBytesSent = 0;

  // Receive state
  private receiveBuffers: Map<string, ArrayBuffer[]> = new Map();
  private receiveMetas: Map<string, FileMetadata> = new Map();
  private receiveProgress: Map<string, number> = new Map();
  private writableStreams: Map<string, any> = new Map(); // using any for FileSystemWritableFileStream to avoid type issues in older environments
  private iceCandidatesQueue: RTCIceCandidateInit[] = [];

  constructor(
    config: RTCConfig = DEFAULT_RTC_CONFIG,
    peerId: string = uuidv4(),
    remotePeerId = ''
  ) {
    this.peerId = peerId;
    this.remotePeerId = remotePeerId;
    this.pc = new RTCPeerConnection(config as RTCConfiguration);
    console.log(`[P2P] Initialized connection for peer: ${remotePeerId}`);
    this.setupPCListeners();
  }

  setWritableStream(fileId: string, stream: any) {
    this.writableStreams.set(fileId, stream);
    const buffered = this.receiveBuffers.get(fileId) || [];
    if (buffered.length > 0) {
      buffered.forEach((chunk, index) => {
        if (chunk) stream.write({ type: 'write', position: index * CHUNK_SIZE, data: chunk });
      });
    }
  }

  private setupPCListeners() {
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log(`[P2P] Locally generated ICE candidate for ${this.remotePeerId}`);
        this.emit('ice-candidate', { candidate: e.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log(`[P2P] Connection state for ${this.remotePeerId}: ${state}`);
      if (state === 'connected') {
        this.emit('connected', {});
      }
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.emit('disconnected', { state });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(`[P2P] ICE connection state for ${this.remotePeerId}: ${this.pc.iceConnectionState}`);
    };

    this.pc.ondatachannel = (e) => {
      console.log(`[P2P] Remote data channel received from ${this.remotePeerId}`);
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

    channel.onerror = (e: any) => {
      const errorDetail = e.error || e.message || 'Unknown data channel error';
      console.error(`[P2P] Data channel error for ${this.remotePeerId}:`, errorDetail, e);
      this.emit('error', errorDetail);
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

  private async handleMessage(data: ArrayBuffer | string) {
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
    const view = new DataView(data);
    const idLen = view.getUint32(0, true);
    const idBytes = new Uint8Array(data, 4, idLen);
    const fileId = new TextDecoder().decode(idBytes);
    const chunkIndex = view.getUint32(4 + idLen, true);
    const chunk = data.slice(4 + idLen + 4);

    const stream = this.writableStreams.get(fileId);
    if (stream) {
      await stream.write({ type: 'write', position: chunkIndex * CHUNK_SIZE, data: chunk });
    } else {
      const buffers = this.receiveBuffers.get(fileId) || [];
      buffers[chunkIndex] = chunk;
      this.receiveBuffers.set(fileId, buffers);
    }

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

  private async handleControlMessage(msg: ChunkMessage) {
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
        const stream = this.writableStreams.get(msg.fileId);
        if (stream) {
          await stream.close();
          this.writableStreams.delete(msg.fileId);
          // Signal completion without assembling in memory
          const meta = this.receiveMetas.get(msg.fileId);
          if (meta) {
            this.emit('file-received', {
              fileId: msg.fileId,
              metadata: meta,
              streamed: true,
              receivedAt: Date.now(),
            });
          }
        } else {
          this.assembleFile(msg.fileId);
        }
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
        const s = this.writableStreams.get(msg.fileId);
        if (s) {
          await s.abort();
          this.writableStreams.delete(msg.fileId);
        }
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
      receivedAt: Date.now(),
    });
  }

  private async processQueuedCandidates() {
    if (!this.pc.remoteDescription) return;
    
    while (this.iceCandidatesQueue.length > 0) {
      const candidate = this.iceCandidatesQueue.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(candidate);
          console.log(`[P2P] Applied queued ICE candidate for ${this.remotePeerId}`);
        } catch (err) {
          console.warn(`[P2P] Failed to apply queued ICE candidate for ${this.remotePeerId}`, err);
        }
      }
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    console.log(`[P2P] Creating offer for ${this.remotePeerId}`);
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
      console.log(`[P2P] Handling offer from ${this.remotePeerId}`);
      if (this.pc.signalingState !== 'stable') {
        await this.pc.setRemoteDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
      }
      await this.pc.setRemoteDescription(offer);
      await this.processQueuedCandidates();
      
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      return answer;
    } catch (err) {
      console.error(`[P2P] Error handling offer from ${this.remotePeerId}:`, err);
      throw err;
    }
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    try {
      if (this.pc.signalingState !== 'have-local-offer') {
        console.warn(`[P2P] Skipping handleAnswer for ${this.remotePeerId}: state is ${this.pc.signalingState}`);
        return;
      }
      console.log(`[P2P] Handling answer from ${this.remotePeerId}`);
      await this.pc.setRemoteDescription(answer);
      await this.processQueuedCandidates();
    } catch (err) {
      console.error(`[P2P] Error handling answer from ${this.remotePeerId}:`, err);
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      if (!candidate || !candidate.candidate) {
        console.log(`[P2P] Received null/empty ICE candidate for ${this.remotePeerId}, ignoring.`);
        return;
      }

      if (!this.pc.remoteDescription) {
        console.log(`[P2P] Queuing remote ICE candidate for ${this.remotePeerId} (no remote desc yet)`);
        this.iceCandidatesQueue.push(candidate);
        return;
      }
      
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log(`[P2P] Successfully added remote ICE candidate for ${this.remotePeerId}`);
    } catch (err) {
      console.error(`[P2P] Error adding ICE candidate for ${this.remotePeerId}:`, err);
    }
  }

  sendFiles(files: File[]) {
    // Deduplicate incoming files against the current queue and active file
    const filtered = files.filter(f => {
      const isSending = this.currentSendFile && 
        this.currentSendFile.name === f.name && 
        this.currentSendFile.size === f.size &&
        this.currentSendFile.lastModified === f.lastModified;
      
      const inQueue = this.sendQueue.some(q => 
        q.name === f.name && q.size === f.size && q.lastModified === f.lastModified
      );

      if (isSending || inQueue) {
        console.warn(`[P2P] Skipping duplicate file: ${f.name}`);
        return false;
      }
      return true;
    });

    this.sendQueue.push(...filtered);
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

  private resetSendState() {
    this.currentSendFile = null;
    this.currentSendMeta = null;
    this.isSending = false;
  }

  private async sendNextChunks() {
    if (!this.currentSendFile || !this.currentSendMeta || !this.dataChannel) return;
    if (this.sendPaused || this.isSending) return;
    if (this.dataChannel.readyState !== 'open') return;

    this.isSending = true;
    const file = this.currentSendFile;
    const meta = this.currentSendMeta;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    const sendChunk = async (chunkIndex: number): Promise<void> => {
      // Check for interruption: pause, cancellation, or channel close
      if (chunkIndex >= totalChunks || this.sendPaused || !this.isSending) {
        this.isSending = false;
        return;
      }

      if (this.dataChannel?.readyState !== 'open') {
        console.warn('[P2P] Channel closed during send loop');
        this.isSending = false;
        return;
      }

      if (this.dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        console.log('[P2P] Buffer full, pausing send loop');
        this.sendPaused = true;
        this.isSending = false;
        return;
      }

      try {
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

        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
          this.isSending = false;
          return;
        }

        try {
          this.dataChannel.send(combined.buffer);
        } catch (e: any) {
          const errMsg = e.message || e.toString() || '';
          if (e.name === 'OperationError' || /full/i.test(errMsg) || /queue/i.test(errMsg)) {
            console.warn('[P2P] Send queue full handled, pausing...');
            this.sendPaused = true;
            this.isSending = false;
            return;
          }
          throw e;
        }
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

        if (chunkIndex + 1 < totalChunks) {
          // Use setTimeout(0) or queueMicrotask to stay responsive
          // We don't want to use await here to keep the event loop moving
          setTimeout(() => sendChunk(chunkIndex + 1), 0);
        } else {
          console.log(`[P2P] File sent completely: ${meta.name}`);
          const endMsg: ChunkMessage = { type: 'file-end', fileId: meta.id };
          this.send(JSON.stringify(endMsg));
          this.emit('progress', { ...progress, percentage: 100, status: 'completed' as TransferStatus });
          this.resetSendState();
          setTimeout(() => this.sendNextFile(), 100);
        }
      } catch (err) {
        console.error('[P2P] Send chunk failure:', err);
        this.emit('error', `Send failure: ${err}`);
        this.isSending = false;
      }
    };

    sendChunk(Math.floor(this.totalSent / CHUNK_SIZE));
  }

  pauseTransfer() {
    const msg: ChunkMessage = { type: 'pause', fileId: '' };
    this.send(JSON.stringify(msg));
    this.sendPaused = true;
    this.isSending = false;
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
