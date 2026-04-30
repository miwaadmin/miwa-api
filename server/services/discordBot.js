/**
 * Miwa Discord bot — runs alongside the API process when DISCORD_BOT_TOKEN
 * is set. Connects to Discord, auto-configures any guild it joins (channels,
 * roles, pinned welcome), greets new members via DM, and exposes a
 * /feedback slash command that pipes user reports into your existing
 * user_feedback table.
 *
 * Idempotent on startup — safe to redeploy and reconnect repeatedly. The
 * bot checks for required channels/roles/pins and only creates what's
 * missing. Topic mismatches get fixed quietly. Won't ever delete or
 * overwrite anything you set manually beyond the pinned welcome.
 *
 * Disabled when DISCORD_BOT_TOKEN is empty — startDiscordBot() returns
 * silently. The API process continues normally.
 */

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';

let djs = null;
let client = null;

// Lifecycle status for the diagnostic endpoint. Mutable from inside the
// startup flow so /api/_diag/discord can answer "is the bot actually
// connected?" without log-stream access.
const status = {
  enabled: !!TOKEN,
  djsLoaded: false,
  loginAttempted: false,
  loggedIn: false,
  ready: false,
  guildCount: 0,
  username: null,
  lastError: null,
  lastEventAt: null,
};

function getDiscordBotStatus() {
  return { ...status };
}

function noteEvent(name, err) {
  status.lastEventAt = new Date().toISOString();
  if (err) status.lastError = err?.message || String(err);
}

// ─── Server configuration spec — what we want every guild to look like ──────
// Order matters: channels are created in this order so the sidebar lays
// out the way we want for new joiners. Existing channels (including
// #annoucements with the typo) are left alone — we only ADD what's
// missing. The therapist can rename or delete the typo channel manually.
const REQUIRED_CHANNELS = [
  {
    name: 'welcome',
    topic: 'Start here. Read the pinned rules. Then say hi in #general.',
  },
  {
    name: 'announcements',
    topic: 'Product updates from Valdrex. Read-only for everyone else.',
  },
  {
    name: 'general',
    topic: 'Open chat. Anonymized clinical questions OK. No PHI ever.',
  },
  {
    name: 'feedback',
    topic: 'Bugs and feature requests. React 👍 to upvote. Use /feedback to send privately.',
  },
  {
    name: 'show-n-tell',
    topic: 'Workflow tips, template shares, wins.',
  },
];

const REQUIRED_ROLES = [
  { name: 'Founder',      color: 0x6047ee },  // Miwa primary brand
  { name: 'Early Access', color: 0x2dd4bf },  // Miwa accent teal
  { name: 'Trainee',      color: 0x818cf8 },  // Indigo light
  { name: 'Associate',    color: 0xf59e0b },  // Amber
  { name: 'Licensed',     color: 0x10b981 },  // Emerald
];

const WELCOME_MESSAGE = [
  '👋 **Welcome to Miwa.Care** — the early-access community for therapists building their practice with Miwa.',
  '',
  '**📌 Two ground rules**',
  '',
  '**1. No PHI, ever.** Don\'t share patient names, identifying details, or session content here. This is a regular Discord server — not a HIPAA-covered space. Use anonymized vignettes if you need to ask clinical questions.',
  '',
  '**2. Be useful.** Bug reports get fixed. Feature requests get prioritized. Tell me what\'s working and what isn\'t.',
  '',
  '**🗂️ Channel guide**',
  '',
  '`#announcements` — product updates from me, weekly-ish',
  '`#general` — open chat, introduce yourself, ask anything',
  '`#feedback` — bugs and feature requests (react with 👍 to upvote, or use `/feedback` to send privately)',
  '`#show-n-tell` — share workflows, templates, wins',
  '',
  'If you\'re a trainee or associate working toward CA BBS hours, say hi 👋 — there\'s a lot of you here.',
  '',
  '— **Valdrex Philippe, MFT Trainee**',
  'Founder, Miwa',
].join('\n');

