// app/receive/page.tsx
'use client';
import { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { 
  Zap, 
  QrCode, 
  HardDrive, 
  DownloadCloud, 
  ArrowRight, 
  Check, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle, 
  XCircle,
  FileDown,
  ChevronRight,
  Loader2,
  FolderOpen
} from 'lucide-react';
import { useSignaling } from '@/lib/use-signaling';
import { formatBytes, formatSpeed, formatETA, formatDuration, getFileExtension } from '@/lib/utils';
import type { ReceivedFile } from '@/lib/use-signaling';
import ServerStatus from '@/components/ServerStatus';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FileIcon } from '@/components/FileIcon';
import { Html5QrcodeScanner } from 'html5-qrcode';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
});

function ReceiveContent() {
  const searchParams = useSearchParams();
  const roomFromUrl = searchParams.get('room') || '';
  const router = useRouter();

  const [roomCode, setRoomCode] = useState(roomFromUrl);
  const [roomPassword, setRoomPassword] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [autoJoined, setAutoJoined] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const [directSave, setDirectSave] = useState(false);
  const [isFileSystemSupported, setIsFileSystemSupported] = useState(false);
  const [rootDirectory, setRootDirectory] = useState<any>(null);
  const [pendingStreams, setPendingStreams] = useState<Map<string, { peerId: string; metadata: any }>>(new Map());

  const signalingRefs = useRef<{ setFileStream: any, pauseTransfer: any, resumeTransfer: any }>({
    setFileStream: () => {},
    pauseTransfer: () => {},
    resumeTransfer: () => {},
  });

  const getUniqueFileHandle = async (dirHandle: any, name: string) => {
    let finalName = name;
    let counter = 1;
    const dotIndex = name.lastIndexOf('.');
    const base = dotIndex === -1 ? name : name.substring(0, dotIndex);
    const ext = dotIndex === -1 ? '' : name.substring(dotIndex);

    while (true) {
      try {
        await dirHandle.getFileHandle(finalName);
        finalName = `${base} (${counter})${ext}`;
        counter++;
      } catch (e: any) {
        if (e.name === 'NotFoundError') {
          return await dirHandle.getFileHandle(finalName, { create: true });
        }
        throw e;
      }
    }
  };

  useEffect(() => {
    setIsFileSystemSupported('showSaveFilePicker' in window);
  }, []);

  // QR Scanner Logic
  useEffect(() => {
    if (!showScanner) return;

    let scanner: Html5QrcodeScanner | null = null;

    const startScanner = async () => {
      scanner = new Html5QrcodeScanner(
        'reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );

      scanner.render((decodedText: string) => {
        try {
          const url = new URL(decodedText);
          const room = url.searchParams.get('room');
          if (room) {
            setRoomCode(room);
            setShowScanner(false);
            scanner?.clear();
          }
        } catch {
          setRoomCode(decodedText.trim().toUpperCase());
          setShowScanner(false);
          scanner?.clear();
        }
      }, (error: any) => {
        // silent error for frame scanning
      });
    };

    startScanner();

    return () => {
      if (scanner) {
        scanner.clear().catch(console.error);
      }
    };
  }, [showScanner]);

  const onFileStart = useCallback(async (peerId: string, fileId: string, metadata: any) => {
    if (!directSave) return;

    if (rootDirectory) {
      try {
        const fileHandle = await getUniqueFileHandle(rootDirectory, metadata.name);
        const writable = await fileHandle.createWritable();
        signalingRefs.current.setFileStream(peerId, fileId, writable);
        return;
      } catch (err) {
        console.warn('Failed to auto-save to directory, falling back to manual:', err);
      }
    }

    setPendingStreams(prev => new Map(prev).set(fileId, { peerId, metadata }));
    signalingRefs.current.pauseTransfer();
  }, [directSave, rootDirectory]);

  const handleToggleDirectSave = async (enabled: boolean) => {
    if (!enabled) {
      setDirectSave(false);
      setRootDirectory(null);
      return;
    }

    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker();
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const request = await handle.requestPermission({ mode: 'readwrite' });
        if (request !== 'granted') throw new Error('Permission denied');
      }

      setRootDirectory(handle);
      setDirectSave(true);
    } catch (err) {
      console.error('Directory selection failed:', err);
      setDirectSave(false);
    }
  };

  const {
    status,
    room,
    connectedPeers,
    transfers,
    receivedFiles,
    joinRoom,
    leaveRoom,
    setFileStream,
    pauseTransfer,
    resumeTransfer,
    error,
  } = useSignaling({ onFileStart });

  useEffect(() => {
    signalingRefs.current = { setFileStream, pauseTransfer, resumeTransfer };
  }, [setFileStream, pauseTransfer, resumeTransfer]);

  const handleSetSaveLocation = async (fileId: string) => {
    const pending = pendingStreams.get(fileId);
    if (!pending) return;

    try {
      // @ts-ignore
      const handle = await window.showSaveFilePicker({
        suggestedName: pending.metadata.name,
      });
      const writable = await handle.createWritable();

      setFileStream(pending.peerId, fileId, writable);

      setPendingStreams(prev => {
        const next = new Map(prev);
        next.delete(fileId);
        return next;
      });

      resumeTransfer();
    } catch (err) {
      console.error('File save picker cancelled or failed:', err);
      setPendingStreams(prev => {
        const next = new Map(prev);
        next.delete(fileId);
        return next;
      });
      resumeTransfer();
    }
  };

  const isInRoom = !!room;

  useEffect(() => {
    if (roomFromUrl && !autoJoined && !isInRoom) {
      setAutoJoined(true);
      joinRoom(roomFromUrl);
    }
  }, [roomFromUrl, autoJoined, isInRoom, joinRoom]);

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsJoining(true);
    try {
      await joinRoom(roomCode, roomPassword);
    } finally {
      setIsJoining(false);
    }
  };

  const downloadFile = (file: ReceivedFile) => {
    if (file.streamed) {
      alert('File was saved directly to your disk.');
      return;
    }
    if (!file.url) return;
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.metadata.name;
    a.click();
  };

  const downloadAll = () => {
    receivedFiles.forEach((file) => {
      if (!file.streamed) {
        setTimeout(() => downloadFile(file), 100);
      }
    });
  };

  const activeTransfers = [...transfers.values()].filter((t) => t.status === 'transferring');
  const totalReceived = receivedFiles.reduce((acc, f) => acc + f.metadata.size, 0);
  const allCompleted = [...transfers.values()].every((t) => t.status === 'completed') && transfers.size > 0;

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
          className="gradient-orb gradient-orb--teal"
        />
      </div>

      {/* Header */}
      <header className="relative z-10 glass sticky top-0 flex items-center justify-between px-6 md:px-10 py-3.5 border-b border-border border-t-0 border-x-0">
        <div
          onClick={() => router.push('/')}
          className="cursor-pointer flex items-center gap-3"
        >
          <motion.div
            whileHover={{ scale: 1.05, rotate: 2 }}
            className="w-9 h-9 bg-gradient-to-br from-accent to-accent-2 rounded-[10px] flex items-center justify-center shadow-[0_0_15px_var(--color-accent-glow)]"
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
            <ConnectionStatus status={status} connected={connectedPeers.length > 0} />
            {isInRoom && (
              <Button variant="ghost" size="sm" onClick={leaveRoom} className="text-xs sm:text-sm">
                Leave Room
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-[1200px] mx-auto p-4 sm:p-8 flex flex-col items-center">

        {!isInRoom ? (
          <motion.div {...fadeUp()} className="w-full max-w-lg mt-10">
            <Card glass className="p-8 sm:p-12">
              <div className="text-center mb-10">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="w-16 h-16 bg-gradient-to-br from-accent to-accent-2 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_var(--color-accent-glow)] text-white"
                >
                  <DownloadCloud className="w-8 h-8" />
                </motion.div>
                <h2 className="text-2xl font-bold mb-3 tracking-tight">Receive Files</h2>
                <p className="text-text-2 text-sm max-w-sm mx-auto">
                  Enter the room code provided by the sender or scan their QR code to start receiving.
                </p>
              </div>

              {!showScanner ? (
                <div className="flex flex-col gap-5">
                  <div>
                    <label className="section-label mb-2 block">
                      Room Code
                    </label>
                    <input
                      className="input mono text-center text-xl tracking-widest font-bold h-14 uppercase"
                      type="text"
                      placeholder="e.g. A1B2C"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                      maxLength={10}
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="section-label mb-2 flex justify-between items-center">
                      <span>Room Password</span>
                      <span className="text-[10px] font-normal normal-case opacity-60">If required</span>
                    </label>
                    <input
                      className="input"
                      type="password"
                      placeholder="Password"
                      value={roomPassword}
                      onChange={(e) => setRoomPassword(e.target.value)}
                    />
                  </div>

                  <Button
                    variant="primary"
                    onClick={handleJoinRoom}
                    disabled={status === 'connecting' || !roomCode}
                    size="lg"
                    className="w-full mt-2"
                    isLoading={status === 'connecting'}
                  >
                    {status === 'connecting' ? 'Connecting...' : <span className="flex items-center gap-2">Join Room <ArrowRight className="w-4 h-4" /></span>}
                  </Button>

                  <div className="relative flex items-center py-4">
                    <div className="flex-grow h-px bg-gradient-to-r from-transparent via-border-2 to-transparent" />
                    <span className="flex-shrink-0 mx-4 text-text-3 text-[10px] uppercase tracking-[0.2em] font-semibold">Or</span>
                    <div className="flex-grow h-px bg-gradient-to-r from-transparent via-border-2 to-transparent" />
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => setShowScanner(true)}
                    className="w-full"
                  >
                    <QrCode className="w-4 h-4 mr-2" /> Scan QR Code
                  </Button>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-4 bg-red-dim border border-[rgba(244,63,94,0.25)] rounded-xl text-red text-sm text-center"
                    >
                      ⚠ {error}
                    </motion.div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div id="reader" className="w-full overflow-hidden rounded-xl border-2 border-accent bg-black" style={{ minHeight: 300 }} />
                  <Button variant="ghost" onClick={() => setShowScanner(false)} className="w-full">
                    Cancel Scanning
                  </Button>
                </div>
              )}
            </Card>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-full max-w-3xl"
          >
            {/* Settings / Mode */}
            <Card glass className="p-4 sm:p-6 mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="icon-badge w-11 h-11 text-2xl rounded-xl">
                  <HardDrive className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <div className="text-sm sm:text-[15px] font-semibold">Direct Save to Disk</div>
                  <div className="text-xs sm:text-sm text-text-3">
                    {isFileSystemSupported
                      ? (rootDirectory ? `Saving to: ${rootDirectory.name}` : 'Bypasses browser memory limits for large files')
                      : 'Not supported in this browser'}
                  </div>
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={directSave}
                  onChange={(e) => handleToggleDirectSave(e.target.checked)}
                  disabled={!isFileSystemSupported}
                />
                <span className="slider" />
              </label>
            </Card>

            {/* Active Transfers / Waiting state */}
            <Card glass className="p-0">
              <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-3">
                  <DownloadCloud className={`w-5 h-5 ${transfers.size > 0 ? 'text-accent' : 'text-text-3'}`} />
                  {transfers.size > 0 ? `Receiving ${transfers.size} file${transfers.size !== 1 ? 's' : ''}` : 'Waiting for files...'}
                </h2>
                {transfers.size > 0 && (
                  <div className={`tag ${allCompleted ? 'tag-green' : 'tag-blue'}`}>
                    {allCompleted ? <span className="flex items-center gap-1"><Check className="w-3 h-3" /> All Received</span> : 'In Progress'}
                  </div>
                )}
              </div>

              <div className="bg-[rgba(255,255,255,0.01)] min-h-[300px]">
                {transfers.size === 0 ? (
                  <div className="py-24 px-8 text-center flex flex-col items-center justify-center">
                    <motion.div
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                      className="w-20 h-20 icon-badge mb-6"
                    >
                      <DownloadCloud className="w-10 h-10 text-text-3" />
                    </motion.div>
                    <div className="text-xl font-semibold text-text-2 mb-2 tracking-tight">
                      Ready to Receive
                    </div>
                    <div className="text-sm text-text-3 max-w-sm">
                      Files sent to you will appear here and download automatically to your device.
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                    <AnimatePresence>
                      {[...transfers.values()].map((t) => (
                        <ReceiveFileRow
                          key={t.fileId}
                          transfer={t}
                          isPendingStream={pendingStreams.has(t.fileId)}
                          onSetLocation={() => handleSetSaveLocation(t.fileId)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </Card>

            {/* Received Files */}
            {receivedFiles.length > 0 && (
              <Card glass className="p-0 mt-5">
                <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green/10 flex items-center justify-center text-green">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                        {receivedFiles.length} file{receivedFiles.length !== 1 ? 's' : ''} received
                      </h2>
                      <div className="text-sm text-text-2 font-mono">{formatBytes(totalReceived)} total</div>
                    </div>
                  </div>
                  {receivedFiles.length > 1 && (
                    <Button variant="primary" onClick={downloadAll} size="sm">
                      <FileDown className="w-4 h-4 mr-2" /> Download All
                    </Button>
                  )}
                </div>

                <div className="divide-y divide-border">
                  {receivedFiles.map((file) => (
                    <ReceivedFileRow
                      key={file.fileId}
                      file={file}
                      onDownload={() => downloadFile(file)}
                    />
                  ))}
                </div>
              </Card>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default function ReceivePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-text-2 font-medium flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading...
        </div>
      </div>
    }>
      <ReceiveContent />
    </Suspense>
  );
}

function ReceiveFileRow({
  transfer,
  isPendingStream,
  onSetLocation,
}: {
  transfer: { fileId: string; fileName: string; totalSize: number; percentage: number; speed: number; eta: number; status: string; fileType?: string; error?: string };
  isPendingStream?: boolean;
  onSetLocation?: () => void;
}) {
  const isDone = transfer.status === 'completed';
  const isSaving = transfer.status === 'saving';
  const isError = transfer.status === 'error';
  const isCancelled = transfer.status === 'cancelled';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col sm:flex-row sm:items-center gap-5 p-5 sm:p-6 group relative hover:bg-[rgba(255,255,255,0.015)] transition-colors"
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="icon-badge w-12 h-12 rounded-xl text-2xl shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
          <FileIcon mimeType={transfer.fileType || ''} className="w-6 h-6 text-text-2" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-1.5 gap-2 sm:gap-4">
            <div className="font-semibold text-[15px] truncate pr-4 text-text tracking-tight flex items-center gap-1.5">
              <ChevronRight className="w-3.5 h-3.5 text-accent" />
              {transfer.fileName}
            </div>
            <div className="flex gap-2 shrink-0">
              {isPendingStream && <span className="tag tag-amber shrink-0 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Action Required</span>}
              {isDone && <span className="tag tag-green shrink-0 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Saved</span>}
              {isSaving && <span className="tag tag-blue shrink-0 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving...</span>}
              {isError && <span className="tag tag-red shrink-0 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Error</span>}
              {isCancelled && <span className="tag tag-amber shrink-0 flex items-center gap-1"><XCircle className="w-3 h-3" /> Cancelled</span>}
            </div>
          </div>

          <div className="text-xs text-text-3 flex flex-wrap gap-2 gap-y-1 items-center font-mono">
            <span>{formatBytes(transfer.totalSize)}</span>
            <span className="opacity-30">•</span>
            <span className="uppercase">{getFileExtension(transfer.fileName)}</span>

            {transfer.status === 'transferring' && !isPendingStream && (
              <>
                <span className="opacity-30">•</span>
                <span className="text-accent font-medium">{formatSpeed(transfer.speed)}</span>
                <span className="opacity-30">•</span>
                <span>{formatETA(transfer.eta)} left</span>
              </>
            )}

            {(isError || isCancelled) && transfer.error && (
              <>
                <span className="opacity-30">•</span>
                <span className="text-red">{transfer.error}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="w-full sm:w-auto shrink-0 flex items-center gap-4 mt-2 sm:mt-0">
        {isPendingStream ? (
          <div className="p-3 bg-accent-dim rounded-xl border border-[rgba(91,106,247,0.2)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full sm:w-auto">
            <span className="text-[12px] font-medium text-accent leading-tight max-w-[200px] hidden sm:block">Choose where to save this file to start the transfer</span>
            <Button
              variant="primary" size="sm" onClick={onSetLocation}
              className="shrink-0 text-xs w-full sm:w-auto py-2 h-auto text-[13px] px-4 font-semibold"
            >
              <FolderOpen className="w-4 h-4 mr-2" /> Set Save Location
            </Button>
          </div>
        ) : transfer.status === 'transferring' || transfer.status === 'saving' || isPendingStream === false ? (
          <div className="flex items-center gap-4 w-full sm:w-auto">
            {transfer.status === 'transferring' && (
              <div className="text-xl font-bold text-accent font-mono min-w-[50px] text-right">
                {transfer.percentage.toFixed(0)}%
              </div>
            )}
            {transfer.status === 'transferring' && (
              <div className="progress-track h-2 w-full sm:w-[120px] rounded-full shrink-0">
                <motion.div
                  className="progress-fill h-full"
                  animate={{ width: `${transfer.percentage}%` }}
                  transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function ReceivedFileRow({
  file,
  onDownload,
}: {
  file: ReceivedFile;
  onDownload: () => void;
}) {
  const age = Date.now() - file.receivedAt;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex items-center gap-4 p-4 sm:p-5 transition-colors group ${age < 3000 ? 'bg-[rgba(34,211,160,0.03)]' : 'hover:bg-[rgba(255,255,255,0.015)]'}`}
    >
      <div className="icon-badge w-10 h-10 sm:w-11 sm:h-11 rounded-lg text-xl shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center">
        <FileIcon mimeType={file.metadata.type} className="w-5 h-5 text-text-2" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm sm:text-[15px] mb-1 truncate text-text">{file.metadata.name}</div>
        <div className="text-[11px] sm:text-xs text-text-3 flex flex-wrap gap-2 items-center font-mono">
          <span>{formatBytes(file.metadata.size)}</span>
          <span className="opacity-30">•</span>
          <span className="truncate max-w-[80px] sm:max-w-[120px]">{file.metadata.type || 'Unknown type'}</span>
          <span className="opacity-30">•</span>
          <span>{formatDuration(Date.now() - file.receivedAt)} ago</span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <span className="tag tag-green hidden sm:inline-flex flex items-center gap-1"><Check className="w-3 h-3" /> Received</span>
        <Button variant="ghost" onClick={onDownload} size="sm" className="text-xs h-8 px-3">
          <FileDown className="w-3.5 h-3.5 mr-1" /> Save
        </Button>
      </div>
    </motion.div>
  );
}

function ConnectionStatus({ status, connected }: { status: string; connected: boolean }) {
  const statusMap: Record<string, { label: string; cls: string; dot: string }> = {
    disconnected: { label: 'Disconnected', cls: 'tag-amber', dot: 'disconnected' },
    connecting: { label: 'Connecting...', cls: 'tag-amber', dot: 'connecting animate-pulse' },
    connected: { label: connected ? 'Connected' : 'Waiting', cls: connected ? 'tag-green' : 'tag-amber', dot: connected ? 'connected' : 'connecting animate-pulse' },
    transferring: { label: 'Receiving', cls: 'tag-blue', dot: 'connected' },
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
