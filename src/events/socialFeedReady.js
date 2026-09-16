import { Events } from 'discord.js';
import { startSocialFeedWatcher } from '../services/socialFeedService.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(_readyClient, client) {
    startSocialFeedWatcher(client);
  },
};
