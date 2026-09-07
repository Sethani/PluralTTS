import { REST, Routes } from 'discord.js';
import { loadConfig } from './config.js';
import { commands } from './commands.js';
import { logger } from './logger.js';

const config = loadConfig();
const rest = new REST({ version: '10' }).setToken(config.discord.token);

if (config.discord.guildId) {
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body: commands });
  logger.info({ guildId: config.discord.guildId }, 'Registered guild slash commands');
} else {
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
  logger.info('Registered global slash commands');
}
