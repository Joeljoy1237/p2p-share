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
import { Toaster } from 'react-hot-toast';

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
            <Toaster 
              position="bottom-right"
              toastOptions={{
                className: 'glass',
                style: {
                  background: 'rgba(15, 17, 23, 0.8)',
                  color: '#e8eaf6',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(10px)',
                },
                success: {
                  iconTheme: {
                    primary: '#22d3a0',
                    secondary: '#0f1117',
                  },
                },
                error: {
                  iconTheme: {
                    primary: '#f43f5e',
                    secondary: '#0f1117',
                  },
                },
              }}
            />
          </SignalingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
