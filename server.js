const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { ExpressPeerServer } = require('peer');

// PeerJS signalleme (kimlik paylaşım) sunucusunu aynı portta başlatıyoruz
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/'
});

app.use('/peerjs', peerServer);
app.use(express.static('public'));

const roomUsers = {}; // 'lobi' ana odasındaki kullanıcılar: peerId -> username

io.on('connection', (socket) => {
  socket.on('join-room', (roomId, peerId, username) => {
    socket.join(roomId);
    roomUsers[peerId] = username;
    socket.peerId = peerId;
    socket.roomId = roomId;

    // Yeni bağlanan kullanıcıya mevcut kullanıcı listesini gönder
    socket.emit('current-users', roomUsers);
    
    // Odadaki diğer kullanıcılara yeni birinin katıldığını duyur
    socket.to(roomId).emit('user-connected', peerId, username);

    // Sohbet mesajı dağıtımı
    socket.on('chat-message', (message, senderName) => {
      io.to(roomId).emit('create-message', message, senderName);
    });

    // Kullanıcı koptuğunda
    socket.on('disconnect', () => {
      delete roomUsers[socket.peerId];
      socket.to(roomId).emit('user-disconnected', socket.peerId);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Lonca Sunucusu Başladı! Web tarayıcınızda http://localhost:${PORT} adresine gidin.`);
});
