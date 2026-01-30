"use client";

import { Scale, HelpCircle, ShieldCheck, Zap, Printer, Download, BookOpen, Loader2, X, Info, MessageCircle, MessageSquare, Bookmark, BookmarkPlus, BookmarkCheck } from "lucide-react";
import { useState, useEffect } from "react";
import axios from "axios";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import ReportChatSection from "./ReportChatSection";

interface LegalReportViewProps {
    reportId: string;
    query: string;
    answer: string;
    sources: any[];
    engine?: string;
    chat_history?: any[];
}

export default function LegalReportView({ reportId, query, answer, sources, engine, chat_history = [] }: LegalReportViewProps) {
    const [mounted, setMounted] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const { user } = useAuth();
    const [subscribedLaws, setSubscribedLaws] = useState<string[]>([]);
    const [submittingLaw, setSubmittingLaw] = useState<string | null>(null);

    useEffect(() => {
        setMounted(true);
        if (user) {
            fetchSubscriptions();
        }
    }, [user]);

    const fetchData = async () => {
        if (user) {
            fetchSubscriptions();
        }
    };

    const fetchSubscriptions = async () => {
        try {
            const res = await api.get("/subscriptions");
            setSubscribedLaws(res.data.map((s: any) => s.law_name));
        } catch (error) {
            console.error("Failed to fetch subscriptions:", error);
        }
    };

    const toggleSubscription = async (lawName: string) => {
        if (!user) return;
        setSubmittingLaw(lawName);
        try {
            if (subscribedLaws.includes(lawName)) {
                await api.delete(`/subscriptions?law_name=${encodeURIComponent(lawName)}`);
                setSubscribedLaws(prev => prev.filter(l => l !== lawName));
            } else {
                const formData = new FormData();
                formData.append("law_name", lawName);
                await api.post("/subscriptions", formData);
                setSubscribedLaws(prev => [...prev, lawName]);
            }
        } catch (error) {
            console.error("Failed to toggle subscription:", error);
        } finally {
            setSubmittingLaw(null);
        }
    };

    const getApiUrl = () => {
        if (typeof window !== "undefined") {
            return window.location.hostname === "localhost" ? "http://localhost:8000" : "http://127.0.0.1:8000";
        }
        return "http://127.0.0.1:8000";
    };

    // Clean markdown and artifacts
    const cleanContent = (text: string) => {
        if (!text) return "";
        return text
            .replace(/\*\*(.*?)\*\*/g, "$1") // Remove bold markers
            .replace(/#{1,6}\s?/g, "")       // Remove all markdown headers and # symbols
            .replace(/[-\*]\s?/g, "• ")       // Replace bullet points with a cleaner bullet
            .replace(/\\n/g, "\n")           // Handle literal newlines
            .trim();
    };

    // Parse AI response into sections
    const parseReport = (text: string) => {
        const sections: { [key: string]: string } = {
            overview: "",
            analysis: "",
            conclusion: "",
            action: ""
        };

        const overviewMatch = text.match(/(?:1\.\s*)?(?:\*\*)?사건\s*개요(?:\*\*)?([\s\S]*?)(?=(?:\d\.\s*)?(?:\*\*)?법률\s*분석(?:\*\*)?|$)/i);
        const analysisMatch = text.match(/(?:2\.\s*)?(?:\*\*)?법률\s*분석(?:\*\*)?([\s\S]*?)(?=(?:\d\.\s*)?(?:\*\*)?결론(?:\*\*)?|$)/i);
        const conclusionMatch = text.match(/(?:3\.\s*)?(?:\*\*)?결론(?:\*\*)?([\s\S]*?)(?=(?:\d\.\s*)?(?:\*\*)?향후\s*조치(?:\*\*)?|$)/i);
        const actionMatch = text.match(/(?:4\.\s*)?(?:\*\*)?향후\s*조치(?:\*\*)?([\s\S]*?)$/i);

        if (overviewMatch) sections.overview = cleanContent(overviewMatch[1]);
        if (analysisMatch) sections.analysis = cleanContent(analysisMatch[1]);
        if (conclusionMatch) sections.conclusion = cleanContent(conclusionMatch[1]);
        if (actionMatch) sections.action = cleanContent(actionMatch[1]);

        if (!sections.overview && !sections.analysis) {
            sections.overview = cleanContent(text);
        }

        return sections;
    };

    const sections = parseReport(answer);


    const renderContent = (content: string) => {
        if (!content) return null;
        return (
            <div className="leading-[1.8] break-keep whitespace-pre-wrap px-1 text-slate-700 font-serif">
                {content}
            </div>
        );
    };

    if (!mounted) return <div className="min-h-screen bg-[#f8fafc] animate-pulse" />;

    return (
        <div className="bg-[#f8fafc] min-h-screen text-slate-900 flex flex-col relative overflow-hidden">

            {/* Main Layout Grid */}
            <div className="flex-1 flex w-full max-w-[1600px] mx-auto relative group">

                {/* Left Side: Report View */}
                <div className="flex-1 p-6 md:p-12 lg:p-20 overflow-y-auto max-h-screen scrollbar-hide w-full">
                    <div className="max-w-3xl mx-auto space-y-16">

                        <div className="flex flex-col md:flex-row justify-end items-stretch md:items-center gap-3 print:hidden mb-12 border-b border-slate-100 pb-4">
                            <button
                                onClick={() => window.print()}
                                className="flex items-center justify-center gap-2 px-6 py-3 md:py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl transition-all text-sm font-bold shadow-lg shadow-slate-900/20"
                            >
                                <Printer size={16} /> 리포트 인쇄 / PDF 저장
                            </button>
                        </div>

                        {/* Title Branding */}
                        <div className="flex justify-between items-end border-b-4 border-slate-900 pb-8">
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="relative w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg transform -rotate-3">
                                        <div className="absolute inset-0 bg-blue-500/20 animate-pulse rounded-2xl"></div>
                                        <Scale className="text-white w-6 h-6" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-2xl font-black text-slate-900 tracking-tighter leading-none">JongLaw AI</span>
                                        <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mt-1">Professional Legal Engine</span>
                                    </div>
                                </div>
                                <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight leading-tight uppercase">Legal Consultation Report</h1>
                                <div className="flex items-center gap-3 text-sm text-slate-400 font-mono italic">
                                    <span>#{reportId}</span>
                                    <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                                    <span>Issued: {new Date().toLocaleDateString()}</span>
                                    {engine && (
                                        <>
                                            <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                                            <span className="text-blue-500 font-bold opacity-80 flex items-center gap-1">
                                                <Zap size={12} /> {engine} Engine
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col items-center md:items-end gap-2 shrink-0">
                                <div className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-full text-[12px] font-black tracking-widest border shadow-xl shadow-blue-500/30">
                                    <ShieldCheck size={14} /> VERIFIED
                                </div>
                                <div className="px-4 py-1.5 bg-red-50 text-red-600 text-[11px] font-bold rounded-lg border border-red-100 uppercase tracking-widest">
                                    CONFIDENTIAL
                                </div>
                            </div>
                        </div>

                        {/* Query Section */}
                        <section className="space-y-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-lg text-slate-500 font-bold text-[11px] tracking-wider uppercase">
                                <HelpCircle size={14} className="text-slate-400" />
                                Client Inquiry
                            </div>
                            <div className="relative p-6 md:p-10 bg-white border-2 border-slate-100 rounded-[1.5rem] md:rounded-[2.5rem] shadow-sm">
                                <div className="absolute top-8 left-8 text-slate-100 select-none hidden md:block">
                                    <Scale size={64} />
                                </div>
                                <div className="relative text-lg md:text-xl text-slate-700 leading-relaxed font-semibold italic md:indent-6 whitespace-pre-wrap">
                                    "{query}"
                                </div>
                            </div>
                        </section>

                        {/* Opinion Section */}
                        <section className="space-y-12">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-lg text-blue-600 font-bold text-[11px] tracking-wider uppercase">
                                <Zap size={14} className="text-blue-500 animate-pulse" />
                                Legal Opinion
                            </div>

                            <div className="space-y-20">
                                {/* 1. Overview */}
                                {sections.overview && (
                                    <div className="group space-y-6">
                                        <div className="flex items-center gap-4 border-l-8 border-slate-900 pl-6">
                                            <span className="text-lg font-black text-slate-300">01</span>
                                            <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">사건 개요</h3>
                                        </div>
                                        <div className="text-slate-700 pl-0 md:pl-14 text-base md:text-lg">
                                            {renderContent(sections.overview)}
                                        </div>
                                    </div>
                                )}

                                {/* 2. Analysis */}
                                {sections.analysis && (
                                    <div className="group space-y-6">
                                        <div className="flex items-center gap-4 border-l-8 border-slate-900 pl-6">
                                            <span className="text-lg font-black text-slate-300">02</span>
                                            <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">법률 분석</h3>
                                        </div>
                                        <div className="text-slate-700 pl-0 md:pl-14 text-base md:text-lg">
                                            {renderContent(sections.analysis)}
                                        </div>
                                    </div>
                                )}

                                {/* 3. Conclusion */}
                                {sections.conclusion && (
                                    <div className="group space-y-6">
                                        <div className="flex items-center gap-4 border-l-8 border-blue-600 pl-6">
                                            <span className="text-lg font-black text-blue-400">03</span>
                                            <h3 className="text-2xl font-black text-blue-600 uppercase tracking-tight">핵심 결론</h3>
                                        </div>
                                        <div className="ml-0 md:ml-14 relative">
                                            <div className="relative bg-blue-50/50 shadow-sm border border-blue-100 p-8 md:p-12 rounded-[1.5rem] md:rounded-[2.5rem] text-slate-900 text-lg md:text-xl font-medium leading-relaxed">
                                                {renderContent(sections.conclusion)}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 4. Steps */}
                                {sections.action && (
                                    <div className="group space-y-6">
                                        <div className="flex items-center gap-4 border-l-8 border-emerald-600 pl-6">
                                            <span className="text-lg font-black text-emerald-400">04</span>
                                            <h3 className="text-2xl font-black text-emerald-600 uppercase tracking-tight">향후 조치</h3>
                                        </div>
                                        <div className="text-slate-700 pl-0 md:pl-14 text-base md:text-lg">
                                            {renderContent(sections.action)}
                                        </div>
                                    </div>
                                )}

                                {/* Sources & Subscription Section */}
                                {sources && sources.length > 0 && (
                                    <section className="space-y-6">
                                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-lg text-slate-500 font-bold text-[11px] tracking-wider uppercase">
                                            <BookOpen size={14} className="text-slate-400" />
                                            Relevant Laws & Sources
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {sources.map((src, idx) => {
                                                const isLaw = src.source && (src.source.endsWith("법") || src.source.endsWith("령") || src.source.endsWith("규칙") || src.source.endsWith("률"));
                                                const isSubscribed = subscribedLaws.includes(src.source);
                                                const isSubmitting = submittingLaw === src.source;

                                                return (
                                                    <div key={idx} className="p-4 bg-white border border-slate-100 rounded-2xl flex items-center justify-between group hover:border-blue-200 transition-all shadow-sm">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`p-2 rounded-lg ${isLaw ? "bg-blue-50 text-blue-500" : "bg-slate-50 text-slate-400"}`}>
                                                                <Scale size={18} />
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-sm font-bold text-slate-800 tracking-tight">{src.source}</span>
                                                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{isLaw ? "Statute" : "Document"}</span>
                                                            </div>
                                                        </div>
                                                        {isLaw && user && (
                                                            <button
                                                                onClick={() => toggleSubscription(src.source)}
                                                                disabled={isSubmitting}
                                                                className={`p-2 rounded-xl transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${isSubscribed
                                                                    ? "bg-blue-50 text-blue-600 border border-blue-100"
                                                                    : "bg-slate-50 text-slate-400 border border-transparent hover:bg-blue-50 hover:text-blue-500"
                                                                    }`}
                                                            >
                                                                {isSubmitting ? (
                                                                    <Loader2 size={14} className="animate-spin" />
                                                                ) : isSubscribed ? (
                                                                    <BookmarkCheck size={14} />
                                                                ) : (
                                                                    <BookmarkPlus size={14} />
                                                                )}
                                                                {isSubscribed ? "Subscribed" : "Watch"}
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                )}
                            </div>
                        </section>

                        <div className="flex flex-col items-center gap-6 pt-20 border-t border-slate-100 opacity-40 select-none pb-12">
                            <div className="flex items-center gap-3 text-slate-400 grayscale">
                                <Scale size={20} />
                                <span className="text-[11px] font-black tracking-[0.2em]">JONGLAW AI TECHNOLOGY</span>
                            </div>
                            <div className="text-[10px] font-mono font-bold text-slate-300 tracking-[0.6em] text-center uppercase">
                                Secure Encrypted Session Report<br />
                                Verified Authentication Token
                            </div>
                        </div>
                    </div>
                </div>

            </div>
            );
}
