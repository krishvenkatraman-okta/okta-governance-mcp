/**
 * Governance Agent — Express server with chat API and web UI.
 *
 * GET  /          — Chat UI
 * GET  /health    — Health check
 * POST /api/chat  — Send a message, get a response
 * POST /api/reset — Reset conversation
 * GET  /api/tools — List available MCP tools
 */

import "dotenv/config";
import express from "express";
import { McpClient } from "./mcp-client.js";
import { GovernanceAgent } from "./bedrock.js";

const PORT = parseInt(process.env.AGENT_PORT || "3100");
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3002";
const MCP_ACCESS_TOKEN = process.env.MCP_ACCESS_TOKEN || "";

async function main() {
  // Initialize MCP client + agent
  const mcpClient = new McpClient(MCP_SERVER_URL, MCP_ACCESS_TOKEN || undefined);
  const agent = new GovernanceAgent(mcpClient);

  try {
    await agent.initialize();
    console.log(`Connected to MCP server at ${MCP_SERVER_URL}`);
    console.log(`Tools available: ${agent.getToolCount()}`);
  } catch (err) {
    console.error(`Failed to connect to MCP server: ${err}`);
    console.log("Starting without tools — will retry on first chat");
  }

  const app = express();
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      tools: agent.getToolCount(),
      mcpServer: MCP_SERVER_URL,
    });
  });

  // Chat API
  app.post("/api/chat", async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    try {
      // Lazy-init if tools weren't loaded at startup
      if (agent.getToolCount() === 0) {
        await agent.initialize();
      }

      console.log(`\n>>> ${message}`);
      const response = await agent.chat(message);
      console.log(`<<< ${response.substring(0, 200)}...`);

      res.json({ response });
    } catch (err) {
      console.error(`Chat error: ${err}`);
      res.status(500).json({ error: `${err}` });
    }
  });

  // Reset conversation
  app.post("/api/reset", (_req, res) => {
    agent.resetConversation();
    res.json({ status: "ok", message: "Conversation reset" });
  });

  // List tools
  app.get("/api/tools", (_req, res) => {
    res.json({
      count: agent.getToolCount(),
      tools: agent.getToolNames(),
    });
  });

  // Chat UI
  app.get("/", (_req, res) => {
    res.send(CHAT_HTML);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Governance Agent running at http://localhost:${PORT}`);
  });
}

const CHAT_HTML = `<!DOCTYPE html>
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
      background: #1e293b; color: white; padding: 16px 24px;
      display: flex; align-items: center; gap: 12px;
    }
    header .icon {
      width: 36px; height: 36px; background: #3b82f6; border-radius: 8px;
      display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    header h1 { font-size: 16px; font-weight: 600; }
    header p { font-size: 12px; color: #94a3b8; }
    .toolbar {
      background: white; border-bottom: 1px solid #e2e8f0; padding: 8px 24px;
      display: flex; gap: 8px; align-items: center;
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
    .msg { max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.6; font-size: 14px; }
    .msg.user {
      align-self: flex-end; background: #3b82f6; color: white; border-bottom-right-radius: 4px;
    }
    .msg.assistant {
      align-self: flex-start; background: white; color: #1e293b;
      border: 1px solid #e2e8f0; border-bottom-left-radius: 4px;
    }
    .msg.assistant pre {
      background: #f1f5f9; padding: 8px 12px; border-radius: 6px;
      overflow-x: auto; font-size: 13px; margin: 8px 0;
    }
    .msg.assistant code { font-size: 13px; }
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
    .msg.thinking::after {
      content: ''; animation: dots 1.5s infinite;
    }
    @keyframes dots {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
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
    <div>
      <h1>Okta Governance Agent</h1>
      <p>AI-powered access review, role mining, and governance</p>
    </div>
  </header>
  <div class="toolbar">
    <button onclick="resetChat()">New Chat</button>
    <button onclick="suggestPrompt('Who are the inactive users on our Salesforce app?')">Inactive Users</button>
    <button onclick="suggestPrompt('Generate access review candidates for our top apps')">Review Candidates</button>
    <button onclick="suggestPrompt('What apps can I manage and what does their access look like?')">My Apps</button>
    <span class="tool-count" id="tool-count">Loading tools...</span>
  </div>
  <div id="messages">
    <div class="msg system">Ask me about access reviews, user activity, role mining, or app governance.</div>
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

    // Load tool count
    fetch('/api/tools').then(r => r.json()).then(d => {
      document.getElementById('tool-count').textContent = d.count + ' governance tools available';
    }).catch(() => {
      document.getElementById('tool-count').textContent = 'MCP server not connected';
    });

    function addMessage(text, cls) {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      if (cls === 'assistant') {
        div.innerHTML = formatMarkdown(text);
      } else {
        div.textContent = text;
      }
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function formatMarkdown(text) {
      // Simple markdown → HTML (tables, code blocks, bold, lists)
      return text
        .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 4px;font-size:14px;">$1</h4>')
        .replace(/^## (.+)$/gm, '<h3 style="margin:12px 0 4px;font-size:15px;">$1</h3>')
        .replace(/^- (.+)$/gm, '• $1<br>')
        .replace(/^\\d+\\. (.+)$/gm, '$&<br>')
        .replace(/\\n\\n/g, '<br><br>')
        .replace(/\\n/g, '<br>')
        // Simple table detection
        .replace(/(\\|.+\\|\\n?)+/g, function(match) {
          const rows = match.trim().split('\\n').filter(r => r.trim());
          if (rows.length < 2) return match;
          let html = '<table>';
          rows.forEach((row, i) => {
            if (row.match(/^\\|[-:\\s|]+\\|$/)) return; // separator row
            const cells = row.split('|').filter(c => c.trim());
            const tag = i === 0 ? 'th' : 'td';
            html += '<tr>' + cells.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
          });
          html += '</table>';
          return html;
        });
    }

    async function sendMessage() {
      const msg = inputEl.value.trim();
      if (!msg) return;

      inputEl.value = '';
      sendBtn.disabled = true;
      addMessage(msg, 'user');

      const thinking = addMessage('Thinking', 'thinking');

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        });
        thinking.remove();

        if (!resp.ok) {
          const err = await resp.json();
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

main().catch(console.error);
