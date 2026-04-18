const socket = io('/');
let peer, myPeerId, myUsername;

let currentTextRoom = 'genel';
let currentVoiceRoom = null;

let localAudioStream = null; 
let localVideoStream = null; 
let privateCall = null;
let voiceCalls = {}; 
let allUsersList = {}; 

let audioContext = null;
const analysers = {}; 

let isMicMuted = false;
let isDeafened = false;
let prevMicMuted = false; 

const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');

const usersList = document.getElementById('users-list');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const textChannels = document.querySelectorAll('.text-channel');
const voiceChannels = document.querySelectorAll('.voice-channel');
const audioContainer = document.getElementById('audio-container');

const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleDeafBtn = document.getElementById('toggle-deaf-btn');
const bottomLeaveVoiceBtn = document.getElementById('bottom-leave-voice');
const voiceConnectionInfo = document.getElementById('voice-connection-info');
const activeVoiceRoomName = document.getElementById('active-voice-room-name');
const displayMyUsername = document.getElementById('display-my-username');

const micSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
const headSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/></svg>`;

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        myUsername = name;
        displayMyUsername.textContent = myUsername;

        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        initializePeer();
    } else alert("Takma ad boş olamaz.");
});

function initializePeer() {
    peer = new Peer(undefined, { path: '/peerjs', host: '/', port: location.port || (location.protocol === 'https:' ? 443 : 80) });

    peer.on('open', id => {
        myPeerId = id;
        socket.emit('register', myPeerId, myUsername);
        joinTextRoom(currentTextRoom);
    });

    peer.on('call', async call => {
        if(call.metadata && call.metadata.type === 'voice-room') {
             if(!localAudioStream) {
                 try {
                     localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                     monitorSpeech(localAudioStream, myPeerId); 
                     applyHardwareStates(); 
                 } catch(err) { }
             }
             call.answer(localAudioStream);
             voiceCalls[call.peer] = call;
             
             call.on('stream', remoteAudio => {
                 playRemoteAudio(remoteAudio, call.peer);
                 monitorSpeech(remoteAudio, call.peer); 
             });
             call.on('close', () => {
                 removeRemoteAudio(call.peer);
                 stopMonitor(call.peer);
             });
             return;
        }

        let callerName = "Biri";
        for(let ip in allUsersList) if(allUsersList[ip].peerId === call.peer) callerName = allUsersList[ip].username;
        
        if (window.confirm(`${callerName} sizi ÖZEL görüntülü arıyor! Kabul ediyor musunuz?`)) {
            try {
                if (!localVideoStream) localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                call.answer(localVideoStream); 
                privateCall = call;
                openVideoModal(); addVideoStream(localVideoStream, 'local', 'Sen');
                call.on('stream', userStream => addVideoStream(userStream, call.peer, callerName));
                call.on('close', () => endPrivateCall());
            } catch (err) { alert("Kameraya erişim sağlanamadı."); }
        }
    });
}

toggleDeafBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    if(isDeafened) {
        prevMicMuted = isMicMuted;
        isMicMuted = true;
    } else {
        isMicMuted = prevMicMuted;
    }
    applyHardwareStates();
});

toggleMicBtn.addEventListener('click', () => {
    if(isDeafened) return; 
    isMicMuted = !isMicMuted;
    applyHardwareStates();
});

function applyHardwareStates() {
    toggleMicBtn.classList.toggle('strikethrough-icon', isMicMuted);
    toggleDeafBtn.classList.toggle('strikethrough-icon', isDeafened);
    
    if (localAudioStream) {
        localAudioStream.getAudioTracks().forEach(track => { track.enabled = !isMicMuted; });
    }
    
    for(let id in voiceCalls) {
        const aud = document.getElementById('audio-' + id);
        if(aud) aud.muted = isDeafened; 
    }
    
    socket.emit('voice-state-update', { mic: !isMicMuted, deaf: !isDeafened });
}

// -----------------------------------------
// Global Sağ Liste - KULLANICILAR
// -----------------------------------------
socket.on('global-users', (usersObj) => {
    allUsersList = usersObj;
    usersList.innerHTML = '';
    const ips = Object.keys(allUsersList).sort((a,b) => {
       if(allUsersList[a].isOnline && !allUsersList[b].isOnline) return -1;
       if(!allUsersList[a].isOnline && allUsersList[b].isOnline) return 1;
       return 0;
    });
    for (let ip of ips) {
        const u = allUsersList[ip];
        
        const li = document.createElement('li');
        li.style.opacity = u.isOnline ? '1' : '0.4';
        
        const infoDiv = document.createElement('div');
        infoDiv.className = u.isOnline ? 'right-user-info online' : 'right-user-info';
        
        const avatar = document.createElement('div');
        avatar.className = 'right-panel-avatar';
        avatar.textContent = u.username.charAt(0).toUpperCase();
        infoDiv.appendChild(avatar);
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = u.username;
        
        if (u.peerId === myPeerId) {
             nameSpan.textContent += " (Sen)";
             nameSpan.style.color = "#43b581"; 
             nameSpan.style.fontWeight = "bold";
        }
        
        infoDiv.appendChild(nameSpan);
        
        const callBtn = document.createElement('button');
        if(u.isOnline && u.peerId !== myPeerId) {
             callBtn.innerHTML = "Ara";
             callBtn.onclick = () => initiatePrivateCall(u.peerId, u.username);
        } else {
             callBtn.style.display = 'none'; 
        }
        
        li.appendChild(infoDiv); 
        if(u.isOnline && u.peerId !== myPeerId) li.appendChild(callBtn); 
        usersList.appendChild(li);
    }
});

// -----------------------------------------
// Metin Kanalları
// -----------------------------------------
textChannels.forEach(channel => {
    channel.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if(newRoom !== currentTextRoom) {
            textChannels.forEach(c => c.classList.remove('active'));
            channel.classList.add('active');
            currentTextRoom = newRoom;
            document.getElementById('current-room-name').textContent = `# ${newRoom}`;
            joinTextRoom(currentTextRoom);
        }
    });
});
function joinTextRoom(room) {
    if(!myPeerId) return;
    messages.innerHTML = '';
    socket.emit('join-text-room', room);
}
socket.on('create-message', (message, senderName) => appendMessage(senderName, message));
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) { socket.emit('chat-message', msg); chatInput.value = ''; }
});
function appendMessage(sender, msg) {
    const div = document.createElement('div');
    div.classList.add('message');
    if(sender === myUsername) div.classList.add('mine');
    div.innerHTML = `<strong>${sender}:</strong> <span>${msg}</span>`;
    messages.appendChild(div); messages.scrollTop = messages.scrollHeight;
}

