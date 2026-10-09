const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

// Env variables parser (Zero-dependencies env loader)
if (fs.existsSync('.env')) {
   try {
      const envContent = fs.readFileSync('.env', 'utf8');
      envContent.split(/\r?\n/).forEach(line => {
         const trimmed = line.trim();
         if (trimmed && !trimmed.startsWith('#')) {
            const index = trimmed.indexOf('=');
            if (index > 0) {
               const key = trimmed.substring(0, index).trim();
               const value = trimmed.substring(index + 1).trim();
               // Remove surrounding quotes if any
               const cleanValue = value.replace(/^['"]|['"]$/g, '');
               // Render panelindeki değerler .env dosyasından önceliklidir.
               // Böylece deploy veya yeniden başlatma oturum imza anahtarını değiştirmez.
               if (!process.env[key]) process.env[key] = cleanValue;
            }
         }
      });
      console.log('[ENV] .env dosyası başarıyla yüklendi.');
   } catch (err) {
      console.error('[ENV] .env dosyası okunurken hata oluştu:', err);
   }
}

// CORS (Güvenlik) İzinleri eklendi
const io = new Server(server, {
   cors: {
      origin: "*",
      methods: ["GET", "POST"]
   },
   maxHttpBufferSize: 1e7 // 10 MB (Görsel ve büyük mesajlar için)
});

const { ExpressPeerServer } = require('peer');

// PeerJS için ayarlar (uzun süre bağlı kalmayı destekleyen heartbeat ve güvenli CORS)
const peerServer = ExpressPeerServer(server, {
   debug: false,
   path: '/',
   alive_timeout: 60000,
   corsOptions: { origin: '*' }
});

peerServer.on('error', (err) => {
   console.warn('[PeerServer Hatası]:', err ? err.message : err);
});

app.use('/peerjs', peerServer);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

const userSockets = {}; // userId -> socketId

function sendFriendUpdate(targetUserId) {
   const socketId = userSockets[targetUserId];
   if (socketId) {
      io.to(socketId).emit('friend-update');
   }
}

const crypto = require('crypto');

// USERS FILE DATABASE
const USERS_FILE = path.join(__dirname, 'users.json');
let usersDb = {};
try {
   if (fs.existsSync(USERS_FILE)) {
      usersDb = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
   } else {
      fs.writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Kullanıcılar yüklenirken hata oluştu:", err);
}

function saveUsers() {
   try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2), 'utf8');
   } catch (err) {
      console.error("Kullanıcılar kaydedilirken hata oluştu:", err);
   }
}

// CRYPTO HELPERS FOR PASSWORDS
function hashPassword(password) {
   const salt = crypto.randomBytes(16).toString('hex');
   const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
   return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
   if (!storedPassword || !storedPassword.includes(':')) return false;
   const [salt, hash] = storedPassword.split(':');
   const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
   return hash === verifyHash;
}

// PURE NODE.JS JWT SYSTEM (ZERO DEPENDENCIES)
const JWT_SECRET = process.env.JWT_SECRET || 'lonca_super_secret_fallback_key_123';
const SESSION_COOKIE_NAME = 'lonca_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 gün

function generateToken(payload) {
   const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
   const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
   const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
   return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
   try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [header, body, signature] = parts;
      const validSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
      if (signature !== validSignature) return null;
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
   } catch (e) {
      return null;
   }
}

function getRequestToken(req) {
   const authHeader = req.headers.authorization;
   if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length);
      if (token && token !== 'null' && token !== 'undefined') return token;
   }

   const cookies = req.headers.cookie || '';
   const cookie = cookies.split(';').map(value => value.trim())
      .find(value => value.startsWith(`${SESSION_COOKIE_NAME}=`));
   return cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE_NAME.length + 1)) : null;
}

function setSessionCookie(res, token) {
   const parts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      'HttpOnly',
      'SameSite=Lax'
   ];

   // Render HTTPS üzerinde çalışır. Yerelde HTTP ile geliştirmeye devam edebilmek için
   // Secure niteliği yalnızca production ortamında eklenir.
   if (process.env.NODE_ENV === 'production' || process.env.RENDER_EXTERNAL_URL) parts.push('Secure');
   res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
   const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
   if (process.env.NODE_ENV === 'production' || process.env.RENDER_EXTERNAL_URL) parts.push('Secure');
   res.setHeader('Set-Cookie', parts.join('; '));
}

function decodeJwt(token) {
   try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
      return JSON.parse(payloadJson);
   } catch (e) {
      return null;
   }
}

// CONFIG ENDPOINT
app.get('/api/config', (req, res) => {
   res.json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || "" // Boş bırakıldığında otomatik simüle Google butonuna döner. Gerçek OAuth için Google Client ID girilmelidir.
   });
});

// DB STATUS ENDPOINT
app.get('/api/db-status', async (req, res) => {
   let mongoCount = 0;
   if (isMongoConnected && MessageModel) {
      try {
         mongoCount = await MessageModel.countDocuments();
      } catch (e) {}
   }
   res.json({
      mongoConnected: isMongoConnected,
      mongoUriSet: !!(process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGO_URI || process.env.MONGODB_URL),
      totalMongoMessages: mongoCount
   });
});

// AUTH MIDDLEWARE
function authenticateToken(req, res, next) {
   const token = getRequestToken(req);
   if (!token) return res.status(401).json({ error: 'Token bulunamadı.' });

   const payload = verifyToken(token);
   if (!payload) return res.status(403).json({ error: 'Geçersiz veya süresi dolmuş token.' });

   req.user = payload;
   next();
}

// GET CURRENT USER (/api/auth/me)
app.get('/api/auth/me', (req, res) => {
   const token = getRequestToken(req);
   if (!token) return res.status(401).json({ error: 'Token bulunamadı.' });

   const payload = verifyToken(token);
   if (!payload) return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });

   const user = usersDb[payload.userId];
   if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

   if (user.email === 'berzanu10@gmail.com' && !user.isAdmin) {
      user.isAdmin = true;
      saveUsers();
   }

   // Kullanıcı uygulamayı kullandıkça oturum süresini uzat.
   setSessionCookie(res, token);

   res.json({
      success: true,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         bio: user.bio || '',
         isAdmin: user.isAdmin
      }
   });
});

// REGISTER ENDPOINT
app.post('/api/auth/register', (req, res) => {
   const { username, email, password } = req.body;
   if (!username || !email || !password) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
   }

   const normalizedEmail = email.toLowerCase().trim();
   
   // Check if user exists
   const existingUser = Object.values(usersDb).find(u => u.email === normalizedEmail);
   if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta adresiyle zaten kayıtlı bir kullanıcı var.' });
   }

   const userId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
   
   usersDb[userId] = {
      id: userId,
      username: username.trim(),
      email: normalizedEmail,
      password: hashPassword(password),
      avatar: '',
      isAdmin: (normalizedEmail === 'berzanu10@gmail.com')
   };

   saveUsers();

   if (serversDb['server_default'] && !serversDb['server_default'].members.includes(userId)) {
      serversDb['server_default'].members.push(userId);
      saveServers();
   }

   const token = generateToken({ userId: userId });
   setSessionCookie(res, token);
   res.json({
      success: true,
      token,
      user: {
         id: userId,
         username: usersDb[userId].username,
         email: normalizedEmail,
         avatar: '',
         isAdmin: false
      }
   });
});

// LOGIN ENDPOINT
app.post('/api/auth/login', (req, res) => {
   const { email, password } = req.body;
   if (!email || !password) {
      return res.status(400).json({ error: 'Lütfen e-posta ve şifrenizi girin.' });
   }

   const normalizedEmail = email.toLowerCase().trim();
   const user = Object.values(usersDb).find(u => u.email === normalizedEmail);

   if (!user) {
      return res.status(400).json({ error: 'Böyle bir kayıt bulunamadı.' });
   }

   if (!user.password || !verifyPassword(password, user.password)) {
      return res.status(400).json({ error: 'E-posta veya şifre hatalı.' });
   }

   if (normalizedEmail === 'berzanu10@gmail.com' && !user.isAdmin) {
      user.isAdmin = true;
      saveUsers();
   }

   const token = generateToken({ userId: user.id });
   setSessionCookie(res, token);
   res.json({
      success: true,
      token,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         isAdmin: user.isAdmin
      }
   });
});

// GOOGLE SIGN IN
app.post('/api/auth/google', (req, res) => {
   const { credential, mock, email, name, picture } = req.body;
   let googleEmail, googleName, googlePicture, googleSub;

   if (mock) {
      if (!email) return res.status(400).json({ error: 'Mock e-posta adresi eksik.' });
      googleEmail = email.toLowerCase().trim();
      googleName = name || googleEmail.split('@')[0];
      googlePicture = picture || '';
      googleSub = 'mock_google_' + googleEmail;
   } else {
      if (!credential) return res.status(400).json({ error: 'Google kimlik verisi eksik.' });
      const decoded = decodeJwt(credential);
      if (!decoded || (decoded.iss !== 'accounts.google.com' && decoded.iss !== 'https://accounts.google.com')) {
         return res.status(400).json({ error: 'Geçersiz Google kimlik doğrulaması.' });
      }
      googleEmail = decoded.email.toLowerCase().trim();
      googleName = decoded.name;
      googlePicture = decoded.picture || '';
      googleSub = decoded.sub;
   }

   // Find or create user
   let user = Object.values(usersDb).find(u => u.email === googleEmail || u.googleId === googleSub);
   let isNewUser = false;

   if (!user) {
      isNewUser = true;
      const userId = 'user_g_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
      usersDb[userId] = {
         id: userId,
         username: googleName,
         email: googleEmail,
         googleId: googleSub,
         avatar: googlePicture,
         isAdmin: (googleEmail === 'berzanu10@gmail.com')
      };
      user = usersDb[userId];
      saveUsers();

      if (serversDb['server_default'] && !serversDb['server_default'].members.includes(userId)) {
         serversDb['server_default'].members.push(userId);
         saveServers();
      }
   } else {
      // Update avatar if we got it from google and didn't have one before
      let changed = false;
      if (googleEmail === 'berzanu10@gmail.com' && !user.isAdmin) {
         user.isAdmin = true;
         changed = true;
      }
      if (googlePicture && !user.avatar) {
         user.avatar = googlePicture;
         changed = true;
      }
      if (googleSub && !user.googleId) {
         user.googleId = googleSub;
         changed = true;
      }
      if (changed) saveUsers();
   }

   const token = generateToken({ userId: user.id });
   setSessionCookie(res, token);
   res.json({
      success: true,
      token,
      isNewUser,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         isAdmin: user.isAdmin
      }
   });
});

