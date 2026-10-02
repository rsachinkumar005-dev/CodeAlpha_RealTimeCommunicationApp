(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const MAX_FILE = 50 * 1024 * 1024; // 50 MB
  const CHUNK = 16 * 1024; // 16 KB chunks are safe for every browser's DataChannel

  const state = {
    token: sessionStorage.getItem("token"),
    user: null,
    socket: null,
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    localStream: null,
    screenStream: null,
    roomId: null,
    selfId: null,
    roomKey: null, // AES-GCM key derived from the room passphrase (or null)
    peers: new Map(), // socketId -> peer object
  };

  /* =====================================================
     Small UI helpers
  ===================================================== */
  const views = { auth: $("#view-auth"), lobby: $("#view-lobby"), room: $("#view-room") };
  function show(name) {
    Object.entries(views).forEach(([k, el]) => (el.hidden = k !== name));
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4500);
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    const res = await fetch("/api" + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  /* =====================================================
     Authentication
  ===================================================== */
  let mode = "login";
  function setMode(m) {
    mode = m;
    $("#tab-login").classList.toggle("active", m === "login");
    $("#tab-register").classList.toggle("active", m === "register");
    $("#name-field").hidden = m !== "register";
    $("#auth-name").required = m === "register";
    $("#auth-submit").textContent = m === "login" ? "Log in" : "Create account";
    $("#auth-password").autocomplete = m === "login" ? "current-password" : "new-password";
    $("#auth-error").textContent = "";
  }
  $("#tab-login").onclick = () => {
    $("#auth-form").hidden = false;
    $("#forgot-form").hidden = true;
    $("#reset-form").hidden = true;
    $("#forgot-password-btn").hidden = false;
    setMode("login");
  };
  $("#tab-register").onclick = () => {
    $("#auth-form").hidden = false;
    $("#forgot-form").hidden = true;
    $("#reset-form").hidden = true;
    $("#forgot-password-btn").hidden = true;
    setMode("register");
  };

  function showLogin() {
    $("#auth-form").hidden = false;
    $("#forgot-form").hidden = true;
    $("#reset-form").hidden = true;
    $("#forgot-password-btn").hidden = false;
    setMode("login");
  }

  $("#forgot-password-btn").onclick = () => {
    $("#auth-form").hidden = true;
    $("#forgot-form").hidden = false;
    $("#reset-form").hidden = true;
    $("#forgot-password-btn").hidden = true;
    $("#forgot-email").value = $("#auth-email").value;
    $("#forgot-message").textContent = "";
    $("#forgot-error").textContent = "";
  };
  $("#back-login-btn").onclick = showLogin;
  $("#reset-back-login-btn").onclick = showLogin;

  $("#forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button[type=submit]");
    btn.disabled = true;
    $("#forgot-error").textContent = "";
    $("#forgot-message").textContent = "";
    try {
      const data = await api("/forgot-password", { method: "POST", body: { email: $("#forgot-email").value } });
      $("#forgot-message").textContent = data.message;
      if (data.devResetUrl) {
        $("#forgot-message").textContent += " Development reset link: " + data.devResetUrl;
      }
    } catch (err) {
      $("#forgot-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = $("#reset-password").value;
    const confirm = $("#reset-password-confirm").value;
    $("#reset-error").textContent = "";
    $("#reset-message").textContent = "";
    if (password !== confirm) return $("#reset-error").textContent = "Passwords do not match";
    const token = new URLSearchParams(location.search).get("reset");
    if (!token) return $("#reset-error").textContent = "Invalid reset link";
    const btn = e.currentTarget.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const data = await api("/reset-password", { method: "POST", body: { token, password } });
      $("#reset-message").textContent = data.message;
      history.replaceState(null, "", location.pathname);
      $("#reset-password").value = "";
      $("#reset-password-confirm").value = "";
      setTimeout(showLogin, 1000);
    } catch (err) {
      $("#reset-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#auth-submit");
    btn.disabled = true;
    $("#auth-error").textContent = "";
    try {
      const body = {
        email: $("#auth-email").value,
        password: $("#auth-password").value,
      };
      if (mode === "register") body.name = $("#auth-name").value;
      const data = await api(mode === "login" ? "/login" : "/register", { method: "POST", body });
      await onAuthenticated(data.token, data.user);
      $("#auth-password").value = "";
    } catch (err) {
      $("#auth-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  function handleResetLink() {
    const token = new URLSearchParams(location.search).get("reset");
    if (!token) return;
    $("#auth-form").hidden = true;
    $("#forgot-form").hidden = true;
    $("#reset-form").hidden = false;
    $("#forgot-password-btn").hidden = true;
  }

  handleResetLink();

  async function onAuthenticated(token, user) {
    state.token = token;
    state.user = user;
    sessionStorage.setItem("token", token);
    $("#lobby-user").textContent = user.name;

    try {
      const { iceServers } = await api("/ice");
      if (iceServers && iceServers.length) state.iceServers = iceServers;
    } catch {
      /* fall back to default STUN */
    }

    connectSocket();
    const fromLink = /room=([a-z0-9-]+)/i.exec(location.hash);
    if (fromLink) $("#room-input").value = fromLink[1];
    show("lobby");
  }

  function logout() {
    leaveRoom(true);
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    state.token = null;
    state.user = null;
    sessionStorage.removeItem("token");
    show("auth");
  }
  $("#logout-btn").onclick = logout;

  /* =====================================================
     Socket.io connection & signaling
  ===================================================== */
  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    const socket = io({ auth: { token: state.token } });
    state.socket = socket;

    socket.on("connect_error", (err) => {
      if (err.message === "unauthorized") {
        toast("Session expired - please log in again");
        logout();
      }
    });

    socket.on("signal", onSignal);

    socket.on("peer-joined", ({ name }) => addSystemMessage(`${name} joined`));

    socket.on("peer-left", ({ id }) => {
      const peer = state.peers.get(id);
      if (peer) addSystemMessage(`${peer.name} left`);
      removePeer(id);
    });

    socket.on("chat", onChat);

    socket.on("draw", (seg) => {
      strokes.push(seg);
      drawSeg(seg);
    });
    socket.on("clear-board", () => {
      strokes = [];
      redraw();
    });

    socket.on("disconnect", () => {
      if (state.roomId) toast("Connection to the server was lost. Reconnecting...");
    });
  }

  /* =====================================================
     Lobby: join a room
  ===================================================== */
  function lobbyError(msg) {
    $("#lobby-error").textContent = msg || "";
  }

  $("#new-room-btn").onclick = () => {
    const letters = "abcdefghjkmnpqrstuvwxyz23456789";
    const rand = (n) =>
      Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => letters[b % letters.length]).join("");
    $("#room-input").value = `${rand(3)}-${rand(4)}-${rand(3)}`;
  };

  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    joinRoom($("#room-input").value, $("#pass-input").value);
  });

  async function getMedia() {
    const attempts = [
      { video: true, audio: true },
      { video: false, audio: true }, // no camera
      { video: true, audio: false }, // no microphone
    ];
    for (const c of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(c);
      } catch (err) {
        console.warn("getUserMedia failed for", c, err);
      }
    }
    throw new Error("Could not access a camera or microphone. Check browser permissions.");
  }

  async function joinRoom(rawId, passphrase) {
    lobbyError("");
    const id = rawId.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(id)) {
      return lobbyError("Room ID must be 3-40 letters, numbers or dashes");
    }
    if (!navigator.mediaDevices || !window.isSecureContext) {
      return lobbyError("Camera access needs HTTPS (or localhost).");
    }

    try {
      state.localStream = await getMedia();
    } catch (err) {
      return lobbyError(err.message);
    }
    state.roomKey = passphrase ? await deriveKey(passphrase, id) : null;

    state.socket.emit("join-room", id, async (res) => {
      if (!res || res.error) {
        stopLocalMedia();
        return lobbyError(res ? res.error : "Could not join the room");
      }
      state.roomId = res.roomId;
      state.selfId = res.selfId;
      history.replaceState(null, "", "#room=" + res.roomId);

      $("#room-title").textContent = res.roomId;
      const badge = $("#enc-badge");
      badge.textContent = state.roomKey
        ? "End-to-end encrypted chat & files"
        : "Chat & files not end-to-end encrypted";
      badge.classList.toggle("secure", !!state.roomKey);
      $("#messages").innerHTML = "";
      $("#grid").innerHTML = "";
      resetControls();

      show("room");
      addLocalTile();

      strokes = res.board || [];
      resizeBoard();

      for (const p of res.peers) createPeer(p.id, p.name, true);
      updateCount();
    });
  }

  /* =====================================================
     Video tiles
  ===================================================== */
  function makeTile(id, label, muted) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.id = "tile-" + id;
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = label; // textContent: never inject names as HTML
    tile.append(video, name);
    $("#grid").appendChild(tile);
    return tile;
  }

  function addLocalTile() {
    const tile = makeTile("local", "You", true);
    tile.querySelector("video").srcObject = state.localStream;
  }

  function updateCount() {
    const n = state.peers.size + 1;
    $("#count").textContent = n === 1 ? "just you" : `${n} people`;
  }

  /* =====================================================
     WebRTC (full mesh)
  ===================================================== */
  function createPeer(id, name, initiator) {
    const pc = new RTCPeerConnection({ iceServers: state.iceServers });
    const peer = {
      id,
      name,
      pc,
      dc: null,
      pending: [],
      incoming: null,
      queue: Promise.resolve(),
      tile: null,
      video: null,
      remote: new MediaStream(),
    };
    state.peers.set(id, peer);

    peer.tile = makeTile(id, name, false);
    peer.video = peer.tile.querySelector("video");
    peer.video.srcObject = peer.remote;

    // Send our audio + (camera or active screen share)
    const stream = state.localStream;
    stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));
    const videoTrack =
      (state.screenStream && state.screenStream.getVideoTracks()[0]) || stream.getVideoTracks()[0];
    if (videoTrack) pc.addTrack(videoTrack, stream);
    else pc.addTransceiver("video", { direction: "sendrecv" }); // lets us screen-share later

    pc.onicecandidate = (e) => {
      if (e.candidate) state.socket.emit("signal", { to: id, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => peer.remote.addTrack(e.track);
    pc.onconnectionstatechange = () => {
      peer.tile.dataset.state = pc.connectionState;
      if (pc.connectionState === "failed") {
        toast(`Could not connect to ${name}. A TURN server may be needed on this network.`);
      }
    };

    if (initiator) {
      setupDataChannel(peer, pc.createDataChannel("files"));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => state.socket.emit("signal", { to: id, data: { sdp: pc.localDescription } }))
        .catch((err) => console.error("offer failed", err));
    } else {
      pc.ondatachannel = (e) => setupDataChannel(peer, e.channel);
    }

    updateCount();
    return peer;
  }

  async function onSignal({ from, name, data }) {
    if (!state.roomId || !data) return;
    const peer = state.peers.get(from) || createPeer(from, name, false);
    const pc = peer.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        while (peer.pending.length) await pc.addIceCandidate(peer.pending.shift());
        if (data.sdp.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          state.socket.emit("signal", { to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else peer.pending.push(data.candidate);
      }
    } catch (err) {
      console.error("signal handling failed", err);
    }
  }

  function removePeer(id) {
    const peer = state.peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    peer.tile.remove();
    state.peers.delete(id);
    updateCount();
  }

  function videoSenders() {
    return [...state.peers.values()]
      .map((p) => p.pc.getTransceivers().find((t) => t.receiver.track && t.receiver.track.kind === "video"))
      .filter(Boolean)
      .map((t) => t.sender);
  }

  /* =====================================================
     Controls: mic, camera, screen share, leave
  ===================================================== */
  function resetControls() {
    for (const id of ["#btn-mic", "#btn-cam"]) $(id).setAttribute("aria-pressed", "true");
    $("#btn-mic").textContent = "Mute";
    $("#btn-cam").textContent = "Stop video";
    $("#btn-screen").setAttribute("aria-pressed", "false");
    $("#btn-screen").textContent = "Share screen";
    $("#btn-board").setAttribute("aria-pressed", "false");
    $("#board-wrap").hidden = true;
    $(".stage").classList.remove("with-board");
  }

  $("#btn-mic").onclick = () => {
    const tracks = state.localStream.getAudioTracks();
    if (!tracks.length) return toast("No microphone available");
    const on = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = on));
    $("#btn-mic").setAttribute("aria-pressed", String(on));
    $("#btn-mic").textContent = on ? "Mute" : "Unmute";
  };

  $("#btn-cam").onclick = () => {
    const tracks = state.localStream.getVideoTracks();
    if (!tracks.length) return toast("No camera available");
    const on = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = on));
    $("#btn-cam").setAttribute("aria-pressed", String(on));
    $("#btn-cam").textContent = on ? "Stop video" : "Start video";
  };

  $("#btn-screen").onclick = async () => {
    if (state.screenStream) return stopScreenShare();
    if (!navigator.mediaDevices.getDisplayMedia) return toast("Screen sharing isn't supported here");
    try {
      state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return; // user cancelled the picker
    }
    const track = state.screenStream.getVideoTracks()[0];
    await Promise.all(videoSenders().map((s) => s.replaceTrack(track)));
    track.onended = stopScreenShare; // browser's own "Stop sharing" bar
    const local = $("#tile-local");
    local.querySelector("video").srcObject = state.screenStream;
    local.classList.add("screen");
    $("#btn-screen").setAttribute("aria-pressed", "true");
    $("#btn-screen").textContent = "Stop sharing";
  };

  async function stopScreenShare() {
    if (!state.screenStream) return;
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
    const cam = state.localStream ? state.localStream.getVideoTracks()[0] || null : null;
    await Promise.all(videoSenders().map((s) => s.replaceTrack(cam).catch(() => {})));
    const local = $("#tile-local");
    if (local) {
      local.querySelector("video").srcObject = state.localStream;
      local.classList.remove("screen");
    }
    $("#btn-screen").setAttribute("aria-pressed", "false");
    $("#btn-screen").textContent = "Share screen";
  }

  function stopLocalMedia() {
    if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }

  function leaveRoom(silent) {
    if (!state.roomId && !state.localStream) return;
    if (state.screenStream) {
      state.screenStream.getTracks().forEach((t) => t.stop());
      state.screenStream = null;
    }
    if (state.socket && state.roomId) state.socket.emit("leave-room");
    [...state.peers.keys()].forEach(removePeer);
    stopLocalMedia();
    state.roomId = null;
    state.roomKey = null;
    strokes = [];
    history.replaceState(null, "", location.pathname);
    $("#grid").innerHTML = "";
    if (!silent) show("lobby");
  }
  $("#btn-leave").onclick = () => leaveRoom(false);

  $("#copy-link").onclick = async () => {
    const link = `${location.origin}/#room=${state.roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied. Share the passphrase separately if you set one.");
    } catch {
      toast(link);
    }
  };

  /* =====================================================
     Encryption helpers (Web Crypto, AES-GCM-256)
  ===================================================== */
  async function deriveKey(passphrase, roomId) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("huddle:" + roomId), iterations: 150000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptBytes(buf) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, state.roomKey, buf);
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), 12);
    return out.buffer;
  }

  async function decryptBytes(buf) {
    const u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, state.roomKey, u.slice(12));
  }

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

  /* =====================================================
     Chat
  ===================================================== */
  function addMessage(who, node, me) {
    const wrap = document.createElement("div");
    wrap.className = "msg" + (me ? " me" : "");
    const w = document.createElement("div");
    w.className = "who";
    w.textContent = who;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.append(node);
    wrap.append(w, bubble);
    const box = $("#messages");
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function addSystemMessage(text) {
    const el = document.createElement("div");
    el.className = "msg system";
    el.textContent = text;
    const box = $("#messages");
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  $("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text || !state.roomId) return;
    input.value = "";
    if (state.roomKey) {
      const data = toB64(await encryptBytes(new TextEncoder().encode(text)));
      state.socket.emit("chat", { enc: true, data });
    } else {
      state.socket.emit("chat", { enc: false, data: text });
    }
  });

  async function onChat(m) {
    let text;
    if (m.enc) {
      try {
        if (!state.roomKey) throw new Error("no key");
        text = new TextDecoder().decode(await decryptBytes(fromB64(m.data)));
      } catch {
        text = "[Encrypted message: missing or wrong passphrase]";
      }
    } else {
      text = m.data;
    }
    addMessage(m.name, document.createTextNode(text), m.from === state.selfId);
  }

  /* =====================================================
     File sharing over the WebRTC DataChannel
  ===================================================== */
  function setupDataChannel(peer, dc) {
    dc.binaryType = "arraybuffer";
    peer.dc = dc;
    dc.onmessage = (e) => {
      // Process messages strictly in order (decryption is async)
      peer.queue = peer.queue.then(() => handleIncoming(peer, e.data)).catch(console.error);
    };
    dc.onclose = () => {
      if (peer.dc === dc) peer.dc = null;
    };
  }

  const safeName = (n) => String(n || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);

  async function handleIncoming(peer, data) {
    if (typeof data === "string") {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.type === "meta") {
        if (!(m.size >= 0) || m.size > MAX_FILE) { peer.incoming = null; return; }
        peer.incoming = { meta: m, chunks: [], failed: false };
      } else if (m.type === "end" && peer.incoming) {
        const { meta, chunks, failed } = peer.incoming;
        peer.incoming = null;
        if (failed) {
          return addSystemMessage(`Could not decrypt "${safeName(meta.name)}" from ${peer.name} (wrong passphrase?)`);
        }
        const blob = new Blob(chunks, { type: "application/octet-stream" });
        addFileMessage(peer.name, meta.name, blob, false);
      }
      return;
    }
    const inc = peer.incoming;
    if (!inc || inc.failed) return;
    let buf = data;
    if (inc.meta.enc) {
      if (!state.roomKey) { inc.failed = true; return; }
      try { buf = await decryptBytes(data); } catch { inc.failed = true; return; }
    }
    inc.chunks.push(buf);
  }

  function addFileMessage(who, name, blob, me) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName(name);
    const kb = Math.max(1, Math.round(blob.size / 1024));
    a.textContent = `${safeName(name)} (${kb} KB)`;
    addMessage(who, a, me);
  }

  function waitForDrain(dc) {
    return new Promise((resolve) => {
      dc.bufferedAmountLowThreshold = 256 * 1024;
      const h = () => {
        dc.removeEventListener("bufferedamountlow", h);
        resolve();
      };
      dc.addEventListener("bufferedamountlow", h);
    });
  }

  async function sendFileTo(peer, file) {
    const dc = peer.dc;
    dc.send(JSON.stringify({ type: "meta", name: file.name, size: file.size, enc: !!state.roomKey }));
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      if (dc.readyState !== "open") return;
      let buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
      if (state.roomKey) buf = await encryptBytes(buf);
      if (dc.bufferedAmount > 1024 * 1024) await waitForDrain(dc);
      dc.send(buf);
    }
    dc.send(JSON.stringify({ type: "end" }));
  }

  $("#btn-file").onclick = () => $("#file-input").click();
  $("#file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE) return toast("Files must be 50 MB or smaller");
    const targets = [...state.peers.values()].filter((p) => p.dc && p.dc.readyState === "open");
    if (!targets.length) return toast("There is nobody connected to send this to yet");
    addFileMessage("You", file.name, file, true);
    for (const p of targets) {
      try { await sendFileTo(p, file); } catch (err) { console.error(err); }
    }
  });

  /* =====================================================
     Whiteboard (normalised coordinates, synced over Socket.io)
  ===================================================== */
  const canvas = $("#board");
  const ctx = canvas.getContext("2d");
  let strokes = [];
  let drawing = false;
  let last = null;
  const tool = { eraser: false };

  function resizeBoard() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    redraw();
  }
  new ResizeObserver(resizeBoard).observe(canvas);

  function drawSeg(s) {
    const dpr = window.devicePixelRatio || 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size * dpr;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s.x0 * canvas.width, s.y0 * canvas.height);
    ctx.lineTo(s.x1 * canvas.width, s.y1 * canvas.height);
    ctx.stroke();
  }

  function redraw() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(drawSeg);
  }

  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function currentStyle() {
    return tool.eraser
      ? { color: "#ffffff", size: 18 }
      : { color: $("#board-color").value, size: +$("#board-size").value };
  }

  function emitSeg(a, b) {
    const seg = { x0: a.x, y0: a.y, x1: b.x, y1: b.y, ...currentStyle() };
    strokes.push(seg);
    drawSeg(seg);
    if (state.socket) state.socket.emit("draw", seg);
  }

  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    last = pointer(e);
    emitSeg(last, last); // a dot for single clicks
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = pointer(e);
    emitSeg(last, p);
    last = p;
  });
  const endStroke = () => { drawing = false; last = null; };
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  $("#btn-board").onclick = () => {
    const wrap = $("#board-wrap");
    wrap.hidden = !wrap.hidden;
    $("#btn-board").setAttribute("aria-pressed", String(!wrap.hidden));
    $(".stage").classList.toggle("with-board", !wrap.hidden);
    if (!wrap.hidden) requestAnimationFrame(resizeBoard);
  };

  $("#board-eraser").onclick = () => {
    tool.eraser = !tool.eraser;
    $("#board-eraser").setAttribute("aria-pressed", String(tool.eraser));
  };
  $("#board-color").addEventListener("input", () => {
    tool.eraser = false;
    $("#board-eraser").setAttribute("aria-pressed", "false");
  });
  $("#board-clear").onclick = () => {
    if (confirm("Clear the whiteboard for everyone in the room?")) state.socket.emit("clear-board");
  };
  $("#board-save").onclick = () => {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `whiteboard-${state.roomId || "room"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };

  /* =====================================================
     Boot
  ===================================================== */
  window.addEventListener("beforeunload", () => {
    if (state.socket && state.roomId) state.socket.emit("leave-room");
  });

  (async function boot() {
    setMode("login");
    if (!state.token) return show("auth");
    try {
      const { user } = await api("/me");
      await onAuthenticated(state.token, user);
    } catch {
      sessionStorage.removeItem("token");
      state.token = null;
      show("auth");
    }
  })();
})();
