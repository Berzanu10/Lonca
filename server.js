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

const textRooms = { 'genel': {}, 'oyun': {}, 'muzik': {} };
// Ses odalarında artık { username, mic: true|false, deaf: true|false } objesi saklanıyor
const voiceRooms = { 'sohbet': {}, 'oyun': {}, 'sessiz': {} };

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
let messageHistory = { 'genel': [], 'oyun': [], 'muzik': [] };

// Load messages history on start
try {
   if (fs.existsSync(MESSAGES_FILE)) {
      const fileContent = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messageHistory = JSON.parse(fileContent);
   } else {
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

io.on('connection', (socket) => {
   socket.voiceState = { mic: true, deaf: false }; // Kullanıcının varsayılan donanım durumu

   socket.on('register', (peerId, username, userId, avatar) => {
      const uId = userId || peerId;
      socket.peerId = peerId;
      socket.username = username;
      socket.userId = uId;
      socket.avatar = avatar || '';

      allTimeUsers[uId] = {
         username: username,
         isOnline: true,
         peerId: peerId,
         userId: uId,
         avatar: avatar || ''
      };

      io.emit('global-users', allTimeUsers);
      socket.emit('voice-rooms-state', voiceRooms);
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

         io.to('text-' + roomId).emit('create-message', message, socket.username);
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