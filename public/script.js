const socket = io('/');
let peer;
let myPeerId;
let myUsername;

let currentTextRoom = 'genel';
let currentVoiceRoom = null;

let localAudioStream = null; 
let localVideoStream = null; 
let privateCall = null;
let voiceCalls = {}; 

let allUsersList = {}; // IP tabanlı Global Veritabanı

// Audio Analitik (Ses geldiğinde Yeşile Dönme Web Audio API)
let audioContext = null;
const analysers = {}; 

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
        socket.emit('register', myPeerId, myUsername);
        joinTextRoom(currentTextRoom);
    });

    peer.on('call', async call => {
        // SESLİ ODA YANITI (Mesh Altyapısı)
        if(call.metadata && call.metadata.type === 'voice-room') {
             if(!localAudioStream) {
                 try {
                     localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                     monitorSpeech(localAudioStream, myPeerId); // Kendi Sesimi Dinle
                 } catch(err) { }
             }
             call.answer(localAudioStream);
             voiceCalls[call.peer] = call;
             
             call.on('stream', remoteAudio => {
                 playRemoteAudio(remoteAudio, call.peer);
                 monitorSpeech(remoteAudio, call.peer); // Başkasının Sesini Dinle
             });
             call.on('close', () => {
                 removeRemoteAudio(call.peer);
                 stopMonitor(call.peer);
             });
             return;
        }

        // ÖZEL VİDEO YANITI
        let callerName = "Biri";
        for(let ip in allUsersList) {
             if(allUsersList[ip].peerId === call.peer) callerName = allUsersList[ip].username;
        }
        
        if (window.confirm(`${callerName} sizi ÖZEL görüntülü arıyor! Kabul ediyor musunuz?`)) {
            try {
                if (!localVideoStream) {
                    localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                }
                call.answer(localVideoStream); 
                privateCall = call;
                openVideoModal();
                addVideoStream(localVideoStream, 'local', 'Sen (Yerel)');

                call.on('stream', userStream => addVideoStream(userStream, call.peer, callerName));
                call.on('close', () => endPrivateCall());
            } catch (err) {
                 alert("Kameranıza erişim sağlanamadı.");
            }
        }
    });
}

// -----------------------------------------
// 1. GLOBAL LİSTE UYGULAMASI (SAĞ MENÜ)
// -----------------------------------------
socket.on('global-users', (usersObj) => {
    allUsersList = usersObj;
    updateGlobalUsersList();
});

function updateGlobalUsersList() {
    usersList.innerHTML = '';
    const ips = Object.keys(allUsersList);
    
    // Çevrimiçi olanları her zaman üste al
    ips.sort((a,b) => {
       if(allUsersList[a].isOnline && !allUsersList[b].isOnline) return -1;
       if(!allUsersList[a].isOnline && allUsersList[b].isOnline) return 1;
       return 0;
    });

    let count = 0;
    for (let ip of ips) {
        const u = allUsersList[ip];
        if (u.peerId === myPeerId) continue; 
        
        count++;
        const li = document.createElement('li');
        // Offline olanları soluk renkte listele
        li.style.opacity = u.isOnline ? '1' : '0.5';
        
        const span = document.createElement('span');
        span.innerHTML = `<span style="color: ${u.isOnline ? '#3ba55c' : '#747f8d'}; font-size:1.3em; margin-right:4px;">●</span> ${u.username}`;
        
        const callBtn = document.createElement('button');
        if(u.isOnline) {
             callBtn.innerHTML = "Özel Ara";
             callBtn.onclick = () => initiatePrivateCall(u.peerId, u.username);
        } else {
             callBtn.innerHTML = "Çevrimdışı";
             callBtn.disabled = true;
             callBtn.style.background = '#747f8d';
             callBtn.style.cursor = 'not-allowed';
             callBtn.style.color = '#ccc';
        }
        
        li.appendChild(span);
        li.appendChild(callBtn);
        usersList.appendChild(li);
    }
    
    // Yalnızsak
    if(count === 0) {
        const li = document.createElement('li');
        li.textContent = "Geçmişte katılan kimse yok...";
        li.style.color = '#747f8d'; li.style.fontStyle = 'italic'; li.style.background = 'transparent';
        usersList.appendChild(li);
    }
}

