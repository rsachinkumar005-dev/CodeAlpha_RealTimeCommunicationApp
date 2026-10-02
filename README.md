# Huddle: real-time video + collaboration app

Multi-user video calls, screen sharing, file sharing, a shared whiteboard, chat,
encryption and user authentication, built on WebRTC + Socket.io + Express.

## Run it

```bash
npm install
cp .env.example .env        # then set JWT_SECRET to a long random string
npm start                   # or: npm run dev (auto-restart with nodemon)
```

Open http://localhost:5000 in two browser windows (use one normal + one
incognito window so each can have its own account), register two users, and
join the same room ID.

> Browsers only allow camera/mic on **HTTPS or localhost**. To test from a
> phone on your Wi-Fi you need HTTPS (see "Deploying").

## How each requirement is built

| Feature | Where | How |
|---|---|---|
| Multi-user video | `client/app.js` (`createPeer`, `onSignal`) | WebRTC full mesh: every user connects directly to every other user. Good for ~5 people. |
| Signaling | `server/index.js` (`signal` event) | Socket.io relays offers/answers/ICE candidates, only between users in the same room. |
| Screen sharing | `#btn-screen` handler | `getDisplayMedia` + `RTCRtpSender.replaceTrack` (no renegotiation needed). |
| File sharing | `sendFileTo` / `handleIncoming` | Chunked transfer over a WebRTC DataChannel with backpressure. Peer-to-peer, never touches the server. 50 MB limit. |
| Whiteboard | Whiteboard section of `app.js` | Canvas strokes sent as normalised coordinates over Socket.io; the server keeps the room's strokes so late joiners see the board. |
| Authentication | `server/auth.js` | bcrypt (cost 12) password hashes, JWT (12 h), JWT also required for the Socket.io handshake. |
| Encryption in transit | WebRTC + HTTPS | Media and DataChannels use DTLS-SRTP automatically. Use HTTPS in production. |
| End-to-end encryption | `deriveKey`, `encryptBytes` | Optional room passphrase -> PBKDF2 -> AES-GCM-256. Chat messages and file chunks are encrypted in the browser, so the server only sees ciphertext. |
| Hardening | `server/index.js` | helmet (CSP etc.), rate limits on login/register, input validation, room-scoped relaying, size limits. |

## Project layout

```
server/index.js   Express + Socket.io (rooms, signaling, chat, whiteboard)
server/auth.js    register / login / JWT helpers (users stored in server/data/users.json)
client/           index.html, style.css, app.js (no build step)
```

## Deploying (so people on different networks can join)

1. **HTTPS**: put the app behind a host that gives you TLS (Render, Railway,
   Fly.io, or Nginx + Let's Encrypt). Set `CLIENT_ORIGIN` if the frontend is on another domain.
2. **TURN server**: STUN alone fails for users behind strict NATs. Run
   [coturn](https://github.com/coturn/coturn) (or a hosted TURN service) and set
   `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` in `.env`. The server hands these to logged-in users only.
3. Set a strong `JWT_SECRET`.
4. The JSON user file is fine for a project demo. For real use, swap `loadUsers/saveUsers`
   in `server/auth.js` for MongoDB or PostgreSQL.

## Known limits / ideas to extend

- Mesh video gets heavy above ~5 people. To scale, move to an SFU (mediasoup, LiveKit).
- The passphrase is shared out of band; there is no key exchange. Fine for a project,
  but a production design would use proper E2EE key agreement.
- Ideas: raise-hand, recording, room passwords on the server, active-speaker highlight,
  persistent chat history, email verification.