app.post('/api/auth/logout', (req, res) => {
   clearSessionCookie(res);
   res.json({ success: true });
});

const passwordResetCodes = new Map(); // email -> code
const nodemailer = require('nodemailer');

// Nodemailer Transporter Setup
let transporter;
const smtpHost = process.env.SMTP_HOST || 'smtp.ethereal.email';
const smtpPort = process.env.SMTP_PORT || 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

if (smtpUser && smtpPass) {
   transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort == 465,
      auth: {
         user: smtpUser,
         pass: smtpPass
      }
   });
} else {
   // Fallback to Ethereal fake SMTP for local testing
   nodemailer.createTestAccount((err, account) => {
      if (err) {
         console.error('Ethereal SMTP test hesabı oluşturulamadı:', err);
         return;
      }
      console.log(`[SMTP] Ethereal test hesabı oluşturuldu. User: ${account.user}`);
      transporter = nodemailer.createTransport({
         host: 'smtp.ethereal.email',
         port: 587,
         secure: false,
         auth: {
            user: account.user,
            pass: account.pass
         }
      });
   });
}

// FORGOT PASSWORD ENDPOINT
app.post('/api/auth/forgot-password', (req, res) => {
   const { email } = req.body;
   if (!email) {
      return res.status(400).json({ error: 'Lütfen e-posta adresinizi girin.' });
   }

   const normalizedEmail = email.toLowerCase().trim();
   const user = Object.values(usersDb).find(u => u.email === normalizedEmail);

   if (!user) {
      return res.status(400).json({ error: 'Bu e-posta adresiyle kayıtlı bir kullanıcı bulunamadı.' });
   }

   if (user.googleId && !user.password) {
      return res.status(400).json({ error: 'Bu hesap Google ile oluşturulmuş. Lütfen Google ile Giriş yapın.' });
   }

   const code = Math.floor(100000 + Math.random() * 900000).toString();
   passwordResetCodes.set(normalizedEmail, code);

   console.log(`[ŞİFRE SIFIRLAMA] Kullanıcı: ${normalizedEmail}, Kod: ${code}`);

   // Send real e-mail using Nodemailer
   if (transporter) {
      const mailOptions = {
         from: '"Lonca" <noreply@lonca.com>',
         to: normalizedEmail,
         subject: 'Lonca Şifre Sıfırlama Kodu',
         text: `Lonca şifrenizi sıfırlamak için doğrulama kodunuz: ${code}`,
         html: `
            <div style="font-family: 'Segoe UI', sans-serif; background-color: #1e1f22; color: #dbdee1; padding: 30px; border-radius: 8px; max-width: 500px; margin: auto; border: 1px solid rgba(255,255,255,0.05);">
               <h2 style="color: #5865F2; margin-top: 0;">Lonca Şifre Sıfırlama</h2>
               <p style="font-size: 1rem; line-height: 1.5;">Şifrenizi sıfırlamak için doğrulama kodunuz aşağıdadır. Lütfen bu kodu uygulamadaki alana girin:</p>
               <div style="background-color: #2b2d31; padding: 15px; border-radius: 4px; text-align: center; margin: 25px 0;">
                  <span style="font-size: 2rem; font-weight: bold; letter-spacing: 4px; color: #fff;">${code}</span>
               </div>
               <p style="font-size: 0.85rem; color: #949ba4;">Bu talebi siz yapmadıysanız lütfen bu e-postayı dikkate almayın.</p>
            </div>
         `
      };
      
      transporter.sendMail(mailOptions, (error, info) => {
         if (error) {
            console.error('[SMTP] E-posta gönderilirken hata oluştu:', error);
         } else {
            console.log('[SMTP] E-posta başarıyla gönderildi: %s', info.messageId);
            const testUrl = nodemailer.getTestMessageUrl(info);
            if (testUrl) {
               console.log(`[SMTP Test] Gönderilen test e-postasını buradan okuyabilirsiniz:\n--> ${testUrl} <--`);
            }
         }
      });
   } else {
      console.log(`[SMTP] E-posta gönderilemedi çünkü SMTP taşıyıcısı henüz hazır değil. Kod: ${code}`);
   }

   res.json({
      success: true,
      message: `Şifre sıfırlama kodu e-postanıza gönderildi.`
   });
});

// RESET PASSWORD ENDPOINT
app.post('/api/auth/reset-password', (req, res) => {
   const { email, code, newPassword } = req.body;
   if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
   }

   const normalizedEmail = email.toLowerCase().trim();
   const user = Object.values(usersDb).find(u => u.email === normalizedEmail);

   if (!user) {
      return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
   }

   const storedCode = passwordResetCodes.get(normalizedEmail);
   if (!storedCode || storedCode !== code.trim()) {
      return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş sıfırlama kodu.' });
   }

   if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });
   }

   user.password = hashPassword(newPassword);
   passwordResetCodes.delete(normalizedEmail);
   saveUsers();

   res.json({
      success: true,
      message: 'Şifreniz başarıyla sıfırlandı. Yeni şifrenizle giriş yapabilirsiniz.'
   });
});

// PROFILE UPDATE ENDPOINT
app.post('/api/users/profile', authenticateToken, (req, res) => {
   const { username, avatar, oldPassword, newPassword, bio } = req.body;
   const userId = req.user.userId;

   const user = usersDb[userId];
   if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

   if (oldPassword && newPassword) {
      if (user.googleId && !user.password) {
         return res.status(400).json({ error: 'Bu hesap Google ile oluşturulmuş, şifre değiştirilemez.' });
      }
      if (!verifyPassword(oldPassword, user.password)) {
         return res.status(400).json({ error: 'Mevcut şifre hatalı.' });
      }
      if (newPassword.length < 6) {
         return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });
      }
      user.password = hashPassword(newPassword);
   } else if (newPassword && !oldPassword) {
      return res.status(400).json({ error: 'Şifrenizi değiştirmek için mevcut şifrenizi girmelisiniz.' });
   }

   if (username && username.trim()) {
      user.username = username.trim();
   }

   if (avatar !== undefined) {
      user.avatar = avatar;
   }

   if (bio !== undefined) {
      user.bio = bio;
   }

   saveUsers();

   rememberEntrant(userId, {
      username: user.username,
      avatar: user.avatar || '',
      isAdmin: !!user.isAdmin,
      isOnline: !!(allTimeUsers[userId] && allTimeUsers[userId].isOnline),
      peerId: allTimeUsers[userId] ? allTimeUsers[userId].peerId : null
   }, seenUsers[userId] && seenUsers[userId].servers && seenUsers[userId].servers.length
      ? seenUsers[userId].servers
      : ['server_default']);
   io.emit('global-users', allTimeUsers);

   res.json({
      success: true,
      user: {
         id: user.id,
         username: user.username,
         email: user.email,
         avatar: user.avatar || '',
         bio: user.bio || '',
         isAdmin: user.isAdmin
      }
   });
});

// GET USER BY ID
app.get('/api/users/:userId', authenticateToken, (req, res) => {
   const { userId } = req.params;
   const user = usersDb[userId] || seenUsers[userId];
   if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
   res.json({
      success: true,
      user: {
         id: user.id || user.userId,
         username: user.username,
         avatar: rosterAvatar(userId, user.avatar || ''),
         bio: user.bio || ''
      }
   });
});

