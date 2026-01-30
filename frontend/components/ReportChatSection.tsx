"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Loader2, Scale, Zap } from 'lucide-react';
import api from '@/utils/api';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ReportChatSectionProps {
    reportId: number;
    initialHistory?: Message[];
}

export default function ReportChatSection({ reportId, initialHistory = [] }: ReportChatSectionProps) {
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
        if (!input.trim() || isLoading || isNaN(reportId)) return;

        const userMessage = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append('query', userMessage);
            const response = await api.post(`/chat/report/${reportId}`, formData);
            setMessages(prev => [...prev, { role: 'assistant', content: response.data.answer }]);
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: '죄송합니다. 오류가 발생했습니다. 다시 시도해 주세요.' }]);
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
