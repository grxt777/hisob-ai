// Speech-to-text through OpenRouter with an audio-capable model (Qwen Omni Flash, fallback Gemini 2.5 Flash).
// Phones record in different containers (Android webm/opus, iPhone mp4/aac), so ffmpeg converts
// everything to 16 kHz mono WAV first. Cost: ~$0.00005 per short voice command.
import { spawn } from 'node:child_process';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Qwen Omni Flash: exact transcription at ~$0.00005 per short command; Gemini 2.5 Flash as automatic fallback.
export const sttModels = () => (process.env.OPENROUTER_STT_MODELS || 'qwen/qwen3.8-omni-flash,google/gemini-2.5-flash').split(',').map(x => x.trim()).filter(Boolean);
export const sttModel = () => sttModels()[0];

function toWav(buf, ext) {
  return mkdtemp(join(tmpdir(), 'stt-')).then(async dir => {
    const inp = join(dir, 'in.' + ext);
    await writeFile(inp, buf); // a file, not a pipe: iPhone mp4 needs a seekable input
    try {
      return await new Promise((res, rej) => {
        const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', inp, '-ac', '1', '-ar', '16000', '-t', '120', '-f', 'wav', 'pipe:1']);
        const out = [], err = [];
        ff.stdout.on('data', c => out.push(c)); ff.stderr.on('data', c => err.push(c));
        ff.on('error', e => rej(new Error('ffmpeg не найден: ' + e.message)));
        ff.on('close', code => code === 0 ? res(Buffer.concat(out)) : rej(new Error('ffmpeg: ' + Buffer.concat(err).toString().slice(0, 200))));
      });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

export async function transcribeOpenRouter(buf, ext, lang) {
  const wav = await toWav(buf, ext);
  if (wav.length < 3200) return { text: '', seconds: 0 }; // < 0.1 s of audio
  const hint = lang === 'uz' ? 'Скорее всего узбекский (латиница), возможны русские слова.' : lang === 'ru' ? 'Скорее всего русский, возможны узбекские слова.' : 'Узбекский или русский, возможна смесь.';
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'X-Title': 'Office AI' },
    body: JSON.stringify({
      // OpenRouter tries the next model if one is down or rate-limited
      models: sttModels(), temperature: 0, max_tokens: 400, usage: { include: true },
      messages: [{ role: 'user', content: [
        { type: 'text', text: `Расшифруй речь из аудио дословно. ${hint} Верни только расшифровку, без кавычек и пояснений. Если речи нет — верни пустую строку.` },
        { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } },
      ] }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'OpenRouter ' + r.status);
  const text = String(d.choices?.[0]?.message?.content || '').trim().replace(/^["«]|["»]$/g, '');
  return { text, model: d.model, seconds: Math.round((wav.length - 44) / 32000 * 10) / 10, cost: d.usage?.cost || 0 };
}
