// =========================================================================
// ConnectPulse PRO - High Performance WebRTC P2P Calling Application
// Modular, Responsive, Production-Grade Client Logic
// =========================================================================

const socket = io();

// Application State
const AppState = {
  myUserId: null,
  myUserName: localStorage.getItem('cp_username') || null,
  currentPartnerId: null,
  currentPartnerSocketId: null,
  callType: 'video', // 'video' | 'audio'
  callStartTime: null,
  callTimerInterval: null,
  statsInterval: null,

  localStream: null,
  remoteStream: null,
  peerConnection: null,
  iceCandidateQueue: [],

  isAudioMuted: false,
  isVideoMuted: false,
  isScreenSharing: false,
  screenTrack: null,
  currentFacingMode: 'user',

  selectedAudioDeviceId: localStorage.getItem('cp_audio_input') || '',
  selectedVideoDeviceId: localStorage.getItem('cp_video_input') || '',
  selectedOutputDeviceId: localStorage.getItem('cp_audio_output') || '',

  pendingCall: null
};

// Public STUN / ICE Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

// UI Cache
const UI = {
  // Navigation & Lobby
  myIdDisplay: document.getElementById('myUserIdDisplay'),
  copyMyIdBtn: document.getElementById('copyMyIdBtn'),
  btnOpenSettings: document.getElementById('btnOpenSettings'),
  targetIdInput: document.getElementById('targetIdInput'),
  btnClearInput: document.getElementById('btnClearInput'),
  btnVideoCall: document.getElementById('btnVideoCall'),
  btnAudioCall: document.getElementById('btnAudioCall'),
  copyInviteBtn: document.getElementById('copyInviteBtn'),
  recentCallsList: document.getElementById('recentCallsList'),
  recentsCount: document.getElementById('recentsCount'),

  // Preview Stage
  localPreviewVideo: document.getElementById('localPreviewVideo'),
  cameraPlaceholder: document.getElementById('cameraPlaceholder'),
  previewMicBtn: document.getElementById('previewMicBtn'),
  previewCamBtn: document.getElementById('previewCamBtn'),
  previewFlipBtn: document.getElementById('previewFlipBtn'),

  // Call Room
  callRoomView: document.getElementById('callRoomView'),
  roomPeerName: document.getElementById('roomPeerName'),
  roomPeerAvatar: document.getElementById('roomPeerAvatar'),
  callTimerDisplay: document.getElementById('callTimerDisplay'),
  connQualityBadge: document.getElementById('connQualityBadge'),
  connQualityText: document.getElementById('connQualityText'),
  btnTogglePiP: document.getElementById('btnTogglePiP'),
  btnToggleFullscreen: document.getElementById('btnToggleFullscreen'),
  btnToggleChat: document.getElementById('btnToggleChat'),
  chatUnreadDot: document.getElementById('chatUnreadDot'),

  // Call Stage Elements
  remoteVideo: document.getElementById('remoteVideo'),
  inCallLocalVideo: document.getElementById('inCallLocalVideo'),
  localVideoWrapper: document.getElementById('localVideoWrapper'),
  remoteAudioCover: document.getElementById('remoteAudioCover'),
  waveformCanvas: document.getElementById('waveformCanvas'),
  floatingReactionsBox: document.getElementById('floatingReactionsBox'),
  reactionsDock: document.getElementById('reactionsDock'),

  // Dock Buttons
  btnMicToggle: document.getElementById('btnMicToggle'),
  btnCamToggle: document.getElementById('btnCamToggle'),
  btnInCallFlipCam: document.getElementById('btnInCallFlipCam'),
  btnScreenToggle: document.getElementById('btnScreenToggle'),
  btnEndCall: document.getElementById('btnEndCall'),

  // In-Call Chat
  chatDrawer: document.getElementById('chatDrawer'),
  btnCloseChatBtn: document.getElementById('btnCloseChatBtn'),
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  btnSendMsg: document.getElementById('btnSendMsg'),

  // Modals & Notifications
  incomingCallModal: document.getElementById('incomingCallModal'),
  incomingCallerName: document.getElementById('incomingCallerName'),
  incomingCallType: document.getElementById('incomingCallType'),
  btnAcceptCall: document.getElementById('btnAcceptCall'),
  btnDeclineCall: document.getElementById('btnDeclineCall'),

  outgoingCallModal: document.getElementById('outgoingCallModal'),
  outgoingTargetName: document.getElementById('outgoingTargetName'),
  btnCancelOutgoing: document.getElementById('btnCancelOutgoing'),

  settingsModal: document.getElementById('settingsModal'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  settingUserName: document.getElementById('settingUserName'),
  selectAudioInput: document.getElementById('selectAudioInput'),
  selectVideoInput: document.getElementById('selectVideoInput'),
  selectAudioOutput: document.getElementById('selectAudioOutput'),
  speakerSettingRow: document.getElementById('speakerSettingRow'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),

  toastMsg: document.getElementById('toastMsg')
};

// =========================================================================
// 1. Toast Notification Helper
// =========================================================================
function showToast(text, duration = 3500) {
  if (!UI.toastMsg) return;
  UI.toastMsg.textContent = text;
  UI.toastMsg.classList.add('show');
  setTimeout(() => {
    UI.toastMsg.classList.remove('show');
  }, duration);
}

// Request Desktop Notifications for background ringing
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showDesktopNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification(title, {
      body,
      icon: '/data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%236366f1"><circle cx="12" cy="12" r="10"/></svg>'
    });
  }
}

