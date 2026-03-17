// lib/peer-connection.ts
import { v4 as uuidv4 } from 'uuid';
import type {
  FileMetadata,
  TransferProgress,
  TransferStatus,
  ChunkMessage,
  RTCConfig,
} from '@/types';

const CHUNK_SIZE = 128 * 1024; // 128KB chunks (stable throughput, balanced overhead)
const MAX_BUFFERED_AMOUNT = 1 * 1024 * 1024; // 1MB per-channel initial limit
const BUFFER_THRESHOLD = 512 * 1024; // 512KB threshold
const GLOBAL_MAX_BUFFER = 32 * 1024 * 1024; // 32MB total limit across all channels

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

class ParallelTaskQueue {
  private activeCount = 0;
  private queue: (() => Promise<void>)[] = [];
  constructor(private concurrency: number) {}

  async run(task: () => Promise<void>) {
    if (this.activeCount >= this.concurrency) {
      await new Promise<void>(resolve => {
        this.queue.push(async () => {
          await task();
          resolve();
        });
      });
      return;
    }

    this.activeCount++;
    try {
      await task();
    } finally {
      this.activeCount--;
      this.next();
    }
  }

  private async next() {
    if (this.queue.length > 0 && this.activeCount < this.concurrency) {
      const nextTask = this.queue.shift()!;
      this.activeCount++;
      try {
        await nextTask();
      } finally {
        this.activeCount--;
        this.next();
      }
    }
  }

