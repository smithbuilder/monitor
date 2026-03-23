# Self-Hosted Agent Email — Implementation Plan

## The Idea

Use your spare "beefy" Windows laptop as a dedicated agent email server. This keeps email infrastructure completely off the Mac Mini (which is RAM-constrained) and gives agents their own email addresses for free.

## Option A: AgenticMail on Windows Laptop (Recommended)

**AgenticMail** is an open-source, Docker-based platform purpose-built for AI agents. It wraps a Stalwart mail server with a REST API (75+ endpoints) and MCP server (62 tools).

### Architecture

```
Windows Laptop (Tailscale: jake-dev-windows or new hostname)
├── Docker Desktop (or OrbStack alternative for Windows)
│   └── AgenticMail (Docker Compose)
│       ├── Stalwart Mail Server (SMTP/IMAP, ~200MB RAM)
│       ├── Express.js API (75+ endpoints, ~100MB RAM)
│       └── MCP Server (62 tools for Claude/OpenClaw)
│
├── Outbound: Gmail SMTP Relay (free, 500/day)
│   └── Avoids residential IP deliverability problems
│
└── Accessible via Tailscale from:
    ├── Mac Mini (OpenClaw agents can send/receive email)
    ├── Dell Laptop (you can manage via API/MCP)
    └── ROG Ally (Discord bot integration)
```

### What Each Agent Gets

- Dedicated email address (e.g., `elle@yourdomain.com`, `jim@yourdomain.com`)
- Own inbox, API key, and thread management
- MCP tools — Claude can create inboxes, send, receive, reply via MCP
- REST API — any service on your Tailnet can call the email API

### Prerequisites

1. **Domain** — ~$10/year for a `.com` on Cloudflare or Namecheap
2. **Docker Desktop** on the Windows laptop (free for personal use)
3. **Tailscale** on the Windows laptop (you may already have this)
4. **Gmail account** for SMTP relay (free, 500 emails/day)

### Step-by-Step Implementation

#### Phase 1: Prepare the Windows Laptop (30 min)

1. Install Docker Desktop for Windows (if not already installed)
   ```powershell
   winget install Docker.DockerDesktop
   ```

2. Install Tailscale (if not already installed)
   ```powershell
   winget install Tailscale.Tailscale
   ```

3. Join your Tailnet (`tail3b2a94.ts.net`)
   - The laptop gets a Tailscale IP (e.g., `100.x.x.x`)
   - Give it a memorable hostname like `jake-email-server`

4. Verify Docker works:
   ```powershell
   docker run hello-world
   ```

#### Phase 2: Deploy AgenticMail (1 hour)

1. Clone AgenticMail:
   ```bash
   git clone https://github.com/agenticmail/agenticmail.git
   cd agenticmail
   ```

2. Follow their Docker setup (check their README for exact compose file)
   ```bash
   docker compose up -d
   ```

3. Configure Gmail relay mode:
   - Create a Gmail App Password (requires 2FA enabled):
     - Google Account > Security > 2-Step Verification > App passwords
     - Generate a password for "Mail"
   - Configure AgenticMail to use Gmail as the outbound relay
   - This means your agents send email through Gmail's servers (great deliverability)

4. Configure your domain's DNS:
   - **MX records** → point to your Tailscale IP (for internal only)
     OR use Cloudflare Email Routing → forward to AgenticMail
   - **SPF, DKIM, DMARC** records for deliverability

5. Create agent inboxes via the API:
   ```bash
   # Example: Create inbox for agent "Elle"
   curl -X POST http://localhost:PORT/api/inboxes \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"name": "Elle", "email": "elle@yourdomain.com"}'
   ```

#### Phase 3: Integration (1-2 hours)

1. **MCP Integration** — Add AgenticMail's MCP server to Claude Code:
   ```bash
   claude mcp add agenticmail http://TAILSCALE_IP:PORT/mcp
   ```

2. **OpenClaw Integration** — Configure OpenClaw agents to use the email API:
   - Add email tool definitions to agent configs
   - Elle, Jim, Jules, etc. can each use their own inbox

3. **Discord Bridge** — Forward important emails to Discord:
   - AgenticMail has webhook support
   - Configure webhook → Discord webhook URL
   - Or run discord-mail-forwarder alongside for two-way Discord↔email

4. **Monitoring Integration** — Add the email server to your monitoring:
   - Add to the health-check GHA workflow
   - Discord bot `/email-status` command
   - Monitor disk usage on the Windows laptop

#### Phase 4: DNS for Receiving External Email (Optional, 1 hour)

If you want external people to email your agents (not just agent-to-agent):

**Option A: Direct MX (requires static IP or tunnel)**
- Point MX records to the laptop's public IP
- Forward port 25 on your router
- Risk: residential IP, ISP may block port 25

**Option B: Cloudflare Email Routing → Forward (recommended)**
- Use Cloudflare Email Routing (free) as the public-facing MX
- Set up catch-all → forward to the laptop's Tailscale IP
- Cloudflare handles the public internet side; your laptop stays private
- Requires a Cloudflare Worker or direct SMTP forwarding

**Option C: Tailscale-only (simplest)**
- Only agents on your Tailnet can send/receive
- No public internet exposure needed
- Perfect if agents only email each other or use Gmail relay for outbound

### Resource Requirements