// SERVERS & FRIENDS DATABASE LOADERS
const SERVERS_FILE = path.join(__dirname, 'servers.json');
let serversDb = {};
try {
   if (fs.existsSync(SERVERS_FILE)) {
      serversDb = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
   } else {
      fs.writeFileSync(SERVERS_FILE, JSON.stringify(serversDb, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Sunucular yüklenirken hata oluştu:", err);
}

function saveServers() {
   try {
      fs.writeFileSync(SERVERS_FILE, JSON.stringify(serversDb, null, 2), 'utf8');
   } catch (err) {
      console.error("Sunucular kaydedilirken hata oluştu:", err);
   }
}

const FRIENDS_FILE = path.join(__dirname, 'friends.json');
let friendsDb = {};
try {
   if (fs.existsSync(FRIENDS_FILE)) {
      friendsDb = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8'));
   } else {
      fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friendsDb, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Arkadaşlar yüklenirken hata oluştu:", err);
}

function saveFriends() {
   try {
      fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friendsDb, null, 2), 'utf8');
   } catch (err) {
      console.error("Arkadaşlar kaydedilirken hata oluştu:", err);
   }
}

function getOrCreateUserFriends(userId) {
   if (!friendsDb[userId]) {
      friendsDb[userId] = {
         friends: [],
         pending_incoming: [],
         pending_outgoing: [],
         dms: []
      };
      saveFriends();
   }
   return friendsDb[userId];
}

// MULTI-SERVER API ENDPOINTS
app.get('/api/servers', authenticateToken, (req, res) => {
   const userId = req.user.userId;
   const userServers = Object.values(serversDb).filter(s => s.members && s.members.includes(userId));
   res.json({ success: true, servers: userServers });
});

app.post('/api/servers/create', authenticateToken, (req, res) => {
   const { name } = req.body;
   const userId = req.user.userId;
   if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Sunucu adı boş olamaz.' });
   }

   const serverId = 'server_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
   const inviteCode = Math.random().toString(36).substr(2, 6).toUpperCase();

   serversDb[serverId] = {
      id: serverId,
      name: name.trim(),
      ownerId: userId,
      inviteCode: inviteCode,
      members: [userId],
      channels: {
         text: ["genel"],
         voice: ["sohbet"]
      }
   };

   saveServers();
   res.json({ success: true, server: serversDb[serverId] });
});

app.post('/api/servers/join', authenticateToken, (req, res) => {
   const { inviteCode } = req.body;
   const userId = req.user.userId;
   if (!inviteCode || !inviteCode.trim()) {
      return res.status(400).json({ error: 'Davet kodu boş olamaz.' });
   }

   const normalizedCode = inviteCode.trim().toUpperCase();
   const server = Object.values(serversDb).find(s => s.inviteCode === normalizedCode);

   if (!server) {
      return res.status(404).json({ error: 'Geçersiz davet kodu.' });
   }

   if (!server.members) server.members = [];
   if (server.members.includes(userId)) {
      return res.status(400).json({ error: 'Bu sunucuya zaten katılmışsınız.' });
   }

   server.members.push(userId);
   saveServers();

   const joinedUser = usersDb[userId];
   if (joinedUser) {
      rememberEntrant(userId, {
         username: joinedUser.username,
         avatar: joinedUser.avatar || '',
         isAdmin: !!joinedUser.isAdmin,
         isOnline: !!(allTimeUsers[userId] && allTimeUsers[userId].isOnline),
         peerId: allTimeUsers[userId] ? allTimeUsers[userId].peerId : null
      }, [server.id]);
      io.emit('global-users', allTimeUsers);
   }
   io.emit('server-update', server.id, server);

   res.json({ success: true, server });
});

app.post('/api/servers/:serverId/update', authenticateToken, (req, res) => {
   const { serverId } = req.params;
   const { name } = req.body;
   const userId = req.user.userId;

   const server = serversDb[serverId];
   if (!server) return res.status(404).json({ error: 'Sunucu bulunamadı.' });

   if (server.ownerId !== userId && !usersDb[userId].isAdmin) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
   }

   if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Sunucu adı boş olamaz.' });
   }

   server.name = name.trim();
   saveServers();

   // Broadcast update to all members
   io.emit('server-update', serverId, server);

   res.json({ success: true, server });
});

app.post('/api/servers/:serverId/leave', authenticateToken, (req, res) => {
   const { serverId } = req.params;
   const userId = req.user.userId;

   const server = serversDb[serverId];
   if (!server) return res.status(404).json({ error: 'Sunucu bulunamadı.' });

   if (server.ownerId === userId) {
      return res.status(400).json({ error: 'Sunucu sahibi sunucudan ayrılamaz. Sunucuyu silmelisiniz.' });
   }

   if (serverId === 'server_default') {
      return res.status(400).json({ error: 'Varsayılan sunucudan ayrılamazsınız.' });
   }

   server.members = server.members.filter(m => m !== userId);
   saveServers();

   if (seenUsers[userId]) {
      seenUsers[userId].servers = (seenUsers[userId].servers || []).filter(id => id !== serverId);
      seenUsers[userId].lastSeen = Date.now();
      saveSeenUsersLocally();
      persistSeenUserMongo(seenUsers[userId]);
   }

   // Broadcast update to remaining members
   io.emit('server-update', serverId, server);

   res.json({ success: true });
});

app.delete('/api/servers/:serverId', authenticateToken, (req, res) => {
   const { serverId } = req.params;
   const userId = req.user.userId;

   const server = serversDb[serverId];
   if (!server) return res.status(404).json({ error: 'Sunucu bulunamadı.' });

   if (server.ownerId !== userId && !usersDb[userId].isAdmin) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
   }

   if (serverId === 'server_default') {
      return res.status(400).json({ error: 'Varsayılan sunucuyu silemezsiniz.' });
   }

   delete serversDb[serverId];
   saveServers();

   // Broadcast deletion
   io.emit('server-deleted', serverId);

   res.json({ success: true });
});

// FRIENDS & DMS API ENDPOINTS
app.get('/api/friends', authenticateToken, (req, res) => {
   const userId = req.user.userId;
   const fData = getOrCreateUserFriends(userId);
   
   // Fetch details of friends and pending requests to render them nicely
   const details = {
      friends: fData.friends.map(id => ({ id, username: usersDb[id]?.username || 'Kullanıcı', avatar: usersDb[id]?.avatar || '', email: usersDb[id]?.email || '' })),
      pending_incoming: fData.pending_incoming.map(id => ({ id, username: usersDb[id]?.username || 'Kullanıcı', avatar: usersDb[id]?.avatar || '', email: usersDb[id]?.email || '' })),
      pending_outgoing: fData.pending_outgoing.map(id => ({ id, username: usersDb[id]?.username || 'Kullanıcı', avatar: usersDb[id]?.avatar || '', email: usersDb[id]?.email || '' })),
      dms: fData.dms.map(id => ({ id, username: usersDb[id]?.username || 'Kullanıcı', avatar: usersDb[id]?.avatar || '', email: usersDb[id]?.email || '' }))
   };
   
   res.json({ success: true, friendsData: details });
});

app.post('/api/friends/request', authenticateToken, (req, res) => {
   const { target } = req.body;
   const userId = req.user.userId;
   if (!target || !target.trim()) {
      return res.status(400).json({ error: 'Lütfen kullanıcı adı veya e-posta girin.' });
   }

   const normalizedTarget = target.trim().toLowerCase();
   const targetUser = Object.values(usersDb).find(u => 
      u.email.toLowerCase() === normalizedTarget || 
      u.username.toLowerCase() === normalizedTarget
   );

   if (!targetUser) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
   }

   if (targetUser.id === userId) {
      return res.status(400).json({ error: 'Kendinize arkadaşlık isteği gönderemezsiniz.' });
   }

   const myFriends = getOrCreateUserFriends(userId);
   const targetFriends = getOrCreateUserFriends(targetUser.id);

   if (myFriends.friends.includes(targetUser.id)) {
      return res.status(400).json({ error: 'Bu kullanıcıyla zaten arkadaşsınız.' });
   }

   if (myFriends.pending_outgoing.includes(targetUser.id) || myFriends.pending_incoming.includes(targetUser.id)) {
      return res.status(400).json({ error: 'Zaten bekleyen bir arkadaşlık isteği var.' });
   }

   myFriends.pending_outgoing.push(targetUser.id);
   targetFriends.pending_incoming.push(userId);

   saveFriends();
   sendFriendUpdate(targetUser.id);
   sendFriendUpdate(userId);
   res.json({ success: true, message: 'Arkadaşlık isteği gönderildi.' });
});

app.post('/api/friends/accept', authenticateToken, (req, res) => {
   const { friendId } = req.body;
   const userId = req.user.userId;

   const myFriends = getOrCreateUserFriends(userId);
   const targetFriends = getOrCreateUserFriends(friendId);

   if (!myFriends.pending_incoming.includes(friendId)) {
      return res.status(400).json({ error: 'Böyle bir arkadaşlık isteği bulunamadı.' });
   }

   myFriends.pending_incoming = myFriends.pending_incoming.filter(id => id !== friendId);
   targetFriends.pending_outgoing = targetFriends.pending_outgoing.filter(id => id !== userId);

   if (!myFriends.friends.includes(friendId)) myFriends.friends.push(friendId);
   if (!targetFriends.friends.includes(userId)) targetFriends.friends.push(userId);

   saveFriends();
   sendFriendUpdate(friendId);
   sendFriendUpdate(userId);
   res.json({ success: true });
});

app.post('/api/friends/reject', authenticateToken, (req, res) => {
   const { friendId } = req.body;
   const userId = req.user.userId;

   const myFriends = getOrCreateUserFriends(userId);
   const targetFriends = getOrCreateUserFriends(friendId);

   myFriends.pending_incoming = myFriends.pending_incoming.filter(id => id !== friendId);
   myFriends.pending_outgoing = myFriends.pending_outgoing.filter(id => id !== friendId);
   myFriends.friends = myFriends.friends.filter(id => id !== friendId);

   targetFriends.pending_incoming = targetFriends.pending_incoming.filter(id => id !== userId);
   targetFriends.pending_outgoing = targetFriends.pending_outgoing.filter(id => id !== userId);
   targetFriends.friends = targetFriends.friends.filter(id => id !== userId);

   saveFriends();
   sendFriendUpdate(friendId);
   sendFriendUpdate(userId);
   res.json({ success: true });
});

app.post('/api/friends/dm', authenticateToken, (req, res) => {
   const { friendId } = req.body;
   const userId = req.user.userId;

   if (!usersDb[friendId]) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
   }

   const myFriends = getOrCreateUserFriends(userId);
   if (!myFriends.dms) myFriends.dms = [];
   if (!myFriends.dms.includes(friendId)) {
      myFriends.dms.push(friendId);
      saveFriends();
   }

   const targetFriends = getOrCreateUserFriends(friendId);
   if (!targetFriends.dms) targetFriends.dms = [];
   if (!targetFriends.dms.includes(userId)) {
      targetFriends.dms.push(userId);
      saveFriends();
   }

   sendFriendUpdate(friendId);
   sendFriendUpdate(userId);
   res.json({ success: true });
});


const CHANNELS_FILE = path.join(__dirname, 'channels.json');
let textRooms = { 'genel': {}, 'oyun': {}, 'muzik': {} };
// Ses odalarında artık { username, mic: true|false, deaf: true|false } objesi saklanıyor
let voiceRooms = { 'sohbet': {}, 'oyun': {}, 'sessiz': {} };

