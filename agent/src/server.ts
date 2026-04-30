/**
 * Governance Agent — Express server with Okta SSO, chat API, and web UI.
 *
 * Auth flow:
 *   GET  /auth/login    → Okta OIDC login (PKCE)
 *   GET  /auth/callback → Token exchange, store in session
 *   GET  /auth/logout   → Clear session + Okta logout
 *
 * Authenticated routes:
 *   GET  /              — Chat UI
 *   POST /api/chat      — Send a message, get a response
 *   POST /api/reset     — Reset conversation
 *   GET  /api/tools     — List available MCP tools
 *   GET  /api/user      — Current user info
 *
 * Unauthenticated:
 *   GET  /health        — Health check
 */

import "dotenv/config";
import express from "express";
import session from "express-session";
import { McpClient } from "./mcp-client.js";
import { GovernanceAgent } from "./bedrock.js";
import { authRouter, requireAuth, getAccessToken } from "./auth.js";
import { getMyReviews, approveItem, revokeItem } from "./cert-api.js";

const PORT = parseInt(process.env.AGENT_PORT || "3100");
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3002";
const SESSION_SECRET = process.env.SESSION_SECRET || "governance-agent-dev-secret";
const SSO_ENABLED = !!(process.env.OKTA_ISSUER && process.env.OKTA_AGENT_CLIENT_ID);

// Per-user agent instances — keyed by Okta user sub (or "anonymous" if no SSO)
const agents = new Map<string, GovernanceAgent>();

function getOrCreateAgent(userId: string, accessToken?: string): GovernanceAgent {
  const existing = agents.get(userId);
  if (existing) {
    // Update token in case it refreshed
    if (accessToken) {
      existing.updateMcpToken(accessToken);
    }
    return existing;
  }

  const mcpClient = new McpClient(MCP_SERVER_URL, accessToken);
  const agent = new GovernanceAgent(mcpClient);
  agents.set(userId, agent);
  return agent;
}

async function main() {
  console.log(`SSO: ${SSO_ENABLED ? "enabled" : "disabled (set OKTA_ISSUER + OKTA_AGENT_CLIENT_ID to enable)"}`);

  const app = express();
  app.use(express.json());

  // Session middleware
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      },
    })
  );

  // Health check (unauthenticated)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      sso: SSO_ENABLED,
      mcpServer: MCP_SERVER_URL,
    });
  });

  // Auth routes
  if (SSO_ENABLED) {
    app.use("/auth", authRouter());
  }

  // Gate everything else behind auth (if SSO enabled)
  if (SSO_ENABLED) {
    app.use(requireAuth);
  }

  // Chat API
  app.post("/api/chat", async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    try {
      const userId = req.session.user?.sub || "anonymous";
      const accessToken = getAccessToken(req);
      const agent = getOrCreateAgent(userId, accessToken);

      // Lazy-init tools on first chat
      if (agent.getToolCount() === 0) {
        await agent.initialize();
      }

      const userName = req.session.user?.name || "anonymous";
      console.log(`\n[${userName}] >>> ${message}`);
      const response = await agent.chat(message);
      console.log(`[${userName}] <<< ${response.substring(0, 200)}...`);

      res.json({ response });
    } catch (err) {
      console.error(`Chat error: ${err}`);
      res.status(500).json({ error: `${err}` });
    }
  });

  // Reset conversation
  app.post("/api/reset", (req, res) => {
    const userId = req.session.user?.sub || "anonymous";
    const agent = agents.get(userId);
    if (agent) agent.resetConversation();
    res.json({ status: "ok" });
  });

  // List tools
  app.get("/api/tools", async (req, res) => {
    const userId = req.session.user?.sub || "anonymous";
    const accessToken = getAccessToken(req);
    const agent = getOrCreateAgent(userId, accessToken);
    try {
      if (agent.getToolCount() === 0) await agent.initialize();
      res.json({ count: agent.getToolCount(), tools: agent.getToolNames() });
    } catch {
      res.json({ count: 0, tools: [] });
    }
  });

  // Current user info
  app.get("/api/user", (req, res) => {
    res.json(req.session.user || { email: "anonymous", name: "Anonymous" });
  });

  // --- Certification Review APIs ---
  app.get("/api/reviews", async (req, res) => {
    try {
      const token = getAccessToken(req) || "";
      const reviews = await getMyReviews(token);
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ error: `${err}` });
    }
  });

  app.post("/api/reviews/:reviewId/items/:itemId/approve", async (req, res) => {
    try {
      const token = getAccessToken(req) || "";
      await approveItem(req.params.reviewId, req.params.itemId, token);
      res.json({ status: "approved" });
    } catch (err) {
      res.status(500).json({ error: `${err}` });
    }
  });

  app.post("/api/reviews/:reviewId/items/:itemId/revoke", async (req, res) => {
    try {
      const token = getAccessToken(req) || "";
      const { justification } = req.body || {};
      await revokeItem(req.params.reviewId, req.params.itemId, token, justification);
      res.json({ status: "revoked" });
    } catch (err) {
      res.status(500).json({ error: `${err}` });
    }
  });

  // Chat UI (split screen)
  app.get("/", (req, res) => {
    const user = req.session.user;
    res.send(getChatHtml(user?.name || "Guest", user?.email || "", SSO_ENABLED));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Governance Agent running at http://localhost:${PORT}`);
  });
}

