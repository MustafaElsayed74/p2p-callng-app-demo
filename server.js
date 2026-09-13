const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 30000,
  pingInterval: 10000
});

const PORT = process.env.PORT || 3500;

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Health Check API
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    activeUsers: usersByUserId.size,
    timestamp: new Date().toISOString()
  });
});

// In-memory state tracking
// usersByUserId: userId -> { socketId, userId, userName, status: 'idle' | 'calling' | 'in-call', partnerId: null }
// usersBySocketId: socketId -> { socketId, userId, userName }
const usersByUserId = new Map();
const usersBySocketId = new Map();

function generateFriendlyId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `CALL-${id}`;
}

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  console.log(`[+] Client connected: ${socket.id} (IP: ${clientIp})`);

  // 1. User Registration
  socket.on('register-user', ({ preferredId, userName }) => {
    let userId = preferredId ? String(preferredId).toUpperCase().trim() : null;

    // Validate ID length & alphanumeric format
    if (userId && (!/^CALL-[A-Z0-9]{4}$/.test(userId) || (usersByUserId.has(userId) && usersByUserId.get(userId).socketId !== socket.id))) {
      userId = generateFriendlyId();
    } else if (!userId) {
      userId = generateFriendlyId();
    }

    const cleanName = userName && typeof userName === 'string' ? userName.slice(0, 30).trim() : `مستخدم ${userId.slice(-4)}`;

    const userInfo = {
      socketId: socket.id,
      userId,
      userName: cleanName,
      status: 'idle',
      partnerSocketId: null
    };

    usersByUserId.set(userId, userInfo);
    usersBySocketId.set(socket.id, userInfo);

    socket.emit('registered', {
      userId,
      userName: userInfo.userName,
      socketId: socket.id
    });

    console.log(`[Registered] ${userId} (${userInfo.userName}) on socket ${socket.id}`);
  });

  // 2. Direct Call Request (Caller -> Callee)
  socket.on('call-user', ({ userToCall, offer, callType, callerName }) => {
    const caller = usersBySocketId.get(socket.id);
    const targetId = userToCall ? String(userToCall).toUpperCase().trim() : null;

    if (!caller) {
      socket.emit('call-error', { message: 'يجب تسجيل الدخول أولاً' });
      return;
    }

    if (!targetId || targetId === caller.userId) {
      socket.emit('call-error', { message: 'لا يمكنك الاتصال بنفسك!' });
      return;
    }

    const targetUser = usersByUserId.get(targetId);
    if (!targetUser) {
      socket.emit('call-error', { message: `المستخدم (${targetId}) غير متصل حاليًا` });
      return;
    }

    if (targetUser.status === 'in-call') {
      socket.emit('call-error', { message: `المستخدم (${targetId}) في مكالمة أخرى حاليًا` });
      return;
    }

    caller.status = 'calling';
    caller.partnerSocketId = targetUser.socketId;

    console.log(`[Call Request] ${caller.userId} -> ${targetId} [${callType || 'video'}]`);

    io.to(targetUser.socketId).emit('incoming-call', {
      callerId: caller.userId,
      callerName: callerName || caller.userName || caller.userId,
      callerSocketId: socket.id,
      offer,
      callType: callType || 'video'
    });
  });

  // 3. Answer Call (Callee -> Caller)
  socket.on('answer-call', ({ targetSocketId, targetUserId, answer }) => {
    const receiver = usersBySocketId.get(socket.id);
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);

    if (destSocketId) {
      const callerUser = usersBySocketId.get(destSocketId);
      if (receiver) {
        receiver.status = 'in-call';
        receiver.partnerSocketId = destSocketId;
      }
      if (callerUser) {
        callerUser.status = 'in-call';
        callerUser.partnerSocketId = socket.id;
      }

      console.log(`[Call Answered] ${receiver ? receiver.userId : socket.id} accepted call from socket ${destSocketId}`);
      io.to(destSocketId).emit('call-accepted', {
        answer,
        answeredBy: receiver ? receiver.userId : 'الطرف الآخر',
        responderSocketId: socket.id
      });
    } else {
      console.warn(`[Answer Error] Target socket ${destSocketId} not found`);
    }
  });

  // 4. Relay ICE Candidates
  socket.on('ice-candidate', ({ targetSocketId, targetUserId, candidate }) => {
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);
    if (destSocketId && candidate) {
      io.to(destSocketId).emit('ice-candidate', {
        candidate,
        fromSocketId: socket.id
      });
    }
  });

  // 5. Reject Call
  socket.on('reject-call', ({ targetSocketId, targetUserId, reason }) => {
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);
    const rejector = usersBySocketId.get(socket.id);
    if (rejector) {
      rejector.status = 'idle';
      rejector.partnerSocketId = null;
    }

    if (destSocketId) {
      const callerUser = usersBySocketId.get(destSocketId);
      if (callerUser) {
        callerUser.status = 'idle';
        callerUser.partnerSocketId = null;
      }
      console.log(`[Call Rejected] Call to ${destSocketId} was rejected: ${reason || ''}`);
      io.to(destSocketId).emit('call-rejected', {
        reason: reason || 'تم رفض المكالمة من الطرف الآخر'
      });
    }
  });

  // 6. End Call
  socket.on('end-call', ({ targetSocketId, targetUserId }) => {
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);
    const user = usersBySocketId.get(socket.id);

    if (user) {
      user.status = 'idle';
      user.partnerSocketId = null;
    }

    if (destSocketId) {
      const partner = usersBySocketId.get(destSocketId);
      if (partner) {
        partner.status = 'idle';
        partner.partnerSocketId = null;
      }
      io.to(destSocketId).emit('call-ended', {
        message: 'تم إنهاء المكالمة'
      });
    }
    console.log(`[Call Ended] Call between ${socket.id} and ${destSocketId} ended`);
  });

  // 7. Instant Chat Message
  socket.on('send-message', ({ targetSocketId, targetUserId, message, timestamp }) => {
    const sender = usersBySocketId.get(socket.id);
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);

    if (destSocketId && message) {
      io.to(destSocketId).emit('receive-message', {
        from: sender ? sender.userName || sender.userId : 'الطرف الآخر',
        message: String(message).slice(0, 1000),
        timestamp: timestamp || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 8. Floating Reactions Relay
  socket.on('send-reaction', ({ targetSocketId, targetUserId, emoji }) => {
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);
    if (destSocketId && emoji) {
      io.to(destSocketId).emit('receive-reaction', {
        emoji: String(emoji).slice(0, 4),
        fromSocketId: socket.id
      });
    }
  });

  // 9. Disconnect Cleanup & Reconnection Alert
  socket.on('disconnect', () => {
    const user = usersBySocketId.get(socket.id);
    if (user) {
      // If user was in call, alert their partner immediately
      if (user.partnerSocketId) {
        io.to(user.partnerSocketId).emit('call-ended', {
          message: 'انقطع اتصال الطرف الآخر بالسيرفر'
        });
        const partner = usersBySocketId.get(user.partnerSocketId);
        if (partner) {
          partner.status = 'idle';
          partner.partnerSocketId = null;
        }
      }

      usersByUserId.delete(user.userId);
      usersBySocketId.delete(socket.id);
      console.log(`[-] Disconnected: ${user.userId} (${socket.id})`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`
  ======================================================
  🚀 ConnectPulse WebRTC Server Running
  📡 Local: http://localhost:${PORT}
  🩺 Health: http://localhost:${PORT}/health
  ======================================================
  `);
});
