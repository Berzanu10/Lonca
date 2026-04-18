const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { ExpressPeerServer } = require('peer');

const peerServer = ExpressPeerServer(server, { debug: true, path: '/' });
app.use('/peerjs', peerServer);
app.use(express.static('public'));

const textRooms = { 'genel': {}, 'oyun': {}, 'muzik': {} };
const voiceRooms = { 'sohbet': {}, 'oyun': {}, 'sessiz': {} };

// GLOBAL KULLANICI İZLEME (IP TABANLI)
const allTimeUsers = {}; // clientIp -> { username, isOnline, peerId }

io.on('connection', (socket) => {
  // En güvenilir şekilde Client IP bulma (Localtunnel/Proxy desteği)
  let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.conn.remoteAddress || 'unknown';
  if(clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0]; // Eğer birden çok proxy varsa asıl public ip'yi al
  
  socket.clientIp = clientIp;

  socket.on('register', (peerId, username) => {
     socket.peerId = peerId;
     socket.username = username;
     
     // AYNI IP farklı isimle girerse tamamen üzerine yazar = 1 IP'den 1 Hesap mantığı
     allTimeUsers[socket.clientIp] = {
         username: username,
         isOnline: true,
         peerId: peerId
     };
     
     io.emit('global-users', allTimeUsers);
     socket.emit('voice-rooms-state', voiceRooms);
  });

  // ========== METİN KANALLARI ==========
  socket.on('join-text-room', (roomId) => {
    if (socket.textRoom) {
       socket.leave('text-' + socket.textRoom);
       if (textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
    }
    
    socket.textRoom = roomId;
    if(!textRooms[roomId]) textRooms[roomId] = {};
    textRooms[roomId][socket.peerId] = socket.username;
    
    socket.join('text-' + roomId);
  });

  socket.on('chat-message', (message) => {
    if(socket.textRoom && socket.username) {
        io.to('text-' + socket.textRoom).emit('create-message', message, socket.username);
    }
  });

  // ========== SES KANALLARI ==========
  socket.on('join-voice-room', (roomId) => {
     if(socket.voiceRoom) {
         socket.leave('voice-' + socket.voiceRoom);
         if(voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
     }
     
     socket.voiceRoom = roomId;
     if (roomId) {
         if(!voiceRooms[roomId]) voiceRooms[roomId] = {};
         // Eski katılanların listesini don
         socket.emit('voice-join-success', voiceRooms[roomId]);
         
         voiceRooms[roomId][socket.peerId] = socket.username;
         socket.join('voice-' + roomId);
     }
     io.emit('voice-rooms-state', voiceRooms);
  });

  // ========== BAĞLANTI KOPMASI ==========
  socket.on('disconnect', () => {
    if(socket.textRoom && socket.peerId) {
       if(textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
    }
    if(socket.voiceRoom && socket.peerId) {
       if(voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
       io.emit('voice-rooms-state', voiceRooms);
    }
    
    // IP Global Listesini Çevrimdışı (Offline) Yapma
    if(socket.peerId && allTimeUsers[socket.clientIp]) {
       // Çıkan kişi gerçekten bu IP'nin son atanmış PeerID'si mi teyit et (aynı anlık çift sekme bugı var ise diye)
       if(allTimeUsers[socket.clientIp].peerId === socket.peerId) {
           allTimeUsers[socket.clientIp].isOnline = false;
       }
       io.emit('global-users', allTimeUsers);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu Başladı: http://localhost:${PORT}`);
});
