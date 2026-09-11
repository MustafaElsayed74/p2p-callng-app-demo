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
  }
});

const PORT = process.env.PORT || 3500;

app.use(express.static(path.join(__dirname, 'public')));

// In-memory user tracking:
// usersByUserId: userId -> { socketId, userId, userName }
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
  console.log(`[+] New Socket Connected: ${socket.id}`);

  // 1. User Registration
  socket.on('register-user', ({ preferredId, userName }) => {
    let userId = preferredId ? preferredId.toUpperCase().trim() : null;
    
    // If ID already taken by another active socket, assign new one
    if (!userId || (usersByUserId.has(userId) && usersByUserId.get(userId).socketId !== socket.id)) {
      userId = generateFriendlyId();
    }

    const userInfo = {
      socketId: socket.id,
      userId,
      userName: userName || `مستخدم ${userId.slice(-4)}`
    };

    usersByUserId.set(userId, userInfo);
    usersBySocketId.set(socket.id, userInfo);

    socket.emit('registered', {
      userId,
      userName: userInfo.userName,
      socketId: socket.id
    });

    console.log(`[Registered] ${userId} on Socket ${socket.id}`);
  });

  // 2. Direct Call Request (Caller -> Callee)
  socket.on('call-user', ({ userToCall, offer, callType, callerName }) => {
    const caller = usersBySocketId.get(socket.id);
    const targetId = userToCall ? userToCall.toUpperCase().trim() : null;

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

    console.log(`[Call Request] ${caller.userId} (${socket.id}) -> ${targetId} (${targetUser.socketId}) [${callType}]`);

    // Forward call with exact socket IDs for 100% direct routing
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

  // 4. Relay ICE Candidates directly via Socket ID
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
    if (destSocketId) {
      console.log(`[Call Rejected] Call from ${destSocketId} was rejected`);
      io.to(destSocketId).emit('call-rejected', {
        reason: reason || 'تم رفض المكالمة من الطرف الآخر'
      });
    }
  });

  // 6. End Call
  socket.on('end-call', ({ targetSocketId, targetUserId }) => {
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);
    if (destSocketId) {
      io.to(destSocketId).emit('call-ended', {
        message: 'تم إنهاء المكالمة'
      });
    }
    console.log(`[Call Ended] Call with ${destSocketId} ended`);
  });

  // 7. Instant Chat Message
  socket.on('send-message', ({ targetSocketId, targetUserId, message, timestamp }) => {
    const sender = usersBySocketId.get(socket.id);
    const destSocketId = targetSocketId || (usersByUserId.get(targetUserId) ? usersByUserId.get(targetUserId).socketId : null);

    if (destSocketId) {
      io.to(destSocketId).emit('receive-message', {
        from: sender ? sender.userId : 'الطرف الآخر',
        message,
        timestamp: timestamp || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 8. Disconnect Cleanup
  socket.on('disconnect', () => {
    const user = usersBySocketId.get(socket.id);
    if (user) {
      usersByUserId.delete(user.userId);
      usersBySocketId.delete(socket.id);
      console.log(`[-] Disconnected: ${user.userId} (${socket.id})`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 WebRTC Calling Server running on http://localhost:${PORT}`);
});
