/* Lonca UX özellikleri — script.js sonrasında yüklenir */
(function () {
    'use strict';

    window.pendingReplyTo = null;
    window.channelUnread = window.channelUnread || {};
    const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '😮', '👏'];

    let activeStreamPeerId = null;
    let streamAudioVolume = 1;
    let streamRecorder = null;
    let streamRecordChunks = [];
    let streamStageMinimized = false;
    let pttKeyHeld = false;
    let capturingKeybind = null;

    function loadVoiceKeySettings() {
        try {
            const raw = localStorage.getItem('loncaVoiceKeys');
            if (raw) return Object.assign({ pttEnabled: false, pttKey: 'KeyV', muteKey: 'KeyM' }, JSON.parse(raw));
        } catch (e) {}
        return { pttEnabled: false, pttKey: 'KeyV', muteKey: 'KeyM' };
    }
    const voiceKeySettings = loadVoiceKeySettings();
    window.voiceKeySettings = voiceKeySettings;
    window.pttKeyHeld = false;

    function saveVoiceKeySettings() {
        localStorage.setItem('loncaVoiceKeys', JSON.stringify(voiceKeySettings));
    }

    function formatKeyCode(code) {
        if (!code) return '?';
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code === 'Space') return 'SPACE';
        return code;
    }

    window.dedupeUsersMap = function dedupeUsersMap(usersObj, memberFilter) {
        const list = Object.values(usersObj || {}).filter(u => u && u.username);
        const filtered = memberFilter ? list.filter(u => memberFilter.includes(u.userId)) : list;
        const byName = new Map();
        for (const u of filtered) {
            const key = (u.username || '').trim().toLowerCase();
            if (!key) continue;
            const prev = byName.get(key);
            if (!prev) { byName.set(key, u); continue; }
            const score = (x) => {
                let s = 0;
                if (x.isOnline) s += 8;
                if (x.avatar) s += 4;
                if (x.peerId) s += 2;
                const id = String(x.userId || '');
                if (id && !id.startsWith('seen_') && !id.startsWith('user_')) s += 3;
                if (x.isAdmin) s += 1;
                return s;
            };
            if (score(u) >= score(prev)) byName.set(key, u);
        }
        return [...byName.values()];
    };

    window.syncVoiceSettingsUI = function syncVoiceSettingsUI() {
        const pttToggle = document.getElementById('setting-ptt-enabled');
        const pttKeyBtn = document.getElementById('setting-ptt-key');
        const muteKeyBtn = document.getElementById('setting-mute-key');
        if (pttToggle) pttToggle.checked = !!voiceKeySettings.pttEnabled;
        if (pttKeyBtn) pttKeyBtn.textContent = formatKeyCode(voiceKeySettings.pttKey);
        if (muteKeyBtn) muteKeyBtn.textContent = formatKeyCode(voiceKeySettings.muteKey);
    };

    window.clearPendingReply = function clearPendingReply() {
        window.pendingReplyTo = null;
        const bar = document.getElementById('reply-bar');
        if (bar) bar.style.display = 'none';
    };

    window.setPendingReply = function setPendingReply(msg) {
        if (!msg || !msg.id) return;
        window.pendingReplyTo = {
            id: msg.id,
            sender: msg.sender || '',
            text: (msg.text || (msg.image ? '[görsel]' : '')).slice(0, 180)
        };
        const bar = document.getElementById('reply-bar');
        if (bar) {
            document.getElementById('reply-bar-user').textContent = window.pendingReplyTo.sender;
            document.getElementById('reply-bar-text').textContent = window.pendingReplyTo.text;
            bar.style.display = 'flex';
        }
        if (typeof chatInput !== 'undefined' && chatInput) chatInput.focus();
    };

    window.updateChannelUnreadBadges = function updateChannelUnreadBadges() {
        if (typeof joinedServers !== 'undefined' && typeof activeServerId !== 'undefined' && typeof renderServerChannels === 'function') {
            const server = joinedServers.find(s => s.id === activeServerId);
            if (server) renderServerChannels(server);
        }
    };

    function formatMessageTextWithMentions(text) {
        const frag = document.createDocumentFragment();
        if (!text) return frag;
        const re = /(@[A-Za-z0-9_\.\-]{2,32})/g;
        let last = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const mention = document.createElement('span');
            mention.className = 'message-mention';
            mention.textContent = m[1];
            frag.appendChild(mention);
            last = m.index + m[1].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        return frag;
    }

    function renderMessageReactions(messageEl, msgId, reactions) {
        let box = messageEl.querySelector('.message-reactions');
        if (!box) {
            box = document.createElement('div');
            box.className = 'message-reactions';
            const content = messageEl.querySelector('.message-content-wrapper');
            if (content) content.appendChild(box);
            else messageEl.appendChild(box);
        }
        box.innerHTML = '';
        Object.keys(reactions || {}).forEach(emoji => {
            const users = reactions[emoji] || [];
            if (!users.length) return;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'reaction-chip' + (users.includes(myUsername) ? ' mine' : '');
            chip.textContent = emoji + ' ' + users.length;
            chip.title = users.join(', ');
            chip.onclick = (e) => {
                e.stopPropagation();
                socket.emit('react-message', { msgId, emoji });
            };
            box.appendChild(chip);
        });
    }

    window.normalizeIncomingMessage = function normalizeIncomingMessage(a, b, c, d, e) {
        if (a && typeof a === 'object' && a.id) {
            return {
                id: a.id,
                sender: a.sender || '',
                text: a.text || '',
                isSystem: !!a.isSystem,
                image: a.image || null,
                pinned: !!a.pinned,
                replyTo: a.replyTo || null,
                reactions: a.reactions || {},
                mentions: a.mentions || [],
                senderId: a.senderId || null
            };
        }
        return {
            id: c,
            sender: b || '',
            text: a || '',
            isSystem: !!d,
            image: e || null,
            pinned: false,
            replyTo: null,
            reactions: {},
            mentions: [],
            senderId: null
        };
    };

    // Mevcut appendMessage'ı zenginleştirilmiş sürümle değiştir
    window.appendMessage = function appendMessage(sender, msg, msgId, isSystem, isPinned, image, meta) {
        const info = meta || { replyTo: null, reactions: {}, mentions: [] };
        const div = document.createElement('div');
        div.classList.add('message');
        div.setAttribute('data-id', msgId);

        if (isSystem) div.classList.add('system');
        else if (sender === myUsername) div.classList.add('mine');
        if (isPinned) div.classList.add('pinned');

        const mentionsMe = (info.mentions || []).includes((myUsername || '').toLowerCase())
            || (msg || '').toLowerCase().includes('@' + (myUsername || '').toLowerCase());
        if (mentionsMe && sender !== myUsername) div.classList.add('mentioned-me');

        const selectContainer = document.createElement('div');
        selectContainer.className = 'message-select-container';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'message-checkbox';
        checkbox.checked = selectedMessageIds.has(msgId);
        selectContainer.appendChild(checkbox);
        div.appendChild(selectContainer);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content-wrapper';

        if (info.replyTo && info.replyTo.id) {
            const replyRef = document.createElement('div');
            replyRef.className = 'message-reply-ref';
            replyRef.textContent = (info.replyTo.sender || '') + ': ' + (info.replyTo.text || '');
            replyRef.onclick = (e) => {
                e.stopPropagation();
                const target = document.querySelector('.message[data-id="' + info.replyTo.id + '"]');
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.style.background = 'rgba(88,101,242,0.2)';
                    setTimeout(() => { target.style.background = ''; }, 1200);
                }
            };
            contentDiv.appendChild(replyRef);
        }

        const textWrapper = document.createElement('div');
        textWrapper.className = 'message-text-wrapper';
        if (isSystem) {
            textWrapper.innerHTML = '<span>' + (msg || '') + '</span>';
        } else {
            const strong = document.createElement('strong');
            strong.textContent = sender + ':';
            strong.style.cursor = 'pointer';
            strong.addEventListener('click', () => {
                const user = Object.values(allUsersList).find(u => u.username === sender);
                if (user) showUserProfileCard(user.userId);
            });
            textWrapper.appendChild(strong);
            if (msg) {
                textWrapper.appendChild(document.createTextNode(' '));
                const span = document.createElement('span');
                span.appendChild(formatMessageTextWithMentions(msg));
                textWrapper.appendChild(span);
            }
        }
        contentDiv.appendChild(textWrapper);

        if (image) {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'message-image-container';
            const imgEl = document.createElement('img');
            imgEl.className = 'message-image-content';
            imgEl.src = image;
            imgEl.alt = 'Görsel';
            imgEl.loading = 'lazy';
            imgEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openImageLightbox(image);
            });
            imgContainer.appendChild(imgEl);
            contentDiv.appendChild(imgContainer);
        }

        div.appendChild(contentDiv);

        if (!isSystem) {
            const hover = document.createElement('div');
            hover.className = 'message-hover-actions';
            REACTION_EMOJIS.forEach(emoji => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = emoji;
                b.onclick = (e) => {
                    e.stopPropagation();
                    socket.emit('react-message', { msgId, emoji });
                };
                hover.appendChild(b);
            });
            const replyBtn = document.createElement('button');
            replyBtn.type = 'button';
            replyBtn.textContent = '↩';
            replyBtn.title = 'Yanıtla';
            replyBtn.onclick = (e) => {
                e.stopPropagation();
                setPendingReply({ id: msgId, sender, text: msg, image });
            };
            hover.appendChild(replyBtn);
            div.appendChild(hover);
        }

        renderMessageReactions(div, msgId, info.reactions || {});

        const actionsBtn = document.createElement('div');
        actionsBtn.className = 'message-actions-btn';
        actionsBtn.title = 'Aksiyonlar';
        actionsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M7 12a2 2 0 11-4 0 2 2 0 014 0zm7 0a2 2 0 11-4 0 2 2 0 014 0zm7 0a2 2 0 11-4 0 2 2 0 014 0z"/></svg>';
        actionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllContextMenus();
            openContextMenu(div, msgId, sender, isSystem);
        });
        div.appendChild(actionsBtn);

        div.addEventListener('click', (e) => {
            if (isSelectionMode) {
                if (e.target.className === 'message-checkbox') return;
                e.preventDefault();
                toggleMessageSelection(msgId, div, checkbox);
            }
        });
        checkbox.addEventListener('click', (e) => { if (isSelectionMode) e.stopPropagation(); });
        checkbox.addEventListener('change', (e) => {
            if (isSelectionMode) {
                e.stopPropagation();
                toggleMessageSelection(msgId, div, checkbox, checkbox.checked);
            }
        });

        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    };

    socket.on('message-reactions', ({ msgId, reactions }) => {
        const msg = activeRoomMessages.find(m => m.id === msgId);
        if (msg) msg.reactions = reactions || {};
        const el = document.querySelector('.message[data-id="' + msgId + '"]');
        if (el) renderMessageReactions(el, msgId, reactions || {});
    });

    socket.on('channel-activity', ({ roomId, mentions, sender }) => {
        if (!roomId || roomId === currentTextRoom) return;
        if (sender && sender === myUsername) return;
        channelUnread[roomId] = (channelUnread[roomId] || 0) + 1;
        updateChannelUnreadBadges();
    });

    // Chat form submit'i replyTo eklemek için yeniden bağla
    if (typeof chatForm !== 'undefined' && chatForm) {
        chatForm.addEventListener('submit', (e) => {
            // script.js de dinliyor; çift gönderimi engellemek için capture + stopImmediate mümkün değil
            // Bunun yerine script.js patch'inde replyTo eklenecek.
        }, true);
    }

    const replyCancelBtn = document.getElementById('reply-bar-cancel');
    if (replyCancelBtn) replyCancelBtn.addEventListener('click', clearPendingReply);

    function hideMentionSuggest() {
        const box = document.getElementById('mention-suggest');
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    }

    function insertMention(name) {
        const input = chatInput;
        const val = input.value;
        const caret = input.selectionStart || val.length;
        const before = val.slice(0, caret);
        const after = val.slice(caret);
        input.value = before.replace(/@([A-Za-z0-9_\.\-]*)$/, '@' + name + ' ') + after;
        input.focus();
        hideMentionSuggest();
    }

    function showMentionSuggest(query) {
        const box = document.getElementById('mention-suggest');
        if (!box) return;
        const q = (query || '').toLowerCase();
        const names = dedupeUsersMap(allUsersList)
            .map(u => u.username)
            .filter(n => n && n !== myUsername && (!q || n.toLowerCase().startsWith(q)))
            .slice(0, 6);
        if (!names.length) { hideMentionSuggest(); return; }
        box.innerHTML = '';
        names.forEach((name, i) => {
            const item = document.createElement('div');
            item.className = 'mention-suggest-item' + (i === 0 ? ' active' : '');
            item.textContent = '@' + name;
            item.onclick = () => insertMention(name);
            box.appendChild(item);
        });
        box.style.display = 'block';
    }

    if (typeof chatInput !== 'undefined' && chatInput) {
        chatInput.addEventListener('input', () => {
            const caret = chatInput.selectionStart || chatInput.value.length;
            const before = chatInput.value.slice(0, caret);
            const m = before.match(/@([A-Za-z0-9_\.\-]*)$/);
            if (m) showMentionSuggest(m[1]);
            else hideMentionSuggest();
        });
    }

    // PTT / tuş atama
    (function bindVoiceSettings() {
        const pttToggle = document.getElementById('setting-ptt-enabled');
        const pttKeyBtn = document.getElementById('setting-ptt-key');
        const muteKeyBtn = document.getElementById('setting-mute-key');
        if (pttToggle) {
            pttToggle.addEventListener('change', () => {
                voiceKeySettings.pttEnabled = pttToggle.checked;
                saveVoiceKeySettings();
                if (voiceKeySettings.pttEnabled) isMicMuted = true;
                applyHardwareStates();
            });
        }
        function bindCapture(btn, which) {
            if (!btn) return;
            btn.addEventListener('click', () => {
                capturingKeybind = which;
                btn.classList.add('listening');
                btn.textContent = '...';
            });
        }
        bindCapture(pttKeyBtn, 'ptt');
        bindCapture(muteKeyBtn, 'mute');
        syncVoiceSettingsUI();
    })();

    function isTypingInField(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    }

    window.addEventListener('keydown', (e) => {
        if (capturingKeybind) {
            e.preventDefault();
            if (e.code === 'Escape') {
                capturingKeybind = null;
                syncVoiceSettingsUI();
                return;
            }
            if (capturingKeybind === 'ptt') voiceKeySettings.pttKey = e.code;
            if (capturingKeybind === 'mute') voiceKeySettings.muteKey = e.code;
            saveVoiceKeySettings();
            capturingKeybind = null;
            document.querySelectorAll('.keybind-btn').forEach(b => b.classList.remove('listening'));
            syncVoiceSettingsUI();
            return;
        }
        if (isTypingInField(document.activeElement) || e.repeat) return;
        if (voiceKeySettings.pttEnabled && e.code === voiceKeySettings.pttKey && currentVoiceRoom) {
            e.preventDefault();
            pttKeyHeld = true;
            window.pttKeyHeld = true;
            applyHardwareStates();
            return;
        }
        if (e.code === voiceKeySettings.muteKey && currentVoiceRoom) {
            e.preventDefault();
            if (voiceKeySettings.pttEnabled) return;
            isMicMuted = !isMicMuted;
            applyHardwareStates();
        }
    });
    window.addEventListener('keyup', (e) => {
        if (voiceKeySettings.pttEnabled && e.code === voiceKeySettings.pttKey) {
            pttKeyHeld = false;
            window.pttKeyHeld = false;
            applyHardwareStates();
        }
    });
    window.addEventListener('blur', () => {
        if (pttKeyHeld) {
            pttKeyHeld = false;
            window.pttKeyHeld = false;
            applyHardwareStates();
        }
    });

    // Yayın sahnesi
    function getStageEls() {
        return {
            stage: document.getElementById('stream-stage'),
            video: document.getElementById('stream-stage-video'),
            title: document.getElementById('stream-stage-title'),
            empty: document.getElementById('stream-stage-empty'),
            toast: document.getElementById('stream-toast')
        };
    }

    window.attachStreamToStage = function attachStreamToStage(peerId, username, stream) {
        const { stage, video, title, empty } = getStageEls();
        if (!stage || !video) return;
        activeStreamPeerId = peerId;
        stage.style.display = 'block';
        stage.classList.toggle('minimized', !!streamStageMinimized);
        if (title) title.textContent = username + ' yayın yapıyor';
        video.srcObject = stream;
        video.muted = false;
        video.volume = streamAudioVolume;
        video.play().catch(() => {});
        if (empty) empty.style.display = 'none';
    };

    window.openStreamStage = function openStreamStage(peerId, username, stream) {
        const source = stream || screenShareStreams[peerId] || (peerId === myPeerId ? localScreenStream : null);
        if (source) {
            attachStreamToStage(peerId, username, source);
            return;
        }
        const { stage, title, empty, video } = getStageEls();
        if (!stage) return;
        activeStreamPeerId = peerId;
        stage.style.display = 'block';
        if (title) title.textContent = (username || 'Kullanıcı') + ' yayınına bağlanılıyor…';
        if (empty) { empty.style.display = 'block'; empty.textContent = 'Yayın akışına bağlanılıyor…'; }
        if (video) video.srcObject = null;
        socket.emit('request-screen-share-stream', { targetPeerId: peerId, requesterPeerId: myPeerId });
        setTimeout(() => {
            if (screenShareStreams[peerId]) attachStreamToStage(peerId, username, screenShareStreams[peerId]);
            else if (empty && activeStreamPeerId === peerId) empty.textContent = 'Yayın akışı alınamadı.';
        }, 3500);
    };

    window.ensureStreamStageForPeer = function ensureStreamStageForPeer(peerId, username) {
        if (activeStreamPeerId === peerId && document.getElementById('stream-stage') && document.getElementById('stream-stage').style.display === 'block') {
            const src = screenShareStreams[peerId] || (peerId === myPeerId ? localScreenStream : null);
            if (src) attachStreamToStage(peerId, username, src);
            return;
        }
        showStreamToast(peerId, username);
    };

    window.clearStreamStageIfPeer = function clearStreamStageIfPeer(peerId) {
        if (activeStreamPeerId !== peerId) return;
        const { stage, video, empty, title } = getStageEls();
        if (video) video.srcObject = null;
        if (empty) { empty.style.display = 'block'; empty.textContent = 'Yayın bitti'; }
        if (title) title.textContent = 'Yayın';
        activeStreamPeerId = null;
        stopStreamRecording();
        setTimeout(() => {
            if (!activeStreamPeerId && stage) stage.style.display = 'none';
        }, 1200);
    };

    function showStreamToast(peerId, username) {
        const toast = document.getElementById('stream-toast');
        if (!toast) return;
        toast.style.display = 'flex';
        toast.innerHTML = '<span><strong>' + (username || 'Biri') + '</strong> yayın açtı</span><button type="button" id="stream-toast-watch">İzle</button>';
        const btn = document.getElementById('stream-toast-watch');
        if (btn) btn.onclick = () => {
            toast.style.display = 'none';
            openStreamStage(peerId, username);
        };
        setTimeout(() => { if (toast.style.display === 'flex') toast.style.display = 'none'; }, 8000);
    }

    socket.on('stream-started', ({ peerId, username, roomId }) => {
        if (!currentVoiceRoom || currentVoiceRoom !== roomId) return;
        showStreamToast(peerId, username || 'Biri');
        if (peerId !== myPeerId) {
            socket.emit('request-screen-share-stream', { targetPeerId: peerId, requesterPeerId: myPeerId });
        }
    });

    socket.on('stream-stopped', ({ peerId }) => {
        clearStreamStageIfPeer(peerId);
        const toast = document.getElementById('stream-toast');
        if (toast) toast.style.display = 'none';
    });

    window.stopStreamRecording = function stopStreamRecording() {
        if (streamRecorder && streamRecorder.state !== 'inactive') {
            try { streamRecorder.stop(); } catch (e) {}
        }
        streamRecorder = null;
        const recBtn = document.getElementById('stream-record-btn');
        if (recBtn) {
            recBtn.classList.remove('recording');
            recBtn.textContent = '⏺ Kaydet';
        }
    };

    function startStreamRecording() {
        const video = document.getElementById('stream-stage-video');
        const stream = video && video.srcObject;
        if (!stream) {
            showCustomAlert('Kayıt', 'Kaydedilecek bir yayın yok.');
            return;
        }
        try {
            streamRecordChunks = [];
            const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
            streamRecorder = new MediaRecorder(stream, { mimeType: mime });
            streamRecorder.ondataavailable = (e) => { if (e.data && e.data.size) streamRecordChunks.push(e.data); };
            streamRecorder.onstop = () => {
                const blob = new Blob(streamRecordChunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'lonca-yayin-' + Date.now() + '.webm';
                a.click();
                URL.revokeObjectURL(url);
                streamRecordChunks = [];
            };
            streamRecorder.start(1000);
            const recBtn = document.getElementById('stream-record-btn');
            if (recBtn) {
                recBtn.classList.add('recording');
                recBtn.textContent = '⏹ Durdur';
            }
        } catch (err) {
            showCustomAlert('Kayıt', 'Bu tarayıcıda kayıt desteklenmiyor.');
        }
    }

    (function bindStreamStageControls() {
        const vol = document.getElementById('stream-audio-volume');
        if (vol) vol.addEventListener('input', () => {
            streamAudioVolume = parseFloat(vol.value);
            const video = document.getElementById('stream-stage-video');
            if (video) video.volume = streamAudioVolume;
        });
        const minBtn = document.getElementById('stream-minimize-btn');
        if (minBtn) minBtn.addEventListener('click', () => {
            streamStageMinimized = !streamStageMinimized;
            const stage = document.getElementById('stream-stage');
            if (stage) stage.classList.toggle('minimized', streamStageMinimized);
        });
        const closeBtn = document.getElementById('stream-close-stage-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => {
            const { stage, video } = getStageEls();
            if (video) video.srcObject = null;
            if (stage) stage.style.display = 'none';
            activeStreamPeerId = null;
            stopStreamRecording();
        });
        const expandBtn = document.getElementById('stream-expand-btn');
        if (expandBtn) expandBtn.addEventListener('click', () => {
            const video = document.getElementById('stream-stage-video');
            const modal = document.getElementById('screen-watch-modal');
            const modalVideo = document.getElementById('screen-watch-video');
            const title = document.getElementById('screen-watch-title') && document.getElementById('screen-watch-title').querySelector('span');
            if (!modal || !modalVideo || !video || !video.srcObject) return;
            modalVideo.srcObject = video.srcObject;
            modalVideo.volume = streamAudioVolume;
            if (title) title.textContent = (document.getElementById('stream-stage-title') || {}).textContent || 'Yayın';
            modal.dataset.watchingPeerId = activeStreamPeerId || '';
            const loading = document.getElementById('screen-watch-loading');
            if (loading) loading.style.display = 'none';
            modal.style.display = 'flex';
        });
        const recBtn = document.getElementById('stream-record-btn');
        if (recBtn) recBtn.addEventListener('click', () => {
            if (streamRecorder && streamRecorder.state === 'recording') stopStreamRecording();
            else startStreamRecording();
        });
    })();

    // Bağlantı kalitesi
    async function updateVoiceConnectionQuality() {
        const label = document.getElementById('voice-connection-quality');
        const title = document.getElementById('voice-status-title');
        const icon = document.getElementById('voice-signal-icon');
        if (!label || !currentVoiceRoom) return;

        const peerIds = Object.keys(voiceCalls || {});
        if (!peerIds.length) {
            label.textContent = 'Kimse yok / bekleniyor';
            label.className = 'status-quality ok';
            if (title) { title.textContent = 'Sese Bağlandı'; title.className = 'status-title'; }
            if (icon) icon.setAttribute('fill', '#faa61a');
            return;
        }

        let bestRtt = Infinity;
        let worstLoss = 0;
        let connected = 0;
        let failed = 0;

        for (const pid of peerIds) {
            const call = voiceCalls[pid];
            const pc = call && call.peerConnection;
            if (!pc) { failed++; continue; }
            const state = pc.connectionState || pc.iceConnectionState;
            if (state === 'failed' || state === 'disconnected' || state === 'closed') { failed++; continue; }
            if (state === 'connected' || state === 'completed') connected++;
            try {
                const stats = await pc.getStats();
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
                        bestRtt = Math.min(bestRtt, report.currentRoundTripTime * 1000);
                    }
                    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                        const lost = report.packetsLost || 0;
                        const received = report.packetsReceived || 0;
                        if (received + lost > 0) worstLoss = Math.max(worstLoss, lost / (received + lost));
                    }
                });
            } catch (e) {}
        }

        const rtt = isFinite(bestRtt) ? Math.round(bestRtt) : null;
        let level = 'good';
        let text = 'Bağlantı iyi';
        if (failed > 0 && connected === 0) {
            level = 'bad';
            text = 'Kopuk — yeniden bağlanılıyor';
        } else if ((rtt != null && rtt > 180) || worstLoss > 0.08 || failed > 0) {
            level = 'bad';
            text = 'Zayıf' + (rtt != null ? ' · ' + rtt + ' ms' : '') + (worstLoss > 0 ? ' · kayıp %' + Math.round(worstLoss * 100) : '');
        } else if ((rtt != null && rtt > 90) || worstLoss > 0.03) {
            level = 'ok';
            text = 'Orta' + (rtt != null ? ' · ' + rtt + ' ms' : '');
        } else {
            text = 'İyi' + (rtt != null ? ' · ' + rtt + ' ms' : '');
        }

        label.textContent = text;
        label.className = 'status-quality ' + level;
        if (title) {
            title.textContent = level === 'bad' ? 'Bağlantı sorunlu' : 'Sese Bağlandı';
            title.className = 'status-title ' + (level === 'good' ? '' : level);
        }
        if (icon) icon.setAttribute('fill', level === 'good' ? '#43b581' : (level === 'ok' ? '#faa61a' : '#ed4245'));
    }

    setInterval(() => {
        if (currentVoiceRoom) updateVoiceConnectionQuality();
    }, 2000);

    // openContextMenu'ya yanıt ekle
    const _openContextMenu = window.openContextMenu;
    window.openContextMenu = function (messageDiv, msgId, sender, isSystem) {
        _openContextMenu(messageDiv, msgId, sender, isSystem);
        if (isSystem) return;
        const menu = messageDiv.querySelector('.message-context-menu');
        if (!menu || menu.querySelector('[data-reply-item]')) return;
        const replyBtn = document.createElement('button');
        replyBtn.className = 'context-menu-item';
        replyBtn.setAttribute('data-reply-item', '1');
        replyBtn.textContent = '↩ Yanıtla';
        replyBtn.onclick = () => {
            const msgObj = activeRoomMessages.find(m => m.id === msgId) || { id: msgId, sender, text: '' };
            setPendingReply(msgObj);
            closeAllContextMenus();
        };
        menu.insertBefore(replyBtn, menu.firstChild);
    };

    console.log('[Lonca] UX özellikleri yüklendi');
})();
