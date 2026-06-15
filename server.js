const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

// CORS (Güvenlik) İzinleri eklendi
const io = new Server(server, {
   cors: {
      origin: "*",
      methods: ["GET", "POST"]
   }
});

const { ExpressPeerServer } = require('peer');

// PeerJS için CORS ayarları eklendi
const peerServer = ExpressPeerServer(server, {
   debug: true,
   path: '/',
   corsOptions: { origin: '*' }
});

app.use('/peerjs', peerServer);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

const crypto = require('crypto');

// USERS FILE DATABASE
const USERS_FILE = path.join(__dirname, 'users.json');
let usersDb = {};
try {
   if (fs.existsSync(USERS_FILE)) {
      usersDb = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
   } else {
      fs.writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Kullanıcılar yüklenirken hata oluştu:", err);
}

function saveUsers() {
   try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2), 'utf8');
   } catch (err) {
      console.error("Kullanıcılar kaydedilirken hata oluştu:", err);
   }
}

// CRYPTO HELPERS FOR PASSWORDS
function hashPassword(password) {
   const salt = crypto.randomBytes(16).toString('hex');
   const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
   return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
   if (!storedPassword || !storedPassword.includes(':')) return false;
   const [salt, hash] = storedPassword.split(':');
   const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
   return hash === verifyHash;
}

// PURE NODE.JS JWT SYSTEM (ZERO DEPENDENCIES)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function generateToken(payload) {
   const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
   const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
   const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
   return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
   try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [header, body, signature] = parts;
      const validSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
      if (signature !== validSignature) return null;
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
   } catch (e) {
      return null;
   }
}

function decodeJwt(token) {
   try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
      return JSON.parse(payloadJson);
   } catch (e) {
      return null;
   }
}

// CONFIG ENDPOINT
app.get('/api/config', (req, res) => {
   res.json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || ""
   });
});

// AUTH MIDDLEWARE
function authenticateToken(req, res, next) {
   const authHeader = req.headers.authorization;
   const token = authHeader && authHeader.split(' ')[1];
   if (!token) return res.status(401).json({ error: 'Token bulunamadı.' });

   const payload = verifyToken(token);
   if (!payload) return res.status(403).json({ error: 'Geçersiz veya süresi dolmuş token.' });

   req.user = payload;
   next();
}

// GET CURRENT USER (/api/auth/me)
app.get('/api/auth/me', (req, res) => {
   const authHeader = req.headers.authorization;
   const token = authHeader && authHeader.split(' ')[1];
   if (!token) return res.status(401).json({ error: 'Token bulunamadı.' });

   const payload = verifyToken(token);
   if (!payload) return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });

   const user = usersDb[payload.userId];
   if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

   res.json({
      success: true,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         isAdmin: user.isAdmin
      }
   });
});

// REGISTER ENDPOINT
app.post('/api/auth/register', (req, res) => {
   const { username, email, password } = req.body;
   if (!username || !email || !password) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
   }

   const normalizedEmail = email.toLowerCase().trim();
   
   // Check if user exists
   const existingUser = Object.values(usersDb).find(u => u.email === normalizedEmail);
   if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta adresiyle zaten kayıtlı bir kullanıcı var.' });
   }

   const userId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
   
   usersDb[userId] = {
      id: userId,
      username: username.trim(),
      email: normalizedEmail,
      password: hashPassword(password),
      avatar: '',
      isAdmin: false
   };

   saveUsers();

   const token = generateToken({ userId: userId });
   res.json({
      success: true,
      token,
      user: {
         id: userId,
         username: usersDb[userId].username,
         email: normalizedEmail,
         avatar: '',
         isAdmin: false
      }
   });
});

// LOGIN ENDPOINT
app.post('/api/auth/login', (req, res) => {
   const { email, password } = req.body;
   if (!email || !password) {
      return res.status(400).json({ error: 'Lütfen e-posta ve şifrenizi girin.' });
   }

   const normalizedEmail = email.toLowerCase().trim();
   const user = Object.values(usersDb).find(u => u.email === normalizedEmail);

   if (!user || !user.password || !verifyPassword(password, user.password)) {
      return res.status(400).json({ error: 'E-posta veya şifre hatalı.' });
   }

   const token = generateToken({ userId: user.id });
   res.json({
      success: true,
      token,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         isAdmin: user.isAdmin
      }
   });
});