try {
   if (fs.existsSync(CHANNELS_FILE)) {
      const fileContent = fs.readFileSync(CHANNELS_FILE, 'utf8');
      const data = JSON.parse(fileContent);
      textRooms = {};
      data.text.forEach(ch => { textRooms[ch] = {}; });
      
      voiceRooms = {};
      data.voice.forEach(ch => { voiceRooms[ch] = {}; });
   } else {
      fs.writeFileSync(CHANNELS_FILE, JSON.stringify({ text: Object.keys(textRooms), voice: Object.keys(voiceRooms) }, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Kanallar yüklenirken hata oluştu:", err);
}

function saveChannels() {
   try {
      fs.writeFileSync(CHANNELS_FILE, JSON.stringify({ text: Object.keys(textRooms), voice: Object.keys(voiceRooms) }, null, 2), 'utf8');
   } catch (err) {
      console.error("Kanallar kaydedilirken hata oluştu:", err);
   }
}

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
let messageHistory = {};
for (let r in textRooms) {
   messageHistory[r] = [];
}

// -------------------------------------------------------------
// MongoDB Atlas (Bulut Veritabanı) Entegrasyonu
// MONGODB_URI ortam değişkeni tanımlıysa mesajlar bulutta kalıcı saklanır.
// Tanımlı değilse veya bağlantı koparsa yerel messages.json kullanılır.
// -------------------------------------------------------------
const mongoose = require('mongoose');
let isMongoConnected = false;
let MessageModel = null;
let DeletedMessageModel = null;
let SeenUserModel = null;

try {
   const messageSchema = new mongoose.Schema({
      id: { type: String, required: true, unique: true, index: true },
      roomId: { type: String, required: true, index: true },
      sender: { type: String, required: true },
      senderId: { type: String, default: null },
      text: { type: String, default: '' },
      image: { type: String, default: null },
      timestamp: { type: Number, required: true },
      pinned: { type: Boolean, default: false },
      isSystem: { type: Boolean, default: false },
      pinnedMsgId: { type: String, default: null }
   }, { timestamps: true });

   MessageModel = mongoose.models.Message || mongoose.model('Message', messageSchema);

   const deletedMessageSchema = new mongoose.Schema({
      id: { type: String, required: true, unique: true, index: true },
      deletedAt: { type: Number, default: () => Date.now() },
      deletedBy: { type: String, default: '' }
   }, { timestamps: true });

   DeletedMessageModel = mongoose.models.DeletedMessage || mongoose.model('DeletedMessage', deletedMessageSchema);

   const seenUserSchema = new mongoose.Schema({
      userId: { type: String, required: true, unique: true, index: true },
      username: { type: String, required: true },
      avatar: { type: String, default: '' },
      isAdmin: { type: Boolean, default: false },
      lastSeen: { type: Number, default: 0 },
      servers: { type: [String], default: [] }
   }, { timestamps: true });

   SeenUserModel = mongoose.models.SeenUser || mongoose.model('SeenUser', seenUserSchema);
} catch (e) {
   console.error("[MongoDB] Model oluşturulurken hata:", e);
}

// -------------------------------------------------------------
// SİLİNEN MESAJLAR (TOMBSTONE) YÖNETİMİ
// Sunucu yeniden başladığında silinen mesajların geri gelmesini kesin olarak engeller.
// -------------------------------------------------------------
const DELETED_MESSAGES_FILE = path.join(__dirname, 'deleted_messages.json');
let deletedMessageIds = new Set();
try {
   if (fs.existsSync(DELETED_MESSAGES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DELETED_MESSAGES_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
         deletedMessageIds = new Set(parsed);
      }
   } else {
      fs.writeFileSync(DELETED_MESSAGES_FILE, JSON.stringify([]), 'utf8');
   }
} catch (err) {
   console.error("Silinen mesajlar yüklenirken hata oluştu:", err);
}

function saveDeletedMessagesLocally() {
   try {
      fs.writeFileSync(DELETED_MESSAGES_FILE, JSON.stringify([...deletedMessageIds], null, 2), 'utf8');
   } catch (err) {
      console.error("Silinen mesajlar kaydedilirken hata oluştu:", err);
   }
}

function canUserDeleteMessage(socket, roomId, msg) {
   if (!socket) return false;
   if (socket.isAdmin) return true;
   const uId = socket.userId;
   if (!uId) return false;

   // 1. Kullanıcı kendi attığı mesajı silebilir
   if (msg && (msg.senderId === uId || msg.sender === socket.username)) {
      return true;
   }

   // 2. Kullanıcı sunucu sahibi ise o sunucudaki tüm mesajları silebilir
   if (roomId) {
      if (roomId.startsWith('serverChannel_')) {
         for (const sId in serversDb) {
            if (roomId.startsWith(`serverChannel_${sId}_`)) {
               if (serversDb[sId] && (serversDb[sId].ownerId === uId)) return true;
            }
         }
      } else if (['genel', 'oyun', 'muzik', 'koordinatlar'].includes(roomId)) {
         if (serversDb['server_default'] && (serversDb['server_default'].ownerId === uId)) return true;
      }
   }

   for (const sId in serversDb) {
      if (serversDb[sId] && serversDb[sId].ownerId === uId) {
         if (roomId && roomId.includes(sId)) return true;
      }
   }

   return false;
}

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGO_URI || process.env.MONGODB_URL;

mongoose.connection.on('connected', () => {
   isMongoConnected = true;
   console.log('✅ [MongoDB] Bulut veritabanı bağlantısı aktif.');
});

mongoose.connection.on('error', (err) => {
   console.error('❌ [MongoDB] Bağlantı hatası:', err.message);
});

mongoose.connection.on('disconnected', () => {
   isMongoConnected = false;
   console.warn('⚠️ [MongoDB] Bulut veritabanı bağlantısı koptu.');
});

if (MONGODB_URI) {
   console.log('[MongoDB] Bulut veritabanı bağlantısı başlatılıyor...');
   mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 20000,
      autoIndex: true
   }).then(async () => {
      isMongoConnected = true;
      console.log('✅ [MongoDB] Bulut veritabanına başarıyla bağlanıldı! Mesajlar Render kapansa dahi kalıcı saklanacak.');
      await syncMessagesWithMongo();
      await syncSeenUsersWithMongo();
   }).catch(err => {
      console.error('❌ [MongoDB] Bağlantı hatası, yerel dosya sistemi (JSON) kullanılacak:', err.message);
   });
} else {
   console.log('ℹ️ [MongoDB] MONGODB_URI tanımlanmamış. Mesajlar yerel messages.json dosyasında saklanıyor.');
}

async function syncMessagesWithMongo() {
   if (!isMongoConnected || !MessageModel) return;
   try {
      // 1. Buluttaki tüm silinmiş mesaj ID'lerini çek ve yerel sete ekle
      if (DeletedMessageModel) {
         const deletedDocs = await DeletedMessageModel.find({}).lean();
         if (deletedDocs && deletedDocs.length > 0) {
            deletedDocs.forEach(d => {
               if (d && d.id) deletedMessageIds.add(d.id);
            });
            saveDeletedMessagesLocally();
         }
         // Yerelde silinmiş kayıtları da DeletedMessageModel'e yaz ve MessageModel'den tamamen sil
         if (deletedMessageIds.size > 0) {
            const bulkTombstones = [...deletedMessageIds].map(id => ({
               updateOne: {
                  filter: { id },
                  update: { $set: { id } },
                  upsert: true
               }
            }));
            await DeletedMessageModel.bulkWrite(bulkTombstones).catch(() => {});
            await MessageModel.deleteMany({ id: { $in: [...deletedMessageIds] } }).catch(() => {});
         }
      }

      // 2. Bellekteki silinmiş mesajları temizle
      for (const r in messageHistory) {
         messageHistory[r] = messageHistory[r].filter(m => m && m.id && !deletedMessageIds.has(m.id));
      }

      // 3. Buluttaki aktif mesajları çek (silinenler hariç)
      const docs = await MessageModel.find({ id: { $nin: [...deletedMessageIds] } }).sort({ timestamp: 1 }).lean();
      if (docs && docs.length > 0) {
         let importedCount = 0;
         docs.forEach(doc => {
            if (!doc || !doc.id || deletedMessageIds.has(doc.id)) return;
            const rId = doc.roomId;
            if (!messageHistory[rId]) messageHistory[rId] = [];
            const exists = messageHistory[rId].some(m => m.id === doc.id);
            if (!exists) {
               messageHistory[rId].push({
                  id: doc.id,
                  sender: doc.sender,
                  senderId: doc.senderId || null,
                  text: doc.text || '',
                  image: doc.image || null,
                  timestamp: doc.timestamp,
                  pinned: !!doc.pinned,
                  isSystem: !!doc.isSystem,
                  pinnedMsgId: doc.pinnedMsgId || null
               });
               importedCount++;
            }
         });
         console.log(`[MongoDB] ${importedCount} adet bulut mesajı yerel belleğe yüklendi.`);
      }

      // 4. Sadece silinmemiş ve henüz MongoDB'de bulunmayan yerel mesajları buluta yükle
      const existingMongoIds = new Set((docs || []).map(d => d.id));
      const newMessagesToUpload = [];
      for (const roomId in messageHistory) {
         for (const msg of messageHistory[roomId]) {
            if (!msg || !msg.id || deletedMessageIds.has(msg.id)) continue;
            if (!existingMongoIds.has(msg.id)) {
               newMessagesToUpload.push({
                  updateOne: {
                     filter: { id: msg.id },
                     update: {
                        $set: {
                           id: msg.id,
                           roomId: roomId,
                           sender: msg.sender,
                           senderId: msg.senderId || null,
                           text: msg.text || '',
                           image: msg.image || null,
                           timestamp: msg.timestamp,
                           pinned: !!msg.pinned,
                           isSystem: !!msg.isSystem,
                           pinnedMsgId: msg.pinnedMsgId || null
                        }
                     },
                     upsert: true
                  }
               });
            }
         }
      }
      if (newMessagesToUpload.length > 0) {
         await MessageModel.bulkWrite(newMessagesToUpload).catch(e => console.error('[MongoDB bulkWrite error]:', e.message));
         console.log(`[MongoDB] ${newMessagesToUpload.length} adet yeni yerel mesaj buluta aktarıldı.`);
      }

      // 5. Ayna kanalları eşitle ve kaydet
      migrateOldChannels();
      saveMessagesLocally();

      // 6. Bağlı kullanıcılara güncel mesaj geçmişini anında ilet
      if (typeof io !== 'undefined' && io.sockets && io.sockets.sockets) {
         for (const [id, s] of io.sockets.sockets) {
            if (s.textRoom && messageHistory[s.textRoom]) {
               s.emit('chat-history', messageHistory[s.textRoom]);
            }
         }
      }
   } catch (err) {
      console.error('[MongoDB] Mesaj senkronizasyon hatası:', err.message);
   }
}

// Eski kanalları (genel, koordinatlar vs.) yeni sunucu kanallarıyla birleştir (Migration)
function migrateOldChannels() {
   const defaultServerId = 'server_default';
   const mappings = {
      'genel': `serverChannel_${defaultServerId}_genel`,
      'oyun': `serverChannel_${defaultServerId}_oyun`,
      'muzik': `serverChannel_${defaultServerId}_muzik`,
      'koordinatlar': `serverChannel_${defaultServerId}_koordinatlar`
   };

   let changed = false;
   for (const [oldRoom, newRoom] of Object.entries(mappings)) {
      if (!messageHistory[newRoom]) messageHistory[newRoom] = [];
      if (!messageHistory[oldRoom]) messageHistory[oldRoom] = [];

      // Eski odadaki mesajları yeni sunucu odasına aktar
      messageHistory[oldRoom].forEach(oldMsg => {
         const exists = messageHistory[newRoom].some(m => m.id === oldMsg.id || (m.timestamp === oldMsg.timestamp && m.text === oldMsg.text));
         if (!exists) {
            messageHistory[newRoom].push(oldMsg);
            changed = true;
         }
      });

      // Yeni sunucu odasındaki mesajları eski odaya da yansıt (çift yönlü uyumluluk)
      messageHistory[newRoom].forEach(newMsg => {
         const exists = messageHistory[oldRoom].some(m => m.id === newMsg.id || (m.timestamp === newMsg.timestamp && m.text === newMsg.text));
         if (!exists) {
            messageHistory[oldRoom].push(newMsg);
            changed = true;
         }
      });

      // Kronolojik sırala
      messageHistory[newRoom].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      messageHistory[oldRoom].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
   }

   if (changed) {
      saveMessagesLocally();
   }
}

// Load messages history on start
try {
   if (fs.existsSync(MESSAGES_FILE)) {
      const fileContent = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messageHistory = JSON.parse(fileContent);
      let dirty = false;
      for (let r in messageHistory) {
         const origLen = messageHistory[r].length;
         // Silinmiş mesajları ayıkla
         messageHistory[r] = messageHistory[r].filter(msg => msg && msg.id && !deletedMessageIds.has(msg.id));
         if (messageHistory[r].length !== origLen) dirty = true;

         messageHistory[r].forEach(msg => {
            if (!msg.id) {
               msg.id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
               dirty = true;
            }
         });
      }
      for (let r in textRooms) {
         if (!messageHistory[r]) messageHistory[r] = [];
      }
      migrateOldChannels();
      if (dirty) {
         saveMessagesLocally();
      }
   } else {
      for (let r in textRooms) {
         if (!messageHistory[r]) messageHistory[r] = [];
      }
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messageHistory, null, 2), 'utf8');
   }
} catch (err) {
   console.error("Mesajlar yüklenirken hata oluştu:", err);
}

