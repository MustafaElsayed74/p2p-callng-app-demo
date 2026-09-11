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

// Serve static assets from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// In-memory user tracking:
// usersByUserId: userId -> { socketId, name, inCallWith: null }
// usersBySocketId: socketId -> userId
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
  // 1. User Registration
  socket.on('register-user', ({ preferredId, userName }) => {
    let userId = preferredId ? preferredId.toUpperCase().trim() : generateFriendlyId();
    
    // If ID already taken by someone else active, generate a new one
    if (usersByUserId.has(userId) && usersByUserId.get(userId).socketId !== socket.id) {
      userId = generateFriendlyId();
    }

    const userInfo = {
      userId,
      socketId: socket.id,
      userName: userName || `مستخدم ${userId.slice(-4)}`,
      inCallWith: null
    };

    usersByUserId.set(userId, userInfo);
    usersBySocketId.set(socket.id, userId);

    socket.emit('registered', {
      userId,
      userName: userInfo.userName
    });

    console.log(`[+] User Registered: ${userId} (${userInfo.userName}) [Socket: ${socket.id}]`);
  });

  // 2. Initiate Call (User A -> User B)
  socket.on('call-user', ({ userToCall, offer, callType, callerName }) => {
    const callerId = usersBySocketId.get(socket.id);
    const targetId = userToCall ? userToCall.toUpperCase().trim() : null;

    if (!callerId) {
      socket.emit('call-error', { message: 'يجب تسجيل الدخول أولاً' });
      return;
    }

    if (!targetId || targetId === callerId) {
      socket.emit('call-error', { message: 'لا يمكنك الاتصال بنفسك أو بكود فارغ!' });
      return;
    }

    const targetUser = usersByUserId.get(targetId);
    if (!targetUser) {
      socket.emit('call-error', { message: `المستخدم (${targetId}) غير متصل حاليًا` });
      return;
    }

    if (targetUser.inCallWith) {
      socket.emit('call-error', { message: `المستخدم (${targetId}) مشغول في مكالمة أخرى حاليًا` });
      return;
    }

    console.log(`[Call Request] ${callerId} calling ${targetId} (${callType})`);

    // Notify target user
    io.to(targetUser.socketId).emit('incoming-call', {
      callerId,
      callerName: callerName || callerId,
      offer,
      callType: callType || 'video'
    });
  });

  // 3. Answer Call (User B -> User A)
  socket.on('answer-call', ({ to, answer }) => {
    const receiverId = usersBySocketId.get(socket.id);
    const callerUser = usersByUserId.get(to);

    if (callerUser && receiverId) {
      const receiverUser = usersByUserId.get(receiverId);
      if (receiverUser) receiverUser.inCallWith = to;
      callerUser.inCallWith = receiverId;

      console.log(`[Call Answered] ${receiverId} accepted call from ${to}`);
      io.to(callerUser.socketId).emit('call-accepted', {
        answer,
        answeredBy: receiverId
      });
    }
  });

  // 4. Relay ICE Candidates
  socket.on('ice-candidate', ({ to, candidate }) => {
    const targetUser = usersByUserId.get(to);
    if (targetUser && candidate) {
      io.to(targetUser.socketId).emit('ice-candidate', {
        candidate,
        from: usersBySocketId.get(socket.id)
      });
    }
  });

  // 5. Reject Call
  socket.on('reject-call', ({ to, reason }) => {
    const targetUser = usersByUserId.get(to);
    if (targetUser) {
      console.log(`[Call Rejected] ${usersBySocketId.get(socket.id)} rejected call from ${to}`);
      io.to(targetUser.socketId).emit('call-rejected', {
        reason: reason || 'تم رفض المكالمة من الطرف الآخر'
      });
    }
  });

  // 6. End Call
  socket.on('end-call', ({ to }) => {
    const myId = usersBySocketId.get(socket.id);
    const myUser = myId ? usersByUserId.get(myId) : null;
    if (myUser) myUser.inCallWith = null;

    if (to) {
      const targetUser = usersByUserId.get(to);
      if (targetUser) {
        targetUser.inCallWith = null;
        io.to(targetUser.socketId).emit('call-ended', {
          by: myId,
          message: 'تم إنهاء المكالمة'
        });
      }
    }
    console.log(`[Call Ended] Call between ${myId} and ${to} ended`);
  });

  // 7. In-Call Chat Message
  socket.on('send-message', ({ to, message, timestamp }) => {
    const senderId = usersBySocketId.get(socket.id);
    const targetUser = usersByUserId.get(to);

    if (targetUser) {
      io.to(targetUser.socketId).emit('receive-message', {
        from: senderId,
        message,
        timestamp: timestamp || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 8. Disconnect Cleanup
  socket.on('disconnect', () => {
    const userId = usersBySocketId.get(socket.id);
    if (userId) {
      const user = usersByUserId.get(userId);
      if (user && user.inCallWith) {
        const partner = usersByUserId.get(user.inCallWith);
        if (partner) {
          partner.inCallWith = null;
          io.to(partner.socketId).emit('call-ended', {
            by: userId,
            message: 'انقطع اتصال الطرف الآخر'
          });
        }
      }
      usersByUserId.delete(userId);
      usersBySocketId.delete(socket.id);
      console.log(`[-] User Disconnected: ${userId}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 WebRTC Calling Server running on http://localhost:${PORT}`);
});
