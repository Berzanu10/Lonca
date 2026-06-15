const socket = io('/');
let peer, myPeerId, myUsername;

let myUserId = localStorage.getItem('userId');
if (!myUserId) {
    myUserId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('userId', myUserId);
}
let myAvatar = localStorage.getItem('avatar') || '';
let myAdminToken = localStorage.getItem('adminToken') || '';
let amIAdmin = false;

let currentTextRoom = 'genel';
let currentVoiceRoom = null;

let localAudioStream = null;
let localVideoStream = null;
let privateCall = null;
let voiceCalls = {};
let allUsersList = {};

let activeRoomMessages = [];
let isSelectionMode = false;
let selectedMessageIds = new Set();

let localScreenStream = null;
let screenShareCalls = {};
let screenShareStreams = {};

let audioContext = null;
const analysers = {};

let isMicMuted = false;
let isDeafened = false;
let prevMicMuted = false;

const loginScreenWrapper = document.getElementById('login-screen-wrapper');
const appContainer = document.getElementById('app-container');
const loginView = document.getElementById('login-view');
const signupView = document.getElementById('signup-view');
const showSignupLink = document.getElementById('show-signup');
const showLoginLink = document.getElementById('show-login');

// Form elemanları ve Şifremi Unuttum
const loginFormEl = document.getElementById('login-form-el');
const signupFormEl = document.getElementById('signup-form-el');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const signupUsernameInput = document.getElementById('signup-username');
const signupEmailInput = document.getElementById('signup-email');
const signupPasswordInput = document.getElementById('signup-password');
const customGoogleBtn = document.getElementById('custom-google-btn');

const forgotView = document.getElementById('forgot-view');
const forgotSendForm = document.getElementById('forgot-send-form');
const forgotResetForm = document.getElementById('forgot-reset-form');
const forgotEmailInput = document.getElementById('forgot-email');
const resetCodeInput = document.getElementById('reset-code');
const resetNewPasswordInput = document.getElementById('reset-new-password');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const backToLoginLink = document.getElementById('back-to-login');

const usersList = document.getElementById('users-list');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const textChannels = document.querySelectorAll('.text-channel');
const voiceChannels = document.querySelectorAll('.voice-channel');
const audioContainer = document.getElementById('audio-container');

// -----------------------------------------
// CUSTOM DIALOG & MODAL SYSTEM (Discord-like)
// -----------------------------------------
function showCustomConfirm(title, message, isDanger, onOk, onCancel) {
    const modal = document.getElementById('custom-dialog-modal');
    const titleEl = document.getElementById('custom-dialog-title');
    const messageEl = document.getElementById('custom-dialog-message');
    const okBtn = document.getElementById('custom-dialog-ok-btn');
    const cancelBtn = document.getElementById('custom-dialog-cancel-btn');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    cancelBtn.style.display = 'inline-block';
    
    if (isDanger) {
        okBtn.style.backgroundColor = '#ed4245';
        okBtn.textContent = 'Evet, Devam Et';
    } else {
        okBtn.style.backgroundColor = '#5865F2';
        okBtn.textContent = 'Evet';
    }
    
    modal.style.display = 'flex';
    
    const cleanUp = () => {
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
    };
    
    okBtn.onclick = () => {
        cleanUp();
        if (onOk) onOk();
    };
    
    cancelBtn.onclick = () => {
        cleanUp();
        if (onCancel) onCancel();
    };
}

function showCustomAlert(title, message, onOk) {
    const modal = document.getElementById('custom-dialog-modal');
    const titleEl = document.getElementById('custom-dialog-title');
    const messageEl = document.getElementById('custom-dialog-message');
    const okBtn = document.getElementById('custom-dialog-ok-btn');
    const cancelBtn = document.getElementById('custom-dialog-cancel-btn');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    cancelBtn.style.display = 'none';
    okBtn.style.backgroundColor = '#5865F2';
    okBtn.textContent = 'Tamam';
    
    modal.style.display = 'flex';
    
    const cleanUp = () => {
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
    };
    
    okBtn.onclick = () => {
        cleanUp();
        if (onOk) onOk();
    };
}

function showCustomPrompt(title, placeholder, onOk, onCancel) {
    const modal = document.getElementById('custom-prompt-modal');
    const titleEl = document.getElementById('custom-prompt-title');
    const inputEl = document.getElementById('custom-prompt-input');
    const okBtn = document.getElementById('custom-prompt-ok-btn');
    const cancelBtn = document.getElementById('custom-prompt-cancel-btn');
    
    titleEl.textContent = title;
    inputEl.placeholder = placeholder;
    inputEl.value = '';
    
    modal.style.display = 'flex';
    inputEl.focus();
    
    const cleanUp = () => {
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
    };
    
    okBtn.onclick = () => {
        const val = inputEl.value.trim();
        cleanUp();
        if (onOk) onOk(val);
    };
    
    cancelBtn.onclick = () => {
        cleanUp();
        if (onCancel) onCancel();
    };
    
    inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') {
            okBtn.click();
        }
    };
}

const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleDeafBtn = document.getElementById('toggle-deaf-btn');
const bottomLeaveVoiceBtn = document.getElementById('bottom-leave-voice');
const voiceConnectionInfo = document.getElementById('voice-connection-info');
const activeVoiceRoomName = document.getElementById('active-voice-room-name');
const displayMyUsername = document.getElementById('display-my-username');
const settingsBtn = document.getElementById('settings-btn');

const currentUserInfo = document.getElementById('current-user-info');
const profileModal = document.getElementById('profile-modal');
const profileUsernameInput = document.getElementById('profile-username-input');
const modalAvatarPreview = document.getElementById('modal-avatar-preview');
const avatarFileInput = document.getElementById('avatar-file-input');
const profileSaveBtn = document.getElementById('profile-save-btn');
const profileCancelBtn = document.getElementById('profile-cancel-btn');

const micSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
const headSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/></svg>`;let isProfileModalForced = false;

// ONAYLANAN GİRİŞ İŞLEMİNİ YÖNETEN YARDIMCI FONKSİYON
function handleLoginSuccess(data) {
    myUsername = data.user.username;
    myUserId = data.user.id;
    myAvatar = data.user.avatar || '';
    amIAdmin = data.user.isAdmin;

    localStorage.setItem('sessionToken', data.token);
    localStorage.setItem('username', myUsername);
    localStorage.setItem('userId', myUserId);
    localStorage.setItem('avatar', myAvatar);

    displayMyUsername.textContent = myUsername;
    const myAv = document.getElementById('my-avatar');
    if (myAv) {
        if (myAvatar) {
            myAv.style.backgroundImage = `url(${myAvatar})`;
            myAv.style.backgroundSize = 'cover';
            myAv.style.color = 'transparent';
            myAv.textContent = '';
        } else {
            myAv.style.backgroundImage = '';
            myAv.style.color = '';
            myAv.textContent = myUsername.charAt(0).toUpperCase();
        }
    }

    if (loginScreenWrapper) loginScreenWrapper.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    
    if (data.isNewUser) {
        // İlk kez giriyorsa kullanıcı adı ve fotoğraf için modalı aç, sese/peere hemen bağlanma
        openProfileModal(true);
    } else {
        initializePeer();
    }
}

function clearSession() {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('username');
    localStorage.removeItem('userId');
    localStorage.removeItem('avatar');
}

function showLoginScreen() {
    if (loginScreenWrapper) loginScreenWrapper.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
}

// Oturum doğrulama kontrolü
const sessionToken = localStorage.getItem('sessionToken');
if (sessionToken) {
    fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            handleLoginSuccess(data);
        } else {
            clearSession();
            showLoginScreen();
        }
    })
    .catch(() => {
        clearSession();
        showLoginScreen();
    });
} else {
    showLoginScreen();
}

// Form ve Görünüm Geçişleri
if (showSignupLink) {
    showSignupLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginView.style.display = 'none';
        signupView.style.display = 'block';
        forgotView.style.display = 'none';
    });
}

if (showLoginLink) {
    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        signupView.style.display = 'none';
        loginView.style.display = 'block';
        forgotView.style.display = 'none';
    });
}

if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginView.style.display = 'none';
        signupView.style.display = 'none';
        forgotView.style.display = 'block';
        forgotSendForm.style.display = 'block';
        forgotResetForm.style.display = 'none';
    });
}

if (backToLoginLink) {
    backToLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        forgotView.style.display = 'none';
        loginView.style.display = 'block';
    });
}

// Giriş Formu Submit Dinleyicisi
if (loginFormEl) {
    loginFormEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = loginEmailInput.value.trim();
        const password = loginPasswordInput.value;
        
        fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                handleLoginSuccess(data);
            } else {
                showCustomAlert("Hata", data.error || "Giriş yapılamadı.");
            }
        })
        .catch(() => {
            showCustomAlert("Hata", "Sunucu ile bağlantı kurulamadı.");
        });
    });
}

// Şifremi Unuttum - Kod İsteme Formu Dinleyicisi
if (forgotSendForm) {
    forgotSendForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = forgotEmailInput.value.trim();
        
        fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showCustomAlert("Kod Gönderildi", `Şifre sıfırlama kodu e-postanıza gönderildi! Lütfen e-postanızı kontrol edin.`, () => {
                    forgotSendForm.style.display = 'none';
                    forgotResetForm.style.display = 'block';
                    resetCodeInput.focus();
                });
            } else {
                showCustomAlert("Hata", data.error || "Sıfırlama kodu gönderilemedi.");
            }
        })
        .catch(() => {
            showCustomAlert("Hata", "Sunucu ile bağlantı kurulamadı.");
        });
    });
}

// Şifremi Unuttum - Şifre Sıfırlama Formu Dinleyicisi
if (forgotResetForm) {
    forgotResetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = forgotEmailInput.value.trim();
        const code = resetCodeInput.value.trim();
        const newPassword = resetNewPasswordInput.value;
        
        if (newPassword.length < 6) {
            showCustomAlert("Hata", "Şifre en az 6 karakter olmalıdır.");
            return;
        }
        
        fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, newPassword })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showCustomAlert("Başarılı", data.message, () => {
                    forgotView.style.display = 'none';
                    loginView.style.display = 'block';
                    // Alanları temizle
                    forgotEmailInput.value = '';
                    resetCodeInput.value = '';
                    resetNewPasswordInput.value = '';
                });
            } else {
                showCustomAlert("Hata", data.error || "Şifre sıfırlanamadı.");
            }
        })
        .catch(() => {
            showCustomAlert("Hata", "Sunucu ile bağlantı kurulamadı.");
        });
    });
}

// Kayıt Formu Submit Dinleyicisi
if (signupFormEl) {
    signupFormEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = signupUsernameInput.value.trim();
        const email = signupEmailInput.value.trim();
        const password = signupPasswordInput.value;
        
        if (password.length < 6) {
            showCustomAlert("Hata", "Şifre en az 6 karakter olmalıdır.");
            return;
        }
        
        fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                handleLoginSuccess(data);
            } else {
                showCustomAlert("Hata", data.error || "Kayıt işlemi başarısız.");
            }
        })
        .catch(() => {
            showCustomAlert("Hata", "Sunucu ile bağlantı kurulamadı.");
        });
    });
}

// Google ve Mock Google Giriş Entegrasyonları
function handleCredentialResponse(response) {
    fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            handleLoginSuccess(data);
        } else {
            showCustomAlert("Hata", data.error || "Google ile giriş yapılamadı.");
        }
    })
    .catch(() => {
        showCustomAlert("Hata", "Google kimlik doğrulama sunucusuna erişilemedi.");
    });
}

function showMockGoogleLogin() {
    showCustomPrompt("Google ile Giriş (Mock)", "Google E-posta adresinizi girin...", (email) => {
        if (!email) return;
        if (!email.includes('@')) {
            showCustomAlert("Hata", "Geçersiz e-posta adresi.");
            return;
        }
        const namePart = email.split('@')[0];
        const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        const mockAvatar = `https://api.dicebear.com/7.x/identicon/svg?seed=${namePart}`;
        
        fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mock: true,
                email: email,
                name: name,
                picture: mockAvatar
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                handleLoginSuccess(data);
            } else {
                showCustomAlert("Hata", data.error || "Giriş yapılamadı.");
            }
        })
        .catch(() => {
            showCustomAlert("Hata", "Giriş sırasında hata oluştu.");
        });
    });
}

function initGoogleAuth() {
    fetch('/api/config')
        .then(r => r.json())
        .then(config => {
            if (config.googleClientId) {
                if (typeof google !== 'undefined') {
                    google.accounts.id.initialize({
                        client_id: config.googleClientId,
                        callback: handleCredentialResponse
                    });
                    google.accounts.id.renderButton(
                        document.getElementById("google-signin-container"),
                        { theme: "outline", size: "large", width: "100%" }
                    );
                    google.accounts.id.prompt(); // Tarayıcıda açık hesapları One Tap ile direkt göster
                } else {
                    setTimeout(initGoogleAuth, 1000);
                }
            } else {
                if (customGoogleBtn) {
                    customGoogleBtn.style.display = "flex";
                    customGoogleBtn.onclick = (e) => {
                        e.preventDefault();
                        showMockGoogleLogin();
                    };
                }
            }
        })
        .catch(() => {
            if (customGoogleBtn) {
                customGoogleBtn.style.display = "flex";
                customGoogleBtn.onclick = (e) => {
                    e.preventDefault();
                    showMockGoogleLogin();
                };
            }
        });
}

initGoogleAuth();

function triggerForcedValidationErrors() {
    const modalContent = document.querySelector('.profile-modal-content');
    const usernameInput = document.getElementById('profile-username-input');
    const wrapper = usernameInput ? usernameInput.closest('.profile-input-wrapper') : null;
    
    if (modalContent) {
        modalContent.classList.remove('shake');
        void modalContent.offsetWidth; // Trigger reflow
        modalContent.classList.add('shake');
        modalContent.addEventListener('animationend', () => {
            modalContent.classList.remove('shake');
        }, { once: true });
    }
    
    if (wrapper && usernameInput) {
        wrapper.classList.add('input-error');
        const clearError = () => {
            wrapper.classList.remove('input-error');
            usernameInput.removeEventListener('input', clearError);
        };
        usernameInput.addEventListener('input', clearError);
    }
}

