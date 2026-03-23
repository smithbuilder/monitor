/**
 * Mac Mini Monitor Discord Bot
 *
 * Provides slash commands for on-demand server health checks.
 * Runs directly on the Mac Mini for direct access to system metrics.
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN        — Bot token from Discord Developer Portal
 *   MONITORING_CHANNEL_ID    — Channel ID for hourly auto-posts (optional)
 *
 * Install:
 *   cd bot && npm install
 *   DISCORD_BOT_TOKEN=... DISCORD_CLIENT_ID=... node register-commands.js
 *   DISCORD_BOT_TOKEN=... node bot.js
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const os = require('os');
const { execSync } = require('child_process');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- Helpers ---

function exec(cmd, timeout = 10000) {
  try {
    return execSync(cmd, {
      timeout,
      env: { ...process.env, PATH: `/opt/orbstack/bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}` },
    }).toString().trim();
  } catch (e) {
    return e.stdout ? e.stdout.toString().trim() : `Error: ${e.message}`;
  }
}

function truncate(str, max = 1024) {
  if (str.length <= max) return str;
  return str.slice(0, max - 20) + '\n... (truncated)';
}

function codeBlock(str, lang = '') {
  const content = truncate(str, 1000);
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

// --- Service definitions ---
const SERVICES = [
  { name: 'OpenRouter Log Viewer', port: 3000, path: '/' },
  { name: 'Mission Control', port: 3001, path: '/' },
  { name: 'Project Manager', port: 3002, path: '/api/health' },
  { name: 'Homebase', port: 3003, path: '/api/health' },
  { name: 'Project Coach', port: 3004, path: '/' },
  { name: 'Coral Money Manager', port: 3005, path: '/api/health' },
  { name: 'SmithBuilder', port: 3010, path: '/' },
  { name: 'MC Backend', port: 8000, path: '/docs' },
  { name: 'Penpot', port: 9001, path: '/' },
];

// Map service choices to Docker container names or log paths
const LOG_SOURCES = {
  projectmanager: { type: 'docker', container: 'projectmanager-deploy-app-1' },
  coral: { type: 'docker', container: 'coral_moneymanager-nextjs-app-1' },
  smithbuilder: { type: 'docker', container: 'smithbuilder-app-1' },
  missioncontrol: { type: 'docker', container: 'openclaw-mission-control-frontend-1' },
  penpot: { type: 'docker', container: 'penpot-penpot-frontend-1' },
  logviewer: { type: 'file', path: '/tmp/openrouterlogviewer.log' },
  homebase: { type: 'file', path: '/tmp/homebase.log' },
  coach: { type: 'file', path: '/tmp/project-coach.log' },
  ollama: { type: 'file', path: '/opt/homebrew/var/log/ollama.log' },
  openclaw: { type: 'file', path: `${os.homedir()}/.openclaw/logs/gateway.log` },
};

// --- Command Handlers ---

async function handleStatus(interaction) {
  await interaction.deferReply();

  const uptimeSeconds = os.uptime();
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const mins = Math.floor((uptimeSeconds % 3600) / 60);
  const loadAvg = os.loadavg();

  // Disk
  const diskInfo = exec("df -h /System/Volumes/Data | tail -1");
  const diskParts = diskInfo.split(/\s+/);
  const diskPct = parseInt((diskParts[4] || '0').replace('%', ''), 10);

  // Memory (macOS vm_stat)
  const vmStat = exec('vm_stat');
  let memInfo = 'Unable to parse';
  const pageSize = parseInt(exec('sysctl -n hw.pagesize') || '4096', 10);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = Math.round((usedMem / totalMem) * 100);
  memInfo = `${(usedMem / 1024 / 1024 / 1024).toFixed(1)} / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB (${memPct}%)`;

  // Docker
  const dockerRunning = exec("docker ps -q 2>/dev/null | wc -l").trim();
  const dockerTotal = exec("docker ps -aq 2>/dev/null | wc -l").trim();

  // Ollama
  const ollamaStatus = exec("curl -s --max-time 3 http://127.0.0.1:11434/api/tags 2>/dev/null | head -c 1") === '{'
    ? 'Running' : 'Not responding';

  // Color based on health
  let color = 0x2ECC71; // green
  if (diskPct > 90 || memPct > 90) color = 0xE74C3C; // red
  else if (diskPct > 80 || memPct > 80) color = 0xF1C40F; // yellow

  const embed = new EmbedBuilder()
    .setTitle('Mac Mini Server Status')
    .setColor(color)
    .addFields(
      { name: 'Uptime', value: `${days}d ${hours}h ${mins}m`, inline: true },
      { name: 'Load (1/5/15)', value: loadAvg.map(l => l.toFixed(2)).join(' / '), inline: true },
      { name: 'Memory', value: memInfo, inline: true },
      { name: 'Disk', value: diskInfo || 'unknown', inline: false },
      { name: 'Docker', value: `${dockerRunning} / ${dockerTotal} containers running`, inline: true },
      { name: 'Ollama', value: ollamaStatus, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Mac Mini Monitor' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleDisk(interaction) {
  await interaction.deferReply();

  const diskOverview = exec('df -h /System/Volumes/Data');
  const dockerDf = exec('docker system df 2>/dev/null');

  // Top directories
  const topDirs = exec(`du -sh ~/Documents ~/Downloads ~/Library ~/coral_moneymanager ~/smithbuilder ~/projectmanager ~/openrouterlogviewer ~/project-coach 2>/dev/null | sort -rh | head -8`);

  const embed = new EmbedBuilder()
    .setTitle('Disk Usage')
    .setColor(0x3498DB)
    .addFields(
      { name: 'Filesystem', value: codeBlock(diskOverview), inline: false },
      { name: 'Docker', value: codeBlock(dockerDf), inline: false },
      { name: 'Top Directories', value: codeBlock(topDirs), inline: false },
    )
    .setTimestamp()
    .setFooter({ text: 'Mac Mini Monitor' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleDocker(interaction) {
  await interaction.deferReply();

  const containers = exec('docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null');

  const fields = [];
  for (const line of containers.split('\n')) {
    if (!line.trim()) continue;
    const [name, status, ports] = line.split('|');
    const isUp = (status || '').toLowerCase().includes('up');
    const emoji = isUp ? '\u{1F7E2}' : '\u{1F534}'; // green/red circle
    fields.push({
      name: `${emoji} ${name}`,
      value: `${status || 'Unknown'}${ports ? `\n${ports}` : ''}`,
      inline: true,
    });
  }

  if (fields.length === 0) {
    fields.push({ name: 'No containers', value: 'Docker may not be running', inline: false });
  }

  const embed = new EmbedBuilder()
    .setTitle('Docker Containers')
    .setColor(0x3498DB)
    .addFields(fields)
    .setTimestamp()
    .setFooter({ text: 'Mac Mini Monitor' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleServices(interaction) {
  await interaction.deferReply();

  const fields = [];
  let allOk = true;

  for (const svc of SERVICES) {
    const code = exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${svc.port}${svc.path}" 2>/dev/null`);
    const isOk = ['200', '301', '302', '307'].includes(code);
    if (!isOk) allOk = false;

    fields.push({
      name: `${isOk ? '\u{1F7E2}' : '\u{1F534}'} ${svc.name}`,
      value: `Port ${svc.port} — HTTP ${code}`,
      inline: true,
    });
  }

  // Also check Ollama
  const ollamaOk = exec("curl -s --max-time 3 http://127.0.0.1:11434/api/tags 2>/dev/null | head -c 1") === '{';
  fields.push({
    name: `${ollamaOk ? '\u{1F7E2}' : '\u{1F534}'} Ollama`,
    value: `Port 11434 — ${ollamaOk ? 'OK' : 'Not responding'}`,
    inline: true,
  });

  const embed = new EmbedBuilder()
    .setTitle(allOk ? 'All Services Operational' : 'Some Services Down')
    .setColor(allOk ? 0x2ECC71 : 0xE74C3C)
    .addFields(fields)
    .setTimestamp()
    .setFooter({ text: 'Mac Mini Monitor' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleLogs(interaction) {
  await interaction.deferReply();

  const service = interaction.options.getString('service');
  const source = LOG_SOURCES[service];

  if (!source) {
    await interaction.editReply('Unknown service.');
    return;
  }

  let logs;
  if (source.type === 'docker') {
    logs = exec(`docker logs ${source.container} --tail 25 2>&1`);
  } else {
    logs = exec(`tail -25 ${source.path} 2>&1`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`Logs: ${service}`)
    .setDescription(codeBlock(logs))
    .setColor(0x3498DB)
    .setTimestamp()
    .setFooter({ text: 'Mac Mini Monitor — last 25 lines' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleCleanup(interaction) {
  await interaction.deferReply();

  const beforeDf = exec('docker system df 2>/dev/null');

  exec('docker container prune -f --filter "until=24h" 2>/dev/null');
  exec('docker image prune -f --filter "until=168h" 2>/dev/null');
  exec('docker image prune -f 2>/dev/null');
  exec('docker builder prune -f --filter "until=168h" 2>/dev/null');
  exec('docker network prune -f 2>/dev/null');

  const afterDf = exec('docker system df 2>/dev/null');
  const diskFree = exec("df -h /System/Volumes/Data | tail -1 | awk '{print $4}'");

  const embed = new EmbedBuilder()
    .setTitle('Docker Cleanup Complete')
    .setColor(0x2ECC71)
    .addFields(
      { name: 'Before', value: codeBlock(beforeDf), inline: false },
      { name: 'After', value: codeBlock(afterDf), inline: false },
      { name: 'Disk Free', value: diskFree || 'unknown', inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Mac Mini Monitor' });

  await interaction.editReply({ embeds: [embed] });
}

// --- Event Handlers ---

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'status': await handleStatus(interaction); break;
      case 'disk': await handleDisk(interaction); break;
      case 'docker': await handleDocker(interaction); break;
      case 'services': await handleServices(interaction); break;
      case 'logs': await handleLogs(interaction); break;
      case 'cleanup': await handleCleanup(interaction); break;
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (error) {
    console.error(`Error handling /${interaction.commandName}:`, error);
    const reply = { content: `Error: ${error.message}`, ephemeral: true };
    if (interaction.deferred) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// --- Hourly Auto-Post ---

const HOURLY_INTERVAL = 60 * 60 * 1000; // 1 hour

async function postHourlyStatus() {
  const channelId = process.env.MONITORING_CHANNEL_ID;
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.warn(`Monitoring channel ${channelId} not found`);
    return;
  }

  try {
    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const loadAvg = os.loadavg();
    const diskInfo = exec("df -h /System/Volumes/Data | tail -1");
    const diskPct = parseInt((diskInfo.split(/\s+/)[4] || '0').replace('%', ''), 10);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPct = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const dockerRunning = exec("docker ps -q 2>/dev/null | wc -l").trim();

    let color = 0x2ECC71;
    if (diskPct > 90 || memPct > 90) color = 0xE74C3C;
    else if (diskPct > 80 || memPct > 80) color = 0xF1C40F;

    // Check services
    let downCount = 0;
    for (const svc of SERVICES) {
      const code = exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${svc.port}${svc.path}" 2>/dev/null`);
      if (!['200', '301', '302', '307'].includes(code)) downCount++;
    }

    const statusLine = downCount > 0
      ? `\u{1F534} ${downCount} service(s) down`
      : '\u{1F7E2} All services operational';

    const embed = new EmbedBuilder()
      .setTitle('Hourly Status')
      .setColor(color)
      .setDescription(statusLine)
      .addFields(
        { name: 'Uptime', value: `${days}d ${hours}h`, inline: true },
        { name: 'Load', value: loadAvg[0].toFixed(2), inline: true },
        { name: 'Memory', value: `${memPct}%`, inline: true },
        { name: 'Disk', value: `${diskPct}%`, inline: true },
        { name: 'Docker', value: `${dockerRunning} containers`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Auto-post — use /status for details' });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Hourly status post failed:', error);
  }
}

// --- Startup ---

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  console.log(`Monitoring ${SERVICES.length} services`);

  // Start hourly auto-post
  if (process.env.MONITORING_CHANNEL_ID) {
    console.log(`Hourly posts enabled for channel ${process.env.MONITORING_CHANNEL_ID}`);
    setInterval(postHourlyStatus, HOURLY_INTERVAL);
    // Post immediately on startup
    setTimeout(postHourlyStatus, 5000);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
