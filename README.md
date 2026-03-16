# P2PShare ⚡

**P2PShare** is a high-performance, business-grade Peer-to-Peer (P2P) file transfer application built with Next.js and WebRTC. It allows for direct, secure, and limitless file sharing between devices without any intermediate server storage.

![P2PShare Screenshot](https://raw.githubusercontent.com/Joeljoy1237/p2p-share/main/public/og-image.png)

## 🚀 Key Features

- **Direct P2P Transfers**: Files go directly from sender to receiver using WebRTC data channels.
- **No Size Limits**: Share files of any size (GBs or TBs) without worrying about server bandwidth or storage limits.
- **End-to-End Encrypted**: Data is encrypted using DTLS 1.3 and SRTP, ensuring only the intended recipient can access the files.
- **Direct-to-Disk Streaming**: Large files can be streamed directly to the receiver's disk using the FileSystem Writable Stream API, preventing browser crashes.
- **Secure Rooms**: Create password-protected transfer rooms for private sharing.
- **QR Code Integration**: Easily join rooms on mobile devices by scanning a generated QR code.
- **Real-time Monitoring**:
  - Live transfer progress with speed and ETA.
  - Server health status and pulse monitoring.
  - Multi-peer support with live connection notifications.
- **Resumable Transfers**: Support for pausing and resuming active file transfers.

## 📍 Application Routes

| Route | Name | Description |
| :--- | :--- | :--- |
| `/` | **Home** | The entry point of the application. Provides room discovery, quick join via code, and navigation to send/receive modes. |
| `/send` | **Send Files** | The sender interface. Here you can create rooms, set passwords, drag-and-drop files, and manage outgoing transfers. |
| `/receive` | **Receive Files** | The receiver interface. Supports joining rooms via URL/code, QR code scanning, and direct-save directory selection. |

## 🛠️ Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Communication**: [Socket.io](https://socket.io/) (Signaling Server)
- **P2P Engine**: WebRTC (DataChannels)
- **Styling**: Vanilla CSS (Premium design system)
- **Animations**: [Framer Motion](https://www.framer.com/motion/)

## 🏗️ Architecture

P2PShare uses a **Signaling Server** to help peers find each other and exchange WebRTC session descriptions. Once the connection is established:
1. The signaling server is no longer involved in the data transfer.
2. An encrypted **DataChannel** is opened directly between peers.
3. Files are sliced into chunks and sent over the channel.

## 🏁 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Joeljoy1237/p2p-share.git
   cd p2p-share
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables in `.env.local`:
   ```env
   NEXT_PUBLIC_SIGNAL_URL=http://localhost:3001
   SIGNAL_PORT=3001
   ```

### Running the Application

1. **Start the Signaling Server**:
   ```bash
   npm run server
   ```

2. **Start the Development App**:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🔒 Security Measures

The application is hardened with several security best practices:
- **Rate Limiting**: Protection against DoS attacks on the signaling server (max 10 rooms/min, 60 joins/min).
- **Input Sanitization**: All room codes and signaling data are sanitized before processing.
- **Memory Management**: Automatic cleanup of expired rooms and rate-limit states.
- **Peer Isolation**: Signaling messages are only relayed between verified peers in the same room.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
