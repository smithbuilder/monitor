/**
 * Register slash commands with Discord.
 * Run once: node register-commands.js
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN
 *   DISCORD_CLIENT_ID
 */

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('mm-status')
    .setDescription('Full server status overview'),

  new SlashCommandBuilder()
    .setName('mm-disk')
    .setDescription('Disk usage breakdown'),

  new SlashCommandBuilder()
    .setName('mm-docker')
    .setDescription('Docker container status'),

  new SlashCommandBuilder()
    .setName('mm-services')
    .setDescription('HTTP health check all services'),

  new SlashCommandBuilder()
    .setName('mm-logs')
    .setDescription('View recent logs for a service')
    .addStringOption(option =>
      option
        .setName('service')
        .setDescription('Service to check')
        .setRequired(true)
        .addChoices(
          { name: 'Project Manager', value: 'projectmanager' },
          { name: 'Coral Money Manager', value: 'coral' },
          { name: 'SmithBuilder', value: 'smithbuilder' },
          { name: 'Mission Control', value: 'missioncontrol' },
          { name: 'Penpot', value: 'penpot' },
          { name: 'OpenRouter Log Viewer', value: 'logviewer' },
          { name: 'Homebase', value: 'homebase' },
          { name: 'Project Coach', value: 'coach' },
          { name: 'Ollama', value: 'ollama' },
          { name: 'OpenClaw Gateway', value: 'openclaw' },
        )
    ),

  new SlashCommandBuilder()
    .setName('mm-cleanup')
    .setDescription('Run Docker cleanup (prune images, containers, build cache)'),
].map(cmd => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands...`);
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
        { body: commands },
      );
      console.log(`Registered as guild commands for server ${guildId} (instant).`);
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands },
      );
      console.log('Registered as global commands (may take up to 1 hour).');
    }
    console.log('Commands registered successfully.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
})();
