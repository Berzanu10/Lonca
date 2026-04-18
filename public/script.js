const socket = io('/');
let peer;
let myPeerId;
let myUsername;

// Durum Takibi
let currentTextRoom = 'genel';
let currentVoiceRoom = null;

// Medya Akışları
let localAudioStream = null; // Grup ses için
let localVideoStream = null; // Özel video arama için
let privateCall = null;
let voiceCalls = {}; // peerId -> callObj (Grup Ses Ağı)

// DOM Elementleri
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');

const usersList = document.getElementById('users-list');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

const videoModal = document.getElementById('video-modal');
const videoGrid = document.getElementById('video-grid');
const hangupBtn = document.getElementById('hangup-btn');
const currentRoomName = document.getElementById('current-room-name');
const textChannels = document.querySelectorAll('.text-channel');
const voiceChannels = document.querySelectorAll('.voice-channel');
const leaveVoiceBtn = document.getElementById('leave-voice-btn');
const audioContainer = document.getElementById('audio-container');

let textUsers = {}; // Metin odasındakiler

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        myUsername = name;
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        initializePeer();
    } else {
        alert("Takma ad boş olamaz.");
    }
});

function initializePeer() {
    peer = new Peer(undefined, {
        path: '/peerjs', host: '/', port: location.port || (location.protocol === 'https:' ? 443 : 80)
    });

    peer.on('open', id => {
        myPeerId = id;
        // Sunucuya kendimizi tüm ağda tanıtıyoruz
        socket.emit('register', myPeerId, myUsername);
        joinTextRoom(currentTextRoom);
    });

    peer.on('call', async call => {
        // SESLİ ODA MANTIĞI: (Biri ses kanalımdayken bana otomatik P2P ses ağı fırlatır)
        if(call.metadata && call.metadata.type === 'voice-room') {
             if(!localAudioStream) {
                 try {
                     localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                 } catch(err) {
                     // İzin yokuşsa boş yayınla geç (karşıya sesin gitmez ama onunkini duyarsın belki)
                 }
             }
             call.answer(localAudioStream);
             voiceCalls[call.peer] = call;
             
             call.on('stream', remoteAudio => playRemoteAudio(remoteAudio, call.peer));
             call.on('close', () => removeRemoteAudio(call.peer));
             return;
        }

        // ÖZEL GÖRÜNTÜLÜ GÖRÜŞME MANTIĞI
        const callerName = textUsers[call.peer] || 'Biri';
        if (window.confirm(`${callerName} sizi metin kanalında özel görüntülü arıyor! Kabul ediyor musunuz?`)) {
            try {
                if (!localVideoStream) {
                    localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                }
                call.answer(localVideoStream); 
                privateCall = call;
                openVideoModal();
                addVideoStream(localVideoStream, 'local', 'Sen (Yerel)');

                call.on('stream', userStream => {
                    addVideoStream(userStream, call.peer, callerName);
                });
                call.on('close', () => endPrivateCall());
            } catch (err) {
                 alert("Kameranıza erişim sağlanamadı.");
            }
        }
    });
}

// -----------------------------------------
// 1. METİN KANALLARI İŞLEMLERİ
// -----------------------------------------
textChannels.forEach(channel => {
    channel.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if(newRoom !== currentTextRoom) {
            textChannels.forEach(c => c.classList.remove('active'));
            channel.classList.add('active');
            currentTextRoom = newRoom;
            currentRoomName.textContent = `# ${newRoom}`;
            joinTextRoom(currentTextRoom);
            
            if(privateCall) endPrivateCall(); // Kanal degisirse mevcut ozel aramayi da kapatir
        }
    });
});

function joinTextRoom(room) {
    if(!myPeerId) return;
    messages.innerHTML = '';
    textUsers = {};
    appendMessage('sistem', `Sen #${room} sistemine metin olarak katıldın.`);
    socket.emit('join-text-room', room);
}

socket.on('text-current-users', (usersObj) => {
    textUsers = usersObj;
    updateTextUsersList();
});
socket.on('text-user-connected', (peerId, username) => {
    textUsers[peerId] = username;
    updateTextUsersList();
});
socket.on('text-user-disconnected', (peerId) => {
    delete textUsers[peerId];
    updateTextUsersList();
});
socket.on('create-message', (message, senderName) => {
    appendMessage(senderName, message);
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit('chat-message', msg); // Basitçe gönder (6 kere kopya hatası düzeltildi)
        chatInput.value = '';
    }
});

