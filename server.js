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
// Ses odalarında artık { username, mic: true|false, deaf: true|false } objesi saklanıyor
const voiceRooms = { 'sohbet': {}, 'oyun': {}, 'sessiz': {} };

const allTimeUsers = {}; 

io.on('connection', (socket) => {
  let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.conn.remoteAddress || 'unknown';
  if(clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0];
  
  socket.clientIp = clientIp;
  socket.voiceState = { mic: true, deaf: false }; // Kullanıcının varsayılan donanım durumu

  socket.on('register', (peerId, username) => {
     socket.peerId = peerId;
     socket.username = username;
     
     allTimeUsers[socket.clientIp] = {
         username: username,
         isOnline: true,
         peerId: peerId
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
    if(!textRooms[roomId]) textRooms[roomId] = {};
    textRooms[roomId][socket.peerId] = socket.username;
    socket.join('text-' + roomId);
  });

  socket.on('chat-message', (message) => {
    if(socket.textRoom && socket.username) {
        io.to('text-' + socket.textRoom).emit('create-message', message, socket.username);
    }
  });

  // SES ODASI GİRİŞ KONTROLLERİ VE DONANIM BİLGİSİ YAYINI
  socket.on('join-voice-room', (roomId) => {
     if(socket.voiceRoom) {
         socket.leave('voice-' + socket.voiceRoom);
         if(voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
     }
     
     socket.voiceRoom = roomId;
     if (roomId) {
         if(!voiceRooms[roomId]) voiceRooms[roomId] = {};
         
         socket.emit('voice-join-success', voiceRooms[roomId]);
         
         // Artık odada sadece ismimizi değil, donanım (mikrofon/kulaklık) verimizi de tutuyoruz!
         voiceRooms[roomId][socket.peerId] = {
             username: socket.username,
             mic: socket.voiceState.mic,
             deaf: socket.voiceState.deaf
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
    if(socket.textRoom && socket.peerId) {
       if(textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
    }
    if(socket.voiceRoom && socket.peerId) {
       if(voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
       io.emit('voice-rooms-state', voiceRooms);
    }
    
    if(socket.peerId && allTimeUsers[socket.clientIp]) {
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