// =========================================================================
// 2. Device & Media Stream Acquisition
// =========================================================================
const DeviceManager = {
  async init() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.populateDeviceSelectors(devices);

      navigator.mediaDevices.ondevicechange = async () => {
        const updated = await navigator.mediaDevices.enumerateDevices();
        this.populateDeviceSelectors(updated);
      };
    } catch (e) {
      console.warn('Device enumeration warning:', e);
    }
  },

  populateDeviceSelectors(devices) {
    if (!UI.selectAudioInput || !UI.selectVideoInput) return;

    UI.selectAudioInput.innerHTML = '<option value="">الميكروفون الافتراضي</option>';
    UI.selectVideoInput.innerHTML = '<option value="">الكاميرا الافتراضية</option>';
    if (UI.selectAudioOutput) {
      UI.selectAudioOutput.innerHTML = '<option value="">السماعة الافتراضية</option>';
    }

    devices.forEach((device) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `${device.kind} (${option.value.slice(0, 5)}...)`;

      if (device.kind === 'audioinput') {
        if (device.deviceId === AppState.selectedAudioDeviceId) option.selected = true;
        UI.selectAudioInput.appendChild(option);
      } else if (device.kind === 'videoinput') {
        if (device.deviceId === AppState.selectedVideoDeviceId) option.selected = true;
        UI.selectVideoInput.appendChild(option);
      } else if (device.kind === 'audiooutput' && UI.selectAudioOutput) {
        if (device.deviceId === AppState.selectedOutputDeviceId) option.selected = true;
        UI.selectAudioOutput.appendChild(option);
      }
    });

    // Check setSinkId support for audio output
    if (UI.speakerSettingRow && !('setSinkId' in HTMLMediaElement.prototype)) {
      UI.speakerSettingRow.style.display = 'none';
    }
  },

  async getMediaConstraints(withVideo = true) {
    const audioConstraints = AppState.selectedAudioDeviceId 
      ? { deviceId: { exact: AppState.selectedAudioDeviceId } } 
      : true;

    const videoConstraints = withVideo ? {
      deviceId: AppState.selectedVideoDeviceId ? { exact: AppState.selectedVideoDeviceId } : undefined,
      facingMode: AppState.currentFacingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    } : false;

    return { audio: audioConstraints, video: videoConstraints };
  }
};

async function acquireMediaStream(withVideo = true) {
  if (AppState.localStream && AppState.localStream.active) {
    return AppState.localStream;
  }

  try {
    const constraints = await DeviceManager.getMediaConstraints(withVideo);
    AppState.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.warn('[Media] Direct hardware access failed or busy, trying fallback:', err);
    try {
      AppState.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (withVideo) {
        const dummyTrack = createAnimatedAvatarTrack();
        AppState.localStream.addTrack(dummyTrack);
      }
    } catch (fallbackErr) {
      console.warn('[Media] Fallback failed, creating simulated stream:', fallbackErr);
      AppState.localStream = createSimulatedStream();
    }
  }

  if (UI.localPreviewVideo) UI.localPreviewVideo.srcObject = AppState.localStream;
  if (UI.inCallLocalVideo) UI.inCallLocalVideo.srcObject = AppState.localStream;
  if (UI.cameraPlaceholder) UI.cameraPlaceholder.style.display = 'none';

  return AppState.localStream;
}