function getChatHtml(userName: string, userEmail: string, ssoEnabled: boolean): string {
  // The UI is split: chat on the left, generated cert dashboard on the right.
  // When the agent returns a message containing <!--CERT_UI_START-->...<!--CERT_UI_END-->,
  // the content between the markers is rendered in the right panel as HTML.
  // The agent generates custom React/HTML based on the user's preferences.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Okta Governance Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; height: 100vh; display: flex; flex-direction: column; }
    header { background: #1e293b; color: white; padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
    header .icon { width: 32px; height: 32px; background: #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    header .title-area { flex: 1; }
    header h1 { font-size: 15px; font-weight: 600; }
    header p { font-size: 11px; color: #94a3b8; }
    header .user-area { text-align: right; font-size: 12px; color: #94a3b8; }
    header .user-area a { color: #94a3b8; text-decoration: none; margin-left: 8px; }
    header .user-area a:hover { color: white; }

    .split { display: flex; flex: 1; overflow: hidden; }

    /* LEFT: Chat panel */
    .chat-panel { width: 420px; min-width: 360px; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; background: #f8fafc; }
    .chat-toolbar { background: white; border-bottom: 1px solid #e2e8f0; padding: 8px 16px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .chat-toolbar button { padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 5px; background: white; cursor: pointer; font-size: 11px; color: #475569; }
    .chat-toolbar button:hover { background: #f1f5f9; }
    .chat-toolbar .info { margin-left: auto; font-size: 10px; color: #94a3b8; }
    #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .msg { max-width: 90%; padding: 10px 14px; border-radius: 10px; line-height: 1.5; font-size: 13px; white-space: pre-wrap; }
    .msg.user { align-self: flex-end; background: #3b82f6; color: white; border-bottom-right-radius: 4px; }
    .msg.assistant { align-self: flex-start; background: white; color: #1e293b; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px; }
    .msg.assistant strong { font-weight: 600; }
    .msg.system { align-self: center; color: #94a3b8; font-size: 11px; font-style: italic; }
    .msg.thinking { align-self: flex-start; color: #94a3b8; font-size: 12px; animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
    #input-area { background: white; border-top: 1px solid #e2e8f0; padding: 12px 16px; display: flex; gap: 8px; }
    #input-area input { flex: 1; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; outline: none; }
    #input-area input:focus { border-color: #3b82f6; }
    #input-area button { padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }

    /* RIGHT: Dashboard panel */
    .dashboard-panel { flex: 1; display: flex; flex-direction: column; background: white; overflow: hidden; }
    .dashboard-header { padding: 12px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }
    .dashboard-header h2 { font-size: 14px; font-weight: 600; color: #1e293b; }
    .dashboard-header .status { font-size: 11px; color: #94a3b8; }
    #dashboard-content { flex: 1; overflow-y: auto; }
    #dashboard-iframe { width: 100%; height: 100%; border: none; }

    /* Default empty state for dashboard */
    .dashboard-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #94a3b8; text-align: center; padding: 40px; }
    .dashboard-empty .icon { font-size: 48px; margin-bottom: 16px; }
    .dashboard-empty h3 { font-size: 16px; color: #64748b; margin-bottom: 8px; }
    .dashboard-empty p { font-size: 13px; max-width: 320px; line-height: 1.6; }
  </style>
</head>
<body>
  <header>
    <div class="icon">🛡️</div>
    <div class="title-area">
      <h1>Okta Governance Agent</h1>
      <p>AI-powered access certification</p>
    </div>
    <div class="user-area">
      ${userName}${ssoEnabled ? ' <a href="/auth/logout">Sign out</a>' : ""}
    </div>
  </header>

  <div class="split">
    <!-- LEFT: Chat -->
    <div class="chat-panel">
      <div class="chat-toolbar">
        <button onclick="resetChat()">New</button>
        <button onclick="suggestPrompt('Show me my pending access reviews')">My Reviews</button>
        <button onclick="suggestPrompt('Build me a dashboard showing my cert reviews grouped by risk level')">Risk Dashboard</button>
        <button onclick="suggestPrompt('Show my reviews as a Kanban board with columns for each status')">Kanban View</button>
        <span class="info" id="tool-count"></span>
      </div>
      <div id="messages">
        <div class="msg system">Hi ${userName}! Describe how you'd like to see your access certifications and I'll build a custom view for you.</div>
      </div>
      <div id="input-area">
        <input type="text" id="input" placeholder="Describe your ideal cert review UI..." autofocus
          onkeydown="if(event.key==='Enter') sendMessage()" />
        <button id="send-btn" onclick="sendMessage()">Send</button>
      </div>
    </div>

    <!-- RIGHT: Generated Dashboard -->
    <div class="dashboard-panel">
      <div class="dashboard-header">
        <h2 id="dashboard-title">Certification Dashboard</h2>
        <span class="status" id="dashboard-status">Waiting for instructions...</span>
      </div>
      <div id="dashboard-content">
        <div class="dashboard-empty" id="dashboard-empty">
          <div>
            <div class="icon">📋</div>
            <h3>Your Custom Cert UI</h3>
            <p>Ask the agent to build a certification review dashboard. Describe the layout, grouping, and style you want — the agent will generate it here in real time.</p>
            <p style="margin-top:12px;font-size:12px;color:#94a3b8;">Try: "Build me a dashboard showing my cert reviews grouped by risk level with color-coded cards"</p>
          </div>
        </div>
        <iframe id="dashboard-iframe" style="display:none;"></iframe>
      </div>
    </div>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const dashboardIframe = document.getElementById('dashboard-iframe');
    const dashboardEmpty = document.getElementById('dashboard-empty');
    const dashboardTitle = document.getElementById('dashboard-title');
    const dashboardStatus = document.getElementById('dashboard-status');

    // Load tool count
    fetch('/api/tools').then(r=>r.json()).then(d=>{
      document.getElementById('tool-count').textContent = d.count + ' tools';
    }).catch(()=>{});

    // Load cert review data for the agent to use
    let certData = null;
    fetch('/api/reviews').then(r=>r.json()).then(d=>{ certData = d; }).catch(()=>{});

    function addMessage(text, cls) {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      if (cls === 'assistant') {
        div.innerHTML = formatResponse(text);
      } else {
        div.textContent = text;
      }
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function formatResponse(text) {
      return text
        .replace(/\`\`\`[\\w]*([\\s\\S]*?)\`\`\`/g, '<pre style="background:#f1f5f9;padding:8px;border-radius:4px;font-size:12px;overflow-x:auto;">$1</pre>')
        .replace(/\`([^\`]+)\`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>')
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/^### (.+)$/gm, '<div style="font-weight:600;margin:8px 0 4px;font-size:13px;">$1</div>')
        .replace(/^## (.+)$/gm, '<div style="font-weight:600;margin:10px 0 4px;font-size:14px;">$1</div>')
        .replace(/^[\\-\\*] (.+)$/gm, '<div style="padding-left:12px;">• $1</div>')
        .replace(/\\n/g, '<br>');
    }

    function renderDashboard(html) {
      // Inject cert data and action handlers into the iframe
      const fullHtml = \`<!DOCTYPE html>
<html><head>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 20px; background: #f8fafc; color: #1e293b; }
</style>
</head><body>
\${html}
<script>
  const certData = \${JSON.stringify(certData)};

  async function approveItem(reviewId, itemId) {
    await fetch('/api/reviews/' + reviewId + '/items/' + itemId + '/approve', { method: 'POST' });
    const btn = document.querySelector('[data-item="' + itemId + '"]');
    if (btn) { btn.closest('tr,div,.card').style.opacity = '0.5'; }
  }

  async function revokeItem(reviewId, itemId) {
    const reason = prompt('Justification for revocation (optional):');
    await fetch('/api/reviews/' + reviewId + '/items/' + itemId + '/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification: reason })
    });
    const btn = document.querySelector('[data-item="' + itemId + '"]');
    if (btn) { btn.closest('tr,div,.card').style.opacity = '0.5'; }
  }
<\\/script>
</body></html>\`;

      dashboardIframe.style.display = 'block';
      dashboardEmpty.style.display = 'none';
      dashboardIframe.srcdoc = fullHtml;
      dashboardStatus.textContent = 'Live — generated by AI';
    }

    async function sendMessage() {
      const msg = inputEl.value.trim();
      if (!msg) return;
      inputEl.value = '';
      sendBtn.disabled = true;
      addMessage(msg, 'user');
      const thinking = addMessage('Building your dashboard...', 'thinking');
      dashboardStatus.textContent = 'Generating...';

      // Augment the message with cert data context so the agent knows what data to render
      const augmented = msg + (certData ? '\\n\\n[SYSTEM CONTEXT - cert review data available via /api/reviews. Here is the current data for generating the UI:]\\n' + JSON.stringify(certData, null, 2) : '');

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: augmented }),
        });
        thinking.remove();
        if (!resp.ok) {
          const err = await resp.json();
          if (resp.status === 401) { window.location.href = '/auth/login'; return; }
          addMessage('Error: ' + (err.error || resp.statusText), 'system');
          dashboardStatus.textContent = 'Error';
        } else {
          const data = await resp.json();

          // Check if response contains HTML for the dashboard
          const htmlMatch = data.response.match(/<!--CERT_UI_START-->([\\s\\S]*?)<!--CERT_UI_END-->/);
          if (htmlMatch) {
            renderDashboard(htmlMatch[1]);
            // Show the non-HTML part in chat
            const chatText = data.response.replace(/<!--CERT_UI_START-->[\\s\\S]*?<!--CERT_UI_END-->/, '').trim();
            if (chatText) addMessage(chatText, 'assistant');
            else addMessage("I've updated the dashboard on the right. Let me know if you'd like any changes!", 'assistant');
          } else {
            addMessage(data.response, 'assistant');
            dashboardStatus.textContent = 'Waiting for UI generation...';
          }
        }
      } catch (err) {
        thinking.remove();
        addMessage('Error: ' + err, 'system');
        dashboardStatus.textContent = 'Error';
      }
      sendBtn.disabled = false;
      inputEl.focus();
    }

    async function resetChat() {
      await fetch('/api/reset', { method: 'POST' });
      messagesEl.innerHTML = '<div class="msg system">Conversation reset. Describe how you want your cert review UI.</div>';
      dashboardIframe.style.display = 'none';
      dashboardEmpty.style.display = 'flex';
      dashboardStatus.textContent = 'Waiting for instructions...';
    }

    function suggestPrompt(text) {
      inputEl.value = text;
      inputEl.focus();
    }
  </script>
</body>
</html>`;
}

main().catch(console.error);