function handleCloseAttempt() {
    const newName = profileUsernameInput.value.trim();
    if (!newName) {
        triggerForcedValidationErrors();
    } else {
        profileSaveBtn.click();
    }
}

function openProfileModal(isForceEdit = false) {
    isProfileModalForced = isForceEdit;
    
    // Kapatma tuşu her zaman açık kalır
    const closeBtn = document.getElementById('profile-close-btn');
    if (closeBtn) {
        closeBtn.style.display = 'block';
    }

    profileUsernameInput.value = myUsername || '';
    const adminKeyInput = document.getElementById('profile-admin-key');
    if (adminKeyInput) adminKeyInput.value = myAdminToken;

    // Badges & role updating
    const badgesDiv = document.getElementById('profile-modal-badges');
    const roleSpan = document.getElementById('profile-modal-role');
    
    if (amIAdmin) {
        if (roleSpan) roleSpan.textContent = 'Sunucu Sahibi / Yönetici';
        if (badgesDiv) {
            badgesDiv.innerHTML = `
                <div class="badge-icon" title="Sunucu Sahibi (Taç)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#FEE75C"><path d="M2 22h20V2L15 9l-3-6-3 6L2 2z"/></svg>
                </div>
                <div class="badge-icon" title="Geliştirici">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#5865F2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                </div>
            `;
            badgesDiv.style.display = 'flex';
        }
    } else {
        if (roleSpan) roleSpan.textContent = 'Üye';
        if (badgesDiv) {
            badgesDiv.innerHTML = '';
            badgesDiv.style.display = 'none';
        }
    }

    if (myAvatar) {
        modalAvatarPreview.style.backgroundImage = `url(${myAvatar})`;
        modalAvatarPreview.style.backgroundSize = 'cover';
    } else {
        modalAvatarPreview.style.backgroundImage = '';
    }

    profileModal.style.display = 'flex';
}

if (currentUserInfo) {
    currentUserInfo.addEventListener('click', () => openProfileModal(false));
}
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => openProfileModal(false));
}

if (modalAvatarPreview && avatarFileInput) {
    modalAvatarPreview.addEventListener('click', () => {
        avatarFileInput.click();
    });

    avatarFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 128;
                    const MAX_HEIGHT = 128;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    
                    modalAvatarPreview.style.backgroundImage = `url(${dataUrl})`;
                    modalAvatarPreview.style.backgroundSize = 'cover';
                    modalAvatarPreview.dataset.tempAvatar = dataUrl;
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

const profileCloseBtn = document.getElementById('profile-close-btn');
if (profileCloseBtn) {
    profileCloseBtn.addEventListener('click', () => {
        if (isProfileModalForced) {
            handleCloseAttempt();
            return;
        }
        profileModal.style.display = 'none';
        if (modalAvatarPreview) delete modalAvatarPreview.dataset.tempAvatar;
    });
}

// Esc tuşu ile kapatmayı engelleme
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && profileModal.style.display === 'flex') {
        if (isProfileModalForced) {
            e.preventDefault();
            e.stopPropagation();
            handleCloseAttempt();
        }
    }
});

