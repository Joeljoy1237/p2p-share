'use client';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Activity, Network } from 'lucide-react';
import { useSignaling } from '@/lib/use-signaling';

export default function ServerStatus() {
  const { checkServerHealth } = useSignaling();
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
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass flex items-center gap-3 px-4 py-2 rounded-full text-[13px] border border-border bg-[rgba(255,255,255,0.02)]">
      <div className="flex items-center gap-2">
        <div className={`status-dot ${serverState.alive ? 'connected' : 'error'} ${serverState.checking ? 'animate-pulse' : ''}`} />
        <span className="font-medium text-text-2">
          {serverState.alive ? 'Server Online' : 'Server Offline'}
        </span>
      </div>

      {serverState.alive && serverState.stats && (
        <div className="hidden sm:flex items-center gap-3 text-text-3 text-[11px] border-l border-border pl-3 font-mono">
          <span className="flex items-center gap-1">
            <Network className="w-3 h-3" /> {Math.floor(serverState.stats.rooms)}
          </span>
          <span className="hidden md:flex items-center gap-1">
            <Activity className="w-3 h-3" /> {Math.floor(serverState.stats.uptime / 60)}m
          </span>
        </div>
      )}

      <motion.button
        onClick={check}
        disabled={serverState.checking}
        whileHover={{ rotate: 180 }}
        whileTap={{ scale: 0.85 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="text-accent cursor-pointer p-1 flex items-center justify-center disabled:opacity-40 border-none bg-transparent outline-none"
        title="Refresh Status"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${serverState.checking ? 'animate-spin' : ''}`} />
      </motion.button>
    </div>
  );
}