function saveMessagesLocally() {
   try {
      // Sadece silinmemiş mesajları kaydet
      const cleaned = {};
      for (const r in messageHistory) {
         cleaned[r] = (messageHistory[r] || []).filter(m => m && m.id && !deletedMessageIds.has(m.id));
      }
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
   } catch (err) {
      console.error("Mesajlar kaydedilirken hata oluştu:", err);
   }
}

function saveMessages(roomId, msgObj) {
   saveMessagesLocally();

   // Buluta asenkron kaydet (silinmiş değilse)
   if (isMongoConnected && MessageModel && msgObj && roomId && !deletedMessageIds.has(msgObj.id)) {
      MessageModel.findOneAndUpdate(
         { id: msgObj.id },
         {
            id: msgObj.id,
            roomId: roomId,
            sender: msgObj.sender,
            senderId: msgObj.senderId || null,
            text: msgObj.text || '',
            image: msgObj.image || null,
            timestamp: msgObj.timestamp,
            pinned: !!msgObj.pinned,
            isSystem: !!msgObj.isSystem,
            pinnedMsgId: msgObj.pinnedMsgId || null
         },
         { upsert: true, new: true }
      ).catch(err => {
         console.error('[MongoDB] Mesaj kaydetme hatası:', err.message);
      });
   }
}

const allTimeUsers = {};

function isFixtureAccount(user) {
   if (!user) return false;
   const email = (user.email || '').toLowerCase();
   if (email.endsWith('@example.com') || email.endsWith('@domain.com')) return true;
   if (typeof user.googleId === 'string' && user.googleId.startsWith('mock_google_')) return true;
   return false;
}

// Kayıtlı gerçek hesaplar çevrimdışı listede durur. Eski sahte test hesapları
// sağ panele yazılmaz; biri gerçekten girerse o anda listeye eklenir.
function initAllTimeUsersFromDb() {
   for (const uId in usersDb) {
      const u = usersDb[uId];
      if (!u || isFixtureAccount(u) || allTimeUsers[uId]) continue;
      allTimeUsers[uId] = {
         username: u.username,
         isOnline: false,
         peerId: null,
         userId: uId,
         avatar: u.avatar || '',
         isAdmin: u.isAdmin || false
      };
   }
}
initAllTimeUsersFromDb();

// Sunucuya bir kez giren herkes burada kalır. Yeniden başlatma ve Render
// deploy'u listeyi eski test hesaplarına döndürmesin diye yerel dosya + Mongo.
const SEEN_USERS_FILE = path.join(__dirname, 'seen_users.json');
let seenUsers = {};

function loadSeenUsersLocally() {
   try {
      if (fs.existsSync(SEEN_USERS_FILE)) {
         const parsed = JSON.parse(fs.readFileSync(SEEN_USERS_FILE, 'utf8'));
         if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            seenUsers = parsed;
         }
      } else {
         fs.writeFileSync(SEEN_USERS_FILE, JSON.stringify({}, null, 2), 'utf8');
      }
   } catch (err) {
      console.error("Giriş yapan kullanıcılar yüklenirken hata oluştu:", err);
   }
}

function saveSeenUsersLocally() {
   try {
      fs.writeFileSync(SEEN_USERS_FILE, JSON.stringify(seenUsers, null, 2), 'utf8');
   } catch (err) {
      console.error("Giriş yapan kullanıcılar kaydedilirken hata oluştu:", err);
   }
}

function persistSeenUserMongo(record) {
   if (!isMongoConnected || !SeenUserModel || !record || !record.userId) return;
   SeenUserModel.findOneAndUpdate(
      { userId: record.userId },
      { $set: record },
      { upsert: true }
   ).catch(err => {
      console.error('[SeenUsers] Kayıt hatası:', err.message);
   });
}

function rosterAvatar(userId, avatar) {
   if (usersDb[userId] && usersDb[userId].avatar) return usersDb[userId].avatar;
   return avatar || '';
}

function applySeenUserOffline(record) {
   if (!record || !record.userId || !record.username) return;
   const avatar = rosterAvatar(record.userId, record.avatar);
   const current = allTimeUsers[record.userId];
   if (current && current.isOnline) {
      current.username = record.username || current.username;
      current.avatar = avatar || current.avatar || '';
      current.isAdmin = !!(record.isAdmin || current.isAdmin);
      return;
   }
   allTimeUsers[record.userId] = {
      username: record.username,
      isOnline: false,
      peerId: null,
      userId: record.userId,
      avatar: avatar,
      isAdmin: !!record.isAdmin
   };
}

function ensureServerMember(serverId, userId) {
   const server = serversDb[serverId];
   if (!server || !userId) return false;
   if (!server.members) server.members = [];
   if (server.members.includes(userId)) return false;
   server.members.push(userId);
   return true;
}

function rememberEntrant(userId, info, serverIds) {
   if (!userId || !info) return [];
   const username = (info.username || '').trim();
   if (!username) return [];

   if (isFixtureAccount(usersDb[userId])) {
      if (info.isOnline) {
         allTimeUsers[userId] = {
            username,
            isOnline: true,
            peerId: info.peerId || null,
            userId,
            avatar: rosterAvatar(userId, info.avatar || ''),
            isAdmin: !!info.isAdmin
         };
      }
      return [];
   }

   const prev = seenUsers[userId] || {};
   const servers = new Set(prev.servers || []);
   const targets = (serverIds && serverIds.length) ? serverIds : ['server_default'];
   const addedServers = [];

   for (const serverId of targets) {
      if (!serversDb[serverId]) continue;
      servers.add(serverId);
      if (ensureServerMember(serverId, userId)) addedServers.push(serverId);
   }

   const incomingAvatar = info.avatar != null ? info.avatar : (prev.avatar || '');
   const record = {
      userId,
      username,
      avatar: usersDb[userId] ? '' : incomingAvatar,
      isAdmin: !!(info.isAdmin || prev.isAdmin),
      lastSeen: Date.now(),
      servers: [...servers]
   };
   seenUsers[userId] = record;
   saveSeenUsersLocally();
   persistSeenUserMongo(record);

   const current = allTimeUsers[userId];
   allTimeUsers[userId] = {
      username: record.username,
      isOnline: info.isOnline !== undefined ? !!info.isOnline : !!(current && current.isOnline),
      peerId: info.peerId !== undefined ? info.peerId : (current ? current.peerId : null),
      userId,
      avatar: rosterAvatar(userId, incomingAvatar),
      isAdmin: record.isAdmin
   };

   if (addedServers.length) saveServers();

   const key = username.trim().toLowerCase();
   for (const otherId of Object.keys(seenUsers)) {
      if (otherId === userId || !otherId.startsWith('seen_')) continue;
      if ((seenUsers[otherId].username || '').trim().toLowerCase() !== key) continue;
      delete seenUsers[otherId];
      delete allTimeUsers[otherId];
      let removedMember = false;
      for (const serverId in serversDb) {
         const server = serversDb[serverId];
         if (!server.members || !server.members.includes(otherId)) continue;
         server.members = server.members.filter(id => id !== otherId);
         removedMember = true;
         io.emit('server-update', serverId, server);
      }
      if (removedMember) saveServers();
      if (isMongoConnected && SeenUserModel) {
         SeenUserModel.deleteOne({ userId: otherId }).catch(() => {});
      }
   }
   saveSeenUsersLocally();
   return addedServers;
}

