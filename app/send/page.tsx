// app/send/page.tsx
'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useSignaling } from '@/lib/use-signaling';
import { formatBytes, formatSpeed, formatETA, getFileIcon, getFileExtension, generateShareUrl, generateQRCode } from '@/lib/utils';

export default function SendPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [qrCode, setQrCode] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    status,
    room,
    connectedPeers,
    transfers,
    createRoom,
    leaveRoom,
    sendFiles,
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
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name + f.size));
        return [...prev, ...dropped.filter((f) => !existing.has(f.name + f.size))];
      });
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...selected.filter((f) => !existing.has(f.name + f.size))];
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (files.length > 0 && connectedPeers.length > 0) {
      sendFiles(files);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const isTransferring = [...transfers.values()].some((t) => t.status === 'transferring');
  const allCompleted = [...transfers.values()].every((t) => t.status === 'completed');

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
          <ConnectionBadge status={status} peers={connectedPeers.length} />
          {isInRoom && (
            <button onClick={leaveRoom} className="btn btn-ghost" style={{ fontSize: 13 }}>
              Leave Room
            </button>
          )}
        </div>
      </header>

      <div style={{
        maxWidth: 1200, margin: '0 auto', padding: '32px 24px',
        display: 'grid', gridTemplateColumns: isInRoom ? '1fr 380px' : '1fr',
        gap: 24, alignItems: 'start',
      }}>

        {/* Left: File Drop + List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Room creation (if not in room) */}
          {!isInRoom && (
            <div className="card animate-slide-up" style={{ padding: 32 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Create a Transfer Room</h2>
              <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 24 }}>
                A secure room will be created. Share the code or QR with recipients.
              </p>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Room Password (optional)
                  </label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Leave blank for public room"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateRoom}
                  disabled={status === 'connecting'}
                  style={{ padding: '12px 28px', fontSize: 15 }}
                >
                  {status === 'connecting' ? (
                    <>
                      <span className="animate-spin-slow" style={{ display: 'inline-block' }}>⟳</span>
                      Creating...
                    </>
                  ) : (
                    <>⚡ Create Room</>
                  )}
                </button>
              </div>

              {error && (
                <div style={{
                  marginTop: 16, padding: 12, background: 'var(--red-dim)',
                  border: '1px solid rgba(244,63,94,0.3)', borderRadius: 8,
                  color: 'var(--red)', fontSize: 13,
                }}>
                  ⚠ {error}
                </div>
              )}
            </div>
          )}

          {/* Drop Zone */}
          <div
            className={`drop-zone ${isDragging ? 'active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              padding: files.length === 0 ? '64px 32px' : '24px 32px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s',
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
              <>
                <div className="animate-float" style={{ fontSize: 56, marginBottom: 16 }}>
                  {isDragging ? '📂' : '📁'}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                  {isDragging ? 'Drop files here' : 'Drop files or click to browse'}
                </div>
                <div style={{ color: 'var(--text-2)', fontSize: 14 }}>
                  Any file type · Any size · Multiple files supported
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
                + Drop more files here
              </div>
            )}
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="card animate-fade-in" style={{ overflow: 'hidden' }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <span style={{ fontWeight: 600, marginRight: 8 }}>
                    {files.length} file{files.length !== 1 ? 's' : ''}
                  </span>
                  <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
                    ({formatBytes(totalSize)} total)
                  </span>
                </div>
                <button
                  onClick={() => setFiles([])}
                  style={{ fontSize: 12, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Clear all
                </button>
              </div>

              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {files.map((file, i) => {
                  const transferId = [...transfers.values()].find(
                    (t) => t.fileName === file.name
                  );
                  return (
                    <FileRow
                      key={i}
                      file={file}
                      transfer={transferId}
                      onRemove={() => removeFile(i)}
                    />
                  );
                })}
              </div>

              {/* Send button */}
              <div style={{
                padding: '16px 20px',
                borderTop: '1px solid var(--border)',
                display: 'flex', gap: 12, alignItems: 'center',
              }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSend}
                  disabled={!isInRoom || connectedPeers.length === 0 || isTransferring}
                  style={{ flex: 1, padding: '14px', fontSize: 15 }}
                >
                  {isTransferring ? (
                    <>
                      <span className="animate-spin-slow" style={{ display: 'inline-block' }}>⟳</span>
                      Transferring...
                    </>
                  ) : allCompleted && transfers.size > 0 ? (
                    '✓ All Sent!'
                  ) : !isInRoom ? (
                    'Create a room first'
                  ) : connectedPeers.length === 0 ? (
                    'Waiting for receiver...'
                  ) : (
                    `⬆ Send to ${connectedPeers.length} peer${connectedPeers.length !== 1 ? 's' : ''}`
                  )}
                </button>

                {isTransferring && (
                  <button
                    className="btn btn-danger"
                    onClick={cancelTransfer}
                  >
                    Pause
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Room info panel */}
        {isInRoom && room && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Room code */}
            <div className="card animate-fade-in" style={{ padding: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Room Code
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 36, fontWeight: 700, letterSpacing: '0.25em',
                    color: 'var(--accent)',
                    background: 'rgba(91,106,247,0.08)',
                    border: '1px solid rgba(91,106,247,0.2)',
                    borderRadius: 12, padding: '16px 20px',
                    textAlign: 'center', cursor: 'pointer',
                    userSelect: 'all',
                  }}
                  onClick={() => copyToClipboard(room.code)}
                  title="Click to copy"
                >
                  {room.code}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => copyToClipboard(shareUrl)}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {copied ? '✓ Copied!' : '🔗 Copy Share Link'}
                </button>
              </div>
            </div>

            {/* QR Code */}
            {qrCode && (
              <div className="card animate-fade-in" style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Scan to Join
                </div>
                <div style={{
                  display: 'inline-block', padding: 12,
                  background: 'white', borderRadius: 12,
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrCode} alt="QR Code" style={{ width: 180, height: 180, display: 'block' }} />
                </div>
              </div>
            )}

            {/* Peers */}
            <div className="card animate-fade-in" style={{ padding: 24 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                Connected Peers
              </div>

              {connectedPeers.length === 0 ? (
                <div style={{
                  padding: '20px', textAlign: 'center',
                  border: '1px dashed var(--border)', borderRadius: 10,
                }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
                  <div style={{ fontSize: 14, color: 'var(--text-2)' }}>Waiting for receivers...</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Share the code above</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {connectedPeers.map((peerId) => (
                    <div key={peerId} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', background: 'var(--surface-2)',
                      borderRadius: 8,
                    }}>
                      <div className="status-dot connected" />
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)', flex: 1 }}>
                        {peerId.slice(0, 8)}...
                      </span>
                      <span className="tag tag-green">Online</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Transfer stats */}
            {transfers.size > 0 && (
              <div className="card animate-fade-in" style={{ padding: 24 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Transfer Progress
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {[...transfers.values()].map((t) => (
                    <TransferProgressCard key={t.fileId} transfer={t} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionBadge({ status, peers }: { status: string; peers: number }) {
  const statusMap: Record<string, { label: string; cls: string }> = {
    disconnected: { label: 'Disconnected', cls: 'tag-amber' },
    connecting: { label: 'Connecting...', cls: 'tag-amber' },
    connected: { label: `${peers} peer${peers !== 1 ? 's' : ''} connected`, cls: peers > 0 ? 'tag-green' : 'tag-blue' },
    transferring: { label: 'Transferring', cls: 'tag-blue' },
    error: { label: 'Error', cls: 'tag-red' },
  };
  const s = statusMap[status] || statusMap['disconnected'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className={`status-dot ${status === 'connected' || status === 'transferring' ? 'connected' : status === 'error' ? 'error' : 'connecting'}`} />
      <span className={`tag ${s.cls}`}>{s.label}</span>
    </div>
  );
}

function FileRow({
  file,
  transfer,
  onRemove,
}: {
  file: File;
  transfer?: { percentage: number; speed: number; eta: number; status: string } | undefined;
  onRemove: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 20px',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: 42, height: 42, background: 'var(--surface-2)', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0,
      }}>
        {getFileIcon(file.type)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 500, fontSize: 14, marginBottom: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {file.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', gap: 8 }}>
          <span>{formatBytes(file.size)}</span>
          <span>·</span>
          <span>{getFileExtension(file.name)}</span>
          {transfer && transfer.status === 'transferring' && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--accent)' }}>{formatSpeed(transfer.speed)}</span>
              <span>·</span>
              <span>{formatETA(transfer.eta)} left</span>
            </>
          )}
        </div>

        {transfer && (
          <div style={{ marginTop: 6 }}>
            <div className="progress-track" style={{ height: 4 }}>
              <div
                className="progress-fill"
                style={{ height: '100%', width: `${transfer.percentage}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {transfer?.status === 'completed' ? (
        <span className="tag tag-green">✓ Done</span>
      ) : (
        <button
          onClick={onRemove}
          style={{
            width: 28, height: 28, background: 'none', border: '1px solid var(--border)',
            borderRadius: 6, cursor: 'pointer', color: 'var(--text-3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function TransferProgressCard({
  transfer,
}: {
  transfer: { fileId: string; fileName: string; totalSize: number; transferredBytes: number; percentage: number; speed: number; eta: number; status: string };
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
          {transfer.fileName}
        </span>
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
          {transfer.percentage.toFixed(0)}%
        </span>
      </div>
      <div className="progress-track" style={{ height: 6, marginBottom: 6 }}>
        <div className="progress-fill" style={{ height: '100%', width: `${transfer.percentage}%` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)' }}>
        <span>{formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.totalSize)}</span>
        <span>{transfer.speed > 0 ? formatSpeed(transfer.speed) : '—'}</span>
      </div>
    </div>
  );
}
