// WebRTC App-to-App Calling Client Logic

const socket = io();

// State variables
let myUserId = null;
let myUserName = null;
let currentPeerId = null;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isAudioMuted = false;
let isVideoMuted = false;
let isScreenSharing = false;
let callStartTime = null;
let callTimerInterval = null;
let pendingOffer = null;
let pendingCallerId = null;
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

// WebRTC Configuration (Public STUN servers)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
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
// 2. Initial Setup & Registration
// ==========================================
function initApp() {
  const savedId = localStorage.getItem('call_user_id');
  const savedName = localStorage.getItem('call_user_name');

  socket.emit('register-user', {
    preferredId: savedId,
    userName: savedName
  });

  // Request preview camera & mic
  initMediaPreview();

  // Load Recent Calls
  loadRecentCalls();

  // Handle URL Query Params (?call=XXXX)
  const urlParams = new URLSearchParams(window.location.search);
  const callParam = urlParams.get('call');
  if (callParam) {
    targetIdInput.value = callParam.toUpperCase().trim();
  }
}

socket.on('registered', (data) => {
  myUserId = data.userId;
  myUserName = data.userName;
  localStorage.setItem('call_user_id', myUserId);
  localStorage.setItem('call_user_name', myUserName);

  myIdDisplay.textContent = myUserId;
  console.log(`[Registered] User ID: ${myUserId}`);
});

// Copy My ID
copyMyIdBtn.addEventListener('click', () => {
  if (!myUserId) return;
  navigator.clipboard.writeText(myUserId).then(() => {
    showToast('✅ تم نسخ الكود الخاص بك!');
  });
});