function backfillEntrantsFromMessages() {
   const byName = new Map();
   for (const roomId in messageHistory) {
      for (const msg of messageHistory[roomId] || []) {
         if (!msg || msg.isSystem) continue;
         const username = (msg.sender || '').trim();
         if (!username || username === 'Sistem') continue;
         const key = username.toLowerCase();
         const prev = byName.get(key) || { username, senderId: null };
         if (msg.senderId && !prev.senderId) prev.senderId = msg.senderId;
         byName.set(key, prev);
      }
   }

   for (const entry of byName.values()) {
      const key = entry.username.toLowerCase();
      const already = Object.keys(seenUsers).some(id => (seenUsers[id].username || '').trim().toLowerCase() === key)
         || Object.keys(allTimeUsers).some(id => (allTimeUsers[id].username || '').trim().toLowerCase() === key && !isFixtureAccount(usersDb[id]));
      if (already) continue;

      let userId = entry.senderId || null;
      if (userId && isFixtureAccount(usersDb[userId])) userId = null;
      if (!userId) {
         const accountId = Object.keys(usersDb).find(id =>
            !isFixtureAccount(usersDb[id]) && (usersDb[id].username || '').trim().toLowerCase() === key
         );
         userId = accountId || ('seen_' + Buffer.from(key).toString('base64url'));
      }
      if (seenUsers[userId] || isFixtureAccount(usersDb[userId])) continue;

      const account = usersDb[userId];
      rememberEntrant(userId, {
         username: account ? account.username : entry.username,
         avatar: account ? (account.avatar || '') : '',
         isAdmin: account ? !!account.isAdmin : false,
         isOnline: !!(allTimeUsers[userId] && allTimeUsers[userId].isOnline),
         peerId: allTimeUsers[userId] ? allTimeUsers[userId].peerId : null
      }, ['server_default']);
   }
}

function forgetEntrant(userId) {
   if (!userId) return;
   if (seenUsers[userId]) {
      delete seenUsers[userId];
      saveSeenUsersLocally();
   }
   if (isMongoConnected && SeenUserModel) {
      SeenUserModel.deleteOne({ userId }).catch(err => {
         console.error('[SeenUsers] Silme hatası:', err.message);
      });
   }
   for (const serverId in serversDb) {
      const server = serversDb[serverId];
      if (!server.members || !server.members.includes(userId)) continue;
      server.members = server.members.filter(id => id !== userId);
      saveServers();
      io.emit('server-update', serverId, server);
   }
}

function seedSeenUsersFromMembers() {
   let changed = false;
   let membersChanged = false;
   for (const serverId in serversDb) {
      const server = serversDb[serverId];
      const before = (server.members || []).length;
      server.members = (server.members || []).filter(memberId => !isFixtureAccount(usersDb[memberId]));
      if (server.members.length !== before) membersChanged = true;

      for (const memberId of server.members) {
         const account = usersDb[memberId];
         if (!account || !account.username || isFixtureAccount(account)) continue;
         if (!seenUsers[memberId]) {
            seenUsers[memberId] = {
               userId: memberId,
               username: account.username,
               avatar: '',
               isAdmin: !!account.isAdmin,
               lastSeen: 0,
               servers: [serverId]
            };
            changed = true;
         } else if (!(seenUsers[memberId].servers || []).includes(serverId)) {
            seenUsers[memberId].servers = [...(seenUsers[memberId].servers || []), serverId];
            changed = true;
         }
         applySeenUserOffline(seenUsers[memberId]);
      }
   }
   if (changed) saveSeenUsersLocally();
   if (membersChanged) saveServers();
   backfillEntrantsFromMessages();
}

loadSeenUsersLocally();
for (const userId of Object.keys(seenUsers)) {
   if (isFixtureAccount(usersDb[userId])) {
      delete seenUsers[userId];
      continue;
   }
   applySeenUserOffline(seenUsers[userId]);
   for (const serverId of seenUsers[userId].servers || []) {
      if (ensureServerMember(serverId, userId)) saveServers();
   }
}
seedSeenUsersFromMembers();

async function syncSeenUsersWithMongo() {
   if (!isMongoConnected || !SeenUserModel) return;
   try {
      const docs = await SeenUserModel.find({}).lean();
      let membersChanged = false;

      for (const doc of docs) {
         if (!doc || !doc.userId || !doc.username) continue;
         if (isFixtureAccount(usersDb[doc.userId])) continue;
         const local = seenUsers[doc.userId];
         const remoteNewer = !local || (doc.lastSeen || 0) >= ((local && local.lastSeen) || 0);
         const mergedServers = new Set([
            ...((local && local.servers) || []),
            ...(doc.servers || [])
         ]);
         if (mergedServers.size === 0) mergedServers.add('server_default');

         const record = {
            userId: doc.userId,
            username: remoteNewer ? doc.username : (local.username || doc.username),
            avatar: remoteNewer ? (doc.avatar || '') : ((local && local.avatar) || doc.avatar || ''),
            isAdmin: !!(doc.isAdmin || (local && local.isAdmin)),
            lastSeen: Math.max(doc.lastSeen || 0, (local && local.lastSeen) || 0),
            servers: [...mergedServers]
         };
         seenUsers[record.userId] = record;
         applySeenUserOffline(record);
         for (const serverId of record.servers) {
            if (ensureServerMember(serverId, record.userId)) membersChanged = true;
         }
      }

      if (MessageModel) {
         const senders = await MessageModel.aggregate([
            { $match: { senderId: { $nin: [null, ''] }, isSystem: { $ne: true } } },
            { $sort: { timestamp: 1 } },
            { $group: { _id: '$senderId', username: { $last: '$sender' } } }
         ]);
         for (const sender of senders) {
            if (!sender || !sender._id || !sender.username || sender.username === 'Sistem') continue;
            if (seenUsers[sender._id]) continue;
            const account = usersDb[sender._id];
            const added = rememberEntrant(sender._id, {
               username: account ? account.username : sender.username,
               avatar: account ? (account.avatar || '') : '',
               isAdmin: account ? !!account.isAdmin : false,
               isOnline: !!(allTimeUsers[sender._id] && allTimeUsers[sender._id].isOnline),
               peerId: allTimeUsers[sender._id] ? allTimeUsers[sender._id].peerId : null
            }, ['server_default']);
            if (added.length) membersChanged = true;
         }
      }

      for (const userId in seenUsers) {
         await SeenUserModel.findOneAndUpdate(
            { userId },
            { $set: seenUsers[userId] },
            { upsert: true }
         );
      }

      backfillEntrantsFromMessages();
      saveSeenUsersLocally();
      if (membersChanged) saveServers();
      io.emit('global-users', allTimeUsers);
      for (const serverId in serversDb) {
         io.emit('server-update', serverId, serversDb[serverId]);
      }
      console.log(`[SeenUsers] ${Object.keys(seenUsers).length} kullanıcı sağ listede kalıcı tutuluyor.`);
   } catch (err) {
      console.error('[SeenUsers] Senkron hatası:', err.message);
   }
}

const ADMIN_KEY = process.env.ADMIN_KEY || "berzan123";