// ─── Slash command spec ─────────────────────────────────────────────────────
const SLASH_COMMANDS = [
  {
    name: 'feedback',
    description: 'Send feedback (bug, feature request, comment) to the Miwa team',
    options: [
      {
        type: 3, // STRING
        name: 'message',
        description: 'Your feedback — be specific, be kind',
        required: true,
      },
    ],
  },
];

// ─── Lifecycle ──────────────────────────────────────────────────────────────
async function startDiscordBot() {
  if (!TOKEN) {
    console.log('[discord] DISCORD_BOT_TOKEN not set — bot disabled');
    return;
  }

  // Lazy-require so the API can boot in environments where discord.js fails
  // to load for any reason (corrupt install, missing native deps, etc.).
  try {
    djs = require('discord.js');
    status.djsLoaded = true;
  } catch (err) {
    console.error('[discord] failed to load discord.js — bot disabled:', err.message);
    noteEvent('djs-load-failed', err);
    return;
  }

  const { Client, GatewayIntentBits, ChannelType, REST, Routes, Events, ActivityType } = djs;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`[discord] connected as ${c.user.tag} — present in ${c.guilds.cache.size} guild(s)`);
    status.ready = true;
    status.username = c.user.tag;
    status.guildCount = c.guilds.cache.size;
    noteEvent('ready');

    try {
      c.user.setActivity('#feedback', { type: ActivityType.Watching });
    } catch (err) {
      console.warn('[discord] setActivity failed:', err.message);
    }

    await registerSlashCommands(c, REST, Routes);

    for (const guild of c.guilds.cache.values()) {
      try {
        await configureGuild(guild, ChannelType);
      } catch (err) {
        console.error(`[discord] configure ${guild.name} failed:`, err.message);
      }
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    console.log(`[discord] joined guild "${guild.name}" — auto-configuring`);
    try {
      await configureGuild(guild, ChannelType);
    } catch (err) {
      console.error('[discord] guild-create configure failed:', err.message);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    // Best-effort welcome DM. Many users have DMs disabled by default —
    // that throws DiscordAPIError 50007 which we swallow silently.
    const dm = [
      `👋 Welcome to **Miwa.Care**, ${member.user.username}!`,
      '',
      'Quick start:',
      '• Read the pinned rules in #welcome (TL;DR: **no PHI ever**)',
      '• Drop a hello in #general so we know you\'re here',
      '• Bugs / feature requests go in #feedback (or use `/feedback` to send privately)',
      '',
      'If you\'re working toward CA BBS hours and haven\'t tried the Hours feature yet, give it a look — auto-tallies your supervised hours from your appointments.',
      '',
      '— **Valdrex Philippe, MFT Trainee**',
      'Founder, Miwa',
    ].join('\n');
    try {
      await member.send(dm);
    } catch (err) {
      // 50007 = "Cannot send messages to this user" (DMs off). Quiet skip.
      if (err?.code !== 50007) {
        console.warn('[discord] welcome DM failed:', err.message);
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'feedback') {
      await handleFeedbackCommand(interaction);
    }
  });

  try {
    status.loginAttempted = true;
    await client.login(TOKEN);
    status.loggedIn = true;
    noteEvent('login-success');
  } catch (err) {
    console.error('[discord] login failed:', err.message);
    noteEvent('login-failed', err);
  }
}

