// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'P2PShare — Business-Grade Peer-to-Peer File Transfer',
  description:
    'Transfer files of any size directly between devices. No servers, no limits, no data stored. Works on local networks and over the internet.',
  keywords: 'p2p file transfer, peer to peer, webrtc, file sharing, secure transfer',
  openGraph: {
    title: 'P2PShare',
    description: 'Transfer files of any size directly between devices.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
