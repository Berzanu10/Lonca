const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { ExpressPeerServer } = require('peer');

// PeerJS signalleme sunucusu
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/'
});

app.use('/peerjs', peerServer);
app.use(express.static('public'));

// Odalardaki kullanıcıları tutuyoruz: roomName -> { peerId: username }
const rooms = {
  'genel': {},
  'oyun': {},
  'muzik': {}
};

io.on('connection', (socket) => {
  
  socket.on('join-room', (roomId, peerId, username) => {
    // Eger belirtilen oda ilk defa oluşturuluyorsa (esneklik açısından)
    if (!rooms[roomId]) rooms[roomId] = {};
    
    // Kullanıcı zaten başka bir odadaysa, önce o odadan çıkart
    if (socket.roomId && socket.roomId !== roomId) {
       socket.leave(socket.roomId);
       if (rooms[socket.roomId]) {
           delete rooms[socket.roomId][socket.peerId];
       }
       socket.to(socket.roomId).emit('user-disconnected', socket.peerId);
    }

    // Yeni odaya ekle
    socket.join(roomId);
    rooms[roomId][peerId] = username;
    
    // Bağlantı nesnesi üzerine bilgileri kopyala
    socket.peerId = peerId;
    socket.roomId = roomId;
    socket.username = username;

    // Bağlanılan odadaki güncel kullanıcı listesini sadece bağlanana gönder
    socket.emit('current-users', rooms[roomId]);
    
    // Odadaki diğerlerine yeni birinin girdiğini haber ver
    socket.to(roomId).emit('user-connected', peerId, username);
  });

  // Gelen chat mesajlarını sadece kişinin bulunduğu odaya yolla
  socket.on('chat-message', (message) => {
    if(socket.roomId && socket.username) {
        // io.to, mesajı gönderen dahil odadaki herkese iletir (böylece mesaj başarılıysa geri ona da düşer)
        io.to(socket.roomId).emit('create-message', message, socket.username);
    }
  });

  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    if (socket.roomId && socket.peerId) {
      if(rooms[socket.roomId]) {
         delete rooms[socket.roomId][socket.peerId];
      }
      socket.to(socket.roomId).emit('user-disconnected', socket.peerId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Lonca Sunucusu Başladı! Web tarayıcınızda http://localhost:${PORT} adresine gidin.`);
});
