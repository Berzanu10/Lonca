const socket = io('/');
let peer;
let myPeerId;
let myUsername;
let localStream;
let currentCall;

// DOM Elementleri
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');

const usersList = document.getElementById('users-list');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');
const hangupBtn = document.getElementById('hangup-btn');
const localLabel = document.getElementById('local-label');

let users = {}; // peerId -> username

// 1. Adaya giriş yap
joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        myUsername = name;
        localLabel.textContent = `${myUsername} (Sen)`;
        startApp();
    }
});

// Arayüzü başlat ve donanım izinlerini iste
function startApp() {
    loginScreen.style.display = 'none';
    appContainer.style.display = 'flex';

    // Kamerayı ve Mikrofonu İstiyoruz
    navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    }).then(stream => {
        localStream = stream;
        localVideo.srcObject = stream;
        initializePeer();
    }).catch(err => {
        console.error('Donanım erişim hatası:', err);
        alert("Kamera izni verilmedi. Sadece metin sohbeti yapabilirsiniz.");
        initializePeer();
    });
}

// 2. PeerJS (WebRTC) Ayarları
function initializePeer() {
    // Kendi Node.js sunucumuzda çalışan PeerServer'a bağlanıyoruz
    peer = new Peer(undefined, {
        path: '/peerjs',
        host: '/',
        port: location.port || (location.protocol === 'https:' ? 443 : 80)
    });

    peer.on('open', id => {
        myPeerId = id;
        // Peer kimliğimiz üretildiğinde, genel 'lobi' odasına katıldığımızı sunucuya bildiriyoruz.
        socket.emit('join-room', 'lobi', id, myUsername);
    });

    // Biri bizi aradığında (Karşı taraf "Görüntülü Ara" butonuna tıkladığında)
    peer.on('call', call => {
        const callerId = call.peer;
        const callerName = users[callerId] || 'Birisi';
        
        const accept = window.confirm(`${callerName} adlı kullanıcı sizi görüntülü arıyor. Kabul ediyor musunuz?`);
        if (accept) {
            // Çağrıyı kendi streamimiz ile cevapla
            call.answer(localStream); 
            currentCall = call;
            
            // Karşı tarafın videosu gelince DOM'a ekle
            call.on('stream', userVideoStream => {
                addRemoteVideo(userVideoStream, callerId, callerName);
            });
            
            // Çağrı kapanınca videosunu kaldır
            call.on('close', () => {
                removeRemoteVideo(callerId);
            });
        } else {
            console.log("Çağrı reddedildi.");
            // Peerjs'de doğrudan reddetme fonksiyonu tam oturmamış olabilir, 
            // ama çağrıya answer() vermezsek bağlantı kurulmaz.
        }
    });
}

// 3. Socket.io Event'leri
socket.on('user-connected', (peerId, username) => {
    appendMessage('sistem', `${username} odaya katıldı.`);
    users[peerId] = username;
    updateUsersList();
});

socket.on('user-disconnected', (peerId) => {
    const name = users[peerId];
    if (name) {
        appendMessage('sistem', `${name} odadan ayrıldı.`);
        delete users[peerId];
        updateUsersList();
        removeRemoteVideo(peerId); // Kişi kopunca varsa video paneli de gitsin
    }
});

socket.on('current-users', (activeUsers) => {
    users = activeUsers;
    updateUsersList();
});

// Sohbet mesajları işlemleri
socket.on('create-message', (message, senderName) => {
    appendMessage(senderName, message);
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit('chat-message', msg, myUsername);
        chatInput.value = '';
    }
});

function appendMessage(sender, msg) {
    const div = document.createElement('div');
    div.classList.add('message');
    if(sender === 'sistem') {
        div.classList.add('system');
    } else if(sender === myUsername) {
        div.classList.add('mine');
    }
    
    div.innerHTML = `<strong>${sender}:</strong> <span>${msg}</span>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight; // Oto aşağı kaydır
}

// Sağ menüdeki listeyi güncelleme ve arama butonlarını ekleme
function updateUsersList() {
    usersList.innerHTML = '';
    for (let id in users) {
        // Kendimizi listeye eklemiyoruz
        if (id !== myPeerId) {
            const li = document.createElement('li');
            li.textContent = users[id];
            
            const callBtn = document.createElement('button');
            callBtn.textContent = "Ara 📹";
            callBtn.onclick = () => initiateCall(id);
            
            li.appendChild(callBtn);
            usersList.appendChild(li);
        }
    }
}

// 4. Arama İşlemini Başlat (Biri "Ara" butonuna basınca)
function initiateCall(peerId) {
    if (!localStream) {
        alert("Kameranıza erişim sağlanamadığı için arama yapamazsınız.");
        return;
    }
    
    appendMessage('sistem', `${users[peerId]} aranıyor...`);
    
    // Karşı tarafa kendi stream'imizle çağrı gönderiyoruz
    const call = peer.call(peerId, localStream);
    currentCall = call;
    
    // Karşı taraf çağrıyı answer() ile açtığında bu event tetiklenir
    call.on('stream', userVideoStream => {
        addRemoteVideo(userVideoStream, peerId, users[peerId]);
    });
    
    call.on('close', () => {
        removeRemoteVideo(peerId);
        appendMessage('sistem', `Görüşme sonlandırıldı.`);
    });
}

// DOM Manipülasyonları: Uzaktaki kullanıcının videosunu ekleme
function addRemoteVideo(stream, peerId, username) {
    // Zaten varsa bir daha ekleme
    let videoWrapper = document.getElementById(`wrapper-${peerId}`);
    if (!videoWrapper) {
        videoWrapper = document.createElement('div');
        videoWrapper.id = `wrapper-${peerId}`;
        videoWrapper.className = 'video-wrapper remote';
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        
        const label = document.createElement('span');
        label.className = 'video-label';
        label.textContent = username || 'Bağlantı';
        
        videoWrapper.appendChild(video);
        videoWrapper.appendChild(label);
        videoGrid.appendChild(videoWrapper);
    }
}

function removeRemoteVideo(peerId) {
    const videoWrapper = document.getElementById(`wrapper-${peerId}`);
    if (videoWrapper) {
        videoWrapper.remove();
    }
}

// 5. Çağrıyı kapatma (Hang up) butonu
hangupBtn.addEventListener('click', () => {
    if (currentCall) {
        currentCall.close();
        currentCall = null;
        
        // Bütün remote videoları DOM'dan temizle
        const remotes = document.querySelectorAll('.video-wrapper.remote');
        remotes.forEach(r => r.remove());
        
        appendMessage('sistem', `Görüşme tarafınızca sonlandırıldı.`);
    } else {
        alert("Şu anda aktif bir çağrınız bulunmuyor.");
    }
});
