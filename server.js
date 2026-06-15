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
app.use(express.static('public'));

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
      for (let r in textRooms) {
         if (!messageHistory[r]) messageHistory[r] = [];
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
      socket.username = username;
      socket.userId = uId;
      socket.avatar = avatar || '';
      
      const isAdmin = (adminToken === ADMIN_KEY);
      socket.isAdmin = isAdmin;

      allTimeUsers[uId] = {
         username: username,
         isOnline: true,
         peerId: peerId,
         userId: uId,
         avatar: avatar || '',
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