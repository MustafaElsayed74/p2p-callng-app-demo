// WebRTC App-to-App Calling Client Logic (High Performance & Direct Socket Routing)

const socket = io();

// State
let myUserId = null;
let myUserName = null;
let currentPartnerId = null;
let currentPartnerSocketId = null;

let localStream = null;
let remoteStream = null;
let peerConnection = null;
let iceCandidateQueue = [];

let isAudioMuted = false;
let isVideoMuted = false;
let isScreenSharing = false;
let callStartTime = null;
let callTimerInterval = null;

let pendingOffer = null;
let pendingCallerId = null;
let pendingCallerSocketId = null;
let pendingCallType = 'video';
let screenTrack = null;

// Audio visualizer state
let audioCtx = null;
let analyser = null;
let visualizerAnimationId = null;

// DOM Elements
const myIdDisplay = document.getElementById('myUserIdDisplay');
const copyMyIdBtn = document.getElementById('copyMyIdBtn');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const targetIdInput = document.getElementById('targetIdInput');
const btnVideoCall = document.getElementById('btnVideoCall');
const btnAudioCall = document.getElementById('btnAudioCall');
const localPreviewVideo = document.getElementById('localPreviewVideo');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const previewMicBtn = document.getElementById('previewMicBtn');
const previewCamBtn = document.getElementById('previewCamBtn');

// Active Room Elements
const callRoomView = document.getElementById('callRoomView');
const remoteVideo = document.getElementById('remoteVideo');
const inCallLocalVideo = document.getElementById('inCallLocalVideo');
const localVideoWrapper = document.getElementById('localVideoWrapper');
const remoteAudioCover = document.getElementById('remoteAudioCover');
const roomPeerName = document.getElementById('roomPeerName');
const roomPeerAvatar = document.getElementById('roomPeerAvatar');
const callTimerDisplay = document.getElementById('callTimerDisplay');
const btnMicToggle = document.getElementById('btnMicToggle');
const btnCamToggle = document.getElementById('btnCamToggle');
const btnScreenToggle = document.getElementById('btnScreenToggle');
const btnEndCall = document.getElementById('btnEndCall');
const btnToggleChat = document.getElementById('btnToggleChat');
const chatDrawer = document.getElementById('chatDrawer');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const btnSendMsg = document.getElementById('btnSendMsg');
const waveformCanvas = document.getElementById('waveformCanvas');

// Modals
const incomingCallModal = document.getElementById('incomingCallModal');
const incomingCallerName = document.getElementById('incomingCallerName');
const incomingCallType = document.getElementById('incomingCallType');
const btnAcceptCall = document.getElementById('btnAcceptCall');
const btnDeclineCall = document.getElementById('btnDeclineCall');

const outgoingCallModal = document.getElementById('outgoingCallModal');
const outgoingTargetName = document.getElementById('outgoingTargetName');
const btnCancelOutgoing = document.getElementById('btnCancelOutgoing');
const toastMsg = document.getElementById('toastMsg');
const recentCallsList = document.getElementById('recentCallsList');

// Ultra-fast STUN configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

// ==========================================
// 1. Toast Notification Helper
// ==========================================
function showToast(text, duration = 3500) {
  toastMsg.textContent = text;
  toastMsg.classList.add('show');
  setTimeout(() => {
    toastMsg.classList.remove('show');
  }, duration);
}

// ==========================================
// 2. Media Acquisition (Hardware or Canvas Fallback)
// ==========================================
async function acquireMediaStream(withVideo = true) {
  if (localStream && localStream.active) {
    return localStream;
  }

  try {
    // Attempt standard webcam & microphone
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } : false
    });
  } catch (err) {
    console.warn('[Media] Direct camera access failed or busy, trying fallback:', err);
    try {
      // If camera is busy (e.g. testing in 2 tabs on same PC), get audio and make synthetic avatar video
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (withVideo) {
        const dummyVideoTrack = createAnimatedAvatarTrack();
        localStream.addTrack(dummyVideoTrack);
      }
    } catch (audioErr) {
      console.warn('[Media] Audio also failed, creating simulated stream:', audioErr);
      localStream = createSimulatedStream();
    }
  }

  localPreviewVideo.srcObject = localStream;
  inCallLocalVideo.srcObject = localStream;
  if (cameraPlaceholder) cameraPlaceholder.style.display = 'none';

  return localStream;
}

