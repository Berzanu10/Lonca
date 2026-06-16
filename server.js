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
               process.env[key] = cleanValue;
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
   }
});

const { ExpressPeerServer } = require('peer');

// PeerJS için CORS ayarları eklendi
const peerServer = ExpressPeerServer(server, {
   debug: true,
   path: '/',
   corsOptions: { origin: '*' }
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

// AUTH MIDDLEWARE
function authenticateToken(req, res, next) {
   const authHeader = req.headers.authorization;
   const token = authHeader && authHeader.split(' ')[1];
   if (!token) return res.status(401).json({ error: 'Token bulunamadı.' });

   const payload = verifyToken(token);
   if (!payload) return res.status(403).json({ error: 'Geçersiz veya süresi dolmuş token.' });

   req.user = payload;
   next();
}

// GET CURRENT USER (/api/auth/me)
app.get('/api/auth/me', (req, res) => {
   const authHeader = req.headers.authorization;
   const token = authHeader && authHeader.split(' ')[1];
   if (!token) return res.status(401).json({ error: 'Token bulunamadı.' });

   const payload = verifyToken(token);
   if (!payload) return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });

   const user = usersDb[payload.userId];
   if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

   if (user.email === 'berzanu10@gmail.com' && !user.isAdmin) {
      user.isAdmin = true;
      saveUsers();
   }

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
   const user = usersDb[userId];
   if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
   res.json({
      success: true,
      user: {
         id: user.id,
         username: user.username,
         avatar: user.avatar || '',
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

// Load messages history on start
try {
   if (fs.existsSync(MESSAGES_FILE)) {
      const fileContent = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messageHistory = JSON.parse(fileContent);
      let dirty = false;
      for (let r in textRooms) {
         if (!messageHistory[r]) messageHistory[r] = [];
         messageHistory[r].forEach(msg => {
            if (!msg.id) {
               msg.id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
               dirty = true;
            }
         });
      }
      if (dirty) {
         saveMessages();
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

function saveMessages() {
   try {
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messageHistory, null, 2), 'utf8');
   } catch (err) {
      console.error("Mesajlar kaydedilirken hata oluştu:", err);
   }
}

const allTimeUsers = {};

// Sunucu başlarken tüm kayıtlı kullanıcıları offline olarak yükle
// Böylece hiç bağlanmamış kullanıcılar da sağ panelde görünür
function initAllTimeUsersFromDb() {
   for (const uId in usersDb) {
      const u = usersDb[uId];
      if (!allTimeUsers[uId]) {
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
}
initAllTimeUsersFromDb();
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

      allTimeUsers[uId] = {
         username: finalUsername,
         isOnline: true,
         peerId: peerId,
         userId: uId,
         avatar: finalAvatar,
         isAdmin: isAdmin
      };

      io.emit('global-users', allTimeUsers);
      socket.emit('voice-rooms-state', voiceRooms);
      socket.emit('admin-status', isAdmin);
      socket.emit('channels-list', { text: Object.keys(textRooms), voice: Object.keys(voiceRooms) });
      // Yeni kullanıcının güncel listesini al
      socket.emit('global-users', allTimeUsers);
   });

   // METİN
   socket.on('join-text-room', (roomId) => {
      if (socket.textRoom) {
         socket.leave('text-' + socket.textRoom);
         if (textRooms[socket.textRoom]) delete textRooms[socket.textRoom][socket.peerId];
      }
      socket.textRoom = roomId;
      if (!textRooms[roomId]) textRooms[roomId] = {};
      textRooms[roomId][socket.peerId] = socket.username;
      socket.join('text-' + roomId);

      // Emit chat history to user
      if (!messageHistory[roomId]) {
         messageHistory[roomId] = [];
         saveMessages();
      }
      socket.emit('chat-history', messageHistory[roomId]);
   });

   socket.on('chat-message', (message) => {
      if (socket.textRoom && socket.username) {
         const roomId = socket.textRoom;
         const msgObj = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            sender: socket.username,
            text: message,
            timestamp: Date.now()
         };

         if (!messageHistory[roomId]) messageHistory[roomId] = [];
         messageHistory[roomId].push(msgObj);

         if (messageHistory[roomId].length > 100) {
            messageHistory[roomId].shift();
         }

         saveMessages();

         io.to('text-' + roomId).emit('create-message', message, socket.username, msgObj.id);

         if (roomId.startsWith('dm_')) {
            const parts = roomId.split('_');
            const targetUserId = parts[1] === socket.userId ? parts[2] : parts[1];
            const targetSocketId = userSockets[targetUserId];
            if (targetSocketId) {
               io.to(targetSocketId).emit('dm-received', {
                  senderId: socket.userId,
                  senderName: socket.username,
                  message: message,
                  roomId: roomId
               });
            }
         }
      }
   });

   socket.on('delete-message', (msgId) => {
      if (!socket.isAdmin) return;
      let deleted = false;
      for (let room in messageHistory) {
         const index = messageHistory[room].findIndex(m => m.id === msgId);
         if (index !== -1) {
            messageHistory[room].splice(index, 1);
            deleted = true;
            break;
         }
      }
      if (deleted) {
         saveMessages();
         io.emit('message-deleted', msgId);
      }
   });

   // SES ODASI GİRİŞ KONTROLLERİ VE DONANIM BİLGİSİ YAYINI
   socket.on('join-voice-room', (roomId) => {
      if (socket.voiceRoom) {
         socket.leave('voice-' + socket.voiceRoom);
         if (voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
      }

      socket.voiceRoom = roomId;
      if (roomId) {
         if (!voiceRooms[roomId]) voiceRooms[roomId] = {};

         socket.emit('voice-join-success', voiceRooms[roomId]);

         // Artık odada sadece ismimizi değil, donanım (mikrofon/kulaklık) verimizi de tutuyoruz!
         voiceRooms[roomId][socket.peerId] = {
            username: socket.username,
            mic: socket.voiceState.mic,
            deaf: socket.voiceState.deaf,
            avatar: socket.avatar || ''
         };

         socket.join('voice-' + roomId);
      }
      io.emit('voice-rooms-state', voiceRooms);
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

      // allTimeUsers'dan sil
      if (allTimeUsers[targetUserId]) {
         delete allTimeUsers[targetUserId];
      }

      io.emit('global-users', allTimeUsers);
   });

   socket.on('pin-message', (msgId) => {
      let roomId = socket.textRoom;
      if (!roomId) return;
      const msg = messageHistory[roomId].find(m => m.id === msgId);
      if (msg) {
         msg.pinned = !msg.pinned;
         saveMessages();
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
            saveMessages();
            io.to('text-' + roomId).emit('create-message', sysMsg.text, sysMsg.sender, sysMsg.id, sysMsg.isSystem);
         } else {
            // Unpinned! Find and remove the linked system message
            const sysIndex = messageHistory[roomId].findIndex(m => m.isSystem && m.pinnedMsgId === msgId);
            if (sysIndex !== -1) {
               const sysMsgId = messageHistory[roomId][sysIndex].id;
               messageHistory[roomId].splice(sysIndex, 1);
               saveMessages();
               io.to('text-' + roomId).emit('message-deleted', sysMsgId);
            }
         }
      }
   });

   socket.on('bulk-delete-messages', (msgIds) => {
      if (!socket.isAdmin) return;
      let roomId = socket.textRoom;
      if (!roomId || !Array.isArray(msgIds)) return;
      messageHistory[roomId] = messageHistory[roomId].filter(m => !msgIds.includes(m.id));
      saveMessages();
      io.to('text-' + roomId).emit('messages-bulk-deleted', msgIds);
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
         if (voiceRooms[socket.voiceRoom]) delete voiceRooms[socket.voiceRoom][socket.peerId];
         io.emit('voice-rooms-state', voiceRooms);
      }

      if (socket.userId && userSockets[socket.userId] === socket.id) {
         delete userSockets[socket.userId];
      }

      if (socket.userId && allTimeUsers[socket.userId]) {
         allTimeUsers[socket.userId].isOnline = false;
         io.emit('global-users', allTimeUsers);
      }
   });
});

// Render'ın uygulamayı bulabilmesi için host ayarı 0.0.0.0 olarak güncellendi
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
   console.log(`Sunucu Başladı: Port ${PORT}`);
});