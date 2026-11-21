// MCP client: every server listed in mcp.json is started, its tools are offered to the model as
// "mcp_<server>_<tool>". Adding a tool = adding an MCP server to mcp.json, no code changes.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const registry = new Map(); // openai tool name -> { client, tool, server }
export const mcpStatus = [];

export async function loadMcp(file = join(ROOT, 'mcp.json')) {
  if (!existsSync(file)) return;
  const cfg = JSON.parse(readFileSync(file, 'utf8')).servers || {};
  await Promise.all(Object.entries(cfg).map(async ([name, s]) => {
    if (s.disabled) return;
    try {
      const client = new Client({ name: 'hisob-ai', version: '0.1.0' });
      const args = (s.args || []).map(a => a.replace('${ROOT}', ROOT));
      await client.connect(new StdioClientTransport({ command: s.command === 'node' ? process.execPath : s.command, args, env: { ...process.env, ...(s.env || {}) }, cwd: ROOT, stderr: 'ignore' }));
      const { tools } = await client.listTools();
      const allow = s.allow ? new Set(s.allow) : null;
      let n = 0;
      for (const t of tools) {
        if (allow && !allow.has(t.name)) continue;
        const id = `mcp_${name}_${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        registry.set(id, { client, tool: t.name, server: name, description: t.description, schema: t.inputSchema });
        n++;
      }
      mcpStatus.push(`${name}: ${n}/${tools.length} tools`);
    } catch (e) { mcpStatus.push(`${name}: failed (${e.message.split('\n')[0]})`); }
  }));
}

export function mcpToolDefs() {
  return [...registry.entries()].map(([id, x]) => ({ type: 'function', function: { name: id, description: `[${x.server}] ${(x.description || '').slice(0, 400)}`, parameters: x.schema || { type: 'object', properties: {} } } }));
}
export const isMcpTool = name => registry.has(name);
export async function callMcp(name, args) {
  const x = registry.get(name);
  const r = await x.client.callTool({ name: x.tool, arguments: args || {} });
  const text = (r.content || []).map(c => c.type === 'text' ? c.text : `[${c.type}]`).join('\n');
  return { isError: !!r.isError, text: text.length > 6000 ? text.slice(0, 6000) + '\n…(обрезано)' : text };
}