// Generates an animated avatar video track if webcam is locked by another tab
function createAnimatedAvatarTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  let angle = 0;

  function render() {
    angle += 0.05;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Glowing circle avatar
    ctx.beginPath();
    ctx.arc(160, 110, 45 + Math.sin(angle) * 5, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👤 فيديو تجريبي', 160, 118);

    ctx.font = '14px Cairo, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('الكاميرا قيد الاستخدام في تبويب آخر', 160, 185);

    requestAnimationFrame(render);
  }
  render();

  const stream = canvas.captureStream(15);
  return stream.getVideoTracks()[0];
}

function createSimulatedStream() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();
  const track = createAnimatedAvatarTrack();
  dest.stream.addTrack(track);
  return dest.stream;
}

// Preview Controls
previewMicBtn.addEventListener('click', () => {
  toggleAudio();
  previewMicBtn.classList.toggle('off', isAudioMuted);
});

previewCamBtn.addEventListener('click', () => {
  toggleVideo();
  previewCamBtn.classList.toggle('off', isVideoMuted);
});

function toggleAudio() {
  if (!localStream) return;
  isAudioMuted = !isAudioMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isAudioMuted;
  });
  btnMicToggle.classList.toggle('muted', isAudioMuted);
}

function toggleVideo() {
  if (!localStream) return;
  isVideoMuted = !isVideoMuted;
  localStream.getVideoTracks().forEach(track => {
    track.enabled = !isVideoMuted;
  });
  btnCamToggle.classList.toggle('disabled', isVideoMuted);
}

// ==========================================
// 3. Application Registration (Per Tab Session)
// ==========================================
function initApp() {
  // Use sessionStorage so tabs on the same machine never overwrite each other!
  const sessionUser = sessionStorage.getItem('call_user_id');

  socket.emit('register-user', {
    preferredId: sessionUser
  });

  // Pre-acquire media for instant calls
  acquireMediaStream(true);

  // Load Recents
  loadRecentCalls();

  // Check URL query parameters (?call=XXXX)
  const urlParams = new URLSearchParams(window.location.search);
  const callParam = urlParams.get('call');
  if (callParam) {
    targetIdInput.value = callParam.toUpperCase().trim();
  }
}

socket.on('registered', (data) => {
  myUserId = data.userId;
  myUserName = data.userName;
  sessionStorage.setItem('call_user_id', myUserId);

  myIdDisplay.textContent = myUserId;
  console.log(`[Registered] My ID is: ${myUserId}`);
});

// Copy Buttons
copyMyIdBtn.addEventListener('click', () => {
  if (!myUserId) return;
  navigator.clipboard.writeText(myUserId).then(() => {
    showToast('✅ تم نسخ الكود الخاص بك!');
  });
});

