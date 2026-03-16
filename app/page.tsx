// app/page.tsx
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ServerStatus from '@/components/ServerStatus';

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length >= 6) {
      router.push(`/receive?room=${code}`);
    }
  };

  return (
    <main className="grid-bg" style={{ minHeight: '100vh' }}>
      {/* Gradient orbs */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0,
      }}>
        <div style={{
          position: 'absolute', top: '-20%', left: '-10%',
          width: '60vw', height: '60vh',
          background: 'radial-gradient(circle, rgba(91,106,247,0.12) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', right: '-10%',
          width: '50vw', height: '50vh',
          background: 'radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', top: '40%', right: '20%',
          width: '30vw', height: '30vh',
          background: 'radial-gradient(circle, rgba(34,211,160,0.06) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Nav */}
        <nav className="glass" style={{
          position: 'sticky', top: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 40px',
          borderTop: 'none', borderLeft: 'none', borderRight: 'none',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36,
              background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>⚡</div>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
              P2P<span style={{ color: 'var(--accent)' }}>Share</span>
            </span>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <ServerStatus />
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href="/send" className="btn btn-ghost" style={{ textDecoration: 'none' }}>
                Send Files
              </Link>
              <Link href="/receive" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Receive Files
              </Link>
            </div>
          </div>
        </nav>

        {/* Hero */}
        <section style={{
          maxWidth: 900, margin: '0 auto', padding: '100px 24px 80px',
          textAlign: 'center',
        }}>
          <div className="tag tag-green animate-fade-in" style={{ marginBottom: 24, display: 'inline-flex' }}>
            <span>●</span> No Upload Limits · No Storage · Encrypted
          </div>

          <h1 className="animate-slide-up" style={{
            fontSize: 'clamp(42px, 6vw, 80px)',
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
            marginBottom: 24,
          }}>
            Transfer files<br />
            <span style={{
              background: 'linear-gradient(90deg, var(--accent), var(--green))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              without limits
            </span>
          </h1>

          <p className="animate-slide-up" style={{
            fontSize: 19, color: 'var(--text-2)', maxWidth: 560, margin: '0 auto 48px',
            lineHeight: 1.6, animationDelay: '0.1s', opacity: 0, animationFillMode: 'forwards',
          }}>
            Business-grade peer-to-peer file sharing using WebRTC. Files go directly
            between devices — never touching a server. Works on local networks and over the internet.
          </p>

          <div className="animate-slide-up" style={{
            display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap',
            animationDelay: '0.2s', opacity: 0, animationFillMode: 'forwards',
          }}>
            <Link href="/send" style={{
              textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 10,
              background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
              color: 'white',
              padding: '16px 32px',
              borderRadius: 'var(--radius-lg)',
              fontSize: 16, fontWeight: 600,
              boxShadow: '0 8px 32px var(--accent-glow)',
              transition: 'all 0.2s',
            }}>
              <span>⬆</span> Start Sending
            </Link>

            <form onSubmit={handleJoin} style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder="Enter room code..."
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                style={{ width: 180, textAlign: 'center', letterSpacing: '0.2em', fontSize: 15 }}
              />
              <button
                type="submit"
                className="btn btn-ghost"
                disabled={joinCode.trim().length < 6}
                style={{ whiteSpace: 'nowrap' }}
              >
                Join Room →
              </button>
            </form>
          </div>
        </section>

        {/* Features grid */}
        <section style={{
          maxWidth: 1100, margin: '0 auto', padding: '0 24px 100px',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 20,
          }}>
            {features.map((f, i) => (
              <FeatureCard key={f.title} {...f} delay={i * 0.05} />
            ))}
          </div>
        </section>

        {/* Architecture diagram */}
        <section style={{
          maxWidth: 900, margin: '0 auto', padding: '0 24px 100px',
        }}>
          <h2 style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em',
            textAlign: 'center', marginBottom: 12,
          }}>How it works</h2>
          <p style={{ textAlign: 'center', color: 'var(--text-2)', marginBottom: 48 }}>
            Your files travel directly between devices using WebRTC DataChannels
          </p>

          <div className="card" style={{ padding: 40 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 20, flexWrap: 'wrap',
            }}>
              {['Sender', '🔒 WebRTC\nDataChannel', 'Receiver'].map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  {i > 0 && (
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}>
                      <div style={{
                        width: 60, height: 2,
                        background: 'linear-gradient(90deg, var(--accent), var(--green))',
                      }} />
                      <span style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
                        ENCRYPTED
                      </span>
                    </div>
                  )}
                  <div style={{
                    background: i === 1 ? 'rgba(91,106,247,0.1)' : 'var(--surface-2)',
                    border: `1px solid ${i === 1 ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: '16px 24px',
                    textAlign: 'center',
                    minWidth: 120,
                  }}>
                    <div style={{ fontSize: i === 1 ? 28 : 24, marginBottom: 8 }}>
                      {i === 0 ? '💻' : i === 1 ? '⚡' : '📱'}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'pre-line', color: i === 1 ? 'var(--accent)' : 'var(--text)' }}>
                      {label}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <hr className="divider" style={{ margin: '32px 0' }} />

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, textAlign: 'center',
            }}>
              {[
                { step: '01', title: 'Create Room', desc: 'Sender creates a room and gets a 6-char code' },
                { step: '02', title: 'Connect', desc: 'Receiver joins using the code — WebRTC handshake happens' },
                { step: '03', title: 'Transfer', desc: 'Files stream directly — chunked, buffered, resumable' },
              ].map((s) => (
                <div key={s.step}>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 8 }}>
                    {s.step}
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{
          borderTop: '1px solid var(--border)',
          padding: '32px 40px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: 'var(--text-3)', fontSize: 13,
          flexWrap: 'wrap', gap: 12,
        }}>
          <span>© 2024 P2PShare — No files stored. Ever.</span>
          <div style={{ display: 'flex', gap: 20 }}>
            <span>WebRTC · DTLS · SRTP</span>
            <span>|</span>
            <span>End-to-End Encrypted</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

const features = [
  {
    icon: '♾️',
    title: 'Unlimited File Size',
    desc: 'Transfer files of any size — movies, archives, disk images. Chunked streaming with backpressure control.',
  },
  {
    icon: '🔒',
    title: 'End-to-End Encrypted',
    desc: 'All data is encrypted with DTLS 1.3 and SRTP. Files never touch our servers.',
  },
  {
    icon: '🌐',
    title: 'Local & Internet',
    desc: 'Blazing fast on local networks. Falls back to TURN relay for internet transfers.',
  },
  {
    icon: '👥',
    title: 'Multi-Peer Rooms',
    desc: 'Share to multiple recipients simultaneously. Create private rooms with passcodes.',
  },
  {
    icon: '⏸️',
    title: 'Pause & Resume',
    desc: 'Transfers can be paused and resumed. Automatic congestion control.',
  },
  {
    icon: '⚡',
    title: 'No Sign-Up',
    desc: 'Open a room, share the code, transfer. No accounts, no tracking, no nonsense.',
  },
];

function FeatureCard({
  icon, title, desc, delay,
}: {
  icon: string; title: string; desc: string; delay: number;
}) {
  return (
    <div className="card animate-slide-up" style={{
      padding: 28, animationDelay: `${delay}s`, opacity: 0, animationFillMode: 'forwards',
    }}>
      <div style={{
        width: 48, height: 48,
        background: 'var(--surface-2)',
        borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, marginBottom: 16,
      }}>
        {icon}
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6 }}>{desc}</p>
    </div>
  );
}