// Canvas Animated Track for Fallback / Camera Busy (e.g. 2 tabs testing on same PC)
function createAnimatedAvatarTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let angle = 0;

  function render() {
    angle += 0.04;
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(320, 210, 85 + Math.sin(angle) * 8, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.shadowColor = '#818cf8';
    ctx.shadowBlur = 30;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👤 فيديو افتراضي', 320, 220);

    ctx.font = '20px Cairo, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('الكاميرا قيد الاستخدام في تطبيق أو تبويب آخر', 320, 360);

    requestAnimationFrame(render);
  }
  render();

  const stream = canvas.captureStream(25);
  return stream.getVideoTracks()[0];
}

function createSimulatedStream() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const dest = audioCtx.createMediaStreamDestination();
  const track = createAnimatedAvatarTrack();
  dest.stream.addTrack(track);
  return dest.stream;
}

// =========================================================================
// 3. User Controls (Mute / Cam / Screen / Settings)
// =========================================================================
function toggleAudio() {
  if (!AppState.localStream) return;
  AppState.isAudioMuted = !AppState.isAudioMuted;
  AppState.localStream.getAudioTracks().forEach(track => {
    track.enabled = !AppState.isAudioMuted;
  });

  UI.btnMicToggle.classList.toggle('muted', AppState.isAudioMuted);
  UI.previewMicBtn.classList.toggle('off', AppState.isAudioMuted);
  showToast(AppState.isAudioMuted ? '🔇 تم كتم الميكروفون' : '🎙️ الميكروفون قيد التشغيل');
}

function toggleVideo() {
  if (!AppState.localStream) return;
  AppState.isVideoMuted = !AppState.isVideoMuted;
  AppState.localStream.getVideoTracks().forEach(track => {
    track.enabled = !AppState.isVideoMuted;
  });

  UI.btnCamToggle.classList.toggle('disabled', AppState.isVideoMuted);
  UI.previewCamBtn.classList.toggle('off', AppState.isVideoMuted);
  showToast(AppState.isVideoMuted ? '🚫 تم إيقاف الكاميرا' : '📷 الكاميرا قيد التشغيل');
}

async function flipCamera() {
  AppState.currentFacingMode = AppState.currentFacingMode === 'user' ? 'environment' : 'user';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: AppState.currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const newVideoTrack = newStream.getVideoTracks()[0];

    const oldTrack = AppState.localStream ? AppState.localStream.getVideoTracks()[0] : null;
    if (oldTrack) {
      oldTrack.stop();
      AppState.localStream.removeTrack(oldTrack);
    }
    if (AppState.localStream) {
      AppState.localStream.addTrack(newVideoTrack);
    }

    UI.localPreviewVideo.srcObject = AppState.localStream;
    UI.inCallLocalVideo.srcObject = AppState.localStream;

    if (AppState.peerConnection) {
      const sender = AppState.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(newVideoTrack);
      }
    }
    showToast(AppState.currentFacingMode === 'user' ? '📷 الكاميرا الأمامية' : '📷 الكاميرا الخلفية');
  } catch (err) {
    console.warn('Flip camera not supported on this device:', err);
    showToast('⚠️ الكاميرا البديلة غير متوفرة');
  }
}