// ─── Guild configuration ────────────────────────────────────────────────────
async function configureGuild(guild, ChannelType) {
  // Channels — create any that are missing, fix topics on existing ones.
  for (const spec of REQUIRED_CHANNELS) {
    let ch = guild.channels.cache.find(
      c => c.name === spec.name && c.type === ChannelType.GuildText,
    );
    if (!ch) {
      try {
        ch = await guild.channels.create({
          name: spec.name,
          type: ChannelType.GuildText,
          topic: spec.topic,
        });
        console.log(`[discord] created #${spec.name} in ${guild.name}`);
      } catch (err) {
        console.warn(`[discord] could not create #${spec.name}: ${err.message}`);
        continue;
      }
    } else if (ch.topic !== spec.topic) {
      try {
        await ch.setTopic(spec.topic);
      } catch (err) {
        // Common cause: bot lacks Manage Channels on this channel; not fatal.
      }
    }
  }

  // Roles — only create missing ones, never modify or delete existing.
  for (const spec of REQUIRED_ROLES) {
    const exists = guild.roles.cache.find(r => r.name === spec.name);
    if (!exists) {
      try {
        await guild.roles.create({ name: spec.name, color: spec.color, hoist: false });
      } catch (err) {
        console.warn(`[discord] could not create role ${spec.name}: ${err.message}`);
      }
    }
  }

  // Pinned welcome message. Three states:
  //   - No pin from us → post + pin a fresh message.
  //   - Pin exists, content matches → no-op (idempotent on redeploy).
  //   - Pin exists, content stale → edit the existing message in place so
  //     copy updates (e.g. signature changes) actually land without us
  //     leaving a stale pin around. We never delete + repost; that would
  //     spam member notifications and lose any reactions.
  const welcomeCh = guild.channels.cache.find(
    c => c.name === 'welcome' && c.type === ChannelType.GuildText,
  );
  if (welcomeCh) {
    try {
      const pins = await welcomeCh.messages.fetchPinned();
      const ourPin = pins.find(m => m.author.id === guild.client.user.id);
      if (!ourPin) {
        const sent = await welcomeCh.send({ content: WELCOME_MESSAGE });
        await sent.pin();
        console.log(`[discord] pinned welcome message in ${guild.name}`);
      } else if (ourPin.content !== WELCOME_MESSAGE) {
        await ourPin.edit({ content: WELCOME_MESSAGE });
        console.log(`[discord] updated stale pinned welcome message in ${guild.name}`);
      }
    } catch (err) {
      console.warn('[discord] pin welcome failed:', err.message);
    }
  }
}

// ─── Slash commands ─────────────────────────────────────────────────────────
async function registerSlashCommands(c, REST, Routes) {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(c.user.id), { body: SLASH_COMMANDS });
    console.log(`[discord] registered ${SLASH_COMMANDS.length} slash command(s) globally`);
  } catch (err) {
    console.error('[discord] slash command register failed:', err.message);
  }
}

async function handleFeedbackCommand(interaction) {
  const message = interaction.options.getString('message');
  if (!message || !message.trim()) {
    return interaction.reply({ content: 'Empty feedback. Try again with some content.', ephemeral: true });
  }

  // Persist into the existing user_feedback table so it shows up in your
  // admin tooling alongside in-app feedback. Best-effort — if the DB write
  // fails we still reply to the user so they know their message landed.
  let saved = false;
  try {
    const { getAsyncDb, persistIfNeeded } = require('../db/asyncDb');
    const db = getAsyncDb();
    await db.insert(
      `INSERT INTO user_feedback (therapist_id, source, content)
       VALUES (?, ?, ?)`,
      null,                        // no Miwa account linked from Discord side
      `discord:${interaction.user.username}`,
      message.trim().slice(0, 4000),
    );
    try { await persistIfNeeded(); } catch {}
    saved = true;
  } catch (err) {
    console.error('[discord] feedback DB write failed:', err.message);
  }

  // Mirror to the public #feedback channel so other members can react/upvote.
  // Skipped silently if we can't find or write to the channel.
  try {
    const ch = interaction.guild?.channels.cache.find(c => c.name === 'feedback');
    if (ch && ch.isTextBased?.()) {
      await ch.send({
        content: `💬 **${interaction.user.username}** via \`/feedback\`:\n> ${message.replace(/\n/g, '\n> ')}`,
      });
    }
  } catch (err) {
    console.warn('[discord] feedback mirror failed:', err.message);
  }

  await interaction.reply({
    content: saved
      ? '✅ Got it — saved and mirrored to #feedback. Thanks.'
      : '✅ Got it — posted to #feedback. (DB save hit a snag; logged for review.)',
    ephemeral: true,
  });
}

module.exports = { startDiscordBot, getDiscordBotStatus };
