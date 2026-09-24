import { describe, expect, it } from 'vitest';
import { CHAT_LIMITS, limitChatMessages } from './chat-limits';

const msg = (role: 'user' | 'assistant', length: number, mark = '') => ({ role, content: mark + 'x'.repeat(length - mark.length) });

describe('limitChatMessages', () => {
  it('normalizes roles and drops non-array input', () => {
    expect(limitChatMessages(null)).toEqual([]);
    expect(limitChatMessages([{ role: 'system', content: 'hi' }, { role: 'assistant', content: 1 }])).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '1' },
    ]);
  });

  it('keeps total size under the budget by dropping the oldest messages', () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', 15000, `#${i}`));
    const limited = limitChatMessages(messages);
    const total = limited.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(CHAT_LIMITS.maxTotalChars);
    expect(limited[limited.length - 1].content.startsWith('#9')).toBe(true);
    expect(limited[0].content.startsWith('#6')).toBe(true);
  });

  it('truncates a single oversized message instead of rejecting it', () => {
    const limited = limitChatMessages([msg('user', 500000)]);
    expect(limited).toHaveLength(1);
    expect(limited[0].content).toHaveLength(CHAT_LIMITS.maxMessageChars);
  });

  it('keeps the pinned report context for follow-ups and the latest question', () => {
    const messages = [
      msg('user', 20000, 'Q'),
      msg('assistant', 12000, 'REPORT'),
      ...Array.from({ length: 12 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', 6000, `c${i}`)),
      msg('user', 20000, 'LAST'),
    ];
    const limited = limitChatMessages(messages, { pinnedLeading: 2 });
    expect(limited[0].content.startsWith('Q')).toBe(true);
    expect(limited[1].content.startsWith('REPORT')).toBe(true);
    expect(limited[limited.length - 1].content.startsWith('LAST')).toBe(true);
    expect(limited.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(CHAT_LIMITS.maxTotalChars);
  });

  it('caps the number of messages', () => {
    const limited = limitChatMessages(Array.from({ length: 100 }, () => msg('user', 10)));
    expect(limited).toHaveLength(CHAT_LIMITS.maxMessages);
  });
});
