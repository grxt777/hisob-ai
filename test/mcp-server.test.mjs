// Smoke test: start mcp-server.js over stdio like Claude Desktop would, list tools, call two of them.
// Run: node test/mcp-server.test.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../mcp-server.js', import.meta.url));
const client = new Client({ name: 'smoke-test', version: '0.0.1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));
const { tools } = await client.listTools();
console.log('tools:', tools.map(t => t.name).join(', '));
const vat = await client.callTool({ name: 'vat_summary', arguments: {} });
console.log('vat_summary:', vat.content[0].text.replace(/\s+/g, ' ').slice(0, 200));
const top = await client.callTool({ name: 'query_invoices', arguments: { type: 'sales', group_by: 'counterparty', limit: 1 } });
console.log('top buyer:', JSON.parse(top.content[0].text).counterparties[0].name);
await client.close();