| Component | RAM | Disk | CPU |
|-----------|-----|------|-----|
| Stalwart Mail Server | ~200 MB | ~1 GB + emails | Minimal |
| AgenticMail API | ~100-200 MB | ~100 MB | Minimal |
| Docker Desktop | ~1 GB overhead | ~2 GB | Minimal |
| **Total** | **~1.5 GB** | **~3 GB** | **Low** |

On a "beefy" Windows laptop with 16-32 GB RAM, this is trivial.

### Costs

| Item | Cost |
|------|------|
| AgenticMail | Free (open source) |
| Docker Desktop | Free (personal use) |
| Tailscale | Free (personal plan) |
| Domain | ~$10/year |
| Gmail SMTP relay | Free (500/day) |
| Electricity | ~$3-5/month |
| **Total** | **~$0.83/month** + electricity |

---

## Option B: Stalwart + Custom API (More Control, More Work)

If AgenticMail doesn't fit or you want full control:

### Architecture

```
Windows Laptop
├── Stalwart Mail Server (Docker, ~200MB RAM)
│   └── SMTP + IMAP + JMAP — single binary, very efficient
├── Custom Node.js API (you build this)
│   └── Inbox CRUD, send/receive, webhook notifications
├── discord-mail-forwarder (Docker, ~50MB RAM)
│   └── Two-way Discord ↔ email bridge
└── Gmail SMTP relay for outbound
```

### Implementation

1. Deploy Stalwart via Docker:
   ```yaml
   # docker-compose.yml
   services:
     mail:
       image: stalwartlabs/mail-server:latest
       container_name: stalwart
       restart: unless-stopped
       ports:
         - "25:25"      # SMTP
         - "587:587"    # Submission
         - "993:993"    # IMAPS
         - "8080:8080"  # Web admin + JMAP
       volumes:
         - stalwart-data:/opt/stalwart-mail
       environment:
         - STALWART_ADMIN_PASSWORD=your-admin-password
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"

   volumes:
     stalwart-data:
   ```

2. Configure Stalwart admin at `http://localhost:8080`
3. Create accounts for each agent
4. Build a thin API layer or use JMAP directly
5. Add discord-mail-forwarder for Discord integration

### Pros vs AgenticMail

| | AgenticMail | Stalwart + Custom |
|---|---|---|
| Setup time | ~2 hours | ~4-6 hours |
| MCP tools | 62 built-in | Build yourself |
| REST API | 75+ endpoints | Build yourself |
| Agent-specific features | Yes | Generic email |
| Maintenance | Update Docker image | Update + maintain custom code |
| Flexibility | Their API design | Full control |

---

## Option C: Cloudflare Email Workers + Windows Laptop Hybrid

**Best of both worlds** — Cloudflare handles public-facing email, Windows laptop handles storage and processing.

```
Internet → Cloudflare MX (free)
  → Email Worker catches all mail
    → Stores in D1 (free, 5GB)
    → Fires webhook to Windows laptop
      → Laptop processes with AI/agents
      → Replies via Cloudflare Worker or Resend

Windows Laptop (via Tailscale)
  └── Agent email processor service
      ├── Receives webhooks from Cloudflare
      ├── Stores/indexes emails locally
      ├── Integrates with OpenClaw agents
      └── Sends replies via Cloudflare/Resend API
```

### Why This is Interesting

- No mail server to maintain (Cloudflare does all SMTP)
- No deliverability concerns (Cloudflare handles reputation)
- No port forwarding or public IP needed
- Laptop can go offline — emails queue in D1 until it reconnects
- $0/month (Cloudflare free + Resend free)

---

## Recommendation

**Start with Option A (AgenticMail)** on the Windows laptop. Reasons:

1. Purpose-built for exactly what you want (AI agent email)
2. MCP integration means Claude and OpenClaw agents get email capabilities immediately
3. Your beefy Windows laptop has plenty of resources (unlike the Mac Mini)
4. Gmail relay solves deliverability
5. Tailscale keeps everything private and accessible
6. If it doesn't work out, you can pivot to Option C (Cloudflare) with zero sunk cost on the Mac Mini

**Long-term**: Consider adding Option C (Cloudflare) as the public-facing layer that forwards to AgenticMail on the laptop. This gives you:
- Public email addresses that work even if the laptop is off
- Cloudflare's email reputation for deliverability
- AgenticMail's agent-specific features for processing

---

## Timeline

| Phase | What | Time | Can Start |
|-------|------|------|-----------|
| 1 | Prep Windows laptop (Docker, Tailscale) | 30 min | Anytime |
| 2 | Deploy AgenticMail | 1 hour | After Phase 1 |
| 3 | Create agent inboxes + Gmail relay | 30 min | After Phase 2 |
| 4 | MCP + OpenClaw integration | 1-2 hours | After Phase 3 |
| 5 | Discord bridge | 1 hour | After Phase 3 |
| 6 | Cloudflare public layer (optional) | 2 hours | After Phase 3 |
| **Total** | | **4-6 hours** | |

## Questions to Decide

1. **Which laptop?** The Dell or the HP? (The Dell is your current dev machine — probably don't want to use that. The HP was being set up on 2026-03-20 — is that the "beefy" one?)
2. **Domain** — Do you already have one on Cloudflare, or need to buy one?
3. **Public email?** — Do agents need to receive email from the public internet, or just from each other + Gmail relay for outbound?
4. **Which agents get email first?** — Elle (coord), Jim (eng), Jules (art), etc.?
