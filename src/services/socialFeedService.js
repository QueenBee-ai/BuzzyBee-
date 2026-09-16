import axios from 'axios';
import { logger } from './utils/logger.js';

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

function feedKey(guildId) {
  return `guild:${guildId}:social_feeds`;
}

function unwrap(value) {
  if (value && typeof value === 'object' && 'data' in value && Object.keys(value).length <= 3) {
    return value.data;
  }
  return value;
}

function normalizeFeeds(value) {
  const feeds = unwrap(value);
  return Array.isArray(feeds) ? feeds : [];
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value = '') {
  return escapeXml(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function firstMatch(text, expressions) {
  for (const expression of expressions) {
    const match = text.match(expression);
    if (match?.[1]) return escapeXml(match[1]);
  }
  return null;
}

async function resolveFeedUrl(inputUrl) {
  const parsed = new URL(inputUrl);

  if (parsed.hostname === 'youtube.com' || parsed.hostname.endsWith('.youtube.com')) {
    if (parsed.pathname === '/feeds/videos.xml' && parsed.searchParams.get('channel_id')) {
      return inputUrl;
    }

    const channelMatch = parsed.pathname.match(/\/channel\/(UC[\w-]+)/i);
    if (channelMatch?.[1]) {
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`;
    }

    const response = await axios.get(inputUrl, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'BuzzyBee/1.0 (+social-feed)' },
    });
    const channelId = firstMatch(response.data, [
      /<meta[^>]+itemprop=["']channelId["'][^>]+content=["'](UC[\w-]+)["']/i,
      /"channelId":"(UC[\w-]+)"/i,
      /"externalId":"(UC[\w-]+)"/i,
    ]);

    if (channelId) {
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    }

    throw new Error('Der YouTube-Kanal konnte nicht erkannt werden. Nutze am besten einen /channel/UC...-Link.');
  }

  if (parsed.pathname.endsWith('.xml') || parsed.pathname.endsWith('.rss') || parsed.pathname.endsWith('.atom')) {
    return inputUrl;
  }

  throw new Error('Unterstützt werden YouTube-Kanäle sowie RSS-/Atom-Feed-Links.');
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(entry|item)\b[\s\S]*?<\/\1>/gi) || [];

  for (const block of blocks) {
    const id = firstMatch(block, [
      /<yt:videoId[^>]*>([^<]+)<\/yt:videoId>/i,
      /<guid[^>]*>([^<]+)<\/guid>/i,
      /<id[^>]*>([^<]+)<\/id>/i,
      /<link[^>]+href=["']([^"']+)["']/i,
      /<link[^>]*>([^<]+)<\/link>/i,
    ]);

    const title = firstMatch(block, [
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) || 'Neuer Upload';

    const published = firstMatch(block, [
      /<published[^>]*>([^<]+)<\/published>/i,
      /<updated[^>]*>([^<]+)<\/updated>/i,
      /<pubDate[^>]*>([^<]+)<\/pubDate>/i,
    ]);

    const link = firstMatch(block, [
      /<link[^>]+href=["']([^"']+)["']/i,
      /<link[^>]*>([^<]+)<\/link>/i,
    ]) || id;

    if (id && link) {
      items.push({
        id,
        title: stripTags(title),
        link,
        publishedAt: published ? new Date(published).toISOString() : new Date(0).toISOString(),
      });
    }
  }

  return items
    .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
    .slice(-10);
}

async function fetchLatestItems(url) {
  const feedUrl = await resolveFeedUrl(url);
  const response = await axios.get(feedUrl, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
  });
  const items = parseFeed(response.data);
  if (items.length === 0) throw new Error('Im Feed wurden keine Uploads gefunden.');
  return { feedUrl, items };
}

export async function getSocialFeeds(client, guildId) {
  if (!client.db?.get) return [];
  return normalizeFeeds(await client.db.get(feedKey(guildId), []));
}

export async function saveSocialFeed(client, guildId, input) {
  if (!client.db?.get || !client.db?.set) {
    throw new Error('Die Datenbank ist nicht verfügbar.');
  }

  const feeds = await getSocialFeeds(client, guildId);
  const id = `${guildId}:${input.channelId}`;
  const existing = feeds.find(feed => feed.id === id);
  const next = {
    id,
    guildId,
    url: input.url,
    channelId: input.channelId,
    roleId: input.roleId,
    lastItemId: existing?.lastItemId || null,
    createdBy: input.createdBy || existing?.createdBy || null,
    updatedAt: new Date().toISOString(),
  };

  const updated = [...feeds.filter(feed => feed.id !== id), next];
  await client.db.set(feedKey(guildId), updated);
  return next;
}

async function checkFeed(client, feed) {
  const { items } = await fetchLatestItems(feed.url);
  const newest = items[items.length - 1];

  if (!feed.lastItemId) {
    feed.lastItemId = newest.id;
    return { feed, changed: true };
  }

  const lastIndex = items.findIndex(item => item.id === feed.lastItemId);
  const newItems = lastIndex >= 0 ? items.slice(lastIndex + 1) : [newest];

  const channel = await client.channels.fetch(feed.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { feed, changed: false };

  const validItems = newItems.filter(item => item.id !== feed.lastItemId).slice(-5);
  for (const item of validItems) {
    await channel.send({
      content: `<@&${feed.roleId}>`,
      embeds: [{
        title: item.title.slice(0, 256),
        url: item.link,
        description: '📢 Neuer Upload!',
        color: 0xF4C542,
        timestamp: item.publishedAt,
      }],
      allowedMentions: { roles: [feed.roleId] },
    });
    feed.lastItemId = item.id;
  }

  return { feed, changed: validItems.length > 0 };
}

let watcherStarted = false;

export function startSocialFeedWatcher(client) {
  if (watcherStarted) return;
  watcherStarted = true;

  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      const feeds = await getSocialFeeds(client, guild.id);
      let changed = false;

      for (const feed of feeds) {
        try {
          const result = await checkFeed(client, feed);
          changed ||= result.changed;
        } catch (error) {
          logger.warn(`Social feed ${feed.id} konnte nicht geprüft werden: ${error.message}`);
        }
      }

      if (changed) await client.db.set(feedKey(guild.id), feeds);
    }
  };

  run().catch(error => logger.warn(`Social-Feed-Initialisierung fehlgeschlagen: ${error.message}`));
  setInterval(() => run().catch(error => logger.warn(`Social-Feed-Prüfung fehlgeschlagen: ${error.message}`)), POLL_INTERVAL_MS);
}
