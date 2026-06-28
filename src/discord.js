import { FORM } from './form-config.js';

const API = 'https://discord.com/api/v10';
const COLOR = 0xd4843d;

// ── Отправка заявки в канал через Discord REST (работает на serverless) ──
export async function postApplication({ code, user, answers }) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_CHANNEL_ID?.trim();
  if (!token) throw new Error('DISCORD_BOT_TOKEN не задан');
  if (!channelId) throw new Error('DISCORD_CHANNEL_ID не задан');

  const roleId = process.env.DISCORD_PING_ROLE_ID?.trim();

  const body = {
    content: roleId ? `<@&${roleId}> Новая заявка в команду!` : '📨 Новая заявка в команду!',
    embeds: [buildEmbed({ code, user, answers })],
    allowed_mentions: roleId ? { roles: [roleId] } : { parse: [] },
  };

  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord REST ${res.status}: ${text}`);
  }
}

function buildEmbed({ code, user, answers }) {
  const avatar = avatarUrl(user);
  return {
    title: '📩 Заявка в Команду MixerGrief',
    color: COLOR,
    author: { name: user.tag, icon_url: avatar },
    thumbnail: { url: avatar },
    fields: [
      { name: '👤 Discord ник', value: user.tag, inline: true },
      { name: '🆔 Discord ID', value: user.id, inline: true },
      ...FORM.fields.map((f) => ({ name: f.label, value: truncate(answers[f.name] ?? '—') })),
    ],
    footer: { text: `Код заявки: ${code}` },
    timestamp: new Date().toISOString(),
  };
}

// Аватар пользователя; если своего нет — дефолтный аватар Discord.
function avatarUrl(user) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  let index = 0;
  try {
    index = Number((BigInt(user.id) >> 22n) % 6n);
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function truncate(str, max = 1024) {
  str = String(str);
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