// -----------------------------------------
// 2. METİN KANALLARI İŞLEMLERİ
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
            if(privateCall) endPrivateCall(); 
        }
    });
});

function joinTextRoom(room) {
    if(!myPeerId) return;
    messages.innerHTML = '';
    appendMessage('sistem', `Sen #${room} isimli kanala odaklandın.`);
    socket.emit('join-text-room', room);
}

socket.on('create-message', (message, senderName) => appendMessage(senderName, message));

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

// -----------------------------------------
// 3. SES ODALARI (Yeşil Yanıp Sönme & Volume Bar UYarlaması)
// -----------------------------------------
voiceChannels.forEach(channel => {
    const header = channel.querySelector('.voice-channel-header');
    header.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if(newRoom !== currentVoiceRoom) connectVoiceRoom(newRoom);
    });
});

async function connectVoiceRoom(room) {
    appendMessage('sistem', `🔊 ${room} bağlanılıyor...`);
    
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        monitorSpeech(localAudioStream, myPeerId); // Kendi Sesimizi Dinlemeye Al
    } catch(e) {
        alert("Mikrofon izni olmadan sesli kanalla bağlantı kurulamaz.");
        return;
    }
    
    disconnectVoiceRoom(); // Önceki Odadan Çık
    
    currentVoiceRoom = room;
    voiceChannels.forEach(c => c.classList.remove('active'));
    document.querySelector(`.voice-channel[data-room="${room}"]`).classList.add('active');
    leaveVoiceBtn.style.display = 'block';
    
    socket.emit('join-voice-room', room);
}

socket.on('voice-join-success', (usersInRoom) => {
    for (let pId in usersInRoom) {
        if(pId !== myPeerId) {
            const call = peer.call(pId, localAudioStream, { metadata: { type: 'voice-room' } });
            voiceCalls[pId] = call;
            call.on('stream', remoteAudio => {
                 playRemoteAudio(remoteAudio, pId);
                 monitorSpeech(remoteAudio, pId); // Karşı Ses Seviyesini Analiz Et
            });
            call.on('close', () => {
                 removeRemoteAudio(pId);
                 stopMonitor(pId);
            });
        }
    }
});

// Sol Sesli Kanal Sidebar Animasyonlu Cizimi
socket.on('voice-rooms-state', (voiceRoomsData) => {
    document.querySelectorAll('.voice-users').forEach(ul => ul.innerHTML = '');
    
    for (let r in voiceRoomsData) {
        const ul = document.getElementById('voice-users-' + r);
        if(ul) {
            for (let id in voiceRoomsData[r]) {
                 const li = document.createElement('li');
                 li.className = 'voice-user';
                 
                 // Ana Tıklanabilir ve İsimli Bölge
                 const mainDiv = document.createElement('div');
                 mainDiv.className = 'voice-user-info';
                 
                 // Yeşile Dönecek Top (VAD)
                 const circle = document.createElement('div');
                 circle.className = 'avatar-circle';
                 circle.id = 'voice-user-avatar-' + id;
                 
                 const nameSpan = document.createElement('span');
                 nameSpan.textContent = voiceRoomsData[r][id];
                 
                 if(id === myPeerId) {
                     nameSpan.style.color = '#3ba55c'; 
                     nameSpan.style.fontWeight = 'bold';
                 }
                 
                 mainDiv.appendChild(circle);
                 mainDiv.appendChild(nameSpan);
                 li.appendChild(mainDiv);

                 // SES SEVİYESİ DÜŞÜRME (Volume Slider) (Sadece diğer kullanıcılara)
                 if(id !== myPeerId && currentVoiceRoom === r) {
                      const volDiv = document.createElement('div');
                      volDiv.className = 'voice-volume-control';
                      volDiv.style.display = 'none'; // İlk tıkta açılır
                      
                      const lbl = document.createElement('div');
                      lbl.textContent = '🔉 Kullanıcı Ses Seviyesi';
                      lbl.style.fontSize = '0.7rem';
                      lbl.style.color = '#b9bbbe';
                      lbl.style.marginBottom = '4px';
                      
                      const range = document.createElement('input');
                      range.type = 'range';
                      range.min = 0; range.max = 1; range.step = 0.05;
                      
                      // Eski Sesi varsa hatırla eklenebilir
                      const existingAudio = document.getElementById('audio-' + id);
                      range.value = existingAudio ? existingAudio.volume : 1;
                      
                      // Çubuğu kaydırdıkça anında gerçek sesi kıs
                      range.oninput = (e) => {
                          const au = document.getElementById('audio-' + id);
                          if(au) au.volume = e.target.value;
                      };
                      
                      volDiv.appendChild(lbl);
                      volDiv.appendChild(range);
                      li.appendChild(volDiv);
                      
                      // Üstüne tıklayınca kayan menüyü aç / kapat
                      mainDiv.onclick = () => {
                          volDiv.style.display = (volDiv.style.display === 'none') ? 'block' : 'none';
                      };
                 }
                 
                 ul.appendChild(li);
            }
        }
    }
});

