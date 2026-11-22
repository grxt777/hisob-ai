// Office AI as an MCP server (stdio): the same data tools for Claude Desktop, Cursor or any MCP client.
// Config example: { "command": "node", "args": ["/path/to/office-ai/mcp-server.js"] }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { vatSummary, queryInvoices, calculate, socialMonitor, geocode, closeBrowser } from './lib/tools.js';
import { telegramDeep, instagramDeep, closeSocialBrowser } from './lib/social.js';

const server = new McpServer({ name: 'office-ai', version: '0.1.0' });
const json = x => ({ content: [{ type: 'text', text: JSON.stringify(x, null, 1) }] });

server.tool('vat_summary', 'Итоги расчёта НДС за октябрь 2026 по электронным счетам-фактурам компании.', {}, async () => json(vatSummary()));
server.tool('query_invoices', 'Запрос к ЭСФ: продажи или покупки, фильтр по контрагенту и датам, группировка.', {
  type: z.enum(['sales', 'purchases']), counterparty: z.string().optional(), date_from: z.string().optional(), date_to: z.string().optional(),
  group_by: z.enum(['counterparty', 'none']).optional(), sort: z.enum(['sum_desc', 'sum_asc', 'date']).optional(), limit: z.number().int().optional(),
}, async a => json(queryInvoices(a).result));
server.tool('calculate', 'Точный калькулятор: числа и + - * / ( ) %.', { expression: z.string(), label: z.string().optional() }, async a => json(calculate(a).result));
server.tool('social_monitor', 'Публичные данные соцсети или сайта: telegram-канал, instagram-профиль, сайт.', { platform: z.enum(['telegram', 'instagram', 'website']), handle: z.string() }, async a => { const r = a.platform === 'telegram' ? await telegramDeep(a.handle) : a.platform === 'instagram' ? await instagramDeep(a.handle) : await socialMonitor(a); return json(r.stats ? { ...r, posts: r.posts.slice(0, 20) } : r); });
server.tool('geocode', 'Найти адрес в Узбекистане и вернуть координаты (OpenStreetMap).', { address: z.string() }, async a => json(await geocode(a.address)));

process.on('SIGINT', async () => { await closeBrowser(); await closeSocialBrowser(); process.exit(0); });
await server.connect(new StdioServerTransport());
