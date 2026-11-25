// Free-text chat is not available on the public site.
import type { ChatMessage, ChatResult, ToolStep } from '../core/types';

export async function askGraphStream(_question: string, _history: ChatMessage[], _onStep: (s: ToolStep) => void): Promise<ChatResult> {
  throw new Error('Chat is not available.');
}