// GOOGLE SIGN IN
app.post('/api/auth/google', (req, res) => {
   const { credential, mock, email, name, picture } = req.body;
   let googleEmail, googleName, googlePicture, googleSub;

   if (mock) {
      if (!email) return res.status(400).json({ error: 'Mock e-posta adresi eksik.' });
      googleEmail = email.toLowerCase().trim();
      googleName = name || googleEmail.split('@')[0];
      googlePicture = picture || '';
      googleSub = 'mock_google_' + googleEmail;
   } else {
      if (!credential) return res.status(400).json({ error: 'Google kimlik verisi eksik.' });
      const decoded = decodeJwt(credential);
      if (!decoded || (decoded.iss !== 'accounts.google.com' && decoded.iss !== 'https://accounts.google.com')) {
         return res.status(400).json({ error: 'Geçersiz Google kimlik doğrulaması.' });
      }
      googleEmail = decoded.email.toLowerCase().trim();
      googleName = decoded.name;
      googlePicture = decoded.picture || '';
      googleSub = decoded.sub;
   }

   // Find or create user
   let user = Object.values(usersDb).find(u => u.email === googleEmail || u.googleId === googleSub);

   if (!user) {
      const userId = 'user_g_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
      usersDb[userId] = {
         id: userId,
         username: googleName,
         email: googleEmail,
         googleId: googleSub,
         avatar: googlePicture,
         isAdmin: false
      };
      user = usersDb[userId];
      saveUsers();
   } else {
      // Update avatar if we got it from google and didn't have one before
      let changed = false;
      if (googlePicture && !user.avatar) {
         user.avatar = googlePicture;
         changed = true;
      }
      if (googleSub && !user.googleId) {
         user.googleId = googleSub;
         changed = true;
      }
      if (changed) saveUsers();
   }

   const token = generateToken({ userId: user.id });
   res.json({
      success: true,
      token,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         isAdmin: user.isAdmin
      }
   });
});

// PROFILE UPDATE ENDPOINT
app.post('/api/users/profile', authenticateToken, (req, res) => {
   const { username, avatar, adminToken } = req.body;
   const userId = req.user.userId;

   const user = usersDb[userId];
   if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

   if (username && username.trim()) {
      user.username = username.trim();
   }

   if (avatar !== undefined) {
      user.avatar = avatar;
   }

   // Update Admin status if adminToken is passed
   if (adminToken !== undefined) {
      user.isAdmin = (adminToken === ADMIN_KEY);
   }

   saveUsers();

   res.json({
      success: true,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         isAdmin: user.isAdmin
      }
   });
});

const CHANNELS_FILE = path.join(__dirname, 'channels.json');
let textRooms = { 'genel': {}, 'oyun': {}, 'muzik': {} };
// Ses odalarında artık { username, mic: true|false, deaf: true|false } objesi saklanıyor
let voiceRooms = { 'sohbet': {}, 'oyun': {}, 'sessiz': {} };

