const socket = io('/');
let peer;
let myPeerId;
let myUsername;
let localStream = null;
let currentCall = null;
let currentRoom = 'genel';

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
const channels = document.querySelectorAll('.channel');

let users = {}; // Odadaki diğer kullanıcılar: peerId -> username

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        myUsername = name;
        startApp();
    } else {
        alert("Lütfen bir takma ad girin!");
    }
});

function startApp() {
    // 1. Ekranları değiştir (Giriş yapamıyorum hatasının asıl çözümü: gereksiz yere baştan kamera istememek!)
    loginScreen.style.display = 'none';
    appContainer.style.display = 'flex';
    
    // Uygulama anında başlar, kamera anında kapanmaz veya izine takılıp donmaz.
    initializePeer();
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

    peer.on('call', async call => {
        const callerId = call.peer;
        const callerName = users[callerId] || 'Birisi';
        
        const accept = window.confirm(`${callerName} adlı kişi bu odada sizi görüntülü arıyor. Kabul ediyor musunuz?`);
        if (accept) {
            try {
                // Kamera iznini SADECE çağrıyı kabul edersen istiyoruz.
                if (!localStream) {
                    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                }
                
                call.answer(localStream); 
                currentCall = call;
                openVideoModal();
                
                addVideoStream(localStream, 'local', 'Siz (Yerel)');

                call.on('stream', userVideoStream => {
                    addVideoStream(userVideoStream, callerId, callerName);
                });

                call.on('close', () => {
                    endLocalCall();
                });
            } catch (err) {
                 console.error(err);
                 alert("Kameranıza/mikrofonunuza ulaşılamadığı için çağrı yanıtlanamadı! (Lütfen tarayıcı izinlerini kontrol edin)");
            }
        }
    });

    peer.on('error', err => {
        console.error('PeerJS Hatası:', err);
        if (err.type === 'peer-unavailable') {
             alert("Bu kullanıcı şu an müsait değil veya sayfayı yenilemiş olabilir.");
             endLocalCall();
        }
    });
}

// ODA DEĞİŞİMİ
channels.forEach(channel => {
    channel.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if(newRoom !== currentRoom) {
            channels.forEach(c => c.classList.remove('active'));
            channel.classList.add('active');
            
            currentRoom = newRoom;
            currentRoomName.textContent = `# ${newRoom}`;
            
            // Aramadayken oda değiştirilirse görüşmeyi kapat
            if (currentCall) {
                endLocalCall();
            }

            joinRoom(currentRoom);
        }
    });
});

function joinRoom(room) {
    if(!myPeerId) return;

    messages.innerHTML = '';
    usersList.innerHTML = '';
    users = {};
    
    appendMessage('sistem', `Sen #${room} adlı kanala bağlandın.`);
    socket.emit('join-room', room, myPeerId, myUsername);
}

// SOCKET EVENTLERİ
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
        
        if (currentCall && currentCall.peer === peerId) {
             endLocalCall();
             appendMessage('sistem', `Karşı taraf çıktığı için arama sonlandı.`);
        }
    }
});

socket.on('current-users', (activeUsers) => {
    users = activeUsers;
    updateUsersList();
});

socket.on('create-message', (message, senderName) => {
    appendMessage(senderName, message);
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit('chat-message', msg); 
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

// SAĞ PANEL: SADECE KULLANICI LİSTELERİ
function updateUsersList() {
    usersList.innerHTML = '';
    let userCount = 0;
    
    for (let id in users) {
        if (id !== myPeerId) {
            userCount++;
            const li = document.createElement('li');
            
            const span = document.createElement('span');
            span.textContent = users[id];
            
            const callBtn = document.createElement('button');
            callBtn.innerHTML = "Ara 📹";
            callBtn.onclick = () => initiateCall(id);
            
            li.appendChild(span);
            li.appendChild(callBtn);
            usersList.appendChild(li);
        }
    }
    
    if (userCount === 0) {
        const li = document.createElement('li');
        li.textContent = "(Aramaya hazır kimse yok)";
        li.style.color = 'var(--text-muted)';
        li.style.fontStyle = 'italic';
        li.style.background = 'transparent';
        usersList.appendChild(li);
    }
}

// GÖRÜNTÜLÜ GÖRÜŞME FONKSİYONLARI (MODAL DESTEKLİ)
async function initiateCall(peerId) {
    appendMessage('sistem', `${users[peerId]} adlı kişiye ulaşılmaya çalışılıyor...`);
    
    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
    } catch(err) {
        alert("Kameranıza erişim sağlanamadı. Lütfen cihaz izinlerini kontrol edin veya kameranızı takın.");
        return;
    }

    const call = peer.call(peerId, localStream);
    currentCall = call;
    
    openVideoModal();
    addVideoStream(localStream, 'local', 'Sen');
    
    call.on('stream', userVideoStream => {
        addVideoStream(userVideoStream, peerId, users[peerId]);
    });
    
    call.on('close', () => {
        endLocalCall();
        appendMessage('sistem', `Görüşmeniz sonlandırıldı.`);
    });
}

function openVideoModal() {
    videoModal.style.display = 'flex';
}

function endLocalCall() {
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    // Lokal kamerayı komple kapat ki bilgisayardaki kamera ışığı sönsün!
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    videoGrid.innerHTML = ''; 
    videoModal.style.display = 'none'; 
}

hangupBtn.addEventListener('click', () => {
    endLocalCall();
    appendMessage('sistem', `Aramayı kapattınız.`);
});

function addVideoStream(stream, peerId, username) {
    if (document.getElementById(`wrapper-${peerId}`)) return;

    const videoWrapper = document.createElement('div');
    videoWrapper.id = `wrapper-${peerId}`;
    videoWrapper.className = 'video-wrapper';
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if(peerId === 'local') {
        video.muted = true; // Kendi sesinizi kendinize yankılatmayın
        video.style.transform = 'scaleX(-1)';
    }
    
    const label = document.createElement('span');
    label.className = 'video-label';
    label.textContent = username || 'Bağlantı';
    
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(label);
    videoGrid.appendChild(videoWrapper);
}