// Screen Sharing Toggle
async function toggleScreenShare() {
  if (!AppState.isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      AppState.screenTrack = screenStream.getVideoTracks()[0];

      if (AppState.peerConnection) {
        const sender = AppState.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(AppState.screenTrack);
        }
      }

      UI.inCallLocalVideo.srcObject = screenStream;
      UI.localVideoWrapper.classList.add('screen-sharing');
      UI.btnScreenToggle.classList.add('active');
      AppState.isScreenSharing = true;

      AppState.screenTrack.onended = () => {
        stopScreenShare();
      };
      showToast('🖥️ بدأت مشاركة الشاشة');
    } catch (err) {
      console.warn('Screen share cancelled:', err);
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (!AppState.isScreenSharing) return;
  if (AppState.screenTrack) {
    AppState.screenTrack.stop();
    AppState.screenTrack = null;
  }

  const cameraTrack = AppState.localStream ? AppState.localStream.getVideoTracks()[0] : null;
  if (AppState.peerConnection && cameraTrack) {
    const sender = AppState.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      sender.replaceTrack(cameraTrack);
    }
  }

  UI.inCallLocalVideo.srcObject = AppState.localStream;
  UI.localVideoWrapper.classList.remove('screen-sharing');
  UI.btnScreenToggle.classList.remove('active');
  AppState.isScreenSharing = false;
  showToast('تم إيقاف مشاركة الشاشة');
}

// Native Picture in Picture API
async function togglePictureInPicture() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (UI.remoteVideo && document.pictureInPictureEnabled) {
      await UI.remoteVideo.requestPictureInPicture();
    }
  } catch (err) {
    console.warn('Picture in Picture failed:', err);
    showToast('⚠️ لا يمكن تفعيل وضع PiP');
  }
}

// Fullscreen Toggle
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

// =========================================================================
// 4. WebRTC Connection Setup & Quality Stats Monitor
// =========================================================================
function createPeerConnection() {
  if (AppState.peerConnection) {
    closePeer();
  }

  AppState.iceCandidateQueue = [];
  AppState.peerConnection = new RTCPeerConnection(rtcConfig);

  // Add all active local tracks
  if (AppState.localStream) {
    AppState.localStream.getTracks().forEach(track => {
      AppState.peerConnection.addTrack(track, AppState.localStream);
    });
  }

  // Handle incoming remote tracks
  AppState.peerConnection.ontrack = (event) => {
    console.log('[WebRTC] Received remote stream track:', event.track.kind);
    AppState.remoteStream = event.streams[0];
    UI.remoteVideo.srcObject = AppState.remoteStream;

    // Start Audio Waveform Visualizer
    startAudioVisualizer(AppState.remoteStream);
  };

  // Emit ICE Candidate via direct socket routing
  AppState.peerConnection.onicecandidate = (event) => {
    if (event.candidate && AppState.currentPartnerSocketId) {
      socket.emit('ice-candidate', {
        targetSocketId: AppState.currentPartnerSocketId,
        candidate: event.candidate
      });
    }
  };

  AppState.peerConnection.onconnectionstatechange = () => {
    const state = AppState.peerConnection.connectionState;
    console.log('[WebRTC] Connection state:', state);

    if (state === 'connected') {
      console.log('✅ WebRTC Connected successfully!');
      startStatsMonitor();
    } else if (state === 'disconnected' || state === 'failed') {
      endCallCleanup('انقطع الاتصال بالطرف الآخر');
    }
  };

  return AppState.peerConnection;
}

function flushIceQueue() {
  while (AppState.iceCandidateQueue.length > 0) {
    const candidate = AppState.iceCandidateQueue.shift();
    if (AppState.peerConnection && AppState.peerConnection.remoteDescription) {
      AppState.peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {
        console.warn('Error adding queued ICE candidate:', e);
      });
    }
  }
}

// Receive ICE candidate from peer
socket.on('ice-candidate', async (data) => {
  if (AppState.peerConnection && AppState.peerConnection.remoteDescription && AppState.peerConnection.remoteDescription.type) {
    try {
      await AppState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.warn('Error adding ICE candidate:', err);
    }
  } else {
    AppState.iceCandidateQueue.push(data.candidate);
  }
});

// Quality & Latency Monitor via WebRTC getStats()
function startStatsMonitor() {
  if (AppState.statsInterval) clearInterval(AppState.statsInterval);

  AppState.statsInterval = setInterval(async () => {
    if (!AppState.peerConnection || AppState.peerConnection.connectionState !== 'connected') return;

    try {
      const stats = await AppState.peerConnection.getStats();
      let rtt = null;

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.currentRoundTripTime !== undefined) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
        }
      });

      if (rtt !== null) {
        updateQualityIndicator(rtt);
      }
    } catch (e) {
      console.warn('Stats error:', e);
    }
  }, 2500);
}

