# Huddle — RTC Video Call

A real-time video collaboration web application built with WebRTC, Node.js, and Express.js.

## 🚀 Live Demo

https://rtc-video-call-sm2q.onrender.com

## 📂 GitHub Repository

https://github.com/rsachinkumar005-dev/rtc-video-call

## ✨ Features

- 🎥 Real-time video calling using WebRTC
- 🎙️ Microphone and camera controls
- 🖥️ Screen sharing
- 💬 Real-time chat
- 📁 File sharing
- 📝 Collaborative whiteboard
- 🔐 User registration and login
- 🔑 Forgot password and password reset
- 📧 Password reset emails using Resend API
- 🌐 Deployed on Render

## 🛠️ Tech Stack

### Frontend
- HTML5
- CSS3
- JavaScript
- WebRTC

### Backend
- Node.js
- Express.js

### Services
- Resend API
- Render
- GitHub

## ⚙️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/rsachinkumar005-dev/rtc-video-call.git
cd rtc-video-call

2. Install dependencies
npm install
3. Configure environment variables

Create a .env file in the project root.

Example:

PORT=5000
JWT_SECRET=your_strong_jwt_secret
APP_URL=http://localhost:5000
RESEND_API_KEY=your_resend_api_key
RESEND_FROM=onboarding@resend.dev

Never upload real API keys, passwords, or secrets to GitHub.

4. Start the application
npm start

Open:

http://localhost:5000
🔐 Password Reset

The application includes a complete password-reset system.

Click Forgot Password.
Enter the registered email.
A password reset link is generated.
The link is sent through the Resend API.
The link expires after a limited period.
Create a new password and log in again.
▶️ How to Use
Open the application.
Create an account or log in.
Create or join a video room.
Allow camera and microphone permissions.
Use video, audio, screen sharing, chat, file sharing, and whiteboard features.
🌐 Deployment

The application is deployed on Render and connected to the GitHub main branch.

Production environment variables are configured through the Render dashboard.

🔒 Security
Secrets are stored in environment variables.
.env is excluded through .gitignore.
Password reset tokens expire.
JWT secret is configured through the deployment environment.
API keys and passwords are never committed to GitHub.
🧪 Tested Features
User registration and login
Forgot password
Password reset email
Password reset
Video calling
Camera and microphone
Screen sharing
Chat
File sharing
Whiteboard
Render deployment
🔮 Future Improvements
PostgreSQL database
User profiles
Meeting history
Better room management
Improved mobile responsiveness
Automated tests and CI/CD
👨‍💻 Author

Sachin Kumar

GitHub: https://github.com/rsachinkumar005-dev

📄 License

This project is intended for learning, internship, and educational purposes.