copyInviteBtn.addEventListener('click', () => {
  if (!myUserId) return;
  const link = `${window.location.origin}/?call=${myUserId}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('🔗 تم نسخ رابط المكالمة المباشرة!');
  });
});

// ==========================================
// 4. WebRTC Connection Setup & Candidate Queue
// ==========================================
function createPeerConnection() {
  if (peerConnection) {
    closePeer();
  }

  iceCandidateQueue = [];
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Add tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Handle remote track
  peerConnection.ontrack = (event) => {
    console.log('[WebRTC] Received remote stream track:', event.track.kind);
    remoteStream = event.streams[0];
    remoteVideo.srcObject = remoteStream;

    // Start Audio Visualizer
    startAudioVisualizer(remoteStream);
  };

  // Emit ICE Candidate via direct socket ID
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentPartnerSocketId) {
      socket.emit('ice-candidate', {
        targetSocketId: currentPartnerSocketId,
        candidate: event.candidate
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      console.log('✅ WebRTC Connected successfully!');
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      endCallCleanup('انقطع الاتصال بالطرف الآخر');
    }
  };

  return peerConnection;
}

function flushIceQueue() {
  console.log(`[WebRTC] Flushing ${iceCandidateQueue.length} queued ICE candidates`);
  while (iceCandidateQueue.length > 0) {
    const candidate = iceCandidateQueue.shift();
    if (peerConnection && peerConnection.remoteDescription) {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
        console.warn('Error adding queued ICE:', e);
      });
    }
  }
}

// Receive ICE candidate from peer
socket.on('ice-candidate', async (data) => {
  if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.warn('Error adding ICE candidate:', err);
    }
  } else {
    // Queue until setRemoteDescription finishes!
    iceCandidateQueue.push(data.candidate);
  }
});

// ==========================================
// 5. Outgoing Call Flow (Caller)
// ==========================================
async function startCall(callType) {
  const targetId = targetIdInput.value.toUpperCase().trim();
  if (!targetId) {
    showToast('⚠️ برجاء إدخال كود الطرف الآخر');
    targetIdInput.focus();
    return;
  }

  if (targetId === myUserId) {
    showToast('⚠️ لا يمكنك الاتصال بنفسك!');
    return;
  }

  // Ensure stream exists
  await acquireMediaStream(callType === 'video');

  currentPartnerId = targetId;
  saveRecentCall(targetId);

  createPeerConnection();

  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'video'
    });
    await peerConnection.setLocalDescription(offer);

    // Show Outgoing Modal
    outgoingTargetName.textContent = targetId;
    outgoingCallModal.classList.add('active');

    // Ringback sound
    window.soundFx.playRingback();

    // Send call offer to server
    socket.emit('call-user', {
      userToCall: targetId,
      offer,
      callType,
      callerName: myUserName || myUserId
    });
  } catch (err) {
    console.error('Failed to create call offer:', err);
    showToast('حدث خطأ أثناء إعداد الاتصال');
  }
}

btnVideoCall.addEventListener('click', () => startCall('video'));
btnAudioCall.addEventListener('click', () => startCall('audio'));

// Cancel Outgoing Call
btnCancelOutgoing.addEventListener('click', () => {
  window.soundFx.stopAll();
  outgoingCallModal.classList.remove('active');
  if (currentPartnerSocketId) {
    socket.emit('end-call', { targetSocketId: currentPartnerSocketId });
  }
  closePeer();
});

// Call Error from Server
socket.on('call-error', (data) => {
  window.soundFx.stopAll();
  outgoingCallModal.classList.remove('active');
  closePeer();
  showToast(`❌ ${data.message}`);
});

// Call Rejected
socket.on('call-rejected', (data) => {
  window.soundFx.stopAll();
  window.soundFx.playCallEnded();
  outgoingCallModal.classList.remove('active');
  closePeer();
  showToast(`🚫 ${data.reason}`);
});

// Call Accepted by Callee
socket.on('call-accepted', async (data) => {
  console.log('[WebRTC] Call accepted! Peer socket:', data.responderSocketId);
  currentPartnerSocketId = data.responderSocketId;

  // Stop Ringing immediately!
  window.soundFx.stopAll();
  window.soundFx.playCallConnected();
  outgoingCallModal.classList.remove('active');

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    flushIceQueue();
    openCallRoom(data.answeredBy || currentPartnerId);
  } catch (err) {
    console.error('Error applying remote answer:', err);
  }
});

// ==========================================
// 6. Incoming Call Flow (Callee)
// ==========================================
socket.on('incoming-call', (data) => {
  console.log('[Incoming Call] Received from:', data.callerId, 'Socket:', data.callerSocketId);
  pendingCallerId = data.callerId;
  pendingCallerSocketId = data.callerSocketId;
  pendingOffer = data.offer;
  pendingCallType = data.callType;

  incomingCallerName.textContent = data.callerName || data.callerId;
  incomingCallType.textContent = data.callType === 'video' ? 'مكالمة فيديو واردة' : 'مكالمة صوتية واردة';

  incomingCallModal.classList.add('active');
  window.soundFx.playIncomingRingtone();
});

// Accept Call
btnAcceptCall.addEventListener('click', async () => {
  window.soundFx.stopAll();
  incomingCallModal.classList.remove('active');

  await acquireMediaStream(pendingCallType === 'video');

  currentPartnerId = pendingCallerId;
  currentPartnerSocketId = pendingCallerSocketId;

  createPeerConnection();

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
    flushIceQueue();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send answer back with exact caller socket ID
    socket.emit('answer-call', {
      targetSocketId: currentPartnerSocketId,
      answer
    });

    window.soundFx.playCallConnected();
    openCallRoom(currentPartnerId);
  } catch (err) {
    console.error('Error answering call:', err);
    showToast('حدث خطأ أثناء قبول المكالمة');
  }
});

// Decline Call
btnDeclineCall.addEventListener('click', () => {
  window.soundFx.stopAll();
  incomingCallModal.classList.remove('active');

  if (pendingCallerSocketId) {
    socket.emit('reject-call', {
      targetSocketId: pendingCallerSocketId,
      reason: 'تم رفض المكالمة'
    });
  }
  pendingCallerId = null;
  pendingCallerSocketId = null;
  pendingOffer = null;
});

// ==========================================
// 7. Active Call Room & Controls
// ==========================================
function openCallRoom(peerId) {
  callRoomView.classList.add('active');
  roomPeerName.textContent = peerId;
  roomPeerAvatar.textContent = peerId.slice(-2);

  // Fallback cover if audio call
  if (pendingCallType === 'audio') {
    remoteAudioCover.style.display = 'flex';
  } else {
    remoteAudioCover.style.display = 'none';
  }

  callStartTime = Date.now();
  updateTimer();
  callTimerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  callTimerDisplay.textContent = `${minutes}:${seconds}`;
}

btnMicToggle.addEventListener('click', () => {
  toggleAudio();
});

btnCamToggle.addEventListener('click', () => {
  toggleVideo();
});

// Screen Sharing
btnScreenToggle.addEventListener('click', async () => {
  if (!isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenTrack = screenStream.getVideoTracks()[0];

      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(screenTrack);
      }

      inCallLocalVideo.srcObject = screenStream;
      localVideoWrapper.classList.add('screen-sharing');
      btnScreenToggle.classList.add('active');
      isScreenSharing = true;

      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.warn('Screen share cancelled:', err);
    }
  } else {
    stopScreenShare();
  }
});

function stopScreenShare() {
  if (!isScreenSharing) return;
  if (screenTrack) screenTrack.stop();

  const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
  const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender && videoTrack) {
    sender.replaceTrack(videoTrack);
  }

  inCallLocalVideo.srcObject = localStream;
  localVideoWrapper.classList.remove('screen-sharing');
  btnScreenToggle.classList.remove('active');
  isScreenSharing = false;
}

// End Call
btnEndCall.addEventListener('click', () => {
  if (currentPartnerSocketId) {
    socket.emit('end-call', { targetSocketId: currentPartnerSocketId });
  }
  endCallCleanup('تم إنهاء المكالمة');
});

socket.on('call-ended', (data) => {
  endCallCleanup(data.message || 'تم إنهاء المكالمة');
});

function endCallCleanup(reason) {
  window.soundFx.stopAll();
  window.soundFx.playCallEnded();

  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }

  stopScreenShare();
  stopAudioVisualizer();
  closePeer();

  callRoomView.classList.remove('active');
  outgoingCallModal.classList.remove('active');
  incomingCallModal.classList.remove('active');

  currentPartnerId = null;
  currentPartnerSocketId = null;
  pendingCallerId = null;
  pendingCallerSocketId = null;
  pendingOffer = null;

  showToast(reason);
}

function closePeer() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  iceCandidateQueue = [];
}

// ==========================================
// 8. In-Call Chat
// ==========================================
btnToggleChat.addEventListener('click', () => {
  chatDrawer.classList.toggle('hidden');
  btnToggleChat.classList.toggle('active');
});

btnSendMsg.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentPartnerSocketId) return;

  const nowTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  appendMessage(text, 'mine', nowTime);

  socket.emit('send-message', {
    targetSocketId: currentPartnerSocketId,
    message: text,
    timestamp: nowTime
  });

  chatInput.value = '';
}

socket.on('receive-message', (data) => {
  appendMessage(data.message, 'theirs', data.timestamp);
});

function appendMessage(text, senderClass, timestamp) {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${senderClass}`;
  msgEl.innerHTML = `
    <div>${escapeHtml(text)}</div>
    <span class="msg-time">${timestamp}</span>
  `;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// 9. Real-time Audio Visualizer
// ==========================================
function startAudioVisualizer(stream) {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);

    const canvas = waveformCanvas;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function drawWave() {
      visualizerAnimationId = requestAnimationFrame(drawWave);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 1.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#6366f1');
        gradient.addColorStop(1, '#a855f7');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);

        x += barWidth;
      }
    }

    drawWave();
  } catch (e) {
    console.warn('Audio visualizer error:', e);
  }
}