if (profileSaveBtn) {
    profileSaveBtn.addEventListener('click', () => {
        const newName = profileUsernameInput.value.trim();
        if (!newName) {
            if (isProfileModalForced) {
                triggerForcedValidationErrors();
            } else {
                showCustomAlert("Hata", "Kullanıcı adı boş olamaz.");
            }
            return;
        }
        
        const adminKeyVal = document.getElementById('profile-admin-key').value.trim();
        const avatarData = (modalAvatarPreview && modalAvatarPreview.dataset.tempAvatar) ? modalAvatarPreview.dataset.tempAvatar : myAvatar;

        const sessionToken = localStorage.getItem('sessionToken');

        fetch('/api/users/profile', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sessionToken}`
            },
            body: JSON.stringify({
                username: newName,
                avatar: avatarData,
                adminToken: adminKeyVal
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                localStorage.setItem('username', data.user.username);
                localStorage.setItem('avatar', data.user.avatar || '');
                if (adminKeyVal) {
                    localStorage.setItem('adminToken', adminKeyVal);
                } else {
                    localStorage.removeItem('adminToken');
                }
                profileModal.style.display = 'none';
                location.reload();
            } else {
                showCustomAlert("Hata", data.error || "Profil güncellenemedi.");
            }
        })
        .catch(() => {
            showCustomAlert("Hata", "Sunucu ile bağlantı kurulamadı.");
        });
    });
}

function initializePeer() {
    peer = new Peer(undefined, { path: '/peerjs', host: '/', port: location.port || (location.protocol === 'https:' ? 443 : 80) });

    peer.on('open', id => {
        myPeerId = id;
        socket.emit('register', myPeerId, myUsername, myUserId, myAvatar, myAdminToken);
        joinTextRoom(currentTextRoom);
    });

    peer.on('call', async call => {
        if (call.metadata && call.metadata.type === 'voice-room') {
            if (!localAudioStream) {
                try {
                    localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    monitorSpeech(localAudioStream, myPeerId);
                    applyHardwareStates();
                } catch (err) { }
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

        if (call.metadata && call.metadata.type === 'screen-share') {
            call.answer();
            call.on('stream', remoteStream => {
                screenShareStreams[call.peer] = remoteStream;
                socket.emit('get-voice-state');
            });
            call.on('close', () => {
                delete screenShareStreams[call.peer];
                const watchModal = document.getElementById('screen-watch-modal');
                if (watchModal.style.display === 'flex' && watchModal.dataset.watchingPeerId === call.peer) {
                    closeScreenWatchModal();
                }
                socket.emit('get-voice-state');
            });
            return;
        }

        let callerName = "Biri";
        for (let ip in allUsersList) if (allUsersList[ip].peerId === call.peer) callerName = allUsersList[ip].username;

        showCustomConfirm("Özel Arama", `${callerName} sizi ÖZEL görüntülü arıyor! Kabul ediyor musunuz?`, false, async () => {
            try {
                if (!localVideoStream) localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                call.answer(localVideoStream);
                privateCall = call;
                openVideoModal(); addVideoStream(localVideoStream, 'local', 'Sen');
                call.on('stream', userStream => addVideoStream(userStream, call.peer, callerName));
                call.on('close', () => endPrivateCall());
            } catch (err) { showCustomAlert("Hata", "Kameraya erişim sağlanamadı."); }
        });
    });
}

toggleDeafBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    if (isDeafened) {
        prevMicMuted = isMicMuted;
        isMicMuted = true;
    } else {
        isMicMuted = prevMicMuted;
    }
    applyHardwareStates();
});


toggleMicBtn.addEventListener('click', () => {
    if (isDeafened) return;
    isMicMuted = !isMicMuted;
    applyHardwareStates();
});

function applyHardwareStates() {
    toggleMicBtn.classList.toggle('strikethrough-icon', isMicMuted);
    toggleDeafBtn.classList.toggle('strikethrough-icon', isDeafened);

    if (localAudioStream) {
        localAudioStream.getAudioTracks().forEach(track => { track.enabled = !isMicMuted; });
    }

    for (let id in voiceCalls) {
        const aud = document.getElementById('audio-' + id);
        if (aud) aud.muted = isDeafened;
    }

    socket.emit('voice-state-update', { mic: !isMicMuted, deaf: !isDeafened });
}

// -----------------------------------------
// Global Sağ Liste - KULLANICILAR
// -----------------------------------------
socket.on('global-users', (usersObj) => {
    allUsersList = usersObj;
    usersList.innerHTML = '';

    const sortedIds = Object.keys(allUsersList).sort((a, b) => {
        const uA = allUsersList[a];
        const uB = allUsersList[b];
        // Önce online olanlar, sonra offline; her ikisi içinde admin önce
        if (uA.isOnline && !uB.isOnline) return -1;
        if (!uA.isOnline && uB.isOnline) return 1;
        if (uA.isAdmin && !uB.isAdmin) return -1;
        if (!uA.isAdmin && uB.isAdmin) return 1;
        return (uA.username || '').localeCompare(uB.username || '');
    });

    // Online / Offline bölüm başlıkları
    let onlineHeaderAdded = false;
    let offlineHeaderAdded = false;

    for (let uid of sortedIds) {
        const u = allUsersList[uid];
        const isMe = u.peerId === myPeerId;

        // Bölüm başlığı
        if (u.isOnline && !onlineHeaderAdded) {
            const hdr = document.createElement('li');
            hdr.style.cssText = 'color:#72767d;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:12px 8px 4px;list-style:none;';
            hdr.textContent = 'Çevrimiçi';
            usersList.appendChild(hdr);
            onlineHeaderAdded = true;
        }
        if (!u.isOnline && !offlineHeaderAdded) {
            const hdr = document.createElement('li');
            hdr.style.cssText = 'color:#72767d;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:12px 8px 4px;list-style:none;';
            hdr.textContent = 'Çevrimdışı';
            usersList.appendChild(hdr);
            offlineHeaderAdded = true;
        }

        const li = document.createElement('li');
        li.style.cssText = `opacity:${u.isOnline ? '1' : '0.45'}; display:flex; align-items:center; justify-content:space-between; padding:3px 4px; border-radius:4px; gap:4px;`;
        li.style.transition = 'background 0.1s';
        li.addEventListener('mouseenter', () => { if (!u.isOnline) li.style.background = 'rgba(255,255,255,0.03)'; else li.style.background = 'rgba(255,255,255,0.05)'; });
        li.addEventListener('mouseleave', () => { li.style.background = 'transparent'; });

        // Sol: avatar + isim + online nokta
        const infoDiv = document.createElement('div');
        infoDiv.className = u.isOnline ? 'right-user-info online' : 'right-user-info';
        infoDiv.style.cssText = 'display:flex;align-items:center;gap:0;flex:1;min-width:0;';

        // Avatar wrapper (relative, for status dot)
        const avatarWrapper = document.createElement('div');
        avatarWrapper.style.cssText = 'position:relative;flex-shrink:0;margin-right:8px;';

        const avatar = document.createElement('div');
        avatar.className = 'right-panel-avatar';
        if (u.avatar) {
            avatar.style.backgroundImage = `url(${u.avatar})`;
            avatar.style.backgroundSize = 'cover';
            avatar.style.color = 'transparent';
            avatar.textContent = '';
        } else {
            avatar.style.backgroundImage = '';
            avatar.style.color = '';
            avatar.textContent = (u.username || '?').charAt(0).toUpperCase();
        }
        avatarWrapper.appendChild(avatar);

        // Status dot
        const statusDot = document.createElement('div');
        statusDot.style.cssText = `
            position:absolute; bottom:-1px; right:-1px;
            width:10px; height:10px; border-radius:50%;
            background:${u.isOnline ? '#43b581' : '#747f8d'};
            border:2px solid #2f3136;
        `;
        avatarWrapper.appendChild(statusDot);
        infoDiv.appendChild(avatarWrapper);

        // Name + badges
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'display:flex;align-items:center;gap:5px;min-width:0;flex:1;';

        const nameText = document.createElement('span');
        nameText.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.88rem;';
        nameText.textContent = isMe ? u.username + ' (Sen)' : u.username;
        if (isMe) { nameText.style.color = '#43b581'; nameText.style.fontWeight = 'bold'; }

        nameSpan.appendChild(nameText);

        if (u.isAdmin) {
            const crown = document.createElement('span');
            crown.title = 'Yönetici';
            crown.style.flexShrink = '0';
            crown.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="#FEE75C"><path d="M2 22h20V2L15 9l-3-6-3 6L2 2z"/></svg>`;
            nameSpan.appendChild(crown);
        }

        infoDiv.appendChild(nameSpan);
        li.appendChild(infoDiv);

        // Sağ: action butonları
        if (!isMe) {
            const actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = 'display:flex;gap:3px;flex-shrink:0;';

            // Ara (sadece online)
            if (u.isOnline) {
                const callBtn = document.createElement('button');
                callBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>`;
                callBtn.title = 'Özel Çağrı';
                callBtn.style.cssText = 'background:rgba(67,181,129,0.15);border:none;color:#43b581;width:26px;height:26px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.1s;';
                callBtn.addEventListener('mouseenter', () => callBtn.style.background = 'rgba(67,181,129,0.3)');
                callBtn.addEventListener('mouseleave', () => callBtn.style.background = 'rgba(67,181,129,0.15)');
                callBtn.onclick = () => initiatePrivateCall(u.peerId, u.username);
                actionsDiv.appendChild(callBtn);
            }

            if (amIAdmin) {
                // Sunucudan At (geçici kick, sadece online)
                if (u.isOnline) {
                    const kickBtn = document.createElement('button');
                    kickBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/></svg>`;
                    kickBtn.title = 'Sunucudan At (Geçici)';
                    kickBtn.style.cssText = 'background:rgba(237,66,69,0.15);border:none;color:#ed4245;width:26px;height:26px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.1s;';
                    kickBtn.addEventListener('mouseenter', () => kickBtn.style.background = 'rgba(237,66,69,0.3)');
                    kickBtn.addEventListener('mouseleave', () => kickBtn.style.background = 'rgba(237,66,69,0.15)');
                    kickBtn.onclick = (e) => {
                        e.stopPropagation();
                        showCustomConfirm("Sunucudan At", `${u.username} sunucudan atılsın mı? (Tekrar giriş yapabilir)`, true, () => {
                            socket.emit('kick-from-server', u.userId);
                        });
                    };
                    actionsDiv.appendChild(kickBtn);
                }

                // Kalıcı Kaldır (her zaman görünür, admin için)
                if (!u.isAdmin) {
                    const removeBtn = document.createElement('button');
                    removeBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
                    removeBtn.title = 'Sunucudan Kalıcı Kaldır';
                    removeBtn.style.cssText = 'background:rgba(237,66,69,0.08);border:1px solid rgba(237,66,69,0.3);color:#c04040;width:26px;height:26px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.1s;';
                    removeBtn.addEventListener('mouseenter', () => { removeBtn.style.background = 'rgba(237,66,69,0.25)'; removeBtn.style.color = '#ed4245'; });
                    removeBtn.addEventListener('mouseleave', () => { removeBtn.style.background = 'rgba(237,66,69,0.08)'; removeBtn.style.color = '#c04040'; });
                    removeBtn.onclick = (e) => {
                        e.stopPropagation();
                        showCustomConfirm(
                            "Kalıcı Kaldır",
                            `${u.username} kullanıcısı sunucudan kalıcı olarak kaldırılsın mı? Bu işlem geri alınamaz!`,
                            true,
                            () => { socket.emit('remove-user', u.userId); }
                        );
                    };
                    actionsDiv.appendChild(removeBtn);
                }
            }

            if (actionsDiv.children.length > 0) li.appendChild(actionsDiv);
        }

        usersList.appendChild(li);
    }
});