function appendMessage(sender, msg) {
    const div = document.createElement('div');
    div.classList.add('message');
    if(sender === 'sistem') div.classList.add('system');
    else if(sender === myUsername) div.classList.add('mine');
    
    div.innerHTML = `<strong>${sender}:</strong> <span>${msg}</span>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

function updateTextUsersList() {
    usersList.innerHTML = '';
    for (let id in textUsers) {
        if (id !== myPeerId) {
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.textContent = textUsers[id];
            
            const callBtn = document.createElement('button');
            callBtn.innerHTML = "Ara 📹";
            callBtn.onclick = () => initiatePrivateCall(id);
            
            li.appendChild(span);
            li.appendChild(callBtn);
            usersList.appendChild(li);
        }
    }
}

// -----------------------------------------
// 2. SES ODALARI (Discord Voice Networks)
// -----------------------------------------
voiceChannels.forEach(channel => {
    const header = channel.querySelector('.voice-channel-header');
    header.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if(newRoom !== currentVoiceRoom) {
            connectVoiceRoom(newRoom);
        }
    });
});

async function connectVoiceRoom(room) {
    appendMessage('sistem', `🔊 ${room} ses kanalına mikrofon izni isteniyor...`);
    
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch(e) {
        alert("Mikrofon izni olmadan sesli kanalla bağlantı kurulamaz.");
        return;
    }
    
    // Eski ses odasından çık
    disconnectVoiceRoom();
    
    currentVoiceRoom = room;
    voiceChannels.forEach(c => c.classList.remove('active'));
    document.querySelector(`.voice-channel[data-room="${room}"]`).classList.add('active');
    leaveVoiceBtn.style.display = 'block';
    
    // Server'a ses kanalına girdiğimizi söyle (o bize networku ayarlayacak)
    socket.emit('join-voice-room', room);
}

socket.on('voice-join-success', (usersInRoom) => {
    // Odada bizden önce olan herkese TEK TEK PeerJS araması yapıp sesleri senkronize ediyoruz! (Mesh Network)
    for (let pId in usersInRoom) {
        if(pId !== myPeerId) {
            const call = peer.call(pId, localAudioStream, { metadata: { type: 'voice-room' } });
            voiceCalls[pId] = call;
            call.on('stream', remoteAudio => playRemoteAudio(remoteAudio, pId));
            call.on('close', () => removeRemoteAudio(pId));
        }
    }
});

// Sidebar'da Odaların Altında İsim Güncelleme Merkezi
socket.on('voice-rooms-state', (voiceRoomsData) => {
    // Önce bütün alt listeleri temizle
    document.querySelectorAll('.voice-users').forEach(ul => ul.innerHTML = '');
    
    for (let r in voiceRoomsData) {
        const ul = document.getElementById('voice-users-' + r);
        if(ul) {
            for (let id in voiceRoomsData[r]) {
                 const li = document.createElement('li');
                 const nameSpan = document.createElement('span');
                 nameSpan.textContent = voiceRoomsData[r][id];
                 
                 // Kendi isminizse yeşil parlasın!
                 if(id === myPeerId) {
                     li.style.color = '#3ba55c'; 
                     li.style.fontWeight = 'bold';
                 }
                 li.appendChild(nameSpan);
                 ul.appendChild(li);
            }
        }
    }
});

leaveVoiceBtn.addEventListener('click', disconnectVoiceRoom);

function disconnectVoiceRoom() {
    if(!currentVoiceRoom) return;
    
    // Açık olan tüm P2P sesleri kes
    for(let id in voiceCalls) {
        voiceCalls[id].close();
    }
    voiceCalls = {};
    if(localAudioStream) {
        localAudioStream.getTracks().forEach(t => t.stop());
        localAudioStream = null;
    }
    
    socket.emit('join-voice-room', null); // Çıtı
    voiceChannels.forEach(c => c.classList.remove('active'));
    leaveVoiceBtn.style.display = 'none';
    currentVoiceRoom = null;
    audioContainer.innerHTML = ''; 
}

// Sesleri arka planda oynatmak için görünmez objeler üretilir
function playRemoteAudio(stream, peerId) {
    let ad = document.getElementById('audio-' + peerId);
    if(!ad) {
        ad = document.createElement('audio');
        ad.id = 'audio-' + peerId;
        ad.autoplay = true;
        audioContainer.appendChild(ad);
    }
    ad.srcObject = stream;
}
function removeRemoteAudio(peerId) {
    const ad = document.getElementById('audio-' + peerId);
    if(ad) ad.remove();
}

// -----------------------------------------
// 3. ÖZEL GÖRÜNTÜLÜ ARAMA (Sağ paneldeki buton)
// -----------------------------------------
async function initiatePrivateCall(peerId) {
    try {
        if (!localVideoStream) {
            localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
    } catch(err) {
        alert("Özel arama için kamera izni şarttır!");
        return;
    }

    const call = peer.call(peerId, localVideoStream); // Meta atmadan yolla
    privateCall = call;
    
    openVideoModal();
    addVideoStream(localVideoStream, 'local', 'Sen');
    
    call.on('stream', userStream => {
        addVideoStream(userStream, peerId, textUsers[peerId]);
    });
    
    call.on('close', () => endPrivateCall());
}

function openVideoModal() { videoModal.style.display = 'flex'; }
function endPrivateCall() {
    if(privateCall) { privateCall.close(); privateCall = null; }
    if(localVideoStream) {
        localVideoStream.getTracks().forEach(t => t.stop());
        localVideoStream = null;
    }
    videoGrid.innerHTML = ''; 
    videoModal.style.display = 'none'; 
}

hangupBtn.addEventListener('click', endPrivateCall);

function addVideoStream(stream, peerId, username) {
    if (document.getElementById(`wrapper-${peerId}`)) return;
    const cw = document.createElement('div');
    cw.id = `wrapper-${peerId}`; cw.className = 'video-wrapper';
    
    const v = document.createElement('video');
    v.srcObject = stream; v.autoplay = true; v.playsInline = true;
    if(peerId === 'local') { v.muted = true; v.style.transform = 'scaleX(-1)'; }
    
    const l = document.createElement('span');
    l.className = 'video-label'; l.textContent = username || 'Bağlantı';
    
    cw.appendChild(v); cw.appendChild(l); videoGrid.appendChild(cw);
}