function stopAudioVisualizer() {
  if (visualizerAnimationId) {
    cancelAnimationFrame(visualizerAnimationId);
    visualizerAnimationId = null;
  }
}

// ==========================================
// 10. Recents Storage
// ==========================================
function saveRecentCall(peerId) {
  let recents = JSON.parse(localStorage.getItem('recent_calls') || '[]');
  recents = recents.filter(id => id !== peerId);
  recents.unshift(peerId);
  if (recents.length > 5) recents.pop();
  localStorage.setItem('recent_calls', JSON.stringify(recents));
  loadRecentCalls();
}

function loadRecentCalls() {
  const recents = JSON.parse(localStorage.getItem('recent_calls') || '[]');
  recentCallsList.innerHTML = '';

  if (recents.length === 0) {
    recentCallsList.innerHTML = '<p style="color: var(--text-dim); font-size: 0.85rem;">لا توجد مكالمات سابقة</p>';
    return;
  }

  recents.forEach(id => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `
      <span class="recent-id">${id}</span>
      <button class="recent-call-action" onclick="dialRecent('${id}')">
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
        </svg>
        اتصال
      </button>
    `;
    recentCallsList.appendChild(item);
  });
}

window.dialRecent = function(id) {
  targetIdInput.value = id;
  startCall('video');
};

// Start
window.addEventListener('DOMContentLoaded', initApp);
