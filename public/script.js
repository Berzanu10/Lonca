const socket = io('/');
let peer;
let myPeerId;
let myUsername;
let localStream;
let currentCall;
let currentRoom = 'genel'; // Varsayılan oda

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
const currentRoomName = document.getElementById('current-room-name');
const channels = document.querySelectorAll('.channel');

let users = {};

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        myUsername = name;
        localLabel.textContent = `${myUsername} (Sen)`;
        startApp();
    }
});

function startApp() {
    loginScreen.style.display = 'none';
    appContainer.style.display = 'flex';

    // 1. Kamera izni için kesin hata yönetimi:
    // https veya localhost olmadığında medya aygıtlarına ulaşılamaz.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Kamera/Mikrofon API'sine erişilemedi.\n\nDİKKAT! Eğer siteyi 192.168... gibi bir IP üzerinden telefondan ya da başka PC'den açıyorsanız, tarayıcılar güvenlik gereği kamera erişimini HTTPS olmadığı için engeller. Sadece cihazınız üzerinde (localhost) açarak ya da HTTPS üzerinden kullanabilirsiniz.");
        initializePeer();
        return;
    }

    // Kamera/Mikrofon izni isteme
    navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    }).then(stream => {
        localStream = stream;
        localVideo.srcObject = stream;
        initializePeer();
    }).catch(err => {
        console.error('Donanım erişim hatası:', err);
        let reason = "Bilinmeyen bir hata oluştu.";
        
        // Cihaza özel hata açıklamaları:
        if(err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            reason = "Aygıtınızda takılı (veya çalışır durumda) herhangi bir kamera/mikrofon bulunamadı.";
        } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            reason = "Tarayıcınızda veya bilgisayarınızda kamera/mikrofon iznini engellediniz/reddettiniz.";
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
             reason = "Kameranız şu anda Chrome/Firefox haricinde başka bir uygulama (Zoom, Discord vb.) tarafından kullanılıyor.";
        }
        
        alert("Medya Hatası Detayı: " + reason + "\n\nEndişelenmeyin! Kamera/mikrofonunuzu kullanmadan sadece metin sohbeti yapmak için odalara yönlendiriliyorsunuz.");
        
        // Kamera olmadan devam ediyoruz
        initializePeer();
    });
}

function initializePeer() {
    peer = new Peer(undefined, {
        path: '/peerjs',
        host: '/',
        port: location.port || (location.protocol === 'https:' ? 443 : 80)
    });

    peer.on('open', id => {
        myPeerId = id;
        joinRoom(currentRoom);
    });

    peer.on('call', call => {
        const callerId = call.peer;
        const callerName = users[callerId] || 'Birisi';
        
        const accept = window.confirm(`${callerName} adlı kişi bu odada sizi görüntülü arıyor. Kabul ediyor musunuz?`);
        if (accept) {
            // Sadece kameramız (stream) varsa ver, yoksa da deniyoruz ama peerjs boş gönderebilir
            call.answer(localStream); 
            currentCall = call;
            
            call.on('stream', userVideoStream => {
                addRemoteVideo(userVideoStream, callerId, callerName);
            });
            call.on('close', () => {
                removeRemoteVideo(callerId);
            });
        }
    });
}

// 2. Çoklu Kanal Mantığı: Kanallar Arası Geçiş
channels.forEach(channel => {
    channel.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if(newRoom !== currentRoom) {
            // Aktif CSS sınıfını taşı
            channels.forEach(c => c.classList.remove('active'));
            channel.classList.add('active');
            
            currentRoom = newRoom;
            currentRoomName.textContent = `# ${newRoom}`;
            
            // Farklı odaya geçersek, var olan arama otomatik sonlanmalı
            if (currentCall) {
                currentCall.close();
                currentCall = null;
                document.querySelectorAll('.video-wrapper.remote').forEach(r => r.remove());
            }

            // Yeni odaya katıl
            joinRoom(currentRoom);
        }
    });
});

