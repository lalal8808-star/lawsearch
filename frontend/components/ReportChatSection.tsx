"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Loader2, Scale, Zap } from 'lucide-react';

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

export default function ReportChatSection({ initialHistory = [], query, answer }: ReportChatSectionProps) {
    const [messages, setMessages] = useState<Message[]>(initialHistory);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput('');
        const convo = [...messages, { role: 'user' as const, content: userMessage }];
        setMessages(convo);
        setIsLoading(true);

        try {
            let token = localStorage.getItem('jonglaw_token');
            if (token === 'null' || token === 'undefined') token = null;

            // 메인 채팅발 임시 리포트는 백엔드에 저장돼 있지 않으므로, 리포트 내용을
            // 대화 맥락으로 전달하고 Vercel AI Gateway(/api/chat)로 후속 질문을 처리한다.
            const payloadMessages = [
                ...(query ? [{ role: 'user', content: query }] : []),
                ...(answer ? [{ role: 'assistant', content: answer }] : []),
                ...convo,
            ].map(m => ({ role: m.role, content: m.content }));

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ messages: payloadMessages }),
            });

            if (!response.ok) {
                throw new Error('채팅 응답에 실패했습니다.');
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
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant' && !last.content) {
                    last.content = '죄송합니다. 오류가 발생했습니다. 다시 시도해 주세요.';
                    return updated;
                }
                return [...updated, { role: 'assistant', content: '죄송합니다. 오류가 발생했습니다. 다시 시도해 주세요.' }];
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <section className="mt-20 space-y-8 print:hidden">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-lg text-blue-600 font-bold text-[11px] tracking-wider uppercase">
                <MessageSquare size={14} className="text-blue-500 animate-pulse" />
                AI 심층 분석 및 질의응답
            </div>

            <div className="bg-white border-2 border-slate-100 rounded-[2.5rem] shadow-sm overflow-hidden flex flex-col h-[600px]">
                {/* Header */}
                <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <MessageSquare className="text-white w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-900 leading-none">AI 전문가 상담</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Real-time Legal Consultation</p>
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px]"
                >
                    {messages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                            <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center">
                                <Scale className="w-8 h-8 text-slate-400" />
                            </div>
                            <p className="text-sm font-medium text-slate-500">
                                리포트 내용에 대해 더 궁금한 점이 있으신가요?<br />
                                구체적인 법리 해석이나 대응 방안을 물어보세요.
                            </p>
                        </div>
                    )}

                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] md:max-w-[75%] p-4 md:p-6 rounded-[1.5rem] shadow-sm ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-tr-none'
                                    : 'bg-slate-50 text-slate-700 rounded-tl-none border border-slate-100'
                                }`}>
                                <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-slate-50 p-4 rounded-[1.5rem] rounded-tl-none border border-slate-100">
                                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                            </div>
                        </div>
                    )}
                </div>

                {/* Input */}
                <form
                    onSubmit={handleSendMessage}
                    className="p-6 bg-slate-50/50 border-t border-slate-100"
                >
                    <div className="relative group">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="추가 질문을 입력하세요..."
                            className="w-full bg-white border-2 border-slate-200 rounded-2xl py-4 pl-6 pr-14 text-sm md:text-base focus:outline-none focus:border-blue-500 transition-all shadow-sm group-hover:border-slate-300"
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="absolute right-2 top-2 bottom-2 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:bg-slate-400 transition-all shadow-lg shadow-blue-500/20"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                </form>
            </div>
        </section>
    );
}