// -----------------------------------------
// Metin Kanalları ve Sohbet Geçmişi
// -----------------------------------------
function joinTextRoom(room) {
    if (!myPeerId) return;
    messages.innerHTML = '';
    socket.emit('join-text-room', room);
}
socket.on('create-message', (message, senderName, msgId, isSystem) => {
    appendMessage(senderName, message, msgId, isSystem);
    activeRoomMessages.push({ id: msgId, sender: senderName, text: message, isSystem: isSystem });
});
socket.on('chat-history', (history) => {
    messages.innerHTML = '';
    activeRoomMessages = history;
    history.forEach(msg => {
        appendMessage(msg.sender, msg.text, msg.id, msg.isSystem, msg.pinned);
    });
    messages.scrollTop = messages.scrollHeight;
    updatePinnedMessagesBanner();
});
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) { socket.emit('chat-message', msg); chatInput.value = ''; }
});
function appendMessage(sender, msg, msgId, isSystem, isPinned) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.setAttribute('data-id', msgId);
    
    if (isSystem) {
        div.classList.add('system');
    } else if (sender === myUsername) {
        div.classList.add('mine');
    }
    
    if (isPinned) {
        div.classList.add('pinned');
    }

    // Checkbox container for selection mode
    const selectContainer = document.createElement('div');
    selectContainer.className = 'message-select-container';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'message-checkbox';
    checkbox.checked = selectedMessageIds.has(msgId);
    selectContainer.appendChild(checkbox);
    div.appendChild(selectContainer);

    // Message text contents container
    const contentDiv = document.createElement('div');
    contentDiv.style.display = 'flex';
    contentDiv.style.justifyContent = 'space-between';
    contentDiv.style.width = '100%';
    contentDiv.style.alignItems = 'center';
    
    const textWrapper = document.createElement('div');
    if (isSystem) {
        textWrapper.innerHTML = `<span>${msg}</span>`;
    } else {
        const strong = document.createElement('strong');
        strong.textContent = sender + ':';
        const span = document.createElement('span');
        span.textContent = msg;
        textWrapper.appendChild(strong);
        textWrapper.appendChild(document.createTextNode(' '));
        textWrapper.appendChild(span);
    }
    contentDiv.appendChild(textWrapper);
    div.appendChild(contentDiv);

    // 3-dots actions button (always display so all messages can be select/delete managed)
    const actionsBtn = document.createElement('div');
    actionsBtn.className = 'message-actions-btn';
    actionsBtn.title = 'Aksiyonlar';
    actionsBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display: block;">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M7 12a2 2 0 11-4 0 2 2 0 014 0zm7 0a2 2 0 11-4 0 2 2 0 014 0zm7 0a2 2 0 11-4 0 2 2 0 014 0z"/>
        </svg>
    `;
    
    actionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllContextMenus();
        openContextMenu(div, msgId, sender, isSystem);
    });
    
    div.appendChild(actionsBtn);

    // Hover list message click for selection mode
    div.addEventListener('click', (e) => {
        if (isSelectionMode) {
            // If click was on checkbox, ignore (checkbox handler will fire change event)
            if (e.target.className === 'message-checkbox') {
                return;
            }
            e.preventDefault();
            toggleMessageSelection(msgId, div, checkbox);
        }
    });

    checkbox.addEventListener('click', (e) => {
        if (isSelectionMode) {
            e.stopPropagation();
        }
    });

    checkbox.addEventListener('change', (e) => {
        if (isSelectionMode) {
            e.stopPropagation();
            toggleMessageSelection(msgId, div, checkbox, checkbox.checked);
        }
    });

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

function openContextMenu(messageDiv, msgId, sender, isSystem) {
    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    
    if (!isSystem) {
        const msgObj = activeRoomMessages.find(m => m.id === msgId);
        const isCurrentlyPinned = msgObj ? !!msgObj.pinned : false;

        // Pin option
        const pinBtn = document.createElement('button');
        pinBtn.className = 'context-menu-item';
        pinBtn.innerHTML = isCurrentlyPinned 
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;"><path d="M16 12V4h1v-2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg> Sabitlemeyi Kaldır`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;"><path d="M16 12V4h1v-2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg> Sabitle`;
        pinBtn.onclick = () => {
            socket.emit('pin-message', msgId);
            closeAllContextMenus();
        };
        menu.appendChild(pinBtn);
    }

    // Select option
    const selectBtn = document.createElement('button');
    selectBtn.className = 'context-menu-item';
    selectBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="20 6 9 17 4 12"/></svg> Seç`;
    selectBtn.onclick = () => {
        enterSelectionMode();
        toggleMessageSelection(msgId, messageDiv, messageDiv.querySelector('.message-checkbox'), true);
        closeAllContextMenus();
    };
    menu.appendChild(selectBtn);

    // Delete option (Admins only)
    if (amIAdmin) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'context-menu-item danger';
        deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Sil`;
        deleteBtn.onclick = () => {
            showCustomConfirm("Mesajı Sil", "Bu mesajı silmek istediğinize emin misiniz?", true, () => {
                socket.emit('delete-message', msgId);
            });
            closeAllContextMenus();
        };
        menu.appendChild(deleteBtn);
    }

    messageDiv.appendChild(menu);
}

function closeAllContextMenus() {
    document.querySelectorAll('.message-context-menu').forEach(m => m.remove());
}

document.addEventListener('click', () => {
    closeAllContextMenus();
});

// Selection Mode Functions
function enterSelectionMode() {
    isSelectionMode = true;
    selectedMessageIds.clear();
    document.getElementById('messages').classList.add('selection-mode');
    document.getElementById('selection-action-bar').style.display = 'flex';
    document.getElementById('chat-form').style.display = 'none';
    
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.style.display = amIAdmin ? 'block' : 'none';
    }
    
    updateSelectionBarUI();
}

function cancelSelectionMode() {
    isSelectionMode = false;
    selectedMessageIds.clear();
    document.getElementById('messages').classList.remove('selection-mode');
    document.getElementById('selection-action-bar').style.display = 'none';
    document.getElementById('chat-form').style.display = 'flex';
    
    document.querySelectorAll('.message').forEach(el => {
        el.classList.remove('selected');
        const cb = el.querySelector('.message-checkbox');
        if (cb) cb.checked = false;
    });
}

function toggleMessageSelection(msgId, messageDiv, checkbox, forceState) {
    const isSelected = (forceState !== undefined) ? forceState : !selectedMessageIds.has(msgId);
    
    if (isSelected) {
        selectedMessageIds.add(msgId);
        messageDiv.classList.add('selected');
        if (checkbox) checkbox.checked = true;
    } else {
        selectedMessageIds.delete(msgId);
        messageDiv.classList.remove('selected');
        if (checkbox) checkbox.checked = false;
    }
    
    updateSelectionBarUI();
}

function updateSelectionBarUI() {
    document.getElementById('selected-count-text').textContent = `${selectedMessageIds.size} mesaj seçildi`;
}

// Pinned Message Banner Management
function updatePinnedMessagesBanner() {
    const banner = document.getElementById('pinned-messages-banner');
    const textEl = document.getElementById('pinned-message-text');
    
    const pinnedMsgs = activeRoomMessages.filter(m => !!m.pinned);
    
    if (pinnedMsgs.length > 0) {
        const latestPin = pinnedMsgs[pinnedMsgs.length - 1];
        textEl.textContent = `${latestPin.sender}: "${latestPin.text}"`;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

// -----------------------------------------
// Ses Odaları
// -----------------------------------------
voiceChannels.forEach(channel => {
    const header = channel.querySelector('.voice-channel-header');
    header.addEventListener('click', () => {
        const newRoom = channel.getAttribute('data-room');
        if (newRoom !== currentVoiceRoom) connectVoiceRoom(newRoom);
    });
});

async function connectVoiceRoom(room) {
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        monitorSpeech(localAudioStream, myPeerId);
        applyHardwareStates();
    } catch (e) {
        showCustomAlert("Bağlantı Hatası", "Mikrofon izni olmadan sesli kanalla bağlantı kurulamaz."); return;
    }

    disconnectVoiceRoom();
    currentVoiceRoom = room;
    document.querySelectorAll('.voice-channel').forEach(c => c.classList.remove('active'));
    const targetEl = document.querySelector(`.voice-channel[data-room="${room}"]`);
    if (targetEl) targetEl.classList.add('active');

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
        if (pId !== myPeerId) {
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
        if (ul) {
            for (let id in voiceRoomsData[r]) {
                const userDataObj = voiceRoomsData[r][id];

                const li = document.createElement('li');
                li.className = 'voice-user';

                const mainDiv = document.createElement('div');
                mainDiv.className = 'voice-user-info';

                const circle = document.createElement('div');
                circle.className = 'voice-avatar';
                circle.id = 'voice-user-avatar-' + id;
                if (userDataObj.avatar) {
                    circle.style.backgroundImage = `url(${userDataObj.avatar})`;
                    circle.style.backgroundSize = 'cover';
                }

                const nameSpan = document.createElement('span');
                // İsim hatası için garantili MyUsername ataması (undefined sorununu çözer)
                nameSpan.textContent = userDataObj.username || (id === myPeerId ? myUsername : "Kullanıcı");
                nameSpan.style.flexGrow = '1';
                nameSpan.style.fontWeight = '500';
                if (id === myPeerId) nameSpan.style.color = '#fff';

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

                if (amIAdmin && id !== myPeerId) {
                    const kickVoiceBtn = document.createElement('button');
                    kickVoiceBtn.className = 'kick-voice-btn';
                    kickVoiceBtn.title = "Sesten At";
                    kickVoiceBtn.innerHTML = `×`;
                    kickVoiceBtn.onclick = (e) => {
                        e.stopPropagation();
                        showCustomConfirm("Sesten At", `${userDataObj.username || "Kullanıcı"} adlı kişiyi sesten atmak istediğinize emin misiniz?`, true, () => {
                            socket.emit('kick-from-voice', id);
                        });
                    };
                    statesContainer.appendChild(kickVoiceBtn);
                }

                if (userDataObj.isSharingScreen) {
                    const liveBtn = document.createElement('button');
                    liveBtn.className = 'voice-live-badge';
                    liveBtn.innerHTML = 'YAYIN';
                    if (id !== myPeerId) {
                        liveBtn.onclick = (e) => {
                            e.stopPropagation();
                            watchScreenShare(id, userDataObj.username || "Kullanıcı");
                        };
                    } else {
                        liveBtn.style.cursor = 'default';
                    }
                    statesContainer.appendChild(liveBtn);
                }

                mainDiv.appendChild(circle); mainDiv.appendChild(nameSpan); mainDiv.appendChild(statesContainer);
                li.appendChild(mainDiv);

                if (id !== myPeerId && currentVoiceRoom === r) {
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
                        if (au) au.volume = e.target.value;
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
    if (!currentVoiceRoom) return;

    stopScreenSharing();
    screenShareStreams = {};

    for (let id in voiceCalls) voiceCalls[id].close();
    voiceCalls = {};
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(t => t.stop());
        localAudioStream = null;
        stopMonitor(myPeerId);
    }

    socket.emit('join-voice-room', null);
    document.querySelectorAll('.voice-channel').forEach(c => c.classList.remove('active'));
    voiceConnectionInfo.style.display = 'none';
    currentVoiceRoom = null;
    audioContainer.innerHTML = '';
}

function playRemoteAudio(stream, peerId) {
    let ad = document.getElementById('audio-' + peerId);
    if (!ad) {
        ad = document.createElement('audio');
        ad.id = 'audio-' + peerId; ad.autoplay = true;
        audioContainer.appendChild(ad);
    }
    ad.srcObject = stream;
    ad.muted = isDeafened;
}
function removeRemoteAudio(peerId) {
    const ad = document.getElementById('audio-' + peerId);
    if (ad) ad.remove();
}

// -----------------------------------------
// VAD (Voice Activity Detection)
// -----------------------------------------
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        checkSpeechLooped();
    }
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
}
function monitorSpeech(stream, peerId) {
    if (!stream) return;
    initAudioContext();
    try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser(); analyser.fftSize = 512;
        source.connect(analyser);
        analysers[peerId] = analyser;
    } catch (e) { }
}
function stopMonitor(peerId) {
    if (analysers[peerId]) { analysers[peerId].disconnect?.(); delete analysers[peerId]; }
}
function checkSpeechLooped() {
    requestAnimationFrame(checkSpeechLooped);
    if (!audioContext) return;
    for (let id in analysers) {
        const analyser = analysers[id];
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;

        if (id === myPeerId && isMicMuted) average = 0;

        const circle = document.getElementById('voice-user-avatar-' + id);
        const myAv = document.getElementById('my-avatar');

        if (id === myPeerId && myAv) {
            if (average > 10) myAv.classList.add('speaking');
            else myAv.classList.remove('speaking');
        }

        if (circle) {
            if (average > 10) circle.classList.add('speaking');
            else circle.classList.remove('speaking');
        }
    }
}

// -----------------------------------------
// VİDEO MODAL
// -----------------------------------------
function openVideoModal() { document.getElementById('video-modal').style.display = 'flex'; }
function endPrivateCall() {
    if (privateCall) { privateCall.close(); privateCall = null; }
    if (localVideoStream) { localVideoStream.getTracks().forEach(t => t.stop()); localVideoStream = null; }
    document.getElementById('video-grid').innerHTML = ''; document.getElementById('video-modal').style.display = 'none';
}
document.getElementById('hangup-btn').addEventListener('click', endPrivateCall);
function addVideoStream(stream, peerId, username) {
    if (document.getElementById(`wrapper-${peerId}`)) return;
    const cw = document.createElement('div'); cw.id = `wrapper-${peerId}`; cw.className = 'video-wrapper';
    const v = document.createElement('video'); v.srcObject = stream; v.autoplay = true; v.playsInline = true;
    if (peerId === 'local') { v.muted = true; v.style.transform = 'scaleX(-1)'; }
    const l = document.createElement('span'); l.className = 'video-label'; l.textContent = username;
    cw.appendChild(v); cw.appendChild(l); document.getElementById('video-grid').appendChild(cw);
}

// -----------------------------------------
// ADMİN VE DİNAMİK KANAL OYATICILARI
// -----------------------------------------
const textChannelsList = document.getElementById('text-channels-list');
const voiceChannelsList = document.getElementById('voice-channels-list');
const addTextBtn = document.getElementById('add-text-channel-btn');
const addVoiceBtn = document.getElementById('add-voice-channel-btn');

socket.on('admin-status', (isAdmin) => {
    amIAdmin = isAdmin;
    if (addTextBtn) addTextBtn.style.display = isAdmin ? 'block' : 'none';
    if (addVoiceBtn) addVoiceBtn.style.display = isAdmin ? 'block' : 'none';
});

socket.on('channels-list', ({ text, voice }) => {
    // Render text channels
    if (textChannelsList) {
        textChannelsList.innerHTML = '';
        text.forEach(ch => {
            const li = document.createElement('li');
            li.className = `channel text-channel ${ch === currentTextRoom ? 'active' : ''}`;
            li.setAttribute('data-room', ch);
            
            let deleteBtn = '';
            if (amIAdmin && ch !== 'genel') {
                deleteBtn = `<button class="delete-channel-btn" onclick="event.stopPropagation(); deleteChannel('${ch}', 'text')" title="Kanalı Sil">×</button>`;
            }
            
            li.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <div style="display:flex; align-items:center;">
                        <svg width="20" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;"><path d="M16 4h-2l-1 5h-5l1-5h-2l-1 5h-4v2h3.5l-1 5h-3.5v2h3.5l-1 5h2l1-5h5l-1 5h2l1-5h4v-2h-3.5l1-5h3.5v-2h-3.5l1-5zm-3 12h-5l1-5h5l-1 5z"/></svg>
                        <span>${ch}</span>
                    </div>
                    ${deleteBtn}
                </div>
            `;
            
            li.addEventListener('click', () => {
                if (ch !== currentTextRoom) {
                    document.querySelectorAll('.text-channel').forEach(c => c.classList.remove('active'));
                    li.classList.add('active');
                    currentTextRoom = ch;
                    document.getElementById('current-room-name').textContent = `# ${ch}`;
                    joinTextRoom(currentTextRoom);
                }
            });
            textChannelsList.appendChild(li);
        });
    }

    // Render voice channels
    if (voiceChannelsList) {
        voiceChannelsList.innerHTML = '';
        voice.forEach(ch => {
            const li = document.createElement('li');
            li.className = `channel voice-channel ${ch === currentVoiceRoom ? 'active' : ''}`;
            li.setAttribute('data-room', ch);
            
            let deleteBtn = '';
            if (amIAdmin) {
                deleteBtn = `<button class="delete-channel-btn" onclick="event.stopPropagation(); deleteChannel('${ch}', 'voice')" title="Kanalı Sil">×</button>`;
            }

            li.innerHTML = `
                 <div class="voice-channel-header" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                     <div style="display:flex; align-items:center;">
                         <svg width="20" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px; flex-shrink: 0;"><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>
                         <span>${ch}</span>
                     </div>
                     ${deleteBtn}
                 </div>
                 <ul class="voice-users" id="voice-users-${ch}"></ul>
            `;
            
            const header = li.querySelector('.voice-channel-header');
            header.addEventListener('click', () => {
                if (ch !== currentVoiceRoom) connectVoiceRoom(ch);
            });
            
            voiceChannelsList.appendChild(li);
        });
    }
    
    socket.emit('get-voice-state');
});

