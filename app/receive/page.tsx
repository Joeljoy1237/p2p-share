// app/receive/page.tsx
'use client';
import { useState, useEffect, Suspense, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSignaling } from '@/lib/use-signaling';
import { formatBytes, formatSpeed, formatETA, getFileIcon, formatDuration } from '@/lib/utils';
import type { ReceivedFile } from '@/lib/use-signaling';

function ReceiveContent() {
  const searchParams = useSearchParams();
  const roomFromUrl = searchParams.get('room') || '';

  const [roomCode, setRoomCode] = useState(roomFromUrl);
  const [password, setPassword] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [autoJoined, setAutoJoined] = useState(false);

  const [directSave, setDirectSave] = useState(false);
  const [isFileSystemSupported, setIsFileSystemSupported] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [rootDirectory, setRootDirectory] = useState<any>(null);
  const [pendingStreams, setPendingStreams] = useState<Map<string, { peerId: string; metadata: any }>>(new Map());

  // Use refs for signaling functions to avoid circular dependency in useCallback
  const signalingRefs = useRef<{ setFileStream: any, pauseTransfer: any, resumeTransfer: any }>({
    setFileStream: () => {},
    pauseTransfer: () => {},
    resumeTransfer: () => {},
  });

  // Filename resolution helper
  const getUniqueFileHandle = async (dirHandle: any, name: string) => {
    let finalName = name;
    let counter = 1;
    const dotIndex = name.lastIndexOf('.');
    const base = dotIndex === -1 ? name : name.substring(0, dotIndex);
    const ext = dotIndex === -1 ? '' : name.substring(dotIndex);

    while (true) {
      try {
        await dirHandle.getFileHandle(finalName);
        // If it doesn't throw, the file exists
        finalName = `${base} (${counter})${ext}`;
        counter++;
      } catch (e: any) {
        // If it throws NotFoundError, the file name is available
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
    if (!isScanning) return;

    let scanner: any = null;

    const startScanner = async () => {
      const { Html5QrcodeScanner } = await import('html5-qrcode');
      scanner = new Html5QrcodeScanner(
        'qr-reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );

      scanner.render((decodedText: string) => {
        // Handle scanned URL or code
        try {
          const url = new URL(decodedText);
          const room = url.searchParams.get('room');
          if (room) {
            setRoomCode(room);
            setIsScanning(false);
            scanner.clear();
          }
        } catch {
          // If not a URL, assume it's just the code
          setRoomCode(decodedText.trim().toUpperCase());
          setIsScanning(false);
          scanner.clear();
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
  }, [isScanning]);

  const onFileStart = useCallback(async (peerId: string, fileId: string, metadata: any) => {
    if (!directSave) return;
    
    // 1. Try to use the common directory if available
    if (rootDirectory) {
      try {
        const fileHandle = await getUniqueFileHandle(rootDirectory, metadata.name);
        const writable = await fileHandle.createWritable();
        signalingRefs.current.setFileStream(peerId, fileId, writable);
        return; // Success! No need to pause or ask
      } catch (err) {
        console.warn('Failed to auto-save to directory, falling back to manual:', err);
      }
    }

    // 2. Fallback to manual 'Pause & Pick' if no directory or auto-save failed
    setPendingStreams(prev => new Map(prev).set(fileId, { peerId, metadata }));
    signalingRefs.current.pauseTransfer();
  }, [directSave, rootDirectory]); // stable refs used inside

  const handleToggleDirectSave = async (enabled: boolean) => {
    if (!enabled) {
      setDirectSave(false);
      setRootDirectory(null);
      return;
    }

    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker();
      // Check permission
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

  // Update refs when signaling functions change
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
      
      // Setup the stream in the P2P connection
      setFileStream(pending.peerId, fileId, writable);
      
      // Cleanup pending state
      setPendingStreams(prev => {
        const next = new Map(prev);
        next.delete(fileId);
        return next;
      });
      
      // Resume the transfer
      resumeTransfer();
    } catch (err) {
      console.error('File save picker cancelled or failed:', err);
      // Fallback: if user cancels, we can either stay paused or fallback to memory
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

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsJoining(true);
    try {
      await joinRoom(roomCode, password);
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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 32px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <Link href="/" style={{
          textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}>⚡</div>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            P2P<span style={{ color: 'var(--accent)' }}>Share</span>
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className={`status-dot ${isInRoom ? 'connected' : 'disconnected'}`} />
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {isInRoom
                ? `Room ${room.code} · ${connectedPeers.length} sender${connectedPeers.length !== 1 ? 's' : ''}`
                : 'Not connected'}
            </span>
          </div>
          {isInRoom && (
            <button onClick={leaveRoom} className="btn btn-ghost" style={{ fontSize: 13 }}>
              Leave
            </button>
          )}
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
        
        {/* Settings / Mode */}
        {isInRoom && (
          <div className="card animate-fade-in" style={{ padding: '16px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 20 }}>💾</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Direct Save to Disk</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
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
          </div>
        )}

        {/* Join Form */}
        {!isInRoom && (
          <div className="card animate-slide-up" style={{ padding: 40, marginBottom: 32, maxWidth: 560, margin: '0 auto 32px' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📥</div>
              <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Receive Files</h1>
              <p style={{ color: 'var(--text-2)', fontSize: 15 }}>
                Enter the room code shared by the sender
              </p>
            </div>

            <form onSubmit={handleJoin}>
              <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <button
                  type="button"
                  className={`btn ${isScanning ? 'btn-danger' : 'btn-ghost'}`}
                  onClick={() => setIsScanning(!isScanning)}
                  style={{ width: '100%', marginBottom: 16 }}
                >
                  {isScanning ? '✕ Cancel Scanning' : '📷 Scan QR Code'}
                </button>

                {isScanning && (
                  <div 
                    id="qr-reader" 
                    className="card animate-fade-in" 
                    style={{ 
                      overflow: 'hidden', 
                      background: 'black', 
                      borderRadius: 16,
                      border: '1px solid var(--accent)',
                      marginBottom: 16
                    }} 
                  />
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                  Room Code
                </label>
                <input
                  className="input mono"
                  placeholder="XXXXXX"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  style={{
                    textAlign: 'center', letterSpacing: '0.3em',
                    fontSize: 24, fontWeight: 700, padding: '16px',
                  }}
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                  Password (if required)
                </label>
                <input
                  className="input"
                  type="password"
                  placeholder="Leave blank if no password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div style={{
                  marginBottom: 16, padding: 12, background: 'var(--red-dim)',
                  border: '1px solid rgba(244,63,94,0.3)', borderRadius: 8,
                  color: 'var(--red)', fontSize: 13,
                }}>
                  ⚠ {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={roomCode.trim().length < 4 || isJoining}
                style={{ width: '100%', padding: '14px', fontSize: 16 }}
              >
                {isJoining ? (
                  <>
                    <span className="animate-spin-slow" style={{ display: 'inline-block' }}>⟳</span>
                    Joining...
                  </>
                ) : (
                  '⬇ Join & Receive'
                )}
              </button>
            </form>
          </div>
        )}

        {/* Active Transfers */}
        {isInRoom && activeTransfers.length > 0 && (
          <div className="card animate-fade-in" style={{ padding: 24, marginBottom: 20 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 20,
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>
                Receiving {activeTransfers.length} file{activeTransfers.length !== 1 ? 's' : ''}...
              </h2>
              <div className="tag tag-blue">
                <span className="animate-spin-slow" style={{ display: 'inline-block', marginRight: 4 }}>⟳</span>
                In Progress
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {activeTransfers.map((t) => (
                <ActiveTransferRow 
                  key={t.fileId} 
                  transfer={t} 
                  isPendingStream={pendingStreams.has(t.fileId)}
                  onSetLocation={() => handleSetSaveLocation(t.fileId)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Waiting state */}
        {isInRoom && activeTransfers.length === 0 && receivedFiles.length === 0 && (
          <div className="card animate-fade-in" style={{
            padding: 60, textAlign: 'center',
          }}>
            <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 20px' }}>
              <div style={{
                position: 'absolute', inset: 0,
                border: '2px solid var(--accent)',
                borderRadius: '50%',
                animation: 'pulse-ring 2s ease-out infinite',
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                border: '2px solid var(--accent)',
                borderRadius: '50%',
                animation: 'pulse-ring 2s ease-out 1s infinite',
              }} />
              <div style={{
                width: 80, height: 80,
                background: 'rgba(91,106,247,0.1)',
                border: '1px solid var(--accent)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32,
              }}>
                📡
              </div>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              Connected to Room {room.code}
            </h2>
            <p style={{ color: 'var(--text-2)', marginBottom: 16 }}>
              Waiting for sender to start the transfer...
            </p>
            <div className="tag tag-green" style={{ display: 'inline-flex' }}>
              {connectedPeers.length > 0
                ? `${connectedPeers.length} sender connected`
                : 'Waiting for sender to join...'}
            </div>
          </div>
        )}

        {/* Received Files */}
        {receivedFiles.length > 0 && (
          <div className="card animate-fade-in" style={{ overflow: 'hidden' }}>
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
                  ✓ {receivedFiles.length} file{receivedFiles.length !== 1 ? 's' : ''} received
                </h2>
                <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  {formatBytes(totalReceived)} total
                </div>
              </div>
              {receivedFiles.length > 1 && (
                <button className="btn btn-primary" onClick={downloadAll}>
                  ⬇ Download All
                </button>
              )}
            </div>

            <div>
              {receivedFiles.map((file) => (
                <ReceivedFileRow
                  key={file.fileId}
                  file={file}
                  onDownload={() => downloadFile(file)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReceivePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-2)' }}>Loading...</div>
      </div>
    }>
      <ReceiveContent />
    </Suspense>
  );
}

function ActiveTransferRow({
  transfer,
  isPendingStream,
  onSetLocation,
}: {
  transfer: {
    fileId: string;
    fileName: string;
    totalSize: number;
    transferredBytes: number;
    percentage: number;
    speed: number;
    eta: number;
    status: string;
  };
  isPendingStream?: boolean;
  onSetLocation?: () => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        <div style={{
          width: 42, height: 42, background: 'var(--surface-2)', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
        }}>
          {getFileIcon('')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 500, fontSize: 14, marginBottom: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {transfer.fileName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', gap: 12 }}>
            <span>{formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.totalSize)}</span>
            <span style={{ color: 'var(--green)' }}>↓ {formatSpeed(transfer.speed)}</span>
            <span>{formatETA(transfer.eta)} remaining</span>
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
          {isPendingStream ? '⏸' : `${transfer.percentage.toFixed(0)}%`}
        </div>
      </div>

      {isPendingStream ? (
        <div className="animate-fade-in" style={{ 
          padding: '12px', background: 'var(--accent-dim)', 
          borderRadius: 8, border: '1px solid var(--accent)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Choose where to save this file to start the transfer</span>
          <button className="btn btn-primary" onClick={onSetLocation} style={{ padding: '6px 12px', fontSize: 12 }}>
            📂 Set Location
          </button>
        </div>
      ) : (
        <div className="progress-track" style={{ height: 8, borderRadius: 4 }}>
          <div className="progress-fill" style={{ height: '100%', width: `${transfer.percentage}%` }} />
        </div>
      )}
    </div>
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 24px',
      borderBottom: '1px solid var(--border)',
      background: age < 3000 ? 'rgba(34, 211, 160, 0.03)' : 'transparent',
      transition: 'background 2s',
    }}>
      <div style={{
        width: 44, height: 44, background: 'var(--surface-2)', borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, flexShrink: 0,
      }}>
        {getFileIcon(file.metadata.type)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 500, fontSize: 14, marginBottom: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {file.metadata.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', gap: 8 }}>
          <span>{formatBytes(file.metadata.size)}</span>
          <span>·</span>
          <span>{file.metadata.type || 'Unknown type'}</span>
          <span>·</span>
          <span>{formatDuration(Date.now() - file.receivedAt)} ago</span>
        </div>
      </div>

      <span className="tag tag-green" style={{ flexShrink: 0 }}>✓ Received</span>

      <button
        className="btn btn-primary"
        onClick={onDownload}
        style={{ padding: '8px 16px', fontSize: 13, flexShrink: 0 }}
      >
        ⬇ Download
      </button>
    </div>
  );
}
