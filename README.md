# Huddle --- Real-Time Video & Collaboration App

A real-time multi-user video conferencing and collaboration web app
built with **WebRTC, Socket.io, Express.js and Node.js**.

## 🚀 Live Demo

**https://rtc-video-call-sm2q.onrender.com**

> The free Render service may sleep after inactivity, so the first
> request can take a little longer to load.

## ✨ Features

-   🎥 Multi-user video calling with WebRTC
-   🎤 Microphone and camera controls
-   🖥️ Screen sharing
-   💬 Real-time chat
-   📁 Peer-to-peer file sharing
-   📝 Shared whiteboard
-   🔐 User registration and login
-   🔑 JWT-based authentication
-   🔒 Password hashing with bcrypt
-   🛡️ Security hardening with Helmet and rate limiting
-   🔐 Optional room passphrase encryption for chat and file data
-   📱 Works in modern desktop and mobile browsers

## 🛠️ Tech Stack

**Frontend** - HTML - CSS - JavaScript - WebRTC

**Backend** - Node.js - Express.js - Socket.io

**Authentication & Security** - JWT - bcrypt - Helmet - CORS - Express
Rate Limit

**Deployment** - GitHub - Render

## 📁 Project Structure

``` text
rtc-app/
├── client/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── server/
│   ├── index.js
│   └── auth.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

## 💻 Run Locally

### 1. Clone the repository

``` bash
git clone https://github.com/rsachinkumar005-dev/rtc-video-call.git
cd rtc-video-call
```

### 2. Install dependencies

``` bash
npm install
```

### 3. Create the environment file

Create a `.env` file from `.env.example` and set a strong JWT secret.

``` env
PORT=5000
JWT_SECRET=your-long-random-secret
CLIENT_ORIGIN=
MAX_PEERS=6
```

### 4. Start the server

``` bash
npm start
```

Open:

``` text
http://localhost:5000
```

For local testing, open the app in two browser windows and join the same
room with different accounts.

## 🌐 Deployment

This project is deployed as a Node.js Web Service on Render.

-   Repository: https://github.com/rsachinkumar005-dev/rtc-video-call
-   Live Demo: https://rtc-video-call-sm2q.onrender.com

The application uses Socket.io for real-time signaling and WebRTC for
peer-to-peer media/data connections.

## 🔐 Security Notes

-   `.env` is excluded from Git using `.gitignore`.
-   Passwords are stored as bcrypt hashes rather than plain text.
-   JWT authentication is used for authenticated sessions and Socket.io
    connections.
-   Helmet and rate limiting provide additional server-side protection.
-   Never commit real secrets, API keys, or production credentials to
    GitHub.

## 📌 Project Limitations

-   WebRTC mesh connections become more resource-intensive as the room
    size increases.
-   For large-scale video conferencing, an SFU architecture such as
    LiveKit or mediasoup would be more suitable.
-   A TURN server may be required for some restrictive network/NAT
    environments.

## 👨‍💻 Author

**Sachin Kumar**

GitHub: https://github.com/rsachinkumar005-dev

------------------------------------------------------------------------

⭐ If you find this project useful, consider starring the repository.
