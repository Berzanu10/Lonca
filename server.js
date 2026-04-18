const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { ExpressPeerServer } = require('peer');

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/'
});

app.use('/peerjs', peerServer);
app.use(express.static('public'));

// İki farklı kanal yapısı: Metin ve Ses
const textRooms = { 'genel': {}, 'oyun': {}, 'muzik': {} };
const voiceRooms = { 'sohbet': {}, 'oyun': {}, 'sessiz': {} };

io.on('connection', (socket) => {
  
  // Ana Kullanıcı Kaydı Eşleştirmesi
  socket.on('register', (peerId, username) => {
     socket.peerId = peerId;
     socket.username = username;
     
     // Sadece sesli odaların anlık listesini herkese Sidebar için yolla
     socket.emit('voice-rooms-state', voiceRooms);
  });

  // ========== METİN KANALLARI MANTIĞI ==========
  socket.on('join-text-room', (roomId) => {
    // Eski bir metin kanalında ise çıkış yapalım
    if (socket.textRoom) {
       socket.leave('text-' + socket.textRoom);
       if (textRooms[socket.textRoom]) {
           delete textRooms[socket.textRoom][socket.peerId];
       }
       socket.to('text-' + socket.textRoom).emit('text-user-disconnected', socket.peerId);
    }
    
    // Yeni kanala uye yap
    socket.textRoom = roomId;
    if(!textRooms[roomId]) textRooms[roomId] = {};
    textRooms[roomId][socket.peerId] = socket.username;
    
    socket.join('text-' + roomId);
    // Oda bilgisini dön
    socket.emit('text-current-users', textRooms[roomId]);
    socket.to('text-' + roomId).emit('text-user-connected', socket.peerId, socket.username);
  });

  socket.on('chat-message', (message) => {
    if(socket.textRoom && socket.username) {
        // io.to, bu özel prefix'li odadaki herkese (kendisi dahil) yayınlar
        io.to('text-' + socket.textRoom).emit('create-message', message, socket.username);
    }
  });

  // ========== SES KANALLARI MANTIĞI ==========
  socket.on('join-voice-room', (roomId) => {
     // Eski sesten cikis
     if(socket.voiceRoom) {
         socket.leave('voice-' + socket.voiceRoom);
         if(voiceRooms[socket.voiceRoom]) {
             delete voiceRooms[socket.voiceRoom][socket.peerId];
         }
     }
     
     socket.voiceRoom = roomId;
     if (roomId) { // Kullanıcı odayı kapat butonuna basmadıysa ID ile gelmiştir
         if(!voiceRooms[roomId]) voiceRooms[roomId] = {};
         
         // Yeni giriş yapan kişiye içerideki eski elemanların listesini veriyoruz (P2P Mesh ses araması kurması için)
         socket.emit('voice-join-success', voiceRooms[roomId]);
         
         voiceRooms[roomId][socket.peerId] = socket.username;
         socket.join('voice-' + roomId);
     }
     
     // Sağ/Sol menü için tüm ağa anlık sesli kanal mevcudiyetini yayınla
     io.emit('voice-rooms-state', voiceRooms);
  });

  // ========== BAĞLANTI KOPMASI ==========
  socket.on('disconnect', () => {
    if(socket.textRoom && socket.peerId) {
       if(textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
       socket.to('text-' + socket.textRoom).emit('text-user-disconnected', socket.peerId);
    }
    if(socket.voiceRoom && socket.peerId) {
       if(voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
       io.emit('voice-rooms-state', voiceRooms); // Herkeste sidebar'ı güncelle ki odadan silinsin
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu Başladı: http://localhost:${PORT}`);
});