try {
   if (fs.existsSync(CHANNELS_FILE)) {
      const fileContent = fs.readFileSync(CHANNELS_FILE, 'utf8');
      const data = JSON.parse(fileContent);
      textRooms = {};
      data.text.forEach(ch => { textRooms[ch] = {}; });
      
      voiceRooms = {};
      data.voice.forEach(ch => { voiceRooms[ch] = {}; });
   } else {
      fs.writeFileSync(CHANNELS_FILE, JSON.stringify({ text: Object.keys(textRooms), voice: Object.keys(voiceRooms) }, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Kanallar yüklenirken hata oluştu:", err);
}

function saveChannels() {
   try {
      fs.writeFileSync(CHANNELS_FILE, JSON.stringify({ text: Object.keys(textRooms), voice: Object.keys(voiceRooms) }, null, 2), 'utf8');
   } catch (err) {
      console.error("Kanallar kaydedilirken hata oluştu:", err);
   }
}

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
let messageHistory = {};
for (let r in textRooms) {
   messageHistory[r] = [];
}

// Load messages history on start
try {
   if (fs.existsSync(MESSAGES_FILE)) {
      const fileContent = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messageHistory = JSON.parse(fileContent);
      let dirty = false;
      for (let r in textRooms) {
         if (!messageHistory[r]) messageHistory[r] = [];
         messageHistory[r].forEach(msg => {
            if (!msg.id) {
               msg.id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
               dirty = true;
            }
         });
      }
      if (dirty) {
         saveMessages();
      }
   } else {
      for (let r in textRooms) {
         if (!messageHistory[r]) messageHistory[r] = [];
      }
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messageHistory, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Mesajlar yüklenirken hata oluştu:", err);
}

function saveMessages() {
   try {
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messageHistory, null, 2), 'utf8');
   } catch (err) {
      console.error("Mesajlar kaydedilirken hata oluştu:", err);
   }
}

const allTimeUsers = {};
const ADMIN_KEY = process.env.ADMIN_KEY || "berzan123";

io.on('connection', (socket) => {
   socket.voiceState = { mic: true, deaf: false }; // Kullanıcının varsayılan donanım durumu

   socket.on('register', (peerId, username, userId, avatar, adminToken) => {
      const uId = userId || peerId;
      socket.peerId = peerId;
      
      // Get stored user info from DB if possible
      let finalUsername = username;
      let finalAvatar = avatar || '';
      let isAdmin = (adminToken === ADMIN_KEY);
      
      if (usersDb[uId]) {
         finalUsername = usersDb[uId].username || username;
         finalAvatar = usersDb[uId].avatar || avatar || '';
         isAdmin = usersDb[uId].isAdmin || isAdmin;
      }
      
      socket.username = finalUsername;
      socket.userId = uId;
      socket.avatar = finalAvatar;
      socket.isAdmin = isAdmin;

      allTimeUsers[uId] = {
         username: finalUsername,
         isOnline: true,
         peerId: peerId,
         userId: uId,
         avatar: finalAvatar,
         isAdmin: isAdmin
      };

      io.emit('global-users', allTimeUsers);
      socket.emit('voice-rooms-state', voiceRooms);
      socket.emit('admin-status', isAdmin);
      socket.emit('channels-list', { text: Object.keys(textRooms), voice: Object.keys(voiceRooms) });
   });

   // METİN
   socket.on('join-text-room', (roomId) => {
      if (socket.textRoom) {
         socket.leave('text-' + socket.textRoom);
         if (textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
      }
      socket.textRoom = roomId;
      if (!textRooms[roomId]) textRooms[roomId] = {};
      textRooms[roomId][socket.peerId] = socket.username;
      socket.join('text-' + roomId);

      // Emit chat history to user
      socket.emit('chat-history', messageHistory[roomId] || []);
   });

   socket.on('chat-message', (message) => {
      if (socket.textRoom && socket.username) {
         const roomId = socket.textRoom;
         const msgObj = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            sender: socket.username,
            text: message,
            timestamp: Date.now()
         };

         if (!messageHistory[roomId]) messageHistory[roomId] = [];
         messageHistory[roomId].push(msgObj);

         if (messageHistory[roomId].length > 100) {
            messageHistory[roomId].shift();
         }

         saveMessages();

         io.to('text-' + roomId).emit('create-message', message, socket.username, msgObj.id);
      }
   });

   socket.on('delete-message', (msgId) => {
      if (!socket.isAdmin) return;
      let deleted = false;
      for (let room in messageHistory) {
         const index = messageHistory[room].findIndex(m => m.id === msgId);
         if (index !== -1) {
            messageHistory[room].splice(index, 1);
            deleted = true;
            break;
         }
      }
      if (deleted) {
         saveMessages();
         io.emit('message-deleted', msgId);
      }
   });

   // SES ODASI GİRİŞ KONTROLLERİ VE DONANIM BİLGİSİ YAYINI
   socket.on('join-voice-room', (roomId) => {
      if (socket.voiceRoom) {
         socket.leave('voice-' + socket.voiceRoom);
         if (voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
      }

      socket.voiceRoom = roomId;
      if (roomId) {
         if (!voiceRooms[roomId]) voiceRooms[roomId] = {};

         socket.emit('voice-join-success', voiceRooms[roomId]);

         // Artık odada sadece ismimizi değil, donanım (mikrofon/kulaklık) verimizi de tutuyoruz!
         voiceRooms[roomId][socket.peerId] = {
            username: socket.username,
            mic: socket.voiceState.mic,
            deaf: socket.voiceState.deaf,
            avatar: socket.avatar || ''
         };

         socket.join('voice-' + roomId);
      }
      io.emit('voice-rooms-state', voiceRooms);
   });

   socket.on('get-voice-state', () => {
      socket.emit('voice-rooms-state', voiceRooms);
   });

   // KULLANICI MİKROFON/KULAKLIK KAPATTIĞINDA SUNUCUYU HABERDAR EDEN YENİ EVENT
   socket.on('voice-state-update', (state) => {
      socket.voiceState = state; // Gelen objeyi kaydet: { mic: false, deaf: false } vb.

      if (socket.voiceRoom && voiceRooms[socket.voiceRoom] && voiceRooms[socket.voiceRoom][socket.peerId]) {
         voiceRooms[socket.voiceRoom][socket.peerId].mic = state.mic;
         voiceRooms[socket.voiceRoom][socket.peerId].deaf = state.deaf;

         // Herkese duyur ki listede mute/deaf ikonlarını kırmızı yaksınlar!
         io.emit('voice-rooms-state', voiceRooms);
      }
   });

   // ADMİN İŞLEMLERİ (KANAL YÖNETİMİ & ATMA)
   socket.on('create-channel', ({ name, type }) => {
      if (!socket.isAdmin) return;
      if (type === 'text') {
         if (!textRooms[name]) {
            textRooms[name] = {};
            if (!messageHistory[name]) messageHistory[name] = [];
            saveChannels();
            io.emit('channels-list', { text: Object.keys(textRooms), voice: Object.keys(voiceRooms) });
         }
      } else if (type === 'voice') {
         if (!voiceRooms[name]) {
            voiceRooms[name] = {};
            saveChannels();
            io.emit('channels-list', { text: Object.keys(textRooms), voice: Object.keys(voiceRooms) });
         }
      }
   });

   socket.on('delete-channel', ({ name, type }) => {
      if (!socket.isAdmin) return;
      if (type === 'text' && name !== 'genel') {
         delete textRooms[name];
         delete messageHistory[name];
         saveChannels();
         saveMessages();
         io.emit('channels-list', { text: Object.keys(textRooms), voice: Object.keys(voiceRooms) });
      } else if (type === 'voice') {
         delete voiceRooms[name];
         saveChannels();
         io.emit('channels-list', { text: Object.keys(textRooms), voice: Object.keys(voiceRooms) });
      }
   });

   socket.on('kick-from-voice', (targetPeerId) => {
      if (!socket.isAdmin) return;
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.peerId === targetPeerId);
      if (targetSocket) {
         targetSocket.emit('kicked-from-voice');
      }
   });

   socket.on('kick-from-server', (targetUserId) => {
      if (!socket.isAdmin) return;
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.userId === targetUserId);
      if (targetSocket) {
         targetSocket.emit('kicked-from-server');
         targetSocket.disconnect(true);
      }
   });

   socket.on('pin-message', (msgId) => {
      let roomId = socket.textRoom;
      if (!roomId) return;
      const msg = messageHistory[roomId].find(m => m.id === msgId);
      if (msg) {
         msg.pinned = !msg.pinned;
         saveMessages();
         io.to('text-' + roomId).emit('message-pinned-status', msgId, msg.pinned, msg);
         
         // System message notification
         if (msg.pinned) {
            const sysMsg = {
               id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
               sender: 'Sistem',
               text: `${socket.username || 'Bir kullanıcı'} bir mesajı bu kanala sabitledi.`,
               timestamp: Date.now(),
               isSystem: true,
               pinnedMsgId: msgId
            };
            messageHistory[roomId].push(sysMsg);
            saveMessages();
            io.to('text-' + roomId).emit('create-message', sysMsg.text, sysMsg.sender, sysMsg.id, sysMsg.isSystem);
         } else {
            // Unpinned! Find and remove the linked system message
            const sysIndex = messageHistory[roomId].findIndex(m => m.isSystem && m.pinnedMsgId === msgId);
            if (sysIndex !== -1) {
               const sysMsgId = messageHistory[roomId][sysIndex].id;
               messageHistory[roomId].splice(sysIndex, 1);
               saveMessages();
               io.to('text-' + roomId).emit('message-deleted', sysMsgId);
            }
         }
      }
   });

   socket.on('bulk-delete-messages', (msgIds) => {
      if (!socket.isAdmin) return;
      let roomId = socket.textRoom;
      if (!roomId || !Array.isArray(msgIds)) return;
      messageHistory[roomId] = messageHistory[roomId].filter(m => !msgIds.includes(m.id));
      saveMessages();
      io.to('text-' + roomId).emit('messages-bulk-deleted', msgIds);
   });

   socket.on('start-screen-share', () => {
      if (socket.voiceRoom && voiceRooms[socket.voiceRoom] && voiceRooms[socket.voiceRoom][socket.peerId]) {
         voiceRooms[socket.voiceRoom][socket.peerId].isSharingScreen = true;
         io.emit('voice-rooms-state', voiceRooms);
      }
   });

   socket.on('stop-screen-share', () => {
      if (socket.voiceRoom && voiceRooms[socket.voiceRoom] && voiceRooms[socket.voiceRoom][socket.peerId]) {
         voiceRooms[socket.voiceRoom][socket.peerId].isSharingScreen = false;
         io.emit('voice-rooms-state', voiceRooms);
      }
   });

   socket.on('request-screen-share-stream', ({ targetPeerId, requesterPeerId }) => {
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.peerId === targetPeerId);
      if (targetSocket) {
         targetSocket.emit('screen-share-requested', { requesterPeerId });
      }
   });

   socket.on('disconnect', () => {
      if (socket.textRoom && socket.peerId) {
         if (textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
      }
      if (socket.voiceRoom && socket.peerId) {
         if (voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
         io.emit('voice-rooms-state', voiceRooms);
      }

      if (socket.userId && allTimeUsers[socket.userId]) {
         allTimeUsers[socket.userId].isOnline = false;
         io.emit('global-users', allTimeUsers);
      }
   });
});

// Render'ın uygulamayı bulabilmesi için host ayarı 0.0.0.0 olarak güncellendi
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
   console.log(`Sunucu Başladı: Port ${PORT}`);
});