"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Send, X, MessageSquare, Loader2 } from 'lucide-react';
import api from '@/utils/api';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ReportChatSidebarProps {
    reportId: number;
    isOpen: boolean;
    onClose: () => void;
    initialHistory?: Message[];
}

const ReportChatSidebar: React.FC<ReportChatSidebarProps> = ({ reportId, isOpen, onClose, initialHistory = [] }) => {
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

            console.log(`DEBUG: Sending follow-up for reportId: ${reportId}`);
            const response = await api.post(`/chat/report/${reportId}`, formData);

            setMessages(prev => [...prev, { role: 'assistant', content: response.data.answer }]);
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: '죄송합니다. 오류가 발생했습니다. 다시 시도해 주세요.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed right-0 top-0 h-full w-96 bg-white/80 backdrop-blur-xl border-l border-zinc-200 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-white/50">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                    <h3 className="font-bold text-zinc-900">리포트 심층 질의</h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-zinc-100 rounded-full transition-colors"
                >
                    <X className="w-5 h-5 text-zinc-500" />
                </button>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4"
            >
                {messages.length === 0 && (
                    <div className="text-center py-10 px-4">
                        <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <MessageSquare className="w-6 h-6 text-blue-500" />
                        </div>
                        <p className="text-zinc-500 text-sm">
                            리포트 내용에 대해 궁금한 점을 질문해 보세요.<br />
                            "부당이득 조항에 대해 더 설명해줘"와 같이 물어볼 수 있습니다.
                        </p>
                    </div>
                )}

                {messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user'
                                ? 'bg-blue-600 text-white rounded-tr-none'
                                : 'bg-zinc-100 text-zinc-800 rounded-tl-none border border-zinc-200'
                                }`}
                        >
                            {msg.content}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-zinc-100 p-3 rounded-2xl rounded-tl-none border border-zinc-200">
                            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                        </div>
                    </div>
                )}
            </div>

            <form
                onSubmit={handleSendMessage}
                className="p-4 border-t border-zinc-100 bg-white/50 bg-zinc-50"
            >
                <div className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="질문을 입력하세요..."
                        className="w-full bg-white border border-zinc-200 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="absolute right-2 top-1.5 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:bg-zinc-400 transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ReportChatSidebar;
