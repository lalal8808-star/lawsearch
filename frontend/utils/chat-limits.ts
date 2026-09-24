export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// 한 번의 모델 호출에 실을 수 있는 대화 분량. 이 상한이 없으면 요청 하나에
// 수십만 토큰을 실어 보내 비용을 소진시킬 수 있다.
export const CHAT_LIMITS = {
  maxMessages: 30,
  maxMessageChars: 20000,
  maxTotalChars: 60000,
};

/**
 * 클라이언트가 보낸 대화를 정규화하고 분량 상한 안으로 줄인다.
 * 최신 메시지부터 채우고, pinnedLeading개(후속 질의의 원 보고서 질의·답변)는 항상 유지한다.
 * maxTotalChars ≥ (pinnedLeading + 1) × maxMessageChars 이면 마지막 메시지는 항상 남는다.
 */
export function limitChatMessages(
  raw: unknown,
  { pinnedLeading = 0, limits = CHAT_LIMITS }: { pinnedLeading?: number; limits?: typeof CHAT_LIMITS } = {},
): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const all: ChatMessage[] = raw.map((message: any) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.content ?? '').slice(0, limits.maxMessageChars),
  }));
  if (all.length === 0) return [];

  const pinned = all.slice(0, Math.min(pinnedLeading, all.length - 1));
  const rest = all.slice(pinned.length);
  let budget = limits.maxTotalChars - pinned.reduce((sum, message) => sum + message.content.length, 0);
  const kept: ChatMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    if (pinned.length + kept.length >= limits.maxMessages) break;
    const message = rest[i];
    if (message.content.length > budget) break;
    kept.unshift(message);
    budget -= message.content.length;
  }
  return [...pinned, ...kept];
}