// -----------------------------------------
// Ses Odaları
// -----------------------------------------
voiceChannels.forEach(channel => {
    const header = channel.querySelector('.voice-channel-header');
    header.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if(newRoom !== currentVoiceRoom) connectVoiceRoom(newRoom);
    });
});

async function connectVoiceRoom(room) {    
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        monitorSpeech(localAudioStream, myPeerId); 
        applyHardwareStates(); 
    } catch(e) {
        alert("Mikrofon izni olmadan sesli kanalla bağlantı kurulamaz."); return;
    }
    
    disconnectVoiceRoom();
    currentVoiceRoom = room;
    voiceChannels.forEach(c => c.classList.remove('active'));
    document.querySelector(`.voice-channel[data-room="${room}"]`).classList.add('active');
    
    voiceConnectionInfo.style.display = 'flex';
    activeVoiceRoomName.textContent = `"${room}" / Lonca Sunucusu`;
    socket.emit('join-voice-room', room);
    
    // Sunucuya state durumlarımızı hızla güncelletelim ki eksik kalmasın (Undefined Name & Missing State Çözümü)
    setTimeout(() => {
        socket.emit('voice-state-update', { mic: !isMicMuted, deaf: !isDeafened });
    }, 200);
}

socket.on('voice-join-success', (usersInRoom) => {
    for (let pId in usersInRoom) {
        if(pId !== myPeerId) {
            const call = peer.call(pId, localAudioStream, { metadata: { type: 'voice-room' } });
            voiceCalls[pId] = call;
            call.on('stream', remoteAudio => {
                 playRemoteAudio(remoteAudio, pId); monitorSpeech(remoteAudio, pId); 
            });
            call.on('close', () => { removeRemoteAudio(pId); stopMonitor(pId); });
        }
    }
});

