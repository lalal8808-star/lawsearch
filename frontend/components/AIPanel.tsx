"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, Scale, BookOpen, FileText, Clock, X, ShieldCheck, AlertTriangle, FileSearch, CheckCircle2, AlertCircle } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";
import ImageUpload from "./ImageUpload";

export default function AIPanel() {
    const [query, setQuery] = useState("");
    const [messages, setMessages] = useState<{ role: string; content: string; sources?: any[]; intent?: string; engine?: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [loadingStage, setLoadingStage] = useState("");
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [mounted, setMounted] = useState(false);
    const { user } = useAuth();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: "smooth"
            });
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Auto-expand textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [query]);

    // Simulated progress timer
    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (loading) {
            setProgress(0);
            setLoadingStage("사건 분석중...");
            timer = setInterval(() => {
                setProgress(prev => {
                    const next = prev + (prev < 60 ? Math.random() * 5 : prev < 90 ? Math.random() * 2 : 0.1);
                    if (next < 30) setLoadingStage("사건 분석중...");
                    else if (next < 60) setLoadingStage("관련 법령 및 판례 검색중...");
                    else if (next < 85) setLoadingStage("AI 답변 생성중...");
                    else setLoadingStage("최종 검토 및 정리중...");
                    return prev < 98 ? next : prev;
                });
            }, 500);
        } else {
            setProgress(0);
            setLoadingStage("");
        }
        return () => clearInterval(timer);
    }, [loading]);


    const openReportWindow = (q: string, a: string, s: any[], e?: string, ch?: any[], realId?: number) => {
        const reportId = realId ? realId.toString() : `JL-${new Date().getTime().toString().slice(-6)}`;
        sessionStorage.setItem("jonglaw_last_report", JSON.stringify({
            reportId,
            query: q,
            answer: a,
            sources: s,
            engine: e,
            chat_history: ch || []
        }));
        window.open("/report", "_blank");
    };

    const handleCancel = () => {
        if (abortController) {
            abortController.abort();
            setAbortController(null);
            setLoading(false);
            setMessages(prev => [
                ...prev,
                { role: "assistant", content: "요청이 취소되었습니다." }
            ]);
        }
    };

    const handleSend = async () => {
        if (!query.trim() || loading) return;

        setLoading(true);
        const currentQuery = query;
        const userMsg = { role: "user", content: currentQuery };
        setMessages((prev) => [...prev, userMsg]);
        setQuery("");
        const controller = new AbortController();
        setAbortController(controller);

        try {
            let res;
            if (selectedImage) {
                const formData = new FormData();
                formData.append("file", selectedImage);
                if (currentQuery) formData.append("description", currentQuery);

                res = await api.post(`/analyze-image`, formData, {
                    signal: controller.signal
                });

                const assistantMsg = {
                    role: "assistant",
                    content: "이미지 분석 결과입니다.",
                    visionData: res.data,
                    intent: "VISION_ANALYSIS",
                    engine: "gemini-2.0-flash-lite"
                };
                setMessages((prev) => [...prev, assistantMsg]);
                setSelectedImage(null); // Clear after send
            } else {
                const formData = new FormData();
                formData.append("query", currentQuery);
                res = await api.post(`/query`, formData, {
                    signal: controller.signal
                });

                const assistantMsg = {
                    role: "assistant",
                    content: res.data.answer,
                    sources: res.data.sources,
                    intent: res.data.intent,
                    engine: res.data.engine
                };
                setMessages((prev) => [...prev, assistantMsg]);

                // Auto open report only if intent is REPORT
                if (res.data.intent === "REPORT") {
                    openReportWindow(currentQuery, res.data.answer, res.data.sources, res.data.engine, res.data.chat_history, res.data.report_id);
                }
            }

        } catch (error: any) {
            if (error.name === 'CanceledError') return;
            console.error("AI Query Error:", error);
            const detail = error.response?.data?.detail;
            const message = typeof detail === "string" ? detail : (error.message || "서버 통신 중 오류가 발생했습니다.");
            setMessages((prev) => [
                ...prev,
                { role: "assistant", content: `죄송합니다. 오류가 발생했습니다: ${message}` },
            ]);
        } finally {
            setLoading(false);
            setAbortController(null);
        }
    };

    if (!mounted) return <div className="flex-1 glass-card animate-pulse" />;

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] glass-card overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
                        <Scale className="text-white w-5 h-5" />
                    </div>
                    <div className="flex flex-col">
                        <h2 className="font-bold text-md leading-none">JongLaw AI</h2>
                        <span className="text-[9px] text-primary/80 font-bold uppercase tracking-widest mt-0.5">Legal Intelligence</span>
                    </div>
                </div>
            </div>

            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar"
            >
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-muted space-y-3">
                        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                            <Bot className="w-8 h-8 opacity-20" />
                        </div>
                        <p className="text-sm font-medium">JongLaw AI에게 궁금한 법률 사항을 물어보세요.</p>
                    </div>
                )}
                <AnimatePresence>
                    {messages.map((msg, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex group ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                            <div
                                className={`max-w-[85%] p-4 rounded-2xl ${msg.role === "user"
                                    ? "bg-primary text-white shadow-lg shadow-primary/20"
                                    : "bg-white/5 border border-white/10 border-l-4 border-l-primary/50"
                                    }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    {msg.role === "user" ? <User size={14} /> : <div className="w-4 h-4 bg-primary rounded-sm flex items-center justify-center"><Scale size={10} className="text-white" /></div>}
                                    <span className="text-xs font-bold uppercase opacity-60 tracking-wider">
                                        {msg.role === "user" ? (user?.nickname || "Client") : "JongLaw AI"}
                                    </span>
                                </div>
                                <div className="whitespace-pre-wrap text-sm leading-relaxed break-keep">
                                    {msg.role === "assistant" && msg.intent === "REPORT" ? (
                                        <div className="py-2 space-y-2">
                                            <div className="flex items-center gap-2 text-primary">
                                                <ShieldCheck size={16} />
                                                <span className="font-bold">분석이 완료되었습니다.</span>
                                            </div>
                                            <p className="text-muted text-xs leading-relaxed">
                                                요청하신 사안에 대한 전문 법률 자문 보고서가 생성되었습니다. 아래 버튼을 눌러 상세 내용을 확인해 주세요.
                                            </p>
                                        </div>
                                    ) : (msg as any).intent === "VISION_ANALYSIS" ? (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-primary border-b border-white/10 pb-2">
                                                <FileSearch size={18} />
                                                <span className="font-extrabold uppercase tracking-tight">Contract Vision Analysis</span>
                                                <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${(msg as any).visionData.risk_level === '고' ? 'bg-red-500/20 text-red-500' :
                                                    (msg as any).visionData.risk_level === '중' ? 'bg-orange-500/20 text-orange-500' :
                                                        'bg-green-500/20 text-green-500'
                                                    }`}>
                                                    위험도: {(msg as any).visionData.risk_level}
                                                </span>
                                            </div>

                                            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                                                <h4 className="text-xs font-bold text-muted mb-1 uppercase tracking-widest">문서 종류</h4>
                                                <p className="text-sm font-semibold">{(msg as any).visionData.document_type}</p>
                                            </div>

                                            {(msg as any).visionData.toxic_clauses?.length > 0 && (
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-bold text-red-400 flex items-center gap-1.5 uppercase tracking-widest">
                                                        <AlertTriangle size={14} /> 독소 조항 분석
                                                    </h4>
                                                    {(msg as any).visionData.toxic_clauses.map((c: any, i: number) => (
                                                        <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-2">
                                                            <p className="text-[13px] font-bold text-red-200">"{c.clause}"</p>
                                                            <div className="text-xs text-red-200/70 leading-relaxed">
                                                                <span className="font-black text-red-400/80 mr-1">[이유]</span> {c.reason}
                                                            </div>
                                                            <div className="text-xs text-green-200/70 leading-relaxed">
                                                                <span className="font-black text-green-400/80 mr-1">[추천 수정]</span> {c.suggestion}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {(msg as any).visionData.missing_items?.length > 0 && (
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-bold text-orange-400 flex items-center gap-1.5 uppercase tracking-widest">
                                                        <AlertCircle size={14} /> 누락된 필수 항목
                                                    </h4>
                                                    <ul className="grid grid-cols-1 gap-1">
                                                        {(msg as any).visionData.missing_items.map((item: string, i: number) => (
                                                            <li key={i} className="text-xs text-muted flex items-center gap-2 bg-white/5 px-2 py-1.5 rounded-lg border border-white/5">
                                                                <div className="w-1 h-1 bg-orange-400 rounded-full" />
                                                                {item}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3">
                                                <h4 className="text-xs font-bold text-blue-400 mb-2 flex items-center gap-1.5 uppercase tracking-widest">
                                                    <CheckCircle2 size={14} /> 종합 변호사 의견
                                                </h4>
                                                <p className="text-[13px] leading-relaxed italic text-blue-100/90 break-keep">
                                                    {(msg as any).visionData.overall_opinion}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        msg.content
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(msg.content);
                                        }}
                                        className="text-[10px] font-bold text-muted hover:text-primary transition-colors flex items-center gap-1 bg-white/5 px-2 py-1 rounded-md"
                                    >
                                        <Clock size={10} />
                                        복사하기
                                    </button>
                                </div>

                                {msg.role === "assistant" && (
                                    <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                                        {(msg as any).intent === "VISION_ANALYSIS" ? (
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted uppercase">
                                                <Scale size={14} className="text-primary" />
                                                Vision-Driven Analysis
                                            </div>
                                        ) : msg.intent === "REPORT" ? (
                                            <button
                                                onClick={() => openReportWindow(
                                                    messages[idx - 1]?.content || "질의 사항",
                                                    msg.content,
                                                    msg.sources || [],
                                                    msg.engine
                                                )}
                                                className="flex items-center gap-2 bg-primary text-white text-[10px] font-black px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-primary/20 hover:scale-[1.05] active:scale-[0.95] w-fit uppercase"
                                            >
                                                <FileText size={14} />
                                                보고서 열기 (새 창)
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted uppercase">
                                                <Bot size={14} className="opacity-40" />
                                                General Consultation
                                            </div>
                                        )}

                                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-muted uppercase tracking-tighter">
                                            <Clock size={10} />
                                            {msg.intent === "REPORT" ? "Legal Analysis" : "Chat Response"}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-white/5 border border-white/10 p-4 rounded-2xl animate-pulse flex flex-col gap-3 min-w-[220px]">
                            <div className="flex flex-col items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></div>
                                </div>
                                <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em] animate-pulse">
                                    {loadingStage} ({Math.round(progress)}%)
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex flex-col gap-1.5 flex-1">
                                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                        <motion.div
                                            className="h-full bg-primary"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${progress}%` }}
                                            transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={handleCancel}
                                    className="p-1.5 hover:bg-white/10 rounded-lg text-muted hover:text-white transition-colors h-fit shrink-0"
                                    title="취소"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <p className="text-[10px] text-muted font-medium opacity-60">
                                대한민국의 방대한 법령과 판례를 분석하고 있습니다. 잠시만 기다려주세요.
                            </p>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-white/10 border-t border-white/10 backdrop-blur-md">
                <div className="flex gap-2 items-end">
                    <ImageUpload
                        onUpload={setSelectedImage}
                        onClear={() => setSelectedImage(null)}
                        busy={loading}
                    />
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-white/20 resize-none min-h-[44px] max-h-[200px] custom-scrollbar leading-relaxed"
                        placeholder={selectedImage ? "이미지 분석을 위한 설명을 입력하거나(선택), 전송 버튼을 눌러주세요..." : "법률 관련 궁금한 점을 질문해보세요..."}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={loading}
                        className="bg-primary hover:bg-primary/80 text-white p-3 rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-primary/20 hover:scale-[1.05] active:scale-[0.95]"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