// Copy Direct Share Link
copyInviteBtn.addEventListener('click', () => {
  if (!myUserId) return;
  const link = `${window.location.origin}/?call=${myUserId}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('🔗 تم نسخ رابط المكالمة المباشرة!');
  });
});

// ==========================================
// 3. Local Media Management (Audio & Video)
// ==========================================
async function initMediaPreview() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }
    });

    localPreviewVideo.srcObject = localStream;
    inCallLocalVideo.srcObject = localStream;
    cameraPlaceholder.style.display = 'none';
  } catch (err) {
    console.warn('Could not acquire camera/mic stream:', err);
    cameraPlaceholder.style.display = 'flex';
    showToast('⚠️ يرجى السماح بالوصول للكاميرا والمايكروفون للاتصال');
  }
}

// Preview Mic / Cam Toggles
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
  if (cameraPlaceholder) {
    cameraPlaceholder.style.display = isVideoMuted ? 'flex' : 'none';
  }
}

// ==========================================
// 4. Create WebRTC Peer Connection
// ==========================================
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Add all local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Handle incoming remote tracks
  peerConnection.ontrack = (event) => {
    console.log('[WebRTC] Received remote track:', event.track.kind);
    remoteStream = event.streams[0];
    remoteVideo.srcObject = remoteStream;

    // Start Visualizer with remote audio
    startAudioVisualizer(remoteStream);
  };

  // Relay ICE Candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentPeerId) {
      socket.emit('ice-candidate', {
        to: currentPeerId,
        candidate: event.candidate
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      endCallCleanup('انقطع الاتصال بالطرف الآخر');
    }
  };

  return peerConnection;
}

// ==========================================
// 5. Outgoing Call Flow (Caller)
// ==========================================
async function startCall(callType) {
  const targetId = targetIdInput.value.toUpperCase().trim();
  if (!targetId) {
    showToast('⚠️ برجاء كتابة كود المستخدم للاتصال');
    targetIdInput.focus();
    return;
  }

  if (targetId === myUserId) {
    showToast('⚠️ لا يمكنك الاتصال بنفسك!');
    return;
  }

  if (!localStream) {
    await initMediaPreview();
  }

  currentPeerId = targetId;
  saveRecentCall(targetId);

  // Setup PeerConnection & Create Offer
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

    // Play Ringback Tone
    window.soundFx.playRingback();

    // Emit call request
    socket.emit('call-user', {
      userToCall: targetId,
      offer,
      callType,
      callerName: myUserName || myUserId
    });
  } catch (err) {
    console.error('Failed to create offer:', err);
    showToast('حدث خطأ أثناء بدء الاتصال');
  }
}

btnVideoCall.addEventListener('click', () => startCall('video'));
btnAudioCall.addEventListener('click', () => startCall('audio'));

// Cancel Outgoing Call
btnCancelOutgoing.addEventListener('click', () => {
  window.soundFx.stopAll();
  outgoingCallModal.classList.remove('active');
  if (currentPeerId) {
    socket.emit('end-call', { to: currentPeerId });
  }
  closePeer();
  currentPeerId = null;
});

// Server responses
socket.on('call-error', (data) => {
  window.soundFx.stopAll();
  outgoingCallModal.classList.remove('active');
  closePeer();
  showToast(`❌ ${data.message}`);
});

socket.on('call-rejected', (data) => {
  window.soundFx.stopAll();
  window.soundFx.playCallEnded();
  outgoingCallModal.classList.remove('active');
  closePeer();
  showToast(`🚫 ${data.reason}`);
});

// Call Accepted by Receiver
socket.on('call-accepted', async (data) => {
  console.log('[WebRTC] Call accepted by:', data.answeredBy);
  window.soundFx.stopAll();
  window.soundFx.playCallConnected();
  outgoingCallModal.classList.remove('active');

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    openCallRoom(data.answeredBy);
  } catch (err) {
    console.error('Error setting remote answer:', err);
  }
});

// ==========================================
// 6. Incoming Call Flow (Receiver)
// ==========================================
socket.on('incoming-call', (data) => {
  console.log('[Incoming Call] from:', data.callerId);
  pendingCallerId = data.callerId;
  pendingOffer = data.offer;
  pendingCallType = data.callType;

  incomingCallerName.textContent = data.callerName || data.callerId;
  incomingCallType.textContent = data.callType === 'video' ? 'مكالمة فيديو واردة' : 'مكالمة صوتية واردة';

  incomingCallModal.classList.add('active');
  window.soundFx.playIncomingRingtone();
});

// Accept Incoming Call
btnAcceptCall.addEventListener('click', async () => {
  window.soundFx.stopAll();
  incomingCallModal.classList.remove('active');

  if (!localStream) {
    await initMediaPreview();
  }

  currentPeerId = pendingCallerId;
  createPeerConnection();

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer-call', {
      to: currentPeerId,
      answer
    });

    window.soundFx.playCallConnected();
    openCallRoom(currentPeerId);
  } catch (err) {
    console.error('Error accepting call:', err);
    showToast('حدث خطأ أثناء قبول المكالمة');
  }
});

// Decline Incoming Call
btnDeclineCall.addEventListener('click', () => {
  window.soundFx.stopAll();
  incomingCallModal.classList.remove('active');

  if (pendingCallerId) {
    socket.emit('reject-call', {
      to: pendingCallerId,
      reason: 'تم رفض المكالمة'
    });
  }
  pendingCallerId = null;
  pendingOffer = null;
});

// ==========================================
// 7. ICE Candidate Exchange
// ==========================================
socket.on('ice-candidate', async (data) => {
  try {
    if (peerConnection && data.candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error('Error adding ICE candidate:', err);
  }
});

// ==========================================
// 8. Active Call Room View & Controls
// ==========================================
function openCallRoom(peerId) {
  callRoomView.classList.add('active');
  roomPeerName.textContent = peerId;
  roomPeerAvatar.textContent = peerId.slice(-2);

  // Start Call Timer
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

// In-Call Controls
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
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      screenTrack = screenStream.getVideoTracks()[0];

      // Replace video track in peer connection
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(screenTrack);
      }

      inCallLocalVideo.srcObject = screenStream;
      localVideoWrapper.classList.add('screen-sharing');
      btnScreenToggle.classList.add('active');
      isScreenSharing = true;

      // Handle user stopping screen share from browser banner
      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.warn('Screen share cancelled or failed:', err);
    }
  } else {
    stopScreenShare();
  }
});

function stopScreenShare() {
  if (!isScreenSharing) return;
  if (screenTrack) {
    screenTrack.stop();
  }

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

// End Call Action
btnEndCall.addEventListener('click', () => {
  if (currentPeerId) {
    socket.emit('end-call', { to: currentPeerId });
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

  currentPeerId = null;
  pendingCallerId = null;
  pendingOffer = null;

  showToast(reason);
}

function closePeer() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
}

// ==========================================
// 9. In-Call Chat Messaging
// ==========================================
btnToggleChat.addEventListener('click', () => {
  chatDrawer.classList.toggle('hidden');
  btnToggleChat.classList.toggle('active');
});

btnSendMsg.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendChatMessage();
  }
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentPeerId) return;

  const nowTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  // Append mine
  appendMessage(text, 'mine', nowTime);

  // Send to peer
  socket.emit('send-message', {
    to: currentPeerId,
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
// 10. Real-time Audio Visualizer
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
// 11. Recent Calls Memory (LocalStorage)
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

// Start everything
window.addEventListener('DOMContentLoaded', initApp);
