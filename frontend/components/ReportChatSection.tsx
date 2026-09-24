"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Loader2, Scale, Save, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import api, { getAuthToken } from '@/utils/api';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ReportChatSectionProps {
    reportId: number;
    initialHistory?: Message[];
    query?: string;
    answer?: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function ReportChatSection({ reportId, initialHistory = [], query, answer }: ReportChatSectionProps) {
    const [messages, setMessages] = useState<Message[]>(initialHistory);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>(initialHistory.length ? 'saved' : 'idle');
    const [savedAt, setSavedAt] = useState<Date | null>(initialHistory.length ? new Date() : null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        setMessages(initialHistory);
        setSaveState(initialHistory.length ? 'saved' : 'idle');
    }, [initialHistory]);

    const saveConversation = async (conversation: Message[]) => {
        if (reportId <= 0 || conversation.length === 0) return false;
        setSaveState('saving');
        try {
            await api.put(`/history/${reportId}/chat`, { messages: conversation });
            setSaveState('saved');
            setSavedAt(new Date());
            return true;
        } catch (error) {
            console.error('Consultation save error:', error);
            setSaveState('error');
            return false;
        }
    };

    const downloadConversation = () => {
        if (messages.length === 0) return;
        const recordedAt = new Date();
        const body = messages.map((message, index) => {
            const speaker = message.role === 'user' ? '사용자' : 'JongLaw AI 전문가';
            return `## ${index + 1}. ${speaker}\n\n${message.content}`;
        }).join('\n\n---\n\n');
        const content = `# JongLaw AI 전문가 상담 기록\n\n- 보고서 번호: ${reportId > 0 ? reportId : '임시 보고서'}\n- 내려받은 시각: ${recordedAt.toLocaleString('ko-KR')}\n\n${body}\n`;
        const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `JongLaw-AI-상담기록-${reportId > 0 ? reportId : recordedAt.toISOString().slice(0, 10)}.md`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput('');
        const convo = [...messages, { role: 'user' as const, content: userMessage }];
        setMessages(convo);
        setIsLoading(true);
        let jobId: string | null = null;

        try {
            const jobRes = await api.post('/jobs', { query: userMessage, kind: 'followup', model: 'openai/gpt-5.6-sol' });
            jobId = jobRes.data.id;
            const token = await getAuthToken(); // 항상 갱신된 세션 토큰 사용

            // 메인 채팅발 임시 리포트는 백엔드에 저장돼 있지 않으므로, 리포트 내용을
            // 대화 맥락으로 전달하고 Vercel AI Gateway(/api/chat)로 후속 질문을 처리한다.
            const payloadMessages = [
                ...(query ? [{ role: 'user', content: query }] : []),
                ...(answer ? [{ role: 'assistant', content: answer.slice(-12000) }] : []),
                ...convo.slice(-12),
            ].map(m => ({ role: m.role, content: m.content }));

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ messages: payloadMessages, jobId, mode: 'followup' }),
            });

            if (!response.ok) {
                let detail = '';
                try {
                    detail = (await response.json())?.error || '';
                } catch {
                    detail = '';
                }
                // 사용 한도 초과처럼 사용자가 알아야 하는 사유는 그대로 보여준다.
                throw new Error(response.status === 429 && detail ? detail : '채팅 응답에 실패했습니다.');
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (!reader) throw new Error('응답 스트림 리더를 생성할 수 없습니다.');

            // 스트리밍용 빈 어시스턴트 버블 추가
            setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

            let assistantAnswer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                assistantAnswer += decoder.decode(value, { stream: true });
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') last.content = assistantAnswer;
                    return updated;
                });
            }

            if (!assistantAnswer.trim()) {
                throw new Error('빈 응답을 받았습니다.');
            }
            const completed = [...convo, { role: 'assistant' as const, content: assistantAnswer }];
            setMessages(completed);
            // 답변 생성과 상담 기록 저장은 별도 결과로 처리한다. 저장 실패가 이미
            // 생성된 답변까지 오류로 바꾸지 않으며, 헤더에서 수동 재저장할 수 있다.
            await saveConversation(completed);
        } catch (error) {
            console.error('Chat error:', error);
            // 작업 생성(/jobs, axios)과 생성 라우트(/api/chat) 어느 쪽의 한도 초과든 사유를 보여준다.
            const reason = String((error as any)?.response?.data?.detail || (error instanceof Error ? error.message : ''));
            const failure = /한도|너무 많습니다/.test(reason)
                ? `죄송합니다. ${reason}`
                : '죄송합니다. 오류가 발생했습니다. 다시 시도해 주세요.';
            if (jobId) api.patch(`/jobs/${jobId}`, { status: 'error', stage: '후속 질의 실패', error: error instanceof Error ? error.message : String(error) }).catch(() => { });
            setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant' && !last.content) {
                    last.content = failure;
                    return updated;
                }
                return [...updated, { role: 'assistant', content: failure }];
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <section className="mt-16 space-y-6 print:hidden">
            <div className="inline-flex items-center gap-2 text-accent font-bold text-[10px] tracking-[0.14em] uppercase">
                <MessageSquare size={14} className="text-accent" />
                AI 심층 분석 및 질의응답
            </div>

            <div className="bg-card border border-border rounded-[12px] shadow-[0_18px_55px_rgba(42,37,29,0.08)] overflow-hidden flex flex-col h-[600px]">
                {/* Header */}
                <div className="flex flex-col gap-4 border-b border-secondary/10 bg-secondary/[0.025] p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
                            <MessageSquare className="text-[#d7b77b] w-[18px] h-[18px]" />
                        </div>
                        <div>
                            <h3 className="editorial-serif font-semibold text-secondary leading-none">AI 전문가 상담</h3>
                            <p className="text-[9px] text-muted font-semibold uppercase tracking-[0.12em] mt-1">Follow-up Consultation</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div role="status" aria-live="polite" className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-bold ${saveState === 'error' ? 'border-red-200 bg-red-50 text-red-700' : saveState === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-secondary/10 bg-white text-muted'}`}>
                            {saveState === 'saving' ? <Loader2 size={13} className="animate-spin" /> : saveState === 'saved' ? <CheckCircle2 size={13} /> : saveState === 'error' ? <AlertCircle size={13} /> : <Save size={13} />}
                            {saveState === 'saving' ? '상담 기록 저장 중' : saveState === 'saved' ? `자동 저장됨${savedAt ? ` · ${savedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}` : saveState === 'error' ? '저장 실패 · 다시 저장 가능' : reportId > 0 ? '답변 후 자동 저장' : '보고서 저장 후 기록 가능'}
                        </div>
                        {messages.length > 0 && reportId > 0 && (
                            <button type="button" onClick={() => saveConversation(messages)} disabled={saveState === 'saving'} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-secondary/15 bg-white px-3 text-[10px] font-bold text-secondary transition-colors hover:border-accent/50 hover:bg-accent/[0.05] disabled:opacity-50">
                                <Save size={13} /> 기록 저장
                            </button>
                        )}
                        {messages.length > 0 && (
                            <button type="button" onClick={downloadConversation} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-secondary px-3 text-[10px] font-bold text-white transition-colors hover:bg-primary">
                                <Download size={13} /> 파일로 받기
                            </button>
                        )}
                    </div>
                </div>

                {/* Messages */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-[#fbf8f1]"
                >
                    {messages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                            <div className="w-16 h-16 bg-accent/[0.07] border border-accent/10 rounded-full flex items-center justify-center">
                                <Scale className="w-7 h-7 text-accent" />
                            </div>
                            <p className="text-sm font-medium text-slate-500">
                                리포트 내용에 대해 더 궁금한 점이 있으신가요?<br />
                                구체적인 법리 해석이나 대응 방안을 물어보세요.
                            </p>
                        </div>
                    )}

                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] md:max-w-[75%] p-4 md:p-5 rounded-[12px] ${msg.role === 'user'
                                    ? 'bg-primary text-white'
                                    : 'bg-white text-secondary border border-secondary/10 border-l-2 border-l-accent'
                                }`}>
                                <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white p-4 rounded-[12px] border border-secondary/10">
                                <Loader2 className="w-5 h-5 animate-spin text-accent" />
                            </div>
                        </div>
                    )}
                </div>

                {/* Input */}
                <form
                    onSubmit={handleSendMessage}
                    className="p-5 bg-secondary/[0.025] border-t border-secondary/10"
                >
                    <div className="relative group">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="추가 질문을 입력하세요..."
                            className="w-full bg-white border border-secondary/15 rounded-[10px] py-4 pl-5 pr-14 text-sm md:text-base focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 transition-all"
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="absolute right-2 top-2 bottom-2 px-4 bg-secondary text-[#d7b77b] rounded-lg hover:bg-primary disabled:opacity-50 disabled:bg-slate-400 transition-all"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                </form>
            </div>
        </section>
    );
}
