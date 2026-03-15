// app/receive/page.tsx
'use client';
import { useState, useEffect, Suspense } from 'react';
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

  const {
    status,
    room,
    connectedPeers,
    transfers,
    receivedFiles,
    joinRoom,
    leaveRoom,
    error,
  } = useSignaling();

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
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.metadata.name;
    a.click();
  };

  const downloadAll = () => {
    receivedFiles.forEach((file) => {
      setTimeout(() => downloadFile(file), 100);
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
                <ActiveTransferRow key={t.fileId} transfer={t} />
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
          {transfer.percentage.toFixed(0)}%
        </div>
      </div>

      <div className="progress-track" style={{ height: 8, borderRadius: 4 }}>
        <div className="progress-fill" style={{ height: '100%', width: `${transfer.percentage}%` }} />
      </div>
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
