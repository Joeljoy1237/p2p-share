'use client';
import { useState, useEffect } from 'react';
import { useSignaling } from '@/lib/use-signaling';

export default function ServerStatus() {
  const { checkServerHealth, status } = useSignaling();
  const [serverState, setServerState] = useState<{
    alive: boolean;
    checking: boolean;
    stats?: any;
    lastChecked?: Date;
  }>({
    alive: false,
    checking: true,
  });

  const check = async () => {
    setServerState(prev => ({ ...prev, checking: true }));
    const result = await checkServerHealth();
    setServerState({
      alive: result.alive,
      checking: false,
      stats: result.stats,
      lastChecked: new Date(),
    });
  };

  useEffect(() => {
    check();
    // Auto check every 30 seconds
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass" style={{
      padding: '8px 16px',
      borderRadius: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 13,
      border: '1px solid var(--border)',
      background: 'rgba(255, 255, 255, 0.03)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: serverState.alive ? 'var(--green)' : 'var(--red)',
          boxShadow: serverState.alive ? '0 0 8px var(--green)' : '0 0 8px var(--red)',
          animation: serverState.checking ? 'pulse 1s infinite' : 'none'
        }} />
        <span style={{ fontWeight: 500, color: 'var(--text-2)' }}>
          Server {serverState.alive ? 'Online' : 'Offline'}
        </span>
      </div>

      {serverState.alive && serverState.stats && (
        <div style={{ display: 'flex', gap: 12, color: 'var(--text-3)', fontSize: 11, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
          <span>Rooms: {Math.floor(serverState.stats.rooms)}</span>
          <span className="hide-mobile">Uptime: {Math.floor(serverState.stats.uptime / 60)}m</span>
        </div>
      )}

      <button
        onClick={check}
        disabled={serverState.checking}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent)',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.2s',
          transform: serverState.checking ? 'rotate(360deg)' : 'none',
        }}
        title="Refresh Status"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 2v6h-6" />
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M3 22v-6h6" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
      </button>

      <style jsx>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
        @media (max-width: 600px) {
          .hide-mobile { display: none; }
        }
      `}</style>
    </div>
  );
}
