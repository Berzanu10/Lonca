'use strict';
// Kimlik doğrulama yardımcıları: şifre hash, JWT, hız sınırlayıcı (server.js'ten ayrıldı)
const crypto = require('crypto');

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 gün

// CRYPTO HELPERS FOR PASSWORDS
const PBKDF2_ITERATIONS = 120000;

function hashPassword(password) {
   const salt = crypto.randomBytes(16).toString('hex');
   const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
   return `v2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function safeEqualStr(a, b) {
   const ba = Buffer.from(String(a));
   const bb = Buffer.from(String(b));
   return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function verifyPassword(password, storedPassword) {
   if (!storedPassword || typeof password !== 'string') return false;
   if (storedPassword.startsWith('v2$')) {
      const [, iter, salt, hash] = storedPassword.split('$');
      const verifyHash = crypto.pbkdf2Sync(password, salt, parseInt(iter, 10), 64, 'sha512').toString('hex');
      return safeEqualStr(hash, verifyHash);
   }
   // Eski format (salt:hash, 1000 iterasyon) — mevcut kullanıcılar giriş yapabilsin
   if (!storedPassword.includes(':')) return false;
   const [salt, hash] = storedPassword.split(':');
   const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
   return safeEqualStr(hash, verifyHash);
}

// PURE NODE.JS JWT SYSTEM (ZERO DEPENDENCIES)
// JWT_SECRET tanımlı değilse tahmin edilebilir sabit anahtar yerine rastgele (yeniden başlatmada oturumlar düşer) kullan
const JWT_SECRET = process.env.JWT_SECRET || (() => {
   console.warn('[GÜVENLİK] JWT_SECRET tanımlı değil! Rastgele geçici anahtar kullanılıyor.');
   return crypto.randomBytes(48).toString('hex');
})();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RENDER_EXTERNAL_URL;

function generateToken(payload) {
   payload = Object.assign({ exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS }, payload);
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
      if (!safeEqualStr(signature, validSignature)) return null;
      const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      // exp yoksa (eski token) kabul edilir ve /api/auth/me ile yenilenir
      if (data && data.exp && data.exp * 1000 < Date.now()) return null;
      return data;
   } catch (e) {
      return null;
   }
}


// Basit bellek içi hız sınırlayıcı (kaba kuvvet denemelerine karşı)
const rateBuckets = new Map();
function rateLimit(maxHits, windowMs) {
   return (req, res, next) => {
      const key = req.path + '|' + (req.ip || '');
      const now = Date.now();
      const b = rateBuckets.get(key);
      if (!b || b.reset < now) { rateBuckets.set(key, { hits: 1, reset: now + windowMs }); return next(); }
      b.hits++;
      if (b.hits > maxHits) return res.status(429).json({ error: 'Çok fazla deneme. Lütfen biraz bekleyin.' });
      next();
   };
}
setInterval(() => { const n = Date.now(); for (const [k, b] of rateBuckets) if (b.reset < n) rateBuckets.delete(k); }, 10 * 60 * 1000).unref();

module.exports = {
   IS_PRODUCTION,
   SESSION_MAX_AGE_SECONDS,
   hashPassword,
   verifyPassword,
   safeEqualStr,
   generateToken,
   verifyToken,
   rateLimit
};