function updateQualityIndicator(rtt) {
  if (!UI.connQualityBadge || !UI.connQualityText) return;

  UI.connQualityBadge.classList.remove('quality-good', 'quality-fair', 'quality-poor');

  if (rtt < 120) {
    UI.connQualityBadge.classList.add('quality-good');
    UI.connQualityText.textContent = `ممتاز • ${rtt}ms`;
  } else if (rtt < 300) {
    UI.connQualityBadge.classList.add('quality-fair');
    UI.connQualityText.textContent = `جيد • ${rtt}ms`;
  } else {
    UI.connQualityBadge.classList.add('quality-poor');
    UI.connQualityText.textContent = `ضعيف • ${rtt}ms`;
  }
}

// =========================================================================
// 5. Outgoing Call Flow (Caller)
// =========================================================================
async function startCall(type) {
  const targetId = UI.targetIdInput.value.toUpperCase().trim();
  if (!targetId) {
    showToast('⚠️ برجاء إدخال كود الطرف الآخر');
    UI.targetIdInput.focus();
    return;
  }

  if (targetId === AppState.myUserId) {
    showToast('⚠️ لا يمكنك الاتصال بنفسك!');
    return;
  }

  AppState.callType = type;
  await acquireMediaStream(type === 'video');

  AppState.currentPartnerId = targetId;
  saveRecentCall(targetId);

  createPeerConnection();

  try {
    const offer = await AppState.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: type === 'video'
    });
    await AppState.peerConnection.setLocalDescription(offer);

    // Show Outgoing Modal
    UI.outgoingTargetName.textContent = targetId;
    UI.outgoingCallModal.classList.add('active');

    // Ringback Audio
    window.soundFx.playRingback();

    socket.emit('call-user', {
      userToCall: targetId,
      offer,
      callType: type,
      callerName: AppState.myUserName || AppState.myUserId
    });
  } catch (err) {
    console.error('Failed to create call offer:', err);
    showToast('حدث خطأ أثناء إعداد الاتصال');
  }
}

// Cancel Outgoing Call
UI.btnCancelOutgoing.addEventListener('click', () => {
  window.soundFx.stopAll();
  UI.outgoingCallModal.classList.remove('active');
  if (AppState.currentPartnerSocketId) {
    socket.emit('end-call', { targetSocketId: AppState.currentPartnerSocketId });
  }
  closePeer();
});

// Call Server Errors
socket.on('call-error', (data) => {
  window.soundFx.stopAll();
  UI.outgoingCallModal.classList.remove('active');
  closePeer();
  showToast(`❌ ${data.message}`);
});

// Call Rejected
socket.on('call-rejected', (data) => {
  window.soundFx.stopAll();
  window.soundFx.playCallEnded();
  UI.outgoingCallModal.classList.remove('active');
  closePeer();
  showToast(`🚫 ${data.reason}`);
});

// Call Accepted by Peer
socket.on('call-accepted', async (data) => {
  console.log('[WebRTC] Call accepted! Peer socket:', data.responderSocketId);
  AppState.currentPartnerSocketId = data.responderSocketId;

  window.soundFx.stopAll();
  window.soundFx.playCallConnected();
  UI.outgoingCallModal.classList.remove('active');

  try {
    await AppState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    flushIceQueue();
    openCallRoom(data.answeredBy || AppState.currentPartnerId);
  } catch (err) {
    console.error('Error setting remote description:', err);
  }
});

// =========================================================================
// 6. Incoming Call Flow (Callee)
// =========================================================================
socket.on('incoming-call', (data) => {
  console.log('[Incoming Call] Received from:', data.callerId);
  AppState.pendingCall = data;

  UI.incomingCallerName.textContent = data.callerName || data.callerId;
  UI.incomingCallType.textContent = data.callType === 'video' ? 'مكالمة فيديو واردة' : 'مكالمة صوتية واردة';

  UI.incomingCallModal.classList.add('active');
  window.soundFx.playIncomingRingtone();

  showDesktopNotification('مكالمة واردة في ConnectPulse', `اتصال من ${data.callerName || data.callerId}`);
});

