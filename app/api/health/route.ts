// app/api/health/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'p2p-share',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    features: [
      'webrtc-p2p',
      'chunked-transfer',
      'pause-resume',
      'multi-peer',
      'qr-code',
      'e2e-encrypted',
    ],
  });
}
