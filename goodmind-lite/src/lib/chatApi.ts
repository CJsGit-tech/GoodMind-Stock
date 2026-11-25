// Free-text questions to the graph agent (local server only; the public build ships a stub and keeps chat off).
import type { ChatMessage, ChatResult, ToolStep } from '../../lib/types';

/** Streams retrieval steps (server-sent events over a POST) and resolves with the final answer. */
export async function askGraphStream(question: string, history: ChatMessage[], onStep: (s: ToolStep) => void): Promise<ChatResult> {
  const r = await fetch('/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history }) });
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Request failed'); }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', result: ChatResult | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data);
      if (event === 'step') onStep(payload);
      else if (event === 'done') result = payload;
      else if (event === 'error') throw new Error(payload.error);
    }
  }
  if (!result) throw new Error('The answer stream ended early.');
  return result;
}
