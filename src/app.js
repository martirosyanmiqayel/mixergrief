import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FORM, validate } from './form-config.js';
import { postApplication } from './discord.js';
import { sign, unsign, parseCookies, setCookie, clearCookie } from './sign.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISCORD_API = 'https://discord.com/api';
const COOLDOWN_MS = 5 * 60 * 1000;

const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = process.env;

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

function currentUser(req) {
  return unsign(parseCookies(req).session);
}

// ── OAuth ──
app.get('/api/login', (req, res) => {
  if (!DISCORD_CLIENT_ID) return res.redirect('/?error=config');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'oauth_state', sign(state), { maxAge: 600 });
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent',
  });
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const saved = unsign(parseCookies(req).oauth_state);
  clearCookie(res, 'oauth_state');
  if (!code || !state || state !== saved) return res.redirect('/?error=auth');

  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const token = await tokenRes.json();

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    const u = await userRes.json();

    const user = {
      id: u.id,
      tag: u.discriminator && u.discriminator !== '0' ? `${u.username}#${u.discriminator}` : u.username,
      username: u.username,
      avatar: u.avatar,
    };
    setCookie(res, 'session', sign(user), { maxAge: 60 * 60 * 24 });
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=auth');
  }
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user });
});

app.post('/api/logout', (req, res) => {
  clearCookie(res, 'session');
  res.json({ ok: true });
});

// ── Диагностика окружения (только наличие, без значений секретов) ──
app.get('/api/health', (req, res) => {
  const has = (k) => Boolean(process.env[k]?.trim());
  res.json({
    ok: true,
    onVercel: Boolean(process.env.VERCEL),
    env: {
      DISCORD_CLIENT_ID: has('DISCORD_CLIENT_ID'),
      DISCORD_CLIENT_SECRET: has('DISCORD_CLIENT_SECRET'),
      DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || null,
      DISCORD_BOT_TOKEN: has('DISCORD_BOT_TOKEN'),
      DISCORD_CHANNEL_ID: has('DISCORD_CHANNEL_ID'),
      DISCORD_PING_ROLE_ID: has('DISCORD_PING_ROLE_ID'),
      SESSION_SECRET: has('SESSION_SECRET'),
    },
  });
});

// ── Форма ──
app.get('/api/form', (req, res) => res.json(FORM));

app.post('/api/submit', async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Войдите через Discord.' });

  const cd = unsign(parseCookies(req).cd);
  if (typeof cd === 'number' && Date.now() - cd < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (Date.now() - cd)) / 60000);
    return res.status(429).json({ error: `Вы уже отправляли заявку. Попробуйте через ~${wait} мин.` });
  }

  const { ok, errors, clean } = validate(req.body || {});
  if (!ok) return res.status(400).json({ errors });

  const code = crypto.randomBytes(4).toString('hex');
  try {
    await postApplication({ code, user, answers: clean });
  } catch (err) {
    console.error('Discord post error:', err);
    return res.status(502).json({ error: 'Не удалось отправить заявку в Discord. Попробуйте позже.' });
  }

  setCookie(res, 'cd', sign(Date.now()), { maxAge: COOLDOWN_MS / 1000 });
  res.json({ ok: true, code });
});

// ── Статика ──
app.use(express.static(`${__dirname}/../public`));

export default app;