UI.btnAcceptCall.addEventListener('click', async () => {
  if (!AppState.pendingCall) return;

  const { callerId, callerSocketId, offer, callType } = AppState.pendingCall;
  window.soundFx.stopAll();
  UI.incomingCallModal.classList.remove('active');

  AppState.callType = callType;
  await acquireMediaStream(callType === 'video');

  AppState.currentPartnerId = callerId;
  AppState.currentPartnerSocketId = callerSocketId;

  createPeerConnection();

  try {
    await AppState.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    flushIceQueue();

    const answer = await AppState.peerConnection.createAnswer();
    await AppState.peerConnection.setLocalDescription(answer);

    socket.emit('answer-call', {
      targetSocketId: AppState.currentPartnerSocketId,
      answer
    });

    window.soundFx.playCallConnected();
    openCallRoom(callerId);
  } catch (err) {
    console.error('Error answering call:', err);
    showToast('حدث خطأ أثناء قبول المكالمة');
  }
});

UI.btnDeclineCall.addEventListener('click', () => {
  window.soundFx.stopAll();
  UI.incomingCallModal.classList.remove('active');

  if (AppState.pendingCall && AppState.pendingCall.callerSocketId) {
    socket.emit('reject-call', {
      targetSocketId: AppState.pendingCall.callerSocketId,
      reason: 'تم رفض المكالمة'
    });
  }
  AppState.pendingCall = null;
});

// =========================================================================
// 7. Active Call Room UI & State
// =========================================================================
function openCallRoom(peerId) {
  UI.callRoomView.classList.add('active');
  UI.roomPeerName.textContent = peerId;
  UI.roomPeerAvatar.textContent = peerId.slice(-2);

  if (AppState.callType === 'audio') {
    UI.remoteAudioCover.style.display = 'flex';
  } else {
    UI.remoteAudioCover.style.display = 'none';
  }

  AppState.callStartTime = Date.now();
  updateTimer();
  AppState.callTimerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - AppState.callStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  UI.callTimerDisplay.textContent = `${minutes}:${seconds}`;
}

UI.btnEndCall.addEventListener('click', () => {
  if (AppState.currentPartnerSocketId) {
    socket.emit('end-call', { targetSocketId: AppState.currentPartnerSocketId });
  }
  endCallCleanup('تم إنهاء المكالمة');
});

socket.on('call-ended', (data) => {
  endCallCleanup(data.message || 'تم إنهاء المكالمة');
});

function endCallCleanup(reason) {
  window.soundFx.stopAll();
  window.soundFx.playCallEnded();

  if (AppState.callTimerInterval) {
    clearInterval(AppState.callTimerInterval);
    AppState.callTimerInterval = null;
  }
  if (AppState.statsInterval) {
    clearInterval(AppState.statsInterval);
    AppState.statsInterval = null;
  }

  stopScreenShare();
  stopAudioVisualizer();
  closePeer();

  UI.callRoomView.classList.remove('active');
  UI.outgoingCallModal.classList.remove('active');
  UI.incomingCallModal.classList.remove('active');

  AppState.currentPartnerId = null;
  AppState.currentPartnerSocketId = null;
  AppState.pendingCall = null;

  showToast(reason);
}

function closePeer() {
  if (AppState.peerConnection) {
    AppState.peerConnection.close();
    AppState.peerConnection = null;
  }
  UI.remoteVideo.srcObject = null;
  AppState.iceCandidateQueue = [];
}

// =========================================================================
// 8. Floating Emoji Reactions
// =========================================================================
function spawnFloatingEmoji(emoji) {
  if (!UI.floatingReactionsBox) return;

  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;

  // Random horizontal positioning
  const randomLeft = 20 + Math.random() * 60;
  el.style.left = `${randomLeft}%`;

  UI.floatingReactionsBox.appendChild(el);
  window.soundFx.playReactionPop();

  setTimeout(() => {
    el.remove();
  }, 3000);
}

if (UI.reactionsDock) {
  UI.reactionsDock.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-emoji');
    if (!btn || !AppState.currentPartnerSocketId) return;

    const emoji = btn.getAttribute('data-emoji');
    spawnFloatingEmoji(emoji);

    socket.emit('send-reaction', {
      targetSocketId: AppState.currentPartnerSocketId,
      emoji
    });
  });
}

socket.on('receive-reaction', (data) => {
  spawnFloatingEmoji(data.emoji);
});