socket.on('voice-rooms-state', (voiceRoomsData) => {
    document.querySelectorAll('.voice-users').forEach(ul => ul.innerHTML = '');
    
    for (let r in voiceRoomsData) {
        const ul = document.getElementById('voice-users-' + r);
        if(ul) {
            for (let id in voiceRoomsData[r]) {
                 const userDataObj = voiceRoomsData[r][id];
                 
                 const li = document.createElement('li');
                 li.className = 'voice-user';
                 
                 const mainDiv = document.createElement('div');
                 mainDiv.className = 'voice-user-info';
                 
                 const circle = document.createElement('div');
                 circle.className = 'voice-avatar';
                 circle.id = 'voice-user-avatar-' + id;
                 
                 const nameSpan = document.createElement('span');
                 // İsim hatası için garantili MyUsername ataması (undefined sorununu çözer)
                 nameSpan.textContent = userDataObj.username || (id === myPeerId ? myUsername : "Kullanıcı");
                 nameSpan.style.flexGrow = '1';
                 nameSpan.style.fontWeight = '500';
                 if(id === myPeerId) nameSpan.style.color = '#fff';
                 
                 const statesContainer = document.createElement('div');
                 statesContainer.className = 'voice-user-states';
                 
                 // İkonlar her zaman ekranda DURMALI. Sadece kapandığında ".strikethrough-icon" klasını alıp efsanevi çizgi ve kırmızı rengi kendine çeker!
                 const mIcon = document.createElement('div');
                 mIcon.className = (userDataObj.mic === false) ? 'state-icon strikethrough-icon' : 'state-icon';
                 mIcon.innerHTML = micSVG;
                 statesContainer.appendChild(mIcon);
                 
                 const dIcon = document.createElement('div');
                 dIcon.className = (userDataObj.deaf === false) ? 'state-icon strikethrough-icon' : 'state-icon';
                 dIcon.innerHTML = headSVG;
                 statesContainer.appendChild(dIcon);
                 
                 mainDiv.appendChild(circle); mainDiv.appendChild(nameSpan); mainDiv.appendChild(statesContainer);
                 li.appendChild(mainDiv);

                 if(id !== myPeerId && currentVoiceRoom === r) {
                      const volDiv = document.createElement('div');
                      volDiv.className = 'voice-volume-control';
                      volDiv.style.display = 'none'; 
                      
                      const lbl = document.createElement('div');
                      lbl.textContent = '🔉 Kullanıcı Sesi';
                      lbl.style.fontSize = '0.7rem'; lbl.style.color = '#b9bbbe'; lbl.style.marginBottom = '4px';
                      
                      const range = document.createElement('input');
                      range.type = 'range'; range.min = 0; range.max = 1; range.step = 0.05;
                      const existingAudio = document.getElementById('audio-' + id);
                      range.value = existingAudio ? existingAudio.volume : 1;
                      
                      range.oninput = (e) => {
                          const au = document.getElementById('audio-' + id);
                          if(au) au.volume = e.target.value;
                      };
                      volDiv.appendChild(lbl); volDiv.appendChild(range); li.appendChild(volDiv);
                      
                      mainDiv.onclick = () => { volDiv.style.display = (volDiv.style.display === 'none') ? 'block' : 'none'; };
                 }
                 ul.appendChild(li);
            }
        }
    }
});

bottomLeaveVoiceBtn.addEventListener('click', disconnectVoiceRoom);
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
    voiceConnectionInfo.style.display = 'none'; 
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
    ad.muted = isDeafened;
}
function removeRemoteAudio(peerId) {
    const ad = document.getElementById('audio-' + peerId);
    if(ad) ad.remove();
}

// -----------------------------------------
// VAD (Voice Activity Detection)
// -----------------------------------------
function initAudioContext() {
    if(!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        checkSpeechLooped();
    }
    if(audioContext && audioContext.state === 'suspended') audioContext.resume();
}
function monitorSpeech(stream, peerId) {
    if(!stream) return;
    initAudioContext();
    try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser(); analyser.fftSize = 512;
        source.connect(analyser); 
        analysers[peerId] = analyser;
    } catch(e) {}
}
function stopMonitor(peerId) {
    if(analysers[peerId]) { analysers[peerId].disconnect?.(); delete analysers[peerId]; }
}
function checkSpeechLooped() {
    requestAnimationFrame(checkSpeechLooped);
    if(!audioContext) return;
    for(let id in analysers) {
        const analyser = analysers[id];
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray); 
        let sum = 0;
        for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;
        
        if(id === myPeerId && isMicMuted) average = 0;

        const circle = document.getElementById('voice-user-avatar-' + id);
        const myAv = document.getElementById('my-avatar');
        
        if(id === myPeerId && myAv) {
            if(average > 10) myAv.classList.add('speaking');
            else myAv.classList.remove('speaking');
        }

        if(circle) {
             if(average > 10) circle.classList.add('speaking');
             else circle.classList.remove('speaking');
        }
    }
}

// -----------------------------------------
// VİDEO MODAL
// -----------------------------------------
function openVideoModal() { document.getElementById('video-modal').style.display = 'flex'; }
function endPrivateCall() {
    if(privateCall) { privateCall.close(); privateCall = null; }
    if(localVideoStream) { localVideoStream.getTracks().forEach(t => t.stop()); localVideoStream = null; }
    document.getElementById('video-grid').innerHTML = ''; document.getElementById('video-modal').style.display = 'none'; 
}
document.getElementById('hangup-btn').addEventListener('click', endPrivateCall);
function addVideoStream(stream, peerId, username) {
    if (document.getElementById(`wrapper-${peerId}`)) return;
    const cw = document.createElement('div'); cw.id = `wrapper-${peerId}`; cw.className = 'video-wrapper';
    const v = document.createElement('video'); v.srcObject = stream; v.autoplay = true; v.playsInline = true;
    if(peerId === 'local') { v.muted = true; v.style.transform = 'scaleX(-1)'; }
    const l = document.createElement('span'); l.className = 'video-label'; l.textContent = username;
    cw.appendChild(v); cw.appendChild(l); document.getElementById('video-grid').appendChild(cw);
}