leaveVoiceBtn.addEventListener('click', disconnectVoiceRoom);
function disconnectVoiceRoom() {
    if(!currentVoiceRoom) return;
    
    for(let id in voiceCalls) voiceCalls[id].close();
    voiceCalls = {};
    if(localAudioStream) {
        localAudioStream.getTracks().forEach(t => t.stop());
        localAudioStream = null;
        stopMonitor(myPeerId);
    }
    
    socket.emit('join-voice-room', null); 
    voiceChannels.forEach(c => c.classList.remove('active'));
    leaveVoiceBtn.style.display = 'none';
    currentVoiceRoom = null;
    audioContainer.innerHTML = ''; 
}

function playRemoteAudio(stream, peerId) {
    let ad = document.getElementById('audio-' + peerId);
    if(!ad) {
        ad = document.createElement('audio');
        ad.id = 'audio-' + peerId; ad.autoplay = true;
        audioContainer.appendChild(ad);
    }
    ad.srcObject = stream;
}
function removeRemoteAudio(peerId) {
    const ad = document.getElementById('audio-' + peerId);
    if(ad) ad.remove();
}

// -----------------------------------------
// 4. VAD - Voice Activity Detection (Ses Analizi & Yeşil Halka Çizimi)
// -----------------------------------------
function initAudioContext() {
    if(!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        checkSpeechLooped();
    }
    if(audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

function monitorSpeech(stream, peerId) {
    if(!stream) return;
    initAudioContext();
    try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser); 
        // Destinasyona BAĞLAMIYORUZ ki yankı yapmasın (sadece analiz etmek için kopya aldık)
        analysers[peerId] = analyser;
    } catch(e) { console.error('Ses analiz engeli:', e); }
}

function stopMonitor(peerId) {
    if(analysers[peerId]) {
         analysers[peerId].disconnect?.();
         delete analysers[peerId];
    }
}

function checkSpeechLooped() {
    requestAnimationFrame(checkSpeechLooped);
    if(!audioContext) return;

    for(let id in analysers) {
        const analyser = analysers[id];
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray); // 0-255 arası
        
        let sum = 0;
        for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;
        
        // CSS Avatar Halka Tespiti
        const circle = document.getElementById('voice-user-avatar-' + id);
        if(circle) {
             if(average > 10) { // Sınır 10: Çöp sesleri yoksayar
                 circle.classList.add('speaking');
             } else {
                 circle.classList.remove('speaking');
             }
        }
    }
}

// -----------------------------------------
// 5. ÖZEL GÖRÜNTÜLÜ ARAMA 
// -----------------------------------------
async function initiatePrivateCall(peerId, usernameOverride) {
    try {
        if (!localVideoStream) {
            localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
    } catch(err) {
        alert("Özel arama için kamera izni şarttır!"); return;
    }

    const call = peer.call(peerId, localVideoStream);
    privateCall = call;
    
    openVideoModal();
    addVideoStream(localVideoStream, 'local', 'Sen');
    
    call.on('stream', userStream => addVideoStream(userStream, peerId, usernameOverride));
    call.on('close', () => endPrivateCall());
}

function openVideoModal() { videoModal.style.display = 'flex'; }
function endPrivateCall() {
    if(privateCall) { privateCall.close(); privateCall = null; }
    if(localVideoStream) {
        localVideoStream.getTracks().forEach(t => t.stop());
        localVideoStream = null;
    }
    videoGrid.innerHTML = ''; videoModal.style.display = 'none'; 
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