// =========================================================================
// 9. In-Call Chat
// =========================================================================
UI.btnToggleChat.addEventListener('click', () => {
  UI.chatDrawer.classList.toggle('hidden');
  if (UI.chatUnreadDot) UI.chatUnreadDot.classList.remove('show');
});

if (UI.btnCloseChatBtn) {
  UI.btnCloseChatBtn.addEventListener('click', () => UI.chatDrawer.classList.add('hidden'));
}

UI.btnSendMsg.addEventListener('click', sendChatMessage);
UI.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const text = UI.chatInput.value.trim();
  if (!text || !AppState.currentPartnerSocketId) return;

  const nowTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  appendMessage(text, 'mine', nowTime);

  socket.emit('send-message', {
    targetSocketId: AppState.currentPartnerSocketId,
    message: text,
    timestamp: nowTime
  });

  UI.chatInput.value = '';
}

socket.on('receive-message', (data) => {
  appendMessage(data.message, 'theirs', data.timestamp);
  window.soundFx.playMessageReceived();

  if (UI.chatDrawer.classList.contains('hidden') && UI.chatUnreadDot) {
    UI.chatUnreadDot.classList.add('show');
  }
});

function appendMessage(text, senderClass, timestamp) {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${senderClass}`;
  msgEl.innerHTML = `
    <div>${escapeHtml(text)}</div>
    <span class="msg-time">${timestamp}</span>
  `;
  UI.chatMessages.appendChild(msgEl);
  UI.chatMessages.scrollTop = UI.chatMessages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =========================================================================
// 10. Real-time Audio Visualizer
// =========================================================================
let audioCtx = null;
let analyser = null;
let visualizerAnimationId = null;

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

    const canvas = UI.waveformCanvas;
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

// =========================================================================
// 11. Draggable Floating PiP Video
// =========================================================================
(function setupDraggablePiP() {
  const pip = UI.localVideoWrapper;
  if (!pip) return;
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  // Touch
  pip.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      const rect = pip.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    pip.style.left = `${Math.max(10, Math.min(window.innerWidth - 160, initialLeft + deltaX))}px`;
    pip.style.top = `${Math.max(60, Math.min(window.innerHeight - 200, initialTop + deltaY))}px`;
    pip.style.bottom = 'auto';
  }, { passive: true });

  window.addEventListener('touchend', () => {
    isDragging = false;
  });

  // Mouse
  pip.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = pip.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    pip.style.left = `${Math.max(10, Math.min(window.innerWidth - 200, initialLeft + deltaX))}px`;
    pip.style.top = `${Math.max(60, Math.min(window.innerHeight - 240, initialTop + deltaY))}px`;
    pip.style.bottom = 'auto';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
})();

// =========================================================================
// 12. Settings Modal & Storage
// =========================================================================
UI.btnOpenSettings.addEventListener('click', () => {
  UI.settingUserName.value = AppState.myUserName || '';
  UI.settingsModal.classList.add('active');
});

UI.btnCloseSettings.addEventListener('click', () => {
  UI.settingsModal.classList.remove('active');
});

UI.btnSaveSettings.addEventListener('click', async () => {
  const newName = UI.settingUserName.value.trim();
  if (newName) {
    AppState.myUserName = newName;
    localStorage.setItem('cp_username', newName);
  }

  AppState.selectedAudioDeviceId = UI.selectAudioInput.value;
  AppState.selectedVideoDeviceId = UI.selectVideoInput.value;
  AppState.selectedOutputDeviceId = UI.selectAudioOutput ? UI.selectAudioOutput.value : '';

  localStorage.setItem('cp_audio_input', AppState.selectedAudioDeviceId);
  localStorage.setItem('cp_video_input', AppState.selectedVideoDeviceId);
  localStorage.setItem('cp_audio_output', AppState.selectedOutputDeviceId);

  UI.settingsModal.classList.remove('active');
  showToast('✅ تم حفظ الإعدادات');

  // Re-acquire media with newly selected devices
  if (AppState.localStream) {
    AppState.localStream.getTracks().forEach(t => t.stop());
    AppState.localStream = null;
    await acquireMediaStream(AppState.callType === 'video');
  }
});

// =========================================================================
// 13. Recents Calls Manager
// =========================================================================
function saveRecentCall(peerId) {
  let recents = JSON.parse(localStorage.getItem('cp_recent_calls') || '[]');
  recents = recents.filter(id => id !== peerId);
  recents.unshift(peerId);
  if (recents.length > 5) recents.pop();
  localStorage.setItem('cp_recent_calls', JSON.stringify(recents));
  loadRecentCalls();
}

function loadRecentCalls() {
  const recents = JSON.parse(localStorage.getItem('cp_recent_calls') || '[]');
  if (!UI.recentCallsList) return;

  UI.recentCallsList.innerHTML = '';
  if (UI.recentsCount) UI.recentsCount.textContent = recents.length;

  if (recents.length === 0) {
    UI.recentCallsList.innerHTML = '<p style="color: var(--text-dim); font-size: 0.85rem; text-align: center; padding: 12px;">لا توجد مكالمات سابقة</p>';
    return;
  }

  recents.forEach(id => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `
      <span class="recent-id">${id}</span>
      <button class="recent-call-action" onclick="dialRecent('${id}')">
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
        </svg>
        اتصال
      </button>
    `;
    UI.recentCallsList.appendChild(item);
  });
}

window.dialRecent = function(id) {
  UI.targetIdInput.value = id;
  startCall('video');
};

// =========================================================================
// 14. Application Initialization
// =========================================================================
function initApp() {
  // Session-isolated ID per tab so multiple tabs on same PC never conflict
  const sessionUser = sessionStorage.getItem('cp_session_user');

  socket.emit('register-user', {
    preferredId: sessionUser,
    userName: AppState.myUserName
  });

  // Pre-initialize media & device enumeration
  DeviceManager.init();
  acquireMediaStream(true);
  loadRecentCalls();
  requestNotificationPermission();

  // Read URL params (?call=CALL-XXXX)
  const urlParams = new URLSearchParams(window.location.search);
  const callParam = urlParams.get('call');
  if (callParam) {
    UI.targetIdInput.value = callParam.toUpperCase().trim();
  }
}

socket.on('registered', (data) => {
  AppState.myUserId = data.userId;
  sessionStorage.setItem('cp_session_user', AppState.myUserId);

  if (UI.myIdDisplay) UI.myIdDisplay.textContent = AppState.myUserId;
  console.log(`[Registered] ID: ${AppState.myUserId}`);
});

// Event Listeners
UI.btnVideoCall.addEventListener('click', () => startCall('video'));
UI.btnAudioCall.addEventListener('click', () => startCall('audio'));
UI.previewMicBtn.addEventListener('click', toggleAudio);
UI.previewCamBtn.addEventListener('click', toggleVideo);
if (UI.previewFlipBtn) UI.previewFlipBtn.addEventListener('click', flipCamera);
if (UI.btnInCallFlipCam) UI.btnInCallFlipCam.addEventListener('click', flipCamera);

UI.btnMicToggle.addEventListener('click', toggleAudio);
UI.btnCamToggle.addEventListener('click', toggleVideo);
UI.btnScreenToggle.addEventListener('click', toggleScreenShare);
UI.btnTogglePiP.addEventListener('click', togglePictureInPicture);
UI.btnToggleFullscreen.addEventListener('click', toggleFullscreen);

UI.copyMyIdBtn.addEventListener('click', () => {
  if (!AppState.myUserId) return;
  navigator.clipboard.writeText(AppState.myUserId).then(() => {
    showToast('✅ تم نسخ الكود الخاص بك!');
  });
});

UI.copyInviteBtn.addEventListener('click', () => {
  if (!AppState.myUserId) return;
  const link = `${window.location.origin}/?call=${AppState.myUserId}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('🔗 تم نسخ رابط المكالمة المباشرة!');
  });
});

UI.targetIdInput.addEventListener('input', () => {
  if (UI.btnClearInput) {
    UI.btnClearInput.style.display = UI.targetIdInput.value ? 'block' : 'none';
  }
});

if (UI.btnClearInput) {
  UI.btnClearInput.addEventListener('click', () => {
    UI.targetIdInput.value = '';
    UI.btnClearInput.style.display = 'none';
    UI.targetIdInput.focus();
  });
}

window.addEventListener('DOMContentLoaded', initApp);