  get pending() {
    return this.activeCount + this.queue.length;
  }
}

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
  private dataChannels: RTCDataChannel[] = [];
  private currentChannelIndex = 0;
  private peerId: string;
  private remotePeerId: string;
  public instanceId: string = uuidv4().slice(0, 4);
  private listeners: Map<PeerEventType, PeerEventCallback[]> = new Map();

  // Connection readiness tracking
  private pcConnected = false;
  private channelOpen = false;
  private connectedEmitted = false;
  private channelReadyResolvers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  // Performance Tuning (Adaptive)
  private adaptiveMaxBuffer = MAX_BUFFERED_AMOUNT;
  private adaptiveThreshold = BUFFER_THRESHOLD;
  private numChannels = 8;

  // Send state
  private sendQueue: File[] = [];
  private currentSendFile: File | null = null;
  private currentSendMeta: FileMetadata | null = null;
  private sendPaused = false;
  private isSending = false;
  private readAheadQueue: { index: number, buffer: ArrayBuffer }[] = [];
  private totalSent = 0;
  private sendStart = 0;
  private lastSpeedCalc = 0;
  private lastBytesSent = 0;
  private currentSpeed = 0;
  private lastProgressEmit = 0;
  private completedFiles: Set<string> = new Set();

  // Receive state
  private receiveBuffers: Map<string, ArrayBuffer[]> = new Map();
  private receiveMetas: Map<string, FileMetadata> = new Map();
  private receiveProgress: Map<string, number> = new Map();
  private receiveStats: Map<string, { lastSpeedCalc: number, lastBytesReceived: number, currentSpeed: number }> = new Map();
  private receiveChunkCounts: Map<string, number> = new Map();
  private receiveFileEndReached: Map<string, boolean> = new Map();
  private fileIdDecoder = new TextDecoder();
  private fileIdDecoderCache: Map<string, string> = new Map(); // Cache decoded fileIds
  private receiverPaused = false; // Backpressure state
  private writableStreams: Map<string, any> = new Map(); // using any for FileSystemWritableFileStream to avoid type issues in older environments
  private iceCandidatesQueue: RTCIceCandidateInit[] = [];
  private isSettingRemoteDescription = false;

  // Message queue for serialized processing — prevents race conditions
  private messageQueue: (ArrayBuffer | string)[] = [];
  private processingMessage = false;
  private writeQueue = new ParallelTaskQueue(16); // Concurrency 16 for balanced SSD I/O

  private getTotalBufferedAmount(): number {
    return this.dataChannels.reduce((sum, c) => sum + (c?.bufferedAmount || 0), 0);
  }

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
      (async () => {
        try {
          for (let index = 0; index < buffered.length; index++) {
            const chunk = buffered[index];
            if (chunk) {
              await stream.write({ type: 'write', position: index * CHUNK_SIZE, data: chunk });
            }
          }
          this.receiveBuffers.delete(fileId);
        } catch (err) {
          console.error('[P2P] Error writing buffered chunks:', err);
        }
      })();
    } else {
      this.receiveBuffers.delete(fileId);
    }
  }

  /** Check if both PC and data channel are ready, emit 'connected' only once both are. */
  private checkFullyConnected(source: string) {
    if (this.pcConnected && this.channelOpen && !this.connectedEmitted) {
      this.connectedEmitted = true;
      console.log(`[P2P][${this.instanceId}] Fully connected with ${this.remotePeerId} (trigger: ${source})`);
      this.emit('connected', { source });
    } else if (this.pcConnected && this.channelOpen && this.connectedEmitted) {
      // Already emitted, but let's confirm states
      console.log(`[P2P][${this.instanceId}] Connection status confirmed (source: ${source})`);
    } else {
      console.log(`[P2P][${this.instanceId}] checkFullyConnected(${source}): pc=${this.pcConnected}, channel=${this.channelOpen}, emitted=${this.connectedEmitted}`);
    }
  }

  /** Returns a promise that resolves when at least one data channel is open. */
  private waitForDataChannel(timeoutMs = 15000): Promise<void> {
    if (this.dataChannels.some(c => c.readyState === 'open')) return Promise.resolve();
    console.log(`[P2P] Waiting for data channel to open with ${this.remotePeerId}...`);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for data channel'));
      }, timeoutMs);
      this.channelReadyResolvers.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  private setupPCListeners() {
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log(`[P2P] Locally generated ICE candidate for ${this.remotePeerId}`);
        this.emit('ice-candidate', { candidate: e.candidate });
      }
    };

    // PROACTIVE CHECK: Set initial states based on current PC state
    if (this.pc.connectionState === 'connected') {
      this.pcConnected = true;
      if (this.dataChannels.some(c => c.readyState === 'open')) {
        this.channelOpen = true;
      }
      this.checkFullyConnected('proactive-pc');
    }

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log(`[P2P] Connection state for ${this.remotePeerId}: ${state}`);
      if (state === 'connected') {
        this.pcConnected = true;
        // Check if data channel is also ready. If not, we wait for onopen.
        if (this.dataChannels.some(c => c.readyState === 'open')) {
          this.channelOpen = true;
        }
        this.checkFullyConnected('pc');
      }
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.pcConnected = false;
        this.channelOpen = false;
        this.connectedEmitted = false;
        this.emit('disconnected', { state, source: 'pc' });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc.iceConnectionState;
      console.log(`[P2P] ICE connection state for ${this.remotePeerId}: ${iceState}`);
      if (iceState === 'connected' || iceState === 'completed') {
        this.pcConnected = true;
        if (this.dataChannels.some(c => c.readyState === 'open')) {
          this.channelOpen = true;
        }
        this.checkFullyConnected('ice');
      }
    };
    
    this.pc.onicegatheringstatechange = () => {
      console.log(`[P2P] ICE gathering state for ${this.remotePeerId}: ${this.pc.iceGatheringState}`);
    };

    this.pc.ondatachannel = (e) => {
      console.log(`[P2P] Remote data channel received from ${this.remotePeerId}`);
      this.setupDataChannel(e.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel) {
    if (this.dataChannels.includes(channel)) return;
    this.dataChannels.push(channel);
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log(`[P2P] Data channel OPEN [${channel.label}] with ${this.remotePeerId}. PC State: ${this.pc.connectionState}`);
      this.channelOpen = true;
      
      // Resolve any pending waitForDataChannel promises
      const resolvers = this.channelReadyResolvers.splice(0);
      if (resolvers.length > 0) {
        console.log(`[P2P] Resolving ${resolvers.length} pending channel waiters for ${this.remotePeerId}`);
        resolvers.forEach(r => r.resolve());
      }
      
      this.drainControlQueue();
      this.checkFullyConnected('channel');

      // Resume any pending transfers that were waiting for the channel to open
      if (this.currentSendFile && !this.isSending) {
        this.sendNextChunks();
      } else if (this.sendQueue.length > 0 && !this.currentSendFile) {
        this.sendNextFile();
      }
    };

    channel.onclose = () => {
      console.log(`[P2P] Data channel CLOSED [${channel.label}] for ${this.remotePeerId}`);
      this.dataChannels = this.dataChannels.filter(c => c !== channel);
      if (this.dataChannels.length === 0) {
        this.channelOpen = false;
        this.connectedEmitted = false;
        const resolvers = this.channelReadyResolvers.splice(0);
        resolvers.forEach(r => r.reject(new Error('All data channels closed')));
        this.emit('disconnected', { channelClosed: true });
      }
    };

    channel.onerror = (e: any) => {
      const errorDetail = e.error?.message || e.error?.name || e.message || (typeof e.error === 'string' ? e.error : null) || 'Unknown data channel error';
      console.error(`[P2P] Data channel error [${channel.label}] for ${this.remotePeerId}:`, errorDetail);
      
      // AIMD: Decrease buffer limit on error
      this.adaptiveMaxBuffer = Math.max(MAX_BUFFERED_AMOUNT, this.adaptiveMaxBuffer / 2);
      this.adaptiveThreshold = Math.max(BUFFER_THRESHOLD, this.adaptiveMaxBuffer / 2);
      console.log(`[P2P] Adaptive throttle: limits reduced to ${formatBytes(this.adaptiveMaxBuffer)}`);
      
      if (this.dataChannels.length <= 1) {
        const resolvers = this.channelReadyResolvers.splice(0);
        resolvers.forEach(r => r.reject(new Error(`Data channel error: ${errorDetail}`)));
        this.emit('error', errorDetail);
      }
    };

    channel.onmessage = (e) => {
      this.enqueueMessage(e.data);
    };

    channel.bufferedAmountLowThreshold = this.adaptiveThreshold;
    channel.onbufferedamountlow = () => {
      // AIMD: Increase buffer limit moderately on success
      if (this.adaptiveMaxBuffer < 128 * 1024 * 1024) { // Cap at 128MB
        this.adaptiveMaxBuffer += 1024 * 1024; // Add 1MB (more aggressive ramp-up)
        this.adaptiveThreshold = this.adaptiveMaxBuffer / 2;
        channel.bufferedAmountLowThreshold = this.adaptiveThreshold;
      }

      if (this.sendPaused && this.currentSendFile) {
        this.sendPaused = false;
        this.sendNextChunks();
      }
    };

    // PROACTIVE CHECK: If the channel is already open, trigger the logic immediately
    if (channel.readyState === 'open') {
      console.log(`[P2P] Data channel [${channel.label}] was ALREADY open with ${this.remotePeerId}`);
      this.channelOpen = true;
      this.drainControlQueue();
      this.checkFullyConnected('proactive-channel');
    }
  }

  private enqueueMessage(data: ArrayBuffer | string) {
    this.messageQueue.push(data);
    if (!this.processingMessage) {
      this.processMessageQueue();
    }
  }

  private async processMessageQueue() {
    if (this.processingMessage) return;
    this.processingMessage = true;
    try {
      while (this.messageQueue.length > 0) {
        const data = this.messageQueue.shift()!;
        await this.handleMessage(data);
      }
    } finally {
      this.processingMessage = false;
    }
  }

  private async handleMessage(data: ArrayBuffer | string) {
    if (typeof data === 'string') {
      try {
        const msg: ChunkMessage = JSON.parse(data);
        await this.handleControlMessage(msg);
      } catch (err) {
        console.warn('[P2P] Error handling control message:', err);
      }
      return;
    }

    // ZERO-COPY PARSING: Use views instead of slices
    const view = new DataView(data);
    const idLen = view.getUint32(0, true);
    
    // Cache check for fileId decoding (using views avoids copies)
    const idView = new Uint8Array(data, 4, idLen);
    const idKey = idLen + '_' + idView[0] + '_' + idView[idLen - 1]; // Simple fast key
    let fileId = this.fileIdDecoderCache.get(idKey);
    if (!fileId) {
      fileId = this.fileIdDecoder.decode(idView);
      this.fileIdDecoderCache.set(idKey, fileId);
    }
    
    const chunkIndex = view.getUint32(4 + idLen, true);
    // Use subarray instead of slice to avoid copying memory
    const chunkView = new Uint8Array(data, 4 + idLen + 4);

    // RECEIVER BACKPRESSURE: Monitor writeQueue depth to prevent memory exhaustion
    if (this.writeQueue.pending > 64 && !this.receiverPaused) {
      console.warn(`[P2P] Receiver write queue heavy (${this.writeQueue.pending} chunks), triggering backpressure...`);
      this.receiverPaused = true;
      this.send(JSON.stringify({ type: 'pause', fileId: '' }));
    }

    // DECOUPLED DISK WRITE: We run this in parallel task queue to avoid blocking message processing loop
    this.writeQueue.run(async () => {
      const stream = this.writableStreams.get(fileId!);
      if (stream) {
        await stream.write({ type: 'write', position: chunkIndex * CHUNK_SIZE, data: chunkView });
      } else {
        const buffers = this.receiveBuffers.get(fileId!) || [];
        buffers[chunkIndex] = chunkView.buffer.slice(chunkView.byteOffset, chunkView.byteOffset + chunkView.byteLength);
        this.receiveBuffers.set(fileId!, buffers);
      }

      // Check if we can resume sender
      if (this.receiverPaused && this.writeQueue.pending < 16) {
        console.log(`[P2P] Receiver write queue drained (${this.writeQueue.pending} chunks), resuming sender...`);
        this.receiverPaused = false;
        this.send(JSON.stringify({ type: 'resume', fileId: '' }));
      }

      // Completion check for unordered delivery
      const currentCount = (this.receiveChunkCounts.get(fileId!) || 0) + 1;
      this.receiveChunkCounts.set(fileId!, currentCount);
      
      const meta = this.receiveMetas.get(fileId!);
      const totalExpected = meta ? Math.ceil(meta.size / CHUNK_SIZE) : 0;
      
      if (this.receiveFileEndReached.get(fileId!) && currentCount >= totalExpected) {
        this.finalizeFile(fileId!);
      }
    });

    const meta = this.receiveMetas.get(fileId);
    if (meta) {
      const received = (this.receiveProgress.get(fileId) || 0) + chunkView.byteLength;
      this.receiveProgress.set(fileId, received);

      let stats = this.receiveStats.get(fileId);
      if (!stats) {
        stats = { lastSpeedCalc: Date.now(), lastBytesReceived: 0, currentSpeed: 0 };
        this.receiveStats.set(fileId, stats);
      }

      const now = Date.now();
      const elapsed = (now - stats.lastSpeedCalc) / 1000;
      if (elapsed > 0.5) {
        stats.currentSpeed = (received - stats.lastBytesReceived) / elapsed;
        stats.lastBytesReceived = received;
        stats.lastSpeedCalc = now;
      }

      // Throttle UI progress events
      if (now - (this.lastProgressEmit || 0) > 100) {
        const progress: TransferProgress = {
          fileId,
          fileName: meta.name,
          totalSize: meta.size,
          transferredBytes: received,
          percentage: Math.min(100, (received / meta.size) * 100),
          speed: stats.currentSpeed,
          eta: stats.currentSpeed > 0 ? (meta.size - received) / stats.currentSpeed : 0,
          status: 'transferring',
          fileType: meta.type,
        };
        this.emit('progress', progress);
        this.lastProgressEmit = now; 
      }
    }
  }

  private async finalizeFile(fileId: string) {
    const meta = this.receiveMetas.get(fileId);
    if (!meta) return;

    const stream = this.writableStreams.get(fileId);
    if (stream) {
      try {
        await stream.close();
      } catch (err) {
        console.error('[P2P] Error closing file stream:', err);
      }
      this.cleanupReceiverFile(fileId);
      // Signal completion
      this.emit('progress', {
        fileId,
        fileName: meta.name,
        totalSize: meta.size,
        transferredBytes: meta.size,
        percentage: 100,
        speed: 0,
        eta: 0,
        status: 'completed',
        fileType: meta.type,
      });
      this.emit('file-received', {
        fileId,
        metadata: meta,
        streamed: true,
        receivedAt: Date.now(),
      });
    } else {
      this.assembleFile(fileId);
    }
  }

  private cleanupReceiverFile(fileId: string) {
    this.writableStreams.delete(fileId);
    this.receiveStats.delete(fileId);
    this.receiveBuffers.delete(fileId);
    this.receiveProgress.delete(fileId);
    this.receiveChunkCounts.delete(fileId);
    this.receiveFileEndReached.delete(fileId);
  }

  private async handleControlMessage(msg: ChunkMessage) {
    switch (msg.type) {
      case 'file-meta':
        if (msg.metadata) {
          this.receiveMetas.set(msg.fileId, msg.metadata);
          this.receiveBuffers.set(msg.fileId, []);
          this.receiveProgress.set(msg.fileId, 0);
          
          // Emit progress immediately so the receiver UI shows the file row
          this.emit('progress', {
            fileId: msg.fileId,
            fileName: msg.metadata.name,
            totalSize: msg.metadata.size,
            transferredBytes: 0,
            percentage: 0,
            speed: 0,
            eta: 0,
            status: 'transferring',
            fileType: msg.metadata.type,
          });
          
          this.emit('file-start', { fileId: msg.fileId, metadata: msg.metadata });
        }
        break;

      case 'file-end': {
        this.receiveFileEndReached.set(msg.fileId, true);
        const meta = this.receiveMetas.get(msg.fileId);
        const receivedCount = this.receiveChunkCounts.get(msg.fileId) || 0;
        const totalExpected = meta ? Math.ceil(meta.size / CHUNK_SIZE) : 0;
        
        if (receivedCount >= totalExpected) {
          await this.finalizeFile(msg.fileId);
        }
        break;
      }

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
        // If fileId is provided, cancel specific file, otherwise cancel ALL
        if (msg.fileId) {
          const s = this.writableStreams.get(msg.fileId);
          if (s) {
            await s.abort().catch(() => {});
            this.writableStreams.delete(msg.fileId);
          }
          this.receiveBuffers.delete(msg.fileId);
          this.receiveMetas.delete(msg.fileId);
          this.receiveProgress.delete(msg.fileId);
          this.receiveStats.delete(msg.fileId);
          this.receiveChunkCounts.delete(msg.fileId);
          this.receiveFileEndReached.delete(msg.fileId);
        } else {
          // Global cancel
          for (const [id, s] of this.writableStreams.entries()) {
            await s.abort().catch(() => {});
          }
          this.writableStreams.clear();
          this.receiveBuffers.clear();
          this.receiveMetas.clear();
          this.receiveProgress.clear();
          this.receiveStats.clear();
          this.receiveChunkCounts.clear();
          this.receiveFileEndReached.clear();
          this.fileIdDecoderCache.clear();
          this.receiverPaused = false;
          this.writeQueue = new ParallelTaskQueue(16);
          this.emit('disconnected', { cancelled: true });
        }
        break;
    }
  }

  private assembleFile(fileId: string) {
    const buffers = this.receiveBuffers.get(fileId);
    const meta = this.receiveMetas.get(fileId);
    if (!buffers || !meta) return;

    const combined = new Uint8Array(meta.size);
    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      if (buf) {
        combined.set(new Uint8Array(buf), i * CHUNK_SIZE);
      }
    }

    const blob = new Blob([combined], { type: meta.type });
    const url = URL.createObjectURL(blob);

    this.cleanupReceiverFile(fileId);

    // Emit completed progress so receiver UI updates correctly
    this.emit('progress', {
      fileId,
      fileName: meta.name,
      totalSize: meta.size,
      transferredBytes: meta.size,
      percentage: 100,
      speed: 0,
      eta: 0,
      status: 'completed',
      fileType: meta.type,
    });

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
    console.log(`[P2P] Creating offer for ${this.remotePeerId} with ${this.numChannels} channels`);
    for (let i = 0; i < this.numChannels; i++) {
      const channel = this.pc.createDataChannel(`file-transfer-${i}`, {
        ordered: false,
      });
      this.setupDataChannel(channel);
    }

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | null> {
    if (this.isSettingRemoteDescription) {
      console.warn(`[P2P] Already setting remote description for ${this.remotePeerId}, skipping offer`);
      return null;
    }
    
    this.isSettingRemoteDescription = true;
    try {
      console.log(`[P2P] Handling offer from ${this.remotePeerId}`);
      if (this.pc.signalingState !== 'stable') {
        console.log(`[P2P] Signalling state: ${this.pc.signalingState}, rolling back for ${this.remotePeerId}`);
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
    } finally {
      this.isSettingRemoteDescription = false;
    }
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (this.isSettingRemoteDescription) {
      console.log(`[P2P] Already setting remote description for ${this.remotePeerId}, ignoring answer`);
      return;
    }

    if (this.pc.signalingState !== 'have-local-offer') {
      if (this.pc.signalingState === 'stable') {
        console.log(`[P2P] Received answer for ${this.remotePeerId} but already stable, ignoring.`);
        return;
      }
      // If we are in have-remote-offer, it means we are the non-initiator but received an answer? 
      // This is a glare state. We should probably accept the answer if we have a remote offer from them too.
      console.warn(`[P2P] Signaling state is ${this.pc.signalingState} for ${this.remotePeerId}, attempting to apply answer anyway.`);
    }

    this.isSettingRemoteDescription = true;
    try {
      console.log(`[P2P] Handling answer from ${this.remotePeerId}`);
      await this.pc.setRemoteDescription(answer);
      await this.processQueuedCandidates();
    } catch (err: any) {
      if (err.name === 'InvalidStateError' && (this.pc.signalingState as string) === 'stable') {
        console.log(`[P2P] Answer for ${this.remotePeerId} led to InvalidStateError but connection is stable: ignoring.`);
        return;
      }
      console.error(`[P2P] Error handling answer from ${this.remotePeerId}:`, err);
    } finally {
      this.isSettingRemoteDescription = false;
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
    // Deduplicate against active file, current queue, AND already completed files
    const filtered = files.filter(f => {
      const activeMeta = this.currentSendMeta;
      const isSending = activeMeta && 
        activeMeta.name === f.name && 
        activeMeta.size === f.size;
      
      const inQueue = this.sendQueue.some(q => 
        q.name === f.name && q.size === f.size
      );

      const isCompleted = this.completedFiles.has(`${f.name}-${f.size}`);

      if (isSending || inQueue || isCompleted) {
        console.warn(`[P2P] Skipping duplicate/completed file: ${f.name}`);
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      console.log(`[P2P] All files are already in queue or completed for ${this.remotePeerId}`);
      return;
    }

    this.sendQueue.push(...filtered);
    if (!this.currentSendFile) {
      this.sendNextFile();
    }
  }

  cancelTransfer() {
    // Clear whole queue
    this.sendQueue = [];
    this.sendPaused = false;
    this.isSending = false;
    this.completedFiles.clear();
    
    // Notify receiver
    const msg: ChunkMessage = { type: 'cancel', fileId: '' }; // Empty fileId = cancel everything
    this.send(JSON.stringify(msg));
    
    // UI feedback
    if (this.currentSendMeta) {
      this.emit('progress', {
        fileId: this.currentSendMeta.id,
        fileName: this.currentSendMeta.name,
        totalSize: this.currentSendMeta.size,
        transferredBytes: this.totalSent,
        percentage: 0,
        speed: 0,
        eta: 0,
        status: 'error',
      });
    }
    
    this.resetSendState();
  }

  private async sendNextFile() {
    if (this.sendQueue.length === 0) {
      this.currentSendFile = null;
      return;
    }

    this.currentSendFile = this.sendQueue.shift()!;
    this.totalSent = 0;
    this.sendStart = Date.now();
    this.lastSpeedCalc = Date.now();
    this.lastBytesSent = 0;
    this.currentSpeed = 0;
    this.lastProgressEmit = 0;

    const meta: FileMetadata = {
      id: uuidv4(),
      name: this.currentSendFile.name,
      size: this.currentSendFile.size,
      type: this.currentSendFile.type || 'application/octet-stream',
      lastModified: this.currentSendFile.lastModified,
    };
    this.currentSendMeta = meta;

    // Emit initial progress
    this.emit('progress', {
      fileId: meta.id,
      fileName: meta.name,
      totalSize: this.currentSendFile.size,
      transferredBytes: 0,
      percentage: 0,
      speed: 0,
      eta: 0,
      status: 'transferring',
    });

    // Wait for the data channel to be open before sending file metadata and chunks.
    // This prevents the race condition where 'connected' fires from ICE before the channel is ready.
    try {
      await this.waitForDataChannel(15000);
    } catch (err) {
      console.error(`[P2P] Data channel not ready for ${this.remotePeerId}, aborting file send:`, err);
      this.emit('error', `Data channel not ready: ${(err as Error).message}`);
      this.resetSendState();
      return;
    }

    // Double-check file is still queued (user may have cancelled during wait)
    if (!this.currentSendFile || !this.currentSendMeta) return;

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
    this.readAheadQueue = []; // Clear memory!
    this.fileIdDecoderCache.clear(); // Clear decoder cache
    this.receiverPaused = false;
    // No direct way to "clear" ParallelTaskQueue, but resetting the instance works for cleanup
    this.writeQueue = new ParallelTaskQueue(16); 
  }

  private async sendNextChunks() {
    if (!this.currentSendFile || !this.currentSendMeta || this.dataChannels.length === 0) return;
    if (this.sendPaused || this.isSending) return;
    
    // Check if at least one channel is open
    const openChannels = this.dataChannels.filter(c => c.readyState === 'open');
    if (openChannels.length === 0) return;

    this.isSending = true;
    const file = this.currentSendFile;
    const meta = this.currentSendMeta;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let chunkIndex = Math.floor(this.totalSent / CHUNK_SIZE);
    let loopStart = Date.now();

    // BACKGROUND READER: Pre-reads chunks into memory
    const fillReadAhead = async () => {
      let readIndex = chunkIndex;
      while (this.isSending && readIndex < totalChunks) {
        if (this.readAheadQueue.length >= 40) { // Keep 40 chunks (~10MB) in memory
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }
        
        try {
          const start = readIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const buffer = await file.slice(start, end).arrayBuffer();
          this.readAheadQueue.push({ index: readIndex, buffer });
          readIndex++;
        } catch (err) {
          console.error('[P2P] Read-ahead failure:', err);
          break;
        }
      }
    };
    fillReadAhead(); // intentionally not awaited

    while (chunkIndex < totalChunks) {
      if (this.sendPaused || !this.isSending) {
        this.isSending = false;
        return;
      }

      // GLOBAL BACKPRESSURE: If the shared SCTP association is nearly full, pause
      const totalBuffered = this.getTotalBufferedAmount();
      if (totalBuffered >= GLOBAL_MAX_BUFFER) {
        console.warn(`[P2P] Global SCTP buffer threshold hit (${formatBytes(totalBuffered)}), backing off...`);
        this.sendPaused = true;
        this.isSending = false;
        // Wait for onbufferedamountlow on any channel to resume
        return;
      }

      // Round-robin selection of an open channel that isn't full
      let channel: RTCDataChannel | null = null;
      const channelCount = this.dataChannels.length;
      if (channelCount === 0) {
        this.sendPaused = true;
        this.isSending = false;
        return;
      }

      for (let i = 0; i < channelCount; i++) {
        const potential = this.dataChannels[this.currentChannelIndex];
        this.currentChannelIndex = (this.currentChannelIndex + 1) % channelCount;
        
        if (potential && potential.readyState === 'open' && potential.bufferedAmount <= this.adaptiveMaxBuffer) {
          channel = potential;
          break;
        }
      }

      // If no channels are available for sending (all full or closed), pause and wait
      if (!channel) {
        // Randomized short delay before re-testing
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40));
        continue;
      }

      // PULL FROM MEMORY: Pull the next chunk from the read-ahead queue
      const nextIdx = this.readAheadQueue.findIndex(item => item.index === chunkIndex);
      if (nextIdx === -1) {
        // Queue empty, wait a bit for background reader
        await new Promise(resolve => setTimeout(resolve, 20));
        continue;
      }
      const { buffer: sliceBuffer } = this.readAheadQueue.splice(nextIdx, 1)[0];

      try {
        const idBytes = new TextEncoder().encode(meta.id);
        const header = new ArrayBuffer(4 + idBytes.length + 4);
        const headerView = new DataView(header);
        headerView.setUint32(0, idBytes.length, true);
        new Uint8Array(header, 4, idBytes.length).set(idBytes);
        headerView.setUint32(4 + idBytes.length, chunkIndex, true);

        const combined = new Uint8Array(header.byteLength + sliceBuffer.byteLength);
        combined.set(new Uint8Array(header), 0);
        combined.set(new Uint8Array(sliceBuffer), header.byteLength);

        // check again
        if (channel.readyState !== 'open') {
          this.readAheadQueue.unshift({ index: chunkIndex, buffer: sliceBuffer }); // put back
          continue; 
        }

        try {
          if (channel.bufferedAmount > this.adaptiveMaxBuffer) {
            this.readAheadQueue.unshift({ index: chunkIndex, buffer: sliceBuffer }); // put back
            continue; 
          }
          channel.send(combined.buffer);
        } catch (e: any) {
          const errMsg = e.message || e.toString() || '';
          if (e.name === 'OperationError' || /full/i.test(errMsg) || /queue/i.test(errMsg)) {
            this.readAheadQueue.unshift({ index: chunkIndex, buffer: sliceBuffer }); // put back
            this.sendPaused = true;
            this.isSending = false;
            return;
          }
          throw e;
        }

        this.totalSent += sliceBuffer.byteLength;
        chunkIndex++;

        const now = Date.now();
        const elapsedSpeed = (now - this.lastSpeedCalc) / 1000;
        if (elapsedSpeed > 0.5) {
          this.currentSpeed = (this.totalSent - this.lastBytesSent) / elapsedSpeed;
          this.lastBytesSent = this.totalSent;
          this.lastSpeedCalc = now;
        }

        // Throttle progress events to ~100ms
        if (now - this.lastProgressEmit > 100) {
          const progress: TransferProgress = {
            fileId: meta.id,
            fileName: meta.name,
            totalSize: file.size,
            transferredBytes: this.totalSent,
            percentage: Math.min(100, (this.totalSent / file.size) * 100),
            speed: this.currentSpeed,
            eta: this.currentSpeed > 0 ? (file.size - this.totalSent) / this.currentSpeed : 0,
            status: 'transferring',
          };
          this.emit('progress', progress);
          this.lastProgressEmit = now;
        }

        // Keep UI responsive by yielding if we've been spinning in the tight loop for over 16ms
        if (Date.now() - loopStart > 16) {
          await new Promise(resolve => setTimeout(resolve, 0));
          loopStart = Date.now();
        }

      } catch (err) {
        console.error('[P2P] Send chunk failure:', err);
        this.emit('error', `Send failure: ${err}`);
        this.isSending = false;
        return;
      }
    }

    if (chunkIndex >= totalChunks) {
      console.log(`[P2P] File sent completely: ${meta.name}`);
      const endMsg: ChunkMessage = { type: 'file-end', fileId: meta.id };
      this.send(JSON.stringify(endMsg));
      
      const finalProgress: TransferProgress = {
        fileId: meta.id,
        fileName: meta.name,
        totalSize: file.size,
        transferredBytes: file.size,
        percentage: 100,
        speed: this.currentSpeed,
        eta: 0,
        status: 'completed',
      };
      this.emit('progress', finalProgress);
      this.completedFiles.add(`${meta.name}-${file.size}`);
      this.resetSendState();
      setTimeout(() => this.sendNextFile(), 100);
    }
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

  private controlQueue: string[] = [];

  private drainControlQueue() {
    const channel = this.dataChannels.find(c => c.readyState === 'open');
    if (channel) {
      while (this.controlQueue.length > 0) {
        const queued = this.controlQueue.shift();
        if (queued) {
          console.log(`[P2P] Sending queued control message to ${this.remotePeerId}`);
          channel.send(queued);
        }
      }
    }
  }

  private send(data: string) {
    this.drainControlQueue();
    // Use the first available open channel for control messages
    const channel = this.dataChannels.find(c => c.readyState === 'open');
    if (channel) {
      channel.send(data);
    } else {
      console.log(`[P2P] Queuing control message for ${this.remotePeerId} (no open channels)`);
      this.controlQueue.push(data);
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
    // Reject any pending resolvers so they don't hang
    const resolvers = this.channelReadyResolvers.splice(0);
    resolvers.forEach(r => r.reject(new Error('Connection closed manually')));

    this.dataChannels.forEach(c => c.close());
    this.dataChannels = [];
    this.pc.close();
  }

  get id() {
    return this.peerId;
  }
}
