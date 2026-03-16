import type { Metadata } from 'next';
import { Space_Grotesk as SpaceGrotesk, JetBrains_Mono as JetBrainsMono } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
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

const spaceGrotesk = SpaceGrotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const jetBrainsMono = JetBrainsMono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

import { SignalingProvider } from '@/lib/signaling-context';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${spaceGrotesk.variable} ${jetBrainsMono.variable} antialiased`}>
        <ThemeProvider>
          <SignalingProvider>
            {children}
          </SignalingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
