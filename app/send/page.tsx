// app/send/page.tsx
'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, 
  UploadCloud, 
  FolderPlus, 
  Trash2, 
  ArrowUpCircle, 
  Pause, 
  X, 
  CheckCircle2, 
  Clock,
  Link,
  Copy,
  Check,
  Users,
  Loader2,
  ChevronRight,
  Monitor,
  RefreshCcw,
  LogOut
} from 'lucide-react';
import { useSignaling } from '@/lib/use-signaling';
import toast from 'react-hot-toast';
import { formatBytes, formatSpeed, formatETA, getFileExtension, generateShareUrl, generateQRCode } from '@/lib/utils';
import ServerStatus from '@/components/ServerStatus';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FileIcon } from '@/components/FileIcon';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
});

export default function SendPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [qrCode, setQrCode] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const {
    status,
    room,
    connectedPeers,
    pendingPeers,
    transfers,
    createRoom,
    leaveRoom,
    sendFiles,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    error,
    myPeerId,
  } = useSignaling();

  const isInRoom = !!room;
  const shareUrl = room ? generateShareUrl(room.code) : '';

  useEffect(() => {
    if (shareUrl) {
      generateQRCode(shareUrl).then(setQrCode);
    }
  }, [shareUrl]);

  const handleCreateRoom = async () => {
    await createRoom({ password: roomPassword || undefined });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) {
      const existing = new Set(files.map((f) => f.name + f.size));
      const newFiles = dropped.filter((f) => !existing.has(f.name + f.size));
      if (newFiles.length > 0) {
        setFiles((prev) => [...prev, ...newFiles]);
        toast.success(`Added ${newFiles.length} file${newFiles.length !== 1 ? 's' : ''}`);
      }
    }
  }, [files]);

  const handleFolderSelect = async () => {
    try {
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker();
      const selectedFiles: File[] = [];

      const processHandle = async (handle: any, path = '') => {
        for await (const entry of handle.values()) {
          if (entry.kind === 'file') {
            const file = await entry.getFile();
            selectedFiles.push(file);
          } else if (entry.kind === 'directory') {
            await processHandle(entry, path ? `${path}/${entry.name}` : entry.name);
          }
        }
      };

      await processHandle(dirHandle);

      const existing = new Set(files.map((f) => f.name + f.size));
      const newFiles = selectedFiles.filter((f) => !existing.has(f.name + f.size));
      if (newFiles.length > 0) {
        setFiles((prev) => [...prev, ...newFiles]);
        toast.success(`Imported ${newFiles.length} file${newFiles.length !== 1 ? 's' : ''} from folder`);
      }
    } catch (err) {
      console.error('Folder picker error:', err);
      toast.error('Failed to import folder');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const existing = new Set(files.map((f) => f.name + f.size));
    const newFiles = selected.filter((f) => !existing.has(f.name + f.size));
    if (newFiles.length > 0) {
      setFiles((prev) => [...prev, ...newFiles]);
      toast.success(`Added ${newFiles.length} file${newFiles.length !== 1 ? 's' : ''}`);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (files.length > 0 && connectedPeers.length > 0) {
      sendFiles(files);
      toast.loading('Starting transfer...', { duration: 3000, icon: '🚀' });
    } else if (connectedPeers.length === 0) {
      toast.error('Waiting for a receiver to join...', { icon: '⏳' });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const isTransferring = [...transfers.values()].some((t) => t.status === 'transferring');
  const allCompleted = [...transfers.values()].every((t) => t.status === 'completed');

  return (
    <div className="min-h-screen relative overflow-hidden bg-bg">
      {/* Grid bg */}
      <div className="absolute inset-0 grid-bg pointer-events-none z-0 opacity-50" />

      {/* Gradient orbs */}
      <div className="gradient-orbs">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.06, 0.09, 0.06] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="gradient-orb gradient-orb--indigo"
        />
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.04, 0.07, 0.04] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="gradient-orb gradient-orb--purple"
        />
      </div>

      {/* Header */}
      <header className="z-10 glass sticky top-0 flex items-center justify-between px-6 md:px-10 py-3.5 border-b border-border border-t-0 border-x-0">
        <div
          onClick={() => router.push('/')}
          className="cursor-pointer flex items-center gap-3"
        >
          <motion.div
            whileHover={{ scale: 1.05, rotate: 2 }}
            className="w-9 h-9 bg-linear-to-br from-accent to-accent-2 rounded-[10px] flex items-center justify-center shadow-[0_0_15px_var(--color-accent-glow)]"
          >
            <Zap className="w-5 h-5 text-white" />
          </motion.div>
          <span className="text-lg font-bold tracking-tight text-text hidden sm:block">
            P2P<span className="text-accent">Share</span>
          </span>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <ServerStatus />
          <div className="flex items-center gap-3">
            <ConnectionBadge status={status} peers={connectedPeers.length} />
            {isInRoom && (
              <Button variant="ghost" size="sm" onClick={leaveRoom} className="text-xs sm:text-sm">
                <LogOut className="w-3.5 h-3.5 mr-1" /> Leave
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-[1200px] mx-auto p-4 sm:p-8 flex flex-col lg:flex-row gap-6 items-start">

        {/* Left: File Drop + List */}
        <div className="flex flex-col gap-6 w-full flex-1">

          {/* Room creation (if not in room) */}
          {!isInRoom && (
            <motion.div {...fadeUp()}>
              <Card glass className="p-8 sm:p-12 text-center max-w-xl mx-auto mt-10">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="w-16 h-16 bg-linear-to-br from-accent to-accent-2 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_var(--color-accent-glow)] text-white"
                >
                  <Zap className="w-8 h-8" />
                </motion.div>
                <h2 className="text-2xl font-bold mb-3 tracking-tight">Create a Transfer Room</h2>
                <p className="text-text-2 text-sm mb-8 max-w-sm mx-auto">
                  A secure, peer-to-peer room will be created. Files stream directly to recipients — nothing stored on servers.
                </p>

                <div className="flex flex-col gap-4 max-w-xs mx-auto text-left">
                  <div>
                    <label className="section-label mb-2 block">
                      Room Password <span className="text-[10px] font-normal normal-case opacity-60">(optional)</span>
                    </label>
                    <input
                      className="input"
                      type="password"
                      placeholder="Leave blank for public"
                      value={roomPassword}
                      onChange={(e) => setRoomPassword(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleCreateRoom}
                    disabled={status === 'connecting'}
                    className="w-full mt-2"
                    size="lg"
                    isLoading={status === 'connecting'}
                  >
                    {!status || status === 'disconnected' ? 'Create Secure Room' : 'Connecting...'}
                  </Button>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 bg-red-dim border border-[rgba(244,63,94,0.25)] rounded-xl text-red text-sm"
                  >
                    ⚠ {error}
                  </motion.div>
                )}
              </Card>
            </motion.div>
          )}

          {/* Drop Zone */}
          {isInRoom && (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={`drop-zone ${isDragging ? 'active' : ''} glass`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              style={{
                padding: files.length === 0 ? '80px 32px' : '32px',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                onChange={handleFileInput}
                style={{ display: 'none' }}
              />
              {files.length === 0 ? (
                <div className="flex flex-col items-center justify-center">
                  <motion.div
                    animate={{ y: [0, -8, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    className="text-white icon-badge w-20 h-20 bg-accent/20 border-accent/20"
                  >
                    <UploadCloud className="w-10 h-10 text-accent" />
                  </motion.div>
                  <div className="text-xl font-bold mb-2 tracking-tight mt-6">
                    {isDragging ? 'Drop files here' : 'Select or drop files'}
                  </div>
                  <div className="text-text-3 text-sm mb-8">
                    Any file type · Any size · Unlimited transfers
                  </div>
                  {typeof window !== 'undefined' && 'showDirectoryPicker' in window && (
                    <Button
                      variant="ghost" size="sm"
                      onClick={(e) => { e.stopPropagation(); handleFolderSelect(); }}
                      className="pointer-events-auto"
                    >
                      <FolderPlus className="w-4 h-4 mr-2" /> Send Entire Folder
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
                  <div className="text-sm text-text-2 font-medium flex items-center gap-2">
                    <UploadCloud className="w-4 h-4" /> Add more files here
                  </div>
                  {typeof window !== 'undefined' && 'showDirectoryPicker' in window && (
                    <Button
                      variant="ghost" size="sm"
                      onClick={(e) => { e.stopPropagation(); handleFolderSelect(); }}
                    >
                      <FolderPlus className="w-4 h-4 mr-2" /> Add Folder
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* File list */}
          {files.length > 0 && (
            <motion.div layout {...fadeUp()}>
              <Card glass className="overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex justify-between items-center bg-[rgba(255,255,255,0.01)]">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-text text-[15px] flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 text-accent" />
                      {files.length} Item{files.length !== 1 ? 's' : ''} in Queue
                    </span>
                    <span className="text-text-3 text-xs font-mono bg-surface-2 px-2 py-0.5 rounded-md border border-border">
                      {formatBytes(totalSize)}
                    </span>
                  </div>
                  <button
                    onClick={() => setFiles([])}
                    className="text-xs text-text-3 hover:text-red transition-colors cursor-pointer bg-transparent border-none outline-none font-medium flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear All
                  </button>
                </div>

                <div className="max-h-[400px] overflow-y-auto">
                  <AnimatePresence>
                    {files.map((file, i) => (
                      <FileRow
                        key={`${file.name}-${i}`}
                        file={file}
                        transfers={transfers}
                        peerCount={connectedPeers.length}
                        onRemove={() => removeFile(i)}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {/* Send action bar */}
                <div className="p-5 border-t border-border bg-[rgba(255,255,255,0.02)] flex flex-col sm:flex-row gap-4 items-center justify-between">
                  <Button
                    variant="primary"
                    onClick={handleSend}
                    disabled={!isInRoom || connectedPeers.length === 0 || isTransferring}
                    className="w-full sm:flex-1"
                    size="lg"
                    isLoading={isTransferring}
                  >
                    {isTransferring ? 'Transferring...' :
                     allCompleted && transfers.size > 0 ? (
                       <span className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> All Sent Successfully!</span>
                     ) :
                     !isInRoom ? 'Create a room to send' :
                     connectedPeers.length === 0 ? (
                       <span className="flex items-center gap-2"><Clock className="w-4 h-4" /> Waiting for receiver...</span>
                     ) :
                     <span className="flex items-center gap-2"><ArrowUpCircle className="w-5 h-5" /> Send to {connectedPeers.length} peer{connectedPeers.length !== 1 ? 's' : ''}</span>}
                  </Button>

                  {isTransferring && (
                    <div className="flex gap-2 w-full sm:w-auto">
                      <Button variant="ghost" onClick={pauseTransfer} className="flex-1 sm:flex-none">
                        <Pause className="w-4 h-4 mr-1" /> Pause
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => {
                          cancelTransfer();
                          setFiles([]);
                        }}
                        className="flex-1 sm:flex-none"
                      >
                        <X className="w-4 h-4 mr-1" /> Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          )}
        </div>

        {/* Right: Room info panel */}
        {isInRoom && room && (
          <div className="flex flex-col gap-5 w-full lg:w-[380px] shrink-0">
            {/* Room code card */}
            <motion.div {...fadeUp(0)}>
              <Card glass className="p-6">
                <div className="mb-5">
                  <div className="section-label mb-3 flex items-center justify-between">
                    <span>Active Room Code</span>
                    <span className="w-2 h-2 rounded-full bg-green animate-pulse shadow-[0_0_6px_rgba(34,211,160,0.5)]" />
                  </div>
                  <div
                    className="room-code-display text-4xl py-5 px-4"
                    onClick={() => copyToClipboard(room.code, 'Room code')}
                    title="Click to copy"
                  >
                    {room.code}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  onClick={() => copyToClipboard(shareUrl, 'Share link')}
                  className="w-full text-sm font-medium"
                >
                  {copied ? (
                    <span className="flex items-center gap-2"><Check className="w-4 h-4 text-green" /> Copied!</span>
                  ) : (
                    <span className="flex items-center gap-2"><Link className="w-4 h-4" /> Copy Direct Share Link</span>
                  )}
                </Button>
              </Card>
            </motion.div>

            {/* QR Code */}
            {qrCode && (
              <motion.div {...fadeUp(0.1)}>
                <Card glass className="p-6 text-center">
                  <div className="section-label mb-4">Scan with Mobile Camera</div>
                  <div className="inline-block p-4 bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.3)] border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrCode} alt="Room QR Code" className="w-[160px] h-[160px] block" />
                  </div>
                </Card>
              </motion.div>
            )}

            {/* Peers */}
            <motion.div {...fadeUp(0.2)}>
              <Card glass className="p-6">
                <div className="section-label mb-4">
                  Connected Recipients ({connectedPeers.length})
                </div>

                {connectedPeers.length === 0 && pendingPeers.length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-border-2 rounded-xl bg-[rgba(255,255,255,0.01)]">
                    <motion.div
                      animate={{ y: [0, -6, 0] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="text-text-3 mb-3 flex justify-center"
                    >
                      <Users className="w-8 h-8 opacity-30" />
                    </motion.div>
                    <div className="text-[13px] text-text-2 font-medium">Waiting for connections...</div>
                    <div className="text-[11px] text-text-3 mt-1">Share the room code or QR above</div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <AnimatePresence>
                      {connectedPeers.map((peerId) => (
                        <motion.div
                          key={peerId}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center gap-3 p-3 bg-surface-2 border border-border rounded-xl"
                        >
                          <div className="status-dot connected shrink-0" />
                          <Monitor className="w-3.5 h-3.5 text-text-3" />
                          <span className="mono text-xs text-text-2 flex-1 truncate">
                            {peerId.slice(0, 8)}...
                          </span>
                          <span className="tag tag-green text-[9px]">Online</span>
                        </motion.div>
                      ))}
                      {pendingPeers.map((peerId) => (
                        <motion.div
                          key={peerId}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center gap-3 p-3 bg-surface-2 border border-border rounded-xl opacity-60"
                        >
                          <div className="status-dot connecting shrink-0 animate-pulse" />
                          <Loader2 className="w-3.5 h-3.5 text-text-3 animate-spin" />
                          <span className="mono text-xs text-text-2 flex-1 truncate">
                            {peerId.slice(0, 8)}...
                          </span>
                          <span className="tag tag-amber text-[9px]">Joining</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </Card>
            </motion.div>

            {/* Transfer stats */}
            {transfers.size > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              >
                <Card glass glow className="p-6">
                  <div className="section-label text-accent mb-4 flex items-center justify-between">
                    <span>Live Transfer Status</span>
                    <RefreshCcw className="w-3.5 h-3.5 animate-spin-slow" />
                  </div>
                  <div className="flex flex-col gap-5">
                    {[...transfers.values()].map((t) => (
                      <TransferProgressCard key={t.fileId} transfer={t} />
                    ))}
                  </div>
                </Card>
              </motion.div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionBadge({ status, peers }: { status: string; peers: number }) {
  const statusMap: Record<string, { label: string; cls: string; dot: string }> = {
    disconnected: { label: 'Disconnected', cls: 'tag-amber', dot: 'disconnected' },
    connecting: { label: 'Connecting...', cls: 'tag-amber', dot: 'connecting animate-pulse' },
    connected: { label: `${peers} Peer${peers !== 1 ? 's' : ''}`, cls: peers > 0 ? 'tag-green' : 'tag-blue', dot: 'connected' },
    transferring: { label: 'Transferring', cls: 'tag-blue', dot: 'connected' },
    error: { label: 'Error', cls: 'tag-red', dot: 'error' },
  };
  const s = statusMap[status] || statusMap['disconnected'];
  return (
    <div className="flex items-center gap-2">
      <div className={`status-dot ${s.dot}`} />
      <span className={`tag ${s.cls}`}>{s.label}</span>
    </div>
  );
}

function FileRow({
  file,
  transfers,
  peerCount,
  onRemove,
}: {
  file: File;
  transfers: Map<string, any>;
  peerCount: number;
  onRemove: () => void;
}) {
  // Find all transfers related to this file name
  const fileTransfers = [...transfers.values()].filter(t => t.fileName === file.name);
  
  // Aggregate status
  const isTransferring = fileTransfers.some(t => t.status === 'transferring');
  const allCompleted = fileTransfers.length >= peerCount && fileTransfers.every(t => t.status === 'completed');
  
  // Best progress to show: minimum percentage (worst case) or just the first active one
  const avgPercentage = fileTransfers.length > 0 
    ? fileTransfers.reduce((acc, t) => acc + t.percentage, 0) / fileTransfers.length
    : 0;
    
  // Format info
  const speed = fileTransfers.reduce((acc, t) => acc + (t.speed || 0), 0);
  const eta = fileTransfers.length > 0 ? Math.max(...fileTransfers.map(t => t.eta || 0)) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10, height: 0, overflow: 'hidden' }}
      className="flex items-center gap-4 px-5 py-3.5 border-b border-border group hover:bg-[rgba(255,255,255,0.015)] transition-colors"
    >
      <div className="icon-badge w-10 h-10 rounded-lg text-xl shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
        <FileIcon mimeType={file.type} className="w-5 h-5 text-text-2 group-hover:text-accent transition-colors" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm mb-1 truncate text-text">{file.name}</div>
        <div className="text-xs text-text-3 flex gap-2 items-center font-mono">
          <span>{formatBytes(file.size)}</span>
          <span className="opacity-30">•</span>
          <span className="uppercase">{getFileExtension(file.name)}</span>
          {isTransferring && (
            <>
              <span className="opacity-30">•</span>
              <span className="text-accent font-medium">{formatSpeed(speed)} total</span>
              <span className="opacity-30">•</span>
              <span>{formatETA(eta)} left</span>
            </>
          )}
        </div>

        {fileTransfers.length > 0 && (
          <div className="mt-2.5">
            <div className="progress-track h-1.5">
              <motion.div
                className="progress-fill h-full"
                animate={{ width: `${avgPercentage}%` }}
                transition={{ type: "spring", bounce: 0, duration: 0.5 }}
              />
            </div>
          </div>
        )}
      </div>

      {allCompleted ? (
        <span className="tag tag-green shrink-0 flex items-center gap-1"><Check className="w-3 h-3" /> Sent to All</span>
      ) : isTransferring ? (
        <span className="tag tag-blue shrink-0 flex items-center gap-1">
          {fileTransfers.length}/{peerCount}
        </span>
      ) : (
        <button
          onClick={onRemove}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-lg text-text-3 hover:text-red hover:bg-red-dim border border-transparent hover:border-[rgba(244,63,94,0.2)] transition-all shrink-0 opacity-0 group-hover:opacity-100 cursor-pointer bg-transparent outline-none p-0"
          title="Remove file"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  );
}

function TransferProgressCard({
  transfer,
}: {
  transfer: { fileId: string; fileName: string; totalSize: number; transferredBytes: number; percentage: number; speed: number; eta: number; status: string };
}) {
  const isDone = transfer.status === 'completed';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-end text-[13px]">
        <span className="truncate max-w-[65%] font-medium" title={transfer.fileName}>
          {transfer.fileName}
        </span>
        <span className={`font-bold font-mono ${isDone ? 'text-green' : 'text-accent'}`}>
          {isDone ? '✓' : `${transfer.percentage.toFixed(0)}%`}
        </span>
      </div>
      <div className="progress-track h-2">
        <motion.div
          className="progress-fill h-full"
          animate={{ width: `${transfer.percentage}%` }}
          transition={{ ease: "linear", duration: 0.2 }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-text-3 font-mono">
        <span>{formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.totalSize)}</span>
        <span>{transfer.speed > 0 ? formatSpeed(transfer.speed) : isDone ? 'Complete' : '—'}</span>
      </div>
    </div>
  );
}
