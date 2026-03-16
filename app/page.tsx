'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  Zap, 
  ArrowUp, 
  ArrowRight, 
  Infinity as InfinityIcon, 
  Lock, 
  Globe, 
  Users, 
  Pause, 
  Laptop, 
  Smartphone,
  ShieldCheck,
  ZapOff
} from 'lucide-react';
import ServerStatus from '@/components/ServerStatus';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length >= 5) {
      router.push(`/receive?room=${code}`);
    }
  };

  return (
    <main className="grid-bg min-h-screen relative overflow-hidden">
      {/* Animated Gradient mesh orbs */}
      <div className="gradient-orbs">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.08, 0.12, 0.08], x: [0, 60, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="gradient-orb gradient-orb--indigo"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.06, 0.10, 0.06], y: [0, -50, 0], x: [0, -40, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
          className="gradient-orb gradient-orb--purple"
        />
        <motion.div
          animate={{ scale: [1, 1.08, 1], opacity: [0.04, 0.07, 0.04] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          className="gradient-orb gradient-orb--teal"
        />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Navigation */}
        <nav className="glass sticky top-0 z-50 flex items-center justify-between px-6 md:px-10 py-3.5 border-b border-border border-t-0 border-x-0">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ scale: 1.05, rotate: 2 }}
              className="w-10 h-10 bg-gradient-to-br from-accent to-accent-2 rounded-xl flex items-center justify-center shadow-[0_0_20px_var(--color-accent-glow)]"
            >
              <Zap className="w-5 h-5 text-white" />
            </motion.div>
            <span className="text-xl font-bold tracking-tight">
              P2P<span className="text-accent">Share</span>
            </span>
          </div>

          <div className="flex gap-4 items-center">
            <ServerStatus />
            <div className="hidden md:flex gap-3">
              <Button variant="ghost" onClick={() => router.push('/send')}>
                Send Files
              </Button>
              <Button variant="primary" onClick={() => router.push('/receive')}>
                Receive Files
              </Button>
            </div>
          </div>
        </nav>

        {/* Hero */}
        <section className="max-w-4xl mx-auto px-6 pt-28 sm:pt-36 pb-20 sm:pb-28 text-center">
          <motion.div {...fadeUp(0)}>
            <div className="tag tag-green mb-8 inline-flex px-5 py-2.5 border border-[rgba(34,211,160,0.2)]">
              <span className="w-2 h-2 rounded-full bg-green mr-2.5 shadow-[0_0_6px_rgba(34,211,160,0.5)]" />
              <span className="tracking-wider">No Upload Limits · No Storage · Encrypted</span>
            </div>
          </motion.div>

          <motion.h1
            {...fadeUp(0.1)}
            className="text-[clamp(40px,6vw,80px)] font-bold leading-[1.05] tracking-tighter mb-7"
          >
            Transfer files<br />
            <span className="bg-gradient-to-r from-accent via-[#8b5cf6] to-green bg-clip-text text-transparent animate-gradient-shift drop-shadow-[0_0_30px_rgba(91,106,247,0.3)]">
              without limits
            </span>
          </motion.h1>

          <motion.p
            {...fadeUp(0.2)}
            className="text-lg md:text-xl text-text-2 max-w-2xl mx-auto mb-14 leading-relaxed"
          >
            Business-grade peer-to-peer file sharing using WebRTC. Files go directly
            between devices — never touching a server. Works on local networks and over the internet.
          </motion.p>

          <motion.div
            {...fadeUp(0.3)}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <Button
              size="lg"
              className="w-full sm:w-auto text-base px-10 py-4 shadow-[0_8px_32px_var(--color-accent-glow)]"
              onClick={() => router.push('/send')}
            >
              <ArrowUp className="w-5 h-5 mr-1" /> Start Sending
            </Button>

            <form onSubmit={handleJoin} className="flex gap-3 w-full sm:w-auto group">
              <input
                className="input text-center tracking-widest uppercase font-mono !w-[180px]"
                placeholder="ROOM CODE"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
              />
              <Button
                type="submit"
                variant="ghost"
                size="md"
                disabled={joinCode.trim().length < 5}
                className="whitespace-nowrap flex-1 sm:flex-none"
              >
                Join Room <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </form>
          </motion.div>
        </section>

        {/* Features grid */}
        <section className="max-w-[1100px] mx-auto px-6 pb-28 sm:pb-36">
          <motion.div
            variants={stagger}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: '-80px' }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {features.map((f, i) => (
              <FeatureCard key={f.title} {...f} index={i} />
            ))}
          </motion.div>
        </section>

        {/* Architecture diagram */}
        <section className="max-w-4xl mx-auto px-6 pb-28 sm:pb-36">
          <motion.div {...fadeUp(0)} className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              How it works
            </h2>
            <p className="text-text-2 max-w-lg mx-auto">
              Your files travel directly between devices using WebRTC DataChannels — no middleman
            </p>
          </motion.div>

          <Card glass className="p-8 md:p-12">
            <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8 flex-wrap mb-10">
              {[
                { label: 'Sender', icon: <Laptop className="w-10 h-10" /> },
                { label: '🔒 WebRTC\nDataChannel', icon: <Zap className="w-10 h-10" />, active: true },
                { label: 'Receiver', icon: <Smartphone className="w-10 h-10" /> }
              ].map((item, i) => (
                <div key={i} className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
                  {i > 0 && (
                    <div className="flex flex-col items-center gap-1.5 md:rotate-0 rotate-90 my-2 md:my-0">
                      <div className="w-14 h-0.5 bg-gradient-to-r from-accent to-green rounded-full" />
                      <span className="text-[9px] text-text-3 tracking-[0.2em] font-mono uppercase">
                        Encrypted
                      </span>
                    </div>
                  )}
                  <div className={`
                    rounded-2xl p-6 text-center min-w-[140px] border transition-all duration-300
                    ${item.active
                      ? 'bg-accent-dim border-[rgba(91,106,247,0.25)] shadow-[0_0_30px_var(--color-accent-glow)]'
                      : 'bg-[rgba(255,255,255,0.02)] border-border hover:border-border-2 hover:bg-[rgba(255,255,255,0.04)]'}
                  `}>
                    <div className={`flex items-center justify-center mb-4 ${item.active ? 'text-accent animate-float' : 'text-text-2'}`}>
                      {item.icon}
                    </div>
                    <div className={`text-sm font-semibold whitespace-pre-line tracking-wide ${item.active ? 'text-accent' : 'text-text'}`}>
                      {item.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <hr className="divider my-8" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              {[
                { step: '01', title: 'Create Room', desc: 'Sender creates a room and gets a 6-char code' },
                { step: '02', title: 'Connect', desc: 'Receiver joins using the code — WebRTC handshake happens' },
                { step: '03', title: 'Transfer', desc: 'Files stream directly — chunked, buffered, resumable' },
              ].map((s) => (
                <motion.div
                  key={s.step}
                  {...fadeUp(0)}
                  className="flex flex-col items-center"
                >
                  <div className="mono text-accent text-[10px] font-bold mb-3 tracking-[0.15em] bg-accent-dim px-3 py-1.5 rounded-lg border border-[rgba(91,106,247,0.15)]">
                    STEP {s.step}
                  </div>
                  <div className="font-semibold mb-2 text-[15px]">{s.title}</div>
                  <div className="text-sm text-text-2 leading-relaxed max-w-[240px]">{s.desc}</div>
                </motion.div>
              ))}
            </div>
          </Card>
        </section>

        {/* Footer */}
        <footer className="mt-auto border-t border-border px-6 md:px-10 py-8 flex items-center justify-between text-[13px] text-text-3 flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" />
            <span>© 2024 P2PShare — No files stored. Ever.</span>
          </div>
          <div className="flex gap-4 items-center font-mono text-[11px]">
            <span>WebRTC · DTLS · SRTP</span>
            <span className="opacity-30">|</span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-green" /> End-to-End Encrypted
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}

const iconColors: Record<string, string> = {
  InfinityIcon: 'from-accent/20 to-accent/5 border-[rgba(91,106,247,0.15)] text-accent',
  Lock: 'from-[rgba(124,58,237,0.2)] to-[rgba(124,58,237,0.05)] border-[rgba(124,58,237,0.15)] text-[#8b5cf6]',
  Globe: 'from-green/20 to-green/5 border-[rgba(34,211,160,0.15)] text-green',
  Users: 'from-amber/20 to-amber/5 border-[rgba(245,158,11,0.15)] text-amber',
  Pause: 'from-[rgba(236,72,153,0.15)] to-[rgba(236,72,153,0.05)] border-[rgba(236,72,153,0.12)] text-[#ec4899]',
  ZapOff: 'from-accent/20 to-accent-2/10 border-[rgba(91,106,247,0.15)] text-accent',
};

const features = [
  {
    icon: <InfinityIcon className="w-6 h-6" />,
    iconKey: 'InfinityIcon',
    title: 'Unlimited File Size',
    desc: 'Transfer files of any size — movies, archives, disk images. Chunked streaming with backpressure control.',
  },
  {
    icon: <Lock className="w-6 h-6" />,
    iconKey: 'Lock',
    title: 'End-to-End Encrypted',
    desc: 'All data is encrypted with DTLS 1.3 and SRTP. Files never touch our servers.',
  },
  {
    icon: <Globe className="w-6 h-6" />,
    iconKey: 'Globe',
    title: 'Local & Internet',
    desc: 'Blazing fast on local networks. Falls back to TURN relay for internet transfers.',
  },
  {
    icon: <Users className="w-6 h-6" />,
    iconKey: 'Users',
    title: 'Multi-Peer Rooms',
    desc: 'Share to multiple recipients simultaneously. Create private rooms with passcodes.',
  },
  {
    icon: <Pause className="w-6 h-6" />,
    iconKey: 'Pause',
    title: 'Pause & Resume',
    desc: 'Transfers can be paused and resumed. Automatic congestion control.',
  },
  {
    icon: <ZapOff className="w-6 h-6" />,
    iconKey: 'ZapOff',
    title: 'No Sign-Up',
    desc: 'Open a room, share the code, transfer. No accounts, no tracking, no nonsense.',
  },
];

function FeatureCard({
  icon, iconKey, title, desc, index,
}: {
  icon: React.ReactNode; iconKey: string; title: string; desc: string; index: number;
}) {
  const colorClass = iconColors[iconKey] || 'from-surface-2 to-surface-2 border-border';

  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 30 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
      }}
    >
      <Card className="p-7 h-full group cursor-default">
        <div className={`icon-badge w-14 h-14 bg-gradient-to-br ${colorClass} mb-6 group-hover:scale-105 group-hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-300`}>
          {icon}
        </div>
        <h3 className="text-lg font-bold mb-2.5 tracking-tight group-hover:text-accent transition-colors duration-300">
          {title}
        </h3>
        <p className="text-text-2 leading-relaxed text-[14px]">{desc}</p>
      </Card>
    </motion.div>
  );
}
