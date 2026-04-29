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

  // Chat UI
  app.get("/", (req, res) => {
    const user = req.session.user;
    res.send(getChatHtml(user?.name || "Guest", user?.email || "", SSO_ENABLED));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Governance Agent running at http://localhost:${PORT}`);
  });
}

function getChatHtml(userName: string, userEmail: string, ssoEnabled: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Okta Governance Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc; height: 100vh; display: flex; flex-direction: column;
    }
    header {
      background: #1e293b; color: white; padding: 14px 24px;
      display: flex; align-items: center; gap: 12px;
    }
    header .icon {
      width: 36px; height: 36px; background: #3b82f6; border-radius: 8px;
      display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    header .title-area { flex: 1; }
    header h1 { font-size: 16px; font-weight: 600; }
    header p { font-size: 12px; color: #94a3b8; }
    header .user-area { text-align: right; }
    header .user-area .name { font-size: 13px; color: #e2e8f0; }
    header .user-area .email { font-size: 11px; color: #64748b; }
    header .user-area a { color: #94a3b8; font-size: 11px; text-decoration: none; margin-left: 8px; }
    header .user-area a:hover { color: white; }
    .toolbar {
      background: white; border-bottom: 1px solid #e2e8f0; padding: 8px 24px;
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    }
    .toolbar button {
      padding: 6px 14px; border: 1px solid #e2e8f0; border-radius: 6px;
      background: white; cursor: pointer; font-size: 13px; color: #475569;
    }
    .toolbar button:hover { background: #f1f5f9; }
    .toolbar .tool-count { margin-left: auto; font-size: 12px; color: #94a3b8; }
    #messages {
      flex: 1; overflow-y: auto; padding: 24px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .msg { max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.6; font-size: 14px; white-space: pre-wrap; }
    .msg.user {
      align-self: flex-end; background: #3b82f6; color: white; border-bottom-right-radius: 4px;
    }
    .msg.assistant {
      align-self: flex-start; background: white; color: #1e293b;
      border: 1px solid #e2e8f0; border-bottom-left-radius: 4px;
    }
    .msg.assistant pre {
      background: #f1f5f9; padding: 8px 12px; border-radius: 6px;
      overflow-x: auto; font-size: 13px; margin: 8px 0; white-space: pre;
    }
    .msg.assistant table { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
    .msg.assistant th, .msg.assistant td {
      border: 1px solid #e2e8f0; padding: 4px 10px; text-align: left;
    }
    .msg.assistant th { background: #f8fafc; font-weight: 600; }
    .msg.system {
      align-self: center; color: #94a3b8; font-size: 12px; font-style: italic;
    }
    .msg.thinking {
      align-self: flex-start; color: #94a3b8; font-size: 13px;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .msg.thinking { animation: pulse 1.5s ease-in-out infinite; }
    #input-area {
      background: white; border-top: 1px solid #e2e8f0; padding: 16px 24px;
      display: flex; gap: 12px;
    }
    #input-area input {
      flex: 1; padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 8px;
      font-size: 14px; outline: none;
    }
    #input-area input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.1); }
    #input-area button {
      padding: 10px 20px; background: #3b82f6; color: white; border: none;
      border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
    }
    #input-area button:hover { background: #2563eb; }
    #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <header>
    <div class="icon">🛡️</div>
    <div class="title-area">
      <h1>Okta Governance Agent</h1>
      <p>AI-powered access review, role mining, and governance</p>
    </div>
    <div class="user-area">
      <div class="name">${userName}</div>
      <div class="email">${userEmail}${ssoEnabled ? ' <a href="/auth/logout">Sign out</a>' : ""}</div>
    </div>
  </header>
  <div class="toolbar">
    <button onclick="resetChat()">New Chat</button>
    <button onclick="suggestPrompt('Who are the inactive users across our governance-enabled apps?')">Inactive Users</button>
    <button onclick="suggestPrompt('Generate access review candidates ranked by risk')">Review Candidates</button>
    <button onclick="suggestPrompt('What apps can I manage and what does their access structure look like?')">My Apps</button>
    <button onclick="suggestPrompt('List the groups I manage and their members')">My Groups</button>
    <span class="tool-count" id="tool-count">Loading tools...</span>
  </div>
  <div id="messages">
    <div class="msg system">Welcome, ${userName}. Ask me about access reviews, user activity, role mining, or app governance.</div>
  </div>
  <div id="input-area">
    <input type="text" id="input" placeholder="Ask about access, users, or governance..." autofocus
      onkeydown="if(event.key==='Enter') sendMessage()" />
    <button id="send-btn" onclick="sendMessage()">Send</button>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');

    fetch('/api/tools').then(r => r.json()).then(d => {
      document.getElementById('tool-count').textContent = d.count + ' governance tools';
    }).catch(() => {
      document.getElementById('tool-count').textContent = 'Connecting...';
    });

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
      // Code blocks
      text = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre>$1</pre>');
      // Inline code
      text = text.replace(/\`([^\`]+)\`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:13px;">$1</code>');
      // Bold
      text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // Headers
      text = text.replace(/^### (.+)$/gm, '<div style="font-weight:600;margin:12px 0 4px;font-size:14px;">$1</div>');
      text = text.replace(/^## (.+)$/gm, '<div style="font-weight:600;margin:16px 0 6px;font-size:15px;">$1</div>');
      // Lists
      text = text.replace(/^[\\-\\*] (.+)$/gm, '<div style="padding-left:16px;">• $1</div>');
      text = text.replace(/^(\\d+)\\. (.+)$/gm, '<div style="padding-left:16px;">$1. $2</div>');
      // Line breaks
      text = text.replace(/\\n\\n/g, '<br><br>');
      text = text.replace(/\\n/g, '<br>');
      return text;
    }

    async function sendMessage() {
      const msg = inputEl.value.trim();
      if (!msg) return;
      inputEl.value = '';
      sendBtn.disabled = true;
      addMessage(msg, 'user');
      const thinking = addMessage('Analyzing with governance tools...', 'thinking');

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        });
        thinking.remove();
        if (!resp.ok) {
          const err = await resp.json();
          if (resp.status === 401) {
            window.location.href = '/auth/login';
            return;
          }
          addMessage('Error: ' + (err.error || resp.statusText), 'system');
        } else {
          const data = await resp.json();
          addMessage(data.response, 'assistant');
        }
      } catch (err) {
        thinking.remove();
        addMessage('Error: ' + err, 'system');
      }
      sendBtn.disabled = false;
      inputEl.focus();
    }

    async function resetChat() {
      await fetch('/api/reset', { method: 'POST' });
      messagesEl.innerHTML = '<div class="msg system">Conversation reset. Ask me anything about governance.</div>';
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