window.deleteChannel = function(name, type) {
    showCustomConfirm("Kanalı Sil", `"${name}" kanalını silmek istediğinize emin misiniz?`, true, () => {
        socket.emit('delete-channel', { name, type });
    });
};

window.deleteMessage = function(msgId) {
    showCustomConfirm("Mesajı Sil", "Bu mesajı silmek istediğinize emin misiniz?", true, () => {
        socket.emit('delete-message', msgId);
    });
};

if (addTextBtn) {
    addTextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showCustomPrompt("Yeni Metin Kanalı", "Kanal adını girin...", (name) => {
            if (name) {
                const formatted = name.trim().toLowerCase().replace(/\s+/g, '-');
                if (formatted) {
                    socket.emit('create-channel', { name: formatted, type: 'text' });
                }
            }
        });
    });
}

if (addVoiceBtn) {
    addVoiceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showCustomPrompt("Yeni Ses Kanalı", "Kanal adını girin...", (name) => {
            if (name) {
                const formatted = name.trim();
                if (formatted) {
                    socket.emit('create-channel', { name: formatted, type: 'voice' });
                }
            }
        });
    });
}

socket.on('message-deleted', (msgId) => {
    const msgEl = document.querySelector(`.message[data-id="${msgId}"]`);
    if (msgEl) {
        msgEl.remove();
    }
    activeRoomMessages = activeRoomMessages.filter(m => m.id !== msgId);
    updatePinnedMessagesBanner();
});