io.on('connection', (socket) => {
   socket.voiceState = { mic: true, deaf: false }; // Kullanıcının varsayılan donanım durumu

   socket.on('register', (peerId, username, userId, avatar, adminToken) => {
      const uId = userId || peerId;
      socket.peerId = peerId;
      
      // Get stored user info from DB if possible
      let finalUsername = username;
      let finalAvatar = avatar || '';
      let isAdmin = (adminToken === ADMIN_KEY);
      
      if (usersDb[uId]) {
         finalUsername = usersDb[uId].username || username;
         finalAvatar = usersDb[uId].avatar || avatar || '';
         if (usersDb[uId].email === 'berzanu10@gmail.com' && !usersDb[uId].isAdmin) {
            usersDb[uId].isAdmin = true;
            saveUsers();
         }
         isAdmin = usersDb[uId].isAdmin || isAdmin;
      }
      
      socket.username = finalUsername;
      socket.userId = uId;
      socket.avatar = finalAvatar;
      socket.isAdmin = isAdmin;
      
      userSockets[uId] = socket.id;

      const addedServers = rememberEntrant(uId, {
         username: finalUsername,
         avatar: finalAvatar,
         isAdmin: isAdmin,
         isOnline: true,
         peerId: peerId
      }, ['server_default']);

      for (const serverId of addedServers) {
         io.emit('server-update', serverId, serversDb[serverId]);
      }

      io.emit('global-users', allTimeUsers);
      socket.emit('voice-rooms-state', voiceRooms);
      socket.emit('admin-status', isAdmin);
      socket.emit('channels-list', { text: Object.keys(textRooms), voice: Object.keys(voiceRooms) });
      // Yeni kullanıcının güncel listesini al
      socket.emit('global-users', allTimeUsers);
   });

   // METİN
   socket.on('join-text-room', async (roomId) => {
      if (!roomId) return;
      if (socket.textRoom) {
         socket.leave('text-' + socket.textRoom);
         if (textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
      }
      socket.textRoom = roomId;
      if (!textRooms[roomId]) textRooms[roomId] = {};
      textRooms[roomId][socket.peerId] = socket.username;
      socket.join('text-' + roomId);

      // Ayna (mirror) oda eşleşmesi
      const mirrorMap = {
         'genel': 'serverChannel_server_default_genel',
         'serverChannel_server_default_genel': 'genel',
         'oyun': 'serverChannel_server_default_oyun',
         'serverChannel_server_default_oyun': 'oyun',
         'muzik': 'serverChannel_server_default_muzik',
         'serverChannel_server_default_muzik': 'muzik',
         'koordinatlar': 'serverChannel_server_default_koordinatlar',
         'serverChannel_server_default_koordinatlar': 'koordinatlar'
      };

      // MongoDB bağlıysa bu odaya (ve varsa aynasına) ait mesajları veritabanından çekip bellekle senkronize et
      if (isMongoConnected && MessageModel) {
         try {
            const queryRooms = [roomId];
            if (mirrorMap[roomId]) queryRooms.push(mirrorMap[roomId]);

            const docs = await MessageModel.find({ 
               roomId: { $in: queryRooms },
               id: { $nin: [...deletedMessageIds] }
            }).sort({ timestamp: 1 }).lean();

            if (docs && docs.length > 0) {
               if (!messageHistory[roomId]) messageHistory[roomId] = [];
               docs.forEach(doc => {
                  if (!doc || !doc.id || deletedMessageIds.has(doc.id)) return;
                  if (!messageHistory[roomId].some(m => m.id === doc.id)) {
                     messageHistory[roomId].push({
                        id: doc.id,
                        sender: doc.sender,
                        senderId: doc.senderId || null,
                        text: doc.text || '',
                        image: doc.image || null,
                        timestamp: doc.timestamp,
                        pinned: !!doc.pinned,
                        isSystem: !!doc.isSystem,
                        pinnedMsgId: doc.pinnedMsgId || null
                     });
                  }
               });
               messageHistory[roomId] = messageHistory[roomId].filter(m => m && m.id && !deletedMessageIds.has(m.id));
               messageHistory[roomId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

               // Ayna odayı da senkronize et
               if (mirrorMap[roomId]) {
                  const mRoom = mirrorMap[roomId];
                  if (!messageHistory[mRoom]) messageHistory[mRoom] = [];
                  docs.forEach(doc => {
                     if (!doc || !doc.id || deletedMessageIds.has(doc.id)) return;
                     if (!messageHistory[mRoom].some(m => m.id === doc.id)) {
                        messageHistory[mRoom].push({
                           id: doc.id,
                           sender: doc.sender,
                           senderId: doc.senderId || null,
                           text: doc.text || '',
                           image: doc.image || null,
                           timestamp: doc.timestamp,
                           pinned: !!doc.pinned,
                           isSystem: !!doc.isSystem,
                           pinnedMsgId: doc.pinnedMsgId || null
                        });
                     }
                  });
                  messageHistory[mRoom] = messageHistory[mRoom].filter(m => m && m.id && !deletedMessageIds.has(m.id));
                  messageHistory[mRoom].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
               }
            }
         } catch (e) {
            console.error('[MongoDB] join-text-room sorgu hatası:', e.message);
         }
      }

      // Emit chat history to user (silinenler hariç)
      if (!messageHistory[roomId]) {
         messageHistory[roomId] = [];
         saveMessagesLocally();
      } else {
         messageHistory[roomId] = messageHistory[roomId].filter(m => m && m.id && !deletedMessageIds.has(m.id));
      }
      socket.emit('chat-history', messageHistory[roomId]);
   });

   socket.on('chat-message', (data) => {
      if (socket.textRoom && socket.username) {
         const roomId = socket.textRoom;
         let text = '';
         let image = null;

         if (typeof data === 'string') {
            text = data.trim();
         } else if (typeof data === 'object' && data !== null) {
            text = (data.text || '').trim();
            image = data.image || null;
         }

         if (!text && !image) return;

         const msgObj = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            sender: socket.username,
            senderId: socket.userId || null,
            text: text,
            image: image,
            timestamp: Date.now()
         };

         if (!messageHistory[roomId]) messageHistory[roomId] = [];
         messageHistory[roomId].push(msgObj);

         if (messageHistory[roomId].length > 500) {
            messageHistory[roomId].shift();
         }

         saveMessages(roomId, msgObj);

         io.to('text-' + roomId).emit('create-message', text, socket.username, msgObj.id, false, image);

         // Çift yönlü oda eşitlemesi (genel <-> serverChannel_server_default_genel vb.)
         const defaultServerId = 'server_default';
         const mirrorRooms = [
            ['genel', `serverChannel_${defaultServerId}_genel`],
            ['oyun', `serverChannel_${defaultServerId}_oyun`],
            ['muzik', `serverChannel_${defaultServerId}_muzik`],
            ['koordinatlar', `serverChannel_${defaultServerId}_koordinatlar`]
         ];

         for (const [rA, rB] of mirrorRooms) {
            if (roomId === rA || roomId === rB) {
               const targetMirror = (roomId === rA) ? rB : rA;
               if (!messageHistory[targetMirror]) messageHistory[targetMirror] = [];
               const alreadyExists = messageHistory[targetMirror].some(m => m.id === msgObj.id);
               if (!alreadyExists) {
                  messageHistory[targetMirror].push(msgObj);
                  if (messageHistory[targetMirror].length > 500) messageHistory[targetMirror].shift();
                  saveMessages(targetMirror, msgObj);
                  io.to('text-' + targetMirror).emit('create-message', text, socket.username, msgObj.id, false, image);
               }
               break;
            }
         }

         if (roomId.startsWith('dm_')) {
            const parts = roomId.split('_');
            const targetUserId = parts[1] === socket.userId ? parts[2] : parts[1];
            const targetSocketId = userSockets[targetUserId];
            if (targetSocketId) {
               io.to(targetSocketId).emit('dm-received', {
                  senderId: socket.userId,
                  senderName: socket.username,
                  message: text,
                  image: image,
                  roomId: roomId
               });
            }
         }
      }
   });

   socket.on('delete-message', (msgId) => {
      if (!msgId) return;
      let targetRoom = socket.textRoom || null;
      let targetMsg = null;

      for (let room in messageHistory) {
         const m = messageHistory[room].find(x => x.id === msgId);
         if (m) {
            targetRoom = room;
            targetMsg = m;
            break;
         }
      }

      if (!targetMsg && !socket.isAdmin) {
         return;
      }

      if (targetMsg && !canUserDeleteMessage(socket, targetRoom, targetMsg)) {
         return;
      }

      // Kalıcı silme kaydı (Tombstone)
      deletedMessageIds.add(msgId);
      saveDeletedMessagesLocally();

      let deleted = false;
      for (let room in messageHistory) {
         const prevLen = messageHistory[room].length;
         messageHistory[room] = messageHistory[room].filter(m => m.id !== msgId);
         if (messageHistory[room].length !== prevLen) {
            deleted = true;
         }
      }

      saveMessagesLocally();

      if (isMongoConnected) {
         if (MessageModel) {
            MessageModel.deleteMany({ id: msgId }).catch(() => {});
         }
         if (DeletedMessageModel) {
            DeletedMessageModel.updateOne(
               { id: msgId },
               { $set: { id: msgId, deletedBy: socket.username || socket.userId || 'admin', deletedAt: Date.now() } },
               { upsert: true }
            ).catch(() => {});
         }
      }

      io.emit('message-deleted', msgId);
   });

   // SES ODASI GİRİŞ KONTROLLERİ VE DONANIM BİLGİSİ YAYINI
   socket.on('join-voice-room', (roomId) => {
      const prevRoom = socket.voiceRoom;
      if (prevRoom && prevRoom !== roomId) {
         socket.leave('voice-' + prevRoom);
         if (socket.peerId && voiceRooms[prevRoom]) {
            delete voiceRooms[prevRoom][socket.peerId];
         }
         socket.to('voice-' + prevRoom).emit('voice-user-left', {
            peerId: socket.peerId,
            username: socket.username,
            roomId: prevRoom
         });
      }

      socket.voiceRoom = roomId;
      if (roomId) {
         if (!voiceRooms[roomId]) voiceRooms[roomId] = {};

         // Odaya yeni katılan kişiye odadaki mevcut diğer kişilerin listesini ilet
         socket.emit('voice-join-success', voiceRooms[roomId]);

         if (socket.peerId) {
            voiceRooms[roomId][socket.peerId] = {
               username: socket.username,
               mic: socket.voiceState ? socket.voiceState.mic : true,
               deaf: socket.voiceState ? socket.voiceState.deaf : false,
               avatar: socket.avatar || ''
            };

            socket.join('voice-' + roomId);
            // Odadaki diğer kullanıcılara birinin girdiğini bildir
            socket.to('voice-' + roomId).emit('voice-user-joined', {
               peerId: socket.peerId,
               username: socket.username,
               roomId: roomId
            });
         }
      }
      io.emit('voice-rooms-state', voiceRooms);
   });

   // P2P Ses Mesh Doğrudan Sinyalleşme ve Yeniden Bağlantı Köprüsü
   socket.on('voice-signal', ({ toPeerId, type, data }) => {
      if (!toPeerId) return;
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.peerId === toPeerId);
      if (targetSocket) {
         targetSocket.emit('voice-signal', {
            fromPeerId: socket.peerId,
            fromUsername: socket.username,
            type,
            data
         });
      }
   });

   socket.on('get-voice-state', () => {
      socket.emit('voice-rooms-state', voiceRooms);
   });

   // KULLANICI MİKROFON/KULAKLIK KAPATTIĞINDA SUNUCUYU HABERDAR EDEN YENİ EVENT
   socket.on('voice-state-update', (state) => {
      socket.voiceState = state; // Gelen objeyi kaydet: { mic: false, deaf: false } vb.

      if (socket.voiceRoom && voiceRooms[socket.voiceRoom] && voiceRooms[socket.voiceRoom][socket.peerId]) {
         voiceRooms[socket.voiceRoom][socket.peerId].mic = state.mic;
         voiceRooms[socket.voiceRoom][socket.peerId].deaf = state.deaf;

         // Herkese duyur ki listede mute/deaf ikonlarını kırmızı yaksınlar!
         io.emit('voice-rooms-state', voiceRooms);
      }
   });

   // ADMİN İŞLEMLERİ (KANAL YÖNETİMİ & ATMA)
   socket.on('create-channel', ({ serverId, name, type }) => {
      const server = serversDb[serverId];
      if (!server) return;
      if (server.ownerId !== socket.userId && !socket.isAdmin) return;

      if (type === 'text') {
         const formatted = name.trim().toLowerCase().replace(/\s+/g, '-');
         if (formatted && !server.channels.text.includes(formatted)) {
            server.channels.text.push(formatted);
            saveServers();
            io.emit('server-update', serverId, server);
         }
      } else if (type === 'voice') {
         const formatted = name.trim();
         if (formatted && !server.channels.voice.includes(formatted)) {
            server.channels.voice.push(formatted);
            saveServers();
            io.emit('server-update', serverId, server);
         }
      }
   });

   socket.on('delete-channel', ({ serverId, name, type }) => {
      const server = serversDb[serverId];
      if (!server) return;
      if (server.ownerId !== socket.userId && !socket.isAdmin) return;

      if (type === 'text' && name !== 'genel') {
         server.channels.text = server.channels.text.filter(ch => ch !== name);
         saveServers();
         io.emit('server-update', serverId, server);
      } else if (type === 'voice') {
         server.channels.voice = server.channels.voice.filter(ch => ch !== name);
         saveServers();
         io.emit('server-update', serverId, server);
      }
   });

   socket.on('kick-from-voice', (targetPeerId) => {
      if (!socket.isAdmin) return;
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.peerId === targetPeerId);
      if (targetSocket) {
         targetSocket.emit('kicked-from-voice');
      }
   });

   socket.on('kick-from-server', (targetUserId) => {
      if (!socket.isAdmin) return;
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.userId === targetUserId);
      if (targetSocket) {
         targetSocket.emit('kicked-from-server');
         targetSocket.disconnect(true);
      }
   });

   // Sunucudan kalıcı olarak kullanıcı silme (Admin only)
   socket.on('remove-user', (targetUserId) => {
      if (!socket.isAdmin) return;
      if (targetUserId === socket.userId) return; // Kendini silemez

      // Bağlıysa bağlantısını kes
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.userId === targetUserId);
      if (targetSocket) {
         targetSocket.emit('kicked-from-server');
         targetSocket.disconnect(true);
      }

      // usersDb'den kalıcı sil
      if (usersDb[targetUserId]) {
         delete usersDb[targetUserId];
         saveUsers();
      }

      // allTimeUsers'dan ve kalıcı giriş listesinden sil
      if (allTimeUsers[targetUserId]) {
         delete allTimeUsers[targetUserId];
      }
      forgetEntrant(targetUserId);

      io.emit('global-users', allTimeUsers);
   });

   socket.on('pin-message', (msgId) => {
      let roomId = socket.textRoom;
      if (!roomId) return;
      const msg = messageHistory[roomId].find(m => m.id === msgId);
      if (msg) {
         msg.pinned = !msg.pinned;
         saveMessages(roomId, msg);
         io.to('text-' + roomId).emit('message-pinned-status', msgId, msg.pinned, msg);
         
         // System message notification
         if (msg.pinned) {
            const sysMsg = {
               id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
               sender: 'Sistem',
               text: `${socket.username || 'Bir kullanıcı'} bir mesajı bu kanala sabitledi.`,
               timestamp: Date.now(),
               isSystem: true,
               pinnedMsgId: msgId
            };
            messageHistory[roomId].push(sysMsg);
            saveMessages(roomId, sysMsg);
            io.to('text-' + roomId).emit('create-message', sysMsg.text, sysMsg.sender, sysMsg.id, sysMsg.isSystem);
         } else {
            // Unpinned! Find and remove the linked system message
            const sysIndex = messageHistory[roomId].findIndex(m => m.isSystem && m.pinnedMsgId === msgId);
            if (sysIndex !== -1) {
               const sysMsgId = messageHistory[roomId][sysIndex].id;
               messageHistory[roomId].splice(sysIndex, 1);
               saveMessagesLocally();
               if (isMongoConnected && MessageModel) {
                  MessageModel.deleteOne({ id: sysMsgId }).catch(() => {});
               }
               io.to('text-' + roomId).emit('message-deleted', sysMsgId);
            }
         }
      }
   });

   socket.on('bulk-delete-messages', (msgIds) => {
      if (!Array.isArray(msgIds) || msgIds.length === 0) return;

      const deletedIds = [];
      const currentRoom = socket.textRoom;

      for (const msgId of msgIds) {
         let targetRoom = currentRoom;
         let targetMsg = null;

         for (let room in messageHistory) {
            const m = messageHistory[room].find(x => x.id === msgId);
            if (m) {
               targetRoom = room;
               targetMsg = m;
               break;
            }
         }

         if (targetMsg) {
            if (canUserDeleteMessage(socket, targetRoom, targetMsg)) {
               deletedIds.push(msgId);
               deletedMessageIds.add(msgId);
            }
         } else if (socket.isAdmin) {
            deletedIds.push(msgId);
            deletedMessageIds.add(msgId);
         }
      }

      if (deletedIds.length > 0) {
         saveDeletedMessagesLocally();

         for (let room in messageHistory) {
            messageHistory[room] = messageHistory[room].filter(m => !deletedIds.includes(m.id));
         }
         saveMessagesLocally();

         if (isMongoConnected) {
            if (MessageModel) {
               MessageModel.deleteMany({ id: { $in: deletedIds } }).catch(() => {});
            }
            if (DeletedMessageModel) {
               const bulkTombstones = deletedIds.map(id => ({
                  updateOne: {
                     filter: { id },
                     update: { $set: { id, deletedBy: socket.username || socket.userId || 'admin', deletedAt: Date.now() } },
                     upsert: true
                  }
               }));
               DeletedMessageModel.bulkWrite(bulkTombstones).catch(() => {});
            }
         }

         io.emit('messages-bulk-deleted', deletedIds);
      }
   });

   socket.on('start-screen-share', () => {
      if (socket.voiceRoom && voiceRooms[socket.voiceRoom] && voiceRooms[socket.voiceRoom][socket.peerId]) {
         voiceRooms[socket.voiceRoom][socket.peerId].isSharingScreen = true;
         io.emit('voice-rooms-state', voiceRooms);
      }
   });

   socket.on('stop-screen-share', () => {
      if (socket.voiceRoom && voiceRooms[socket.voiceRoom] && voiceRooms[socket.voiceRoom][socket.peerId]) {
         voiceRooms[socket.voiceRoom][socket.peerId].isSharingScreen = false;
         io.emit('voice-rooms-state', voiceRooms);
      }
   });

   socket.on('request-screen-share-stream', ({ targetPeerId, requesterPeerId }) => {
      const targetSocket = [...io.sockets.sockets.values()].find(s => s.peerId === targetPeerId);
      if (targetSocket) {
         targetSocket.emit('screen-share-requested', { requesterPeerId });
      }
   });

    socket.on('call-signal', ({ targetUserId, targetPeerId, type, enabled }) => {
       let targetSocket = null;
       if (targetUserId) {
          const socketId = userSockets[targetUserId];
          if (socketId) targetSocket = io.sockets.sockets.get(socketId);
       } else if (targetPeerId) {
          targetSocket = [...io.sockets.sockets.values()].find(s => s.peerId === targetPeerId);
       }
       if (targetSocket) {
          targetSocket.emit('call-signal', { 
             fromPeerId: socket.peerId, 
             senderId: socket.userId, 
             type, 
             enabled 
          });
       }
    });

   socket.on('disconnect', () => {
      if (socket.textRoom && socket.peerId) {
         if (textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
      }
      if (socket.voiceRoom && socket.peerId) {
         const vRoom = socket.voiceRoom;
         if (voiceRooms[vRoom]) delete voiceRooms[vRoom][socket.peerId];
         socket.to('voice-' + vRoom).emit('voice-user-left', {
            peerId: socket.peerId,
            username: socket.username,
            roomId: vRoom
         });
         io.emit('voice-rooms-state', voiceRooms);
      }

      if (socket.userId && userSockets[socket.userId] === socket.id) {
         delete userSockets[socket.userId];
      }

      const stillConnected = socket.userId && userSockets[socket.userId];
      if (socket.userId && allTimeUsers[socket.userId] && !stillConnected && isFixtureAccount(usersDb[socket.userId])) {
         delete allTimeUsers[socket.userId];
         io.emit('global-users', allTimeUsers);
      } else if (socket.userId && allTimeUsers[socket.userId] && !stillConnected) {
         allTimeUsers[socket.userId].isOnline = false;
         allTimeUsers[socket.userId].peerId = null;
         if (seenUsers[socket.userId]) {
            seenUsers[socket.userId].lastSeen = Date.now();
            seenUsers[socket.userId].username = allTimeUsers[socket.userId].username;
            seenUsers[socket.userId].avatar = allTimeUsers[socket.userId].avatar || '';
            seenUsers[socket.userId].isAdmin = !!allTimeUsers[socket.userId].isAdmin;
            saveSeenUsersLocally();
            persistSeenUserMongo(seenUsers[socket.userId]);
         }
         io.emit('global-users', allTimeUsers);
      }
   });
});

// Render'ın uygulamayı bulabilmesi için host ayarı 0.0.0.0 olarak güncellendi
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
   console.log(`Sunucu Başladı: Port ${PORT}`);
});