function joinRoom(room) {
    if(!myPeerId) return;

    // Chat temizliği
    messages.innerHTML = '';
    // Kişi listesi temizliği
    usersList.innerHTML = '';
    users = {};
    
    appendMessage('sistem', `Sen `#${room}` adlı odaya geçiş yaptın.`);
    
    // Sunucuya odaya girdiğimizi haber ver
    socket.emit('join-room', room, myPeerId, myUsername);
}

// 3. Socket.io Event'leri
socket.on('user-connected', (peerId, username) => {
    appendMessage('sistem', `${username} numaralı odaya katıldı.`);
    users[peerId] = username;
    updateUsersList();
});

socket.on('user-disconnected', (peerId) => {
    const name = users[peerId];
    if (name) {
        appendMessage('sistem', `${name} bu odadan ayrıldı.`);
        delete users[peerId];
        updateUsersList();
        removeRemoteVideo(peerId);
        
        // Gören kişi kendi aramamız ise
        if(currentCall && currentCall.peer === peerId) {
             currentCall.close();
             currentCall = null;
        }
    }
});

socket.on('current-users', (activeUsers) => {
    users = activeUsers;
    updateUsersList();
});

// Metin Sohbeti
socket.on('create-message', (message, senderName) => {
    // Sadece bulunduğumuz odadaki mesajlar server'dan gelecektir
    appendMessage(senderName, message);
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit('chat-message', msg); // Sunucu geldiği odayı Socket API ile kendisi biliyor
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
    messages.scrollTop = messages.scrollHeight;
}

// Sağ Kullanıcı Listesi Çizimi
function updateUsersList() {
    usersList.innerHTML = '';
    let userCount = 0;
    
    for (let id in users) {
        if (id !== myPeerId) {
            userCount++;
            const li = document.createElement('li');
            li.textContent = users[id];
            
            const callBtn = document.createElement('button');
            callBtn.innerHTML = "Ara 📹";
            callBtn.onclick = () => initiateCall(id);
            
            li.appendChild(callBtn);
            usersList.appendChild(li);
        }
    }
    
    if (userCount === 0) {
        const li = document.createElement('li');
        li.textContent = "(Kimse Yok)";
        li.style.color = 'var(--text-muted)';
        li.style.fontStyle = 'italic';
        li.style.background = 'transparent';
        usersList.appendChild(li);
    }
}

// 4. Çağrı Başlatma
function initiateCall(peerId) {
    if (!localStream) {
        alert("Üzgünüz, kameranıza veya mikrofonunuza erişim sağlayamadığımız (veya izin vermediğiniz) için arama başlatamazsınız!");
        return;
    }
    
    appendMessage('sistem', `${users[peerId]} adlı kişi aranıyor...`);
    
    const call = peer.call(peerId, localStream);
    currentCall = call;
    
    call.on('stream', userVideoStream => {
        addRemoteVideo(userVideoStream, peerId, users[peerId]);
    });
    
    call.on('close', () => {
        removeRemoteVideo(peerId);
        appendMessage('sistem', `Görüntülü görüşmeniz sonlandı.`);
    });
}

function addRemoteVideo(stream, peerId, username) {
    if (document.getElementById(`wrapper-${peerId}`)) return;

    const videoWrapper = document.createElement('div');
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

function removeRemoteVideo(peerId) {
    const videoWrapper = document.getElementById(`wrapper-${peerId}`);
    if (videoWrapper) {
        videoWrapper.remove();
    }
}

hangupBtn.addEventListener('click', () => {
    if (currentCall) {
        currentCall.close();
        currentCall = null;
        
        document.querySelectorAll('.video-wrapper.remote').forEach(r => r.remove());
        appendMessage('sistem', `Aktif görüşmeyi sonlandırdınız.`);
    } else {
        alert("Şu anda kapattığınız aktif bir aramanız bulunmuyor.");
    }
});