socket.on('kicked-from-voice', () => {
    showCustomAlert("Sesten Atıldınız", "Bir yönetici tarafından sesli kanaldan atıldınız.", () => {
        disconnectVoiceRoom();
    });
});

socket.on('kicked-from-server', () => {
    showCustomAlert("Sunucudan Atıldınız", "Yönetici tarafından sunucudan atıldınız!", () => {
        clearSession();
        location.reload();
    });
});

socket.on('message-pinned-status', (msgId, isPinned) => {
    const msg = activeRoomMessages.find(m => m.id === msgId);
    if (msg) {
        msg.pinned = isPinned;
    }
    const msgEl = document.querySelector(`.message[data-id="${msgId}"]`);
    if (msgEl) {
        msgEl.classList.toggle('pinned', isPinned);
    }
    updatePinnedMessagesBanner();
});

socket.on('messages-bulk-deleted', (msgIds) => {
    msgIds.forEach(id => {
        const msgEl = document.querySelector(`.message[data-id="${id}"]`);
        if (msgEl) msgEl.remove();
    });
    activeRoomMessages = activeRoomMessages.filter(m => !msgIds.includes(m.id));
    updatePinnedMessagesBanner();
    if (isSelectionMode) {
        cancelSelectionMode();
    }
});

// Selection Action Bar Event Listeners
document.getElementById('select-all-btn').addEventListener('click', () => {
    activeRoomMessages.forEach(msg => {
        if (msg.isSystem) return;
        selectedMessageIds.add(msg.id);
        const msgEl = document.querySelector(`.message[data-id="${msg.id}"]`);
        if (msgEl) {
            msgEl.classList.add('selected');
            const cb = msgEl.querySelector('.message-checkbox');
            if (cb) cb.checked = true;
        }
    });
    updateSelectionBarUI();
});

document.getElementById('bulk-delete-btn').addEventListener('click', () => {
    if (selectedMessageIds.size === 0) return;
    showCustomConfirm("Seçilenleri Sil", `Seçilen ${selectedMessageIds.size} mesajı silmek istediğinize emin misiniz?`, true, () => {
        const idsArray = Array.from(selectedMessageIds);
        socket.emit('bulk-delete-messages', idsArray);
    });
});

document.getElementById('cancel-selection-btn').addEventListener('click', () => {
    cancelSelectionMode();
});

// Pinned List Modal Event Listeners
document.getElementById('view-pins-btn').addEventListener('click', () => {
    const listEl = document.getElementById('pinned-messages-list');
    listEl.innerHTML = '';
    
    const pinnedMsgs = activeRoomMessages.filter(m => !!m.pinned);
    
    if (pinnedMsgs.length === 0) {
        listEl.innerHTML = '<div style="color: #949ba4; text-align: center; padding: 20px;">Sabitlenmiş mesaj bulunmuyor.</div>';
    } else {
        pinnedMsgs.forEach(msg => {
            const div = document.createElement('div');
            div.style.backgroundColor = '#2b2d31';
            div.style.padding = '10px 14px';
            div.style.borderRadius = '4px';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.border = '1px solid rgba(255, 255, 255, 0.05)';
            
            const infoDiv = document.createElement('div');
            infoDiv.innerHTML = `<strong style="color:#fff;">${msg.sender}:</strong> <span style="color:#dbdee1;">${msg.text}</span>`;
            div.appendChild(infoDiv);
            
            const unpinBtn = document.createElement('button');
            unpinBtn.style.background = 'transparent';
            unpinBtn.style.border = 'none';
            unpinBtn.style.color = '#ed4245';
            unpinBtn.style.cursor = 'pointer';
            unpinBtn.style.fontWeight = 'bold';
            unpinBtn.textContent = 'İğneyi Kaldır';
            unpinBtn.onclick = () => {
                socket.emit('pin-message', msg.id);
                div.remove();
                if (listEl.children.length === 0) {
                    listEl.innerHTML = '<div style="color: #949ba4; text-align: center; padding: 20px;">Sabitlenmiş mesaj bulunmuyor.</div>';
                }
            };
            div.appendChild(unpinBtn);
            listEl.appendChild(div);
        });
    }
    
    document.getElementById('pinned-messages-modal').style.display = 'flex';
});

document.getElementById('close-pins-modal-btn').addEventListener('click', () => {
    document.getElementById('pinned-messages-modal').style.display = 'none';
});

socket.on('screen-share-requested', ({ requesterPeerId }) => {
    if (localScreenStream) {
        const call = peer.call(requesterPeerId, localScreenStream, { metadata: { type: 'screen-share' } });
        screenShareCalls[requesterPeerId] = call;
    }
});

// Screen Share Helper Functions
function stopScreenSharing() {
    if (localScreenStream) {
        localScreenStream.getTracks().forEach(t => t.stop());
        localScreenStream = null;
    }
    for (let pId in screenShareCalls) {
        screenShareCalls[pId].close();
    }
    screenShareCalls = {};
    socket.emit('stop-screen-share');
    const bBtn = document.getElementById('bottom-share-screen');
    if (bBtn) bBtn.classList.remove('strikethrough-icon');
}

function watchScreenShare(peerId, username) {
    const modal = document.getElementById('screen-watch-modal');
    const video = document.getElementById('screen-watch-video');
    const title = document.getElementById('screen-watch-title').querySelector('span');
    
    title.textContent = `📺 ${username} adlı kişinin yayını izleniyor`;
    modal.dataset.watchingPeerId = peerId;
    
    if (screenShareStreams[peerId]) {
        video.srcObject = screenShareStreams[peerId];
        modal.style.display = 'flex';
    } else {
        socket.emit('request-screen-share-stream', { targetPeerId: peerId, requesterPeerId: myPeerId });
        showCustomAlert("Bağlantı Kuruluyor", "Yayın akışı talep edildi, bağlanıyor...", () => {
            setTimeout(() => {
                if (screenShareStreams[peerId]) {
                    video.srcObject = screenShareStreams[peerId];
                    modal.style.display = 'flex';
                } else {
                    showCustomAlert("Hata", "Yayın akışı alınamadı. Yayıncı yayını kapatmış olabilir.");
                }
            }, 1500);
        });
    }
}

function closeScreenWatchModal() {
    const modal = document.getElementById('screen-watch-modal');
    const video = document.getElementById('screen-watch-video');
    video.srcObject = null;
    modal.style.display = 'none';
    delete modal.dataset.watchingPeerId;
}

// Bind close button
const screenWatchCloseBtn = document.getElementById('screen-watch-close-btn');
if (screenWatchCloseBtn) {
    screenWatchCloseBtn.addEventListener('click', closeScreenWatchModal);
}

// Bind start/cancel settings buttons
const bottomShareScreenBtn = document.getElementById('bottom-share-screen');
const screenShareSettingsModal = document.getElementById('screen-share-settings-modal');
const screenShareCancelBtn = document.getElementById('screen-share-cancel-btn');
const screenShareStartBtn = document.getElementById('screen-share-start-btn');

if (bottomShareScreenBtn) {
    bottomShareScreenBtn.addEventListener('click', () => {
        if (!currentVoiceRoom) {
            showCustomAlert("Hata", "Ekran paylaşımı başlatmak için bir sesli kanala katılmalısınız.");
            return;
        }
        if (localScreenStream) {
            stopScreenSharing();
        } else {
            screenShareSettingsModal.style.display = 'flex';
        }
    });
}

if (screenShareCancelBtn) {
    screenShareCancelBtn.addEventListener('click', () => {
        screenShareSettingsModal.style.display = 'none';
    });
}

if (screenShareStartBtn) {
    screenShareStartBtn.addEventListener('click', async () => {
        screenShareSettingsModal.style.display = 'none';
        
        const resolution = document.getElementById('share-resolution').value;
        const fps = document.getElementById('share-fps').value;
        
        let width, height;
        if (resolution === "360") { width = 640; height = 360; }
        else if (resolution === "720") { width = 1280; height = 720; }
        else { width = 1920; height = 1080; }
        
        const constraints = {
            video: {
                width: { max: width },
                height: { max: height },
                frameRate: { max: parseInt(fps) }
            },
            audio: true
        };
        
        try {
            localScreenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
            if (bottomShareScreenBtn) bottomShareScreenBtn.classList.add('strikethrough-icon');
            socket.emit('start-screen-share');
            
            for (let peerId in voiceCalls) {
                const call = peer.call(peerId, localScreenStream, { metadata: { type: 'screen-share' } });
                screenShareCalls[peerId] = call;
            }
            
            localScreenStream.getVideoTracks()[0].onended = () => {
                stopScreenSharing();
            };
        } catch (err) {
            showCustomAlert("Hata", "Ekran paylaşımı başlatılamadı.");
        }
    });
}
