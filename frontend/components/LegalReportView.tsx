"use client";

import { Scale, HelpCircle, ShieldCheck, Zap, Printer, Download, BookOpen, Loader2, X, Info, MessageCircle, MessageSquare, Bookmark, BookmarkPlus, BookmarkCheck, AlertCircle, Upload, ExternalLink, FileText } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import ReportChatSection from "./ReportChatSection";

interface Source {
    source: string;
    type?: string;
}

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

interface LegalReportViewProps {
    reportId: string;
    query: string;
    answer: string;
    sources: Source[];
    engine?: string;
    chat_history?: ChatMessage[];
    visionData?: any;
}

export default function LegalReportView({ reportId, query, answer, sources, engine, chat_history = [], visionData }: LegalReportViewProps) {
    const [mounted, setMounted] = useState(false);
    const router = useRouter();
    const { user } = useAuth();
    const [subscribedLaws, setSubscribedLaws] = useState<string[]>([]);
    const [submittingLaw, setSubmittingLaw] = useState<string | null>(null);
    const [citations, setCitations] = useState<any[]>([]);
    const [verifying, setVerifying] = useState(false);

    const [error, setError] = useState<string | null>(null);

    const verifyCitations = async () => {
        if (!answer || !answer.trim()) return;
        setVerifying(true);
        try {
            const res = await api.post("/verify-citations", { text: answer });
            setCitations(res.data?.citations || []);
        } catch (e) {
            console.error("Citation verification failed", e);
        } finally {
            setVerifying(false);
        }
    };

    useEffect(() => {
        setMounted(true);
        if (user) {
            fetchSubscriptions();
            if (!visionData) verifyCitations();
        }

        // Set document title for PDF filename auto-generation
        const now = new Date();
        const dateStr = now.getFullYear().toString().slice(-2) +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0');
        const reportTitle = visionData 
            ? `${dateStr} 계약서분석보고서(${reportId})` 
            : `${dateStr} 법률보고서(${reportId})`;
        const originalTitle = document.title;
        document.title = reportTitle;

        return () => {
            document.title = originalTitle;
        };
    }, [user, reportId, visionData]);

    const fetchSubscriptions = async () => {
        try {
            setError(null);
            const res = await api.get("/subscriptions");
            setSubscribedLaws(res.data.map((s: { law_name: string }) => s.law_name));
        } catch (error) {
            console.error("Failed to fetch subscriptions:", error);
            setError("구독 정보를 불러오는데 실패했습니다.");
        }
    };

    const toggleSubscription = async (lawName: string) => {
        if (!user) return;
        setSubmittingLaw(lawName);
        setError(null);
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
            setError("알림 설정 중 오류가 발생했습니다. 다시 시도해 주세요.");
        } finally {
            setSubmittingLaw(null);
        }
    };

    const getApiUrl = () => {
        return api.defaults.baseURL || "";
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

    // Parse AI response into sections (heading-based).
    // Only treats a line as a section title when it starts with a markdown header (#),
    // a number (1. / 1)), or is a fully bold line (**...**) AND is short. This prevents
    // an inline TOC line like "사건 개요 → 법률 분석 → 결론" or prose like "결론부터 말하면"
    // from being matched instead of the real section bodies further down.
    const parseReport = (text: string) => {
        const sections: { [key: string]: string } = {
            overview: "",
            analysis: "",
            conclusion: "",
            action: ""
        };

        const classify = (line: string): string | null => {
            const isHeading =
                /^[ \t]*#{1,6}\s+\S/.test(line) ||
                /^[ \t]*\d+\s*[.)]\s*\S/.test(line) ||
                /^[ \t]*\*\*[^*]+\*\*[ \t]*$/.test(line);
            if (!isHeading) return null;

            const t = line
                .replace(/^[ \t]*#{1,6}\s*/, "")
                .replace(/^\s*\d+\s*[.)]\s*/, "")
                .replace(/\*\*/g, "")
                .replace(/^\s*\d+\s*[.)]\s*/, "")
                .trim();
            if (t.length > 12) return null; // long lines are body text, not titles

            if (/^향후\s*조치/.test(t)) return "action";
            if (/^(?:핵심\s*)?결론/.test(t)) return "conclusion";
            if (/^판례\s*분석/.test(t)) return "analysis";
            if (/^법률\s*분석/.test(t)) return "analysis";
            if (/^사건\s*개요/.test(t)) return "overview";
            return null;
        };

        const buf: { [key: string]: string[] } = {
            overview: [], analysis: [], conclusion: [], action: []
        };
        let current: string | null = null;

        for (const line of text.split("\n")) {
            const sec = classify(line);
            if (sec) {
                current = sec;
                // Preserve the 판례 분석 sub-title inside the analysis section
                if (/^[ \t]*(?:#{1,6}\s*|\d+\s*[.)]\s*|\*\*)?\s*판례\s*분석/.test(line)) {
                    buf.analysis.push("• 판례 분석");
                }
                continue;
            }
            if (current) buf[current].push(line);
        }

        sections.overview = cleanContent(buf.overview.join("\n"));
        sections.analysis = cleanContent(buf.analysis.join("\n"));
        sections.conclusion = cleanContent(buf.conclusion.join("\n"));
        sections.action = cleanContent(buf.action.join("\n"));

        // Fallback: if nothing parsed, show the whole answer in the overview
        if (!sections.overview && !sections.analysis && !sections.conclusion && !sections.action) {
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

    const handlePrint = () => {
        window.print();
    };

    // 보고서를 Word(.docx)로 내보낸다. HWP도 .docx를 열 수 있어 실무 편집에 쓰기 좋다.
    // docx는 용량이 커서 클릭 시점에 동적 import → 초기 번들에 포함되지 않는다.
    const handleExportDocx = async () => {
        const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
        const P = (text: string) => new Paragraph({ text });
        const body: any[] = [];

        body.push(new Paragraph({ text: visionData ? "계약서 분석 보고서" : "법률 자문 보고서", heading: HeadingLevel.TITLE }));
        body.push(new Paragraph({ children: [new TextRun({ text: `#${reportId}  ·  ${new Date().toLocaleDateString()}${engine ? "  ·  " + engine : ""}`, italics: true, color: "888888" })] }));
        body.push(P(""));

        if (query) {
            body.push(new Paragraph({ text: "질의 내용", heading: HeadingLevel.HEADING_1 }));
            body.push(P(query));
            body.push(P(""));
        }

        const addSection = (title: string, content?: string) => {
            if (!content || !content.trim()) return;
            body.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
            content.split("\n").forEach((line) => body.push(P(line)));
            body.push(P(""));
        };

        if (visionData) {
            addSection("문서 종류", visionData.document_type);
            addSection("위험도", visionData.risk_level);
            if (Array.isArray(visionData.toxic_clauses) && visionData.toxic_clauses.length) {
                body.push(new Paragraph({ text: "독소 조항", heading: HeadingLevel.HEADING_1 }));
                visionData.toxic_clauses.forEach((c: any) => {
                    body.push(P(`• ${c.clause || ""}`));
                    if (c.reason) body.push(P(`   - 이유: ${c.reason}`));
                    if (c.suggestion) body.push(P(`   - 수정 제안: ${c.suggestion}`));
                });
                body.push(P(""));
            }
            if (Array.isArray(visionData.missing_items) && visionData.missing_items.length) {
                addSection("누락된 필수 항목", visionData.missing_items.map((m: string) => `• ${m}`).join("\n"));
            }
            addSection("종합 의견", visionData.overall_opinion);
        } else {
            addSection("사건 개요", sections.overview);
            addSection("법률 분석", sections.analysis);
            addSection("핵심 결론", sections.conclusion);
            addSection("향후 조치", sections.action);
            if (!sections.overview && !sections.analysis && !sections.conclusion && !sections.action) {
                addSection("내용", cleanContent(answer));
            }
        }

        if (sources && sources.length) {
            body.push(new Paragraph({ text: "참고 자료", heading: HeadingLevel.HEADING_1 }));
            sources.forEach((s) => body.push(P(`• ${s.source}${s.type === "user_upload" ? " (내 업로드 자료)" : ""}`)));
        }

        const doc = new Document({ sections: [{ children: body }] });
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${reportId || "report"}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    // 보고서를 한글(.hwpx)로 내보낸다. 백엔드(python-hwpx)가 생성한 파일을 받아 다운로드.
    const handleExportHwpx = async () => {
        try {
            const res = await api.post(
                "/export/hwpx",
                { reportId: reportId?.toString(), query, answer, sources },
                { responseType: "blob" }
            );
            const url = URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${reportId || "report"}.hwpx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert("HWP 파일 생성에 실패했습니다.");
        }
    };

    if (!mounted) return <div className="min-h-screen bg-[#f8fafc] animate-pulse" />;

    return (
        <div className="bg-[#f8fafc] min-h-screen text-slate-900 flex flex-col relative overflow-hidden">

            {/* Main Layout Grid */}
            <div className="flex-1 flex w-full max-w-[1600px] mx-auto relative group">

                {/* Left Side: Report View */}
                <div className="flex-1 p-6 md:p-12 lg:p-20 overflow-y-auto max-h-screen print:max-h-none print:overflow-visible scrollbar-hide w-full">
                    <div className="max-w-3xl mx-auto space-y-16">

                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center gap-3 p-4 bg-red-50 text-red-600 rounded-2xl border border-red-100 text-sm font-bold mb-8 print:hidden"
                                role="alert"
                            >
                                <AlertCircle size={18} />
                                {error}
                                <button onClick={() => setError(null)} className="ml-auto hover:bg-red-100 p-1 rounded-full transition-colors">
                                    <X size={16} />
                                </button>
                            </motion.div>
                        )}

                        <div className="flex flex-col md:flex-row justify-end items-stretch md:items-center gap-3 print:hidden mb-12 border-b border-slate-100 pb-4">
                            <button
                                aria-label="리포트 닫기"
                                onClick={() => router.push("/")}
                                className="flex items-center justify-center gap-2 px-6 py-3 md:py-2 bg-white text-slate-600 hover:bg-slate-50 border border-slate-100 rounded-xl transition-all text-sm font-bold"
                            >
                                <X size={16} aria-hidden="true" /> 닫기
                            </button>
                            <button
                                aria-label="법령 구독 관리 열기"
                                onClick={() => {
                                    const event = new CustomEvent('open-legal-watch');
                                    window.dispatchEvent(event);
                                }}
                                className="flex items-center justify-center gap-2 px-6 py-3 md:py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-xl transition-all text-sm font-bold shadow-lg shadow-blue-600/20"
                            >
                                <BookmarkCheck size={16} aria-hidden="true" /> 법령 구독 관리 (Legal Watch)
                            </button>
                            <button
                                aria-label="리포트 HWP 저장"
                                onClick={handleExportHwpx}
                                className="flex items-center justify-center gap-2 px-6 py-3 md:py-2 bg-sky-600 text-white hover:bg-sky-700 rounded-xl transition-all text-sm font-bold shadow-lg shadow-sky-600/20"
                            >
                                <FileText size={16} aria-hidden="true" /> HWP 저장
                            </button>
                            <button
                                aria-label="리포트 Word 저장"
                                onClick={handleExportDocx}
                                className="flex items-center justify-center gap-2 px-6 py-3 md:py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl transition-all text-sm font-bold shadow-lg shadow-indigo-600/20"
                            >
                                <FileText size={16} aria-hidden="true" /> Word 저장
                            </button>
                            <button
                                aria-label="리포트 PDF 저장"
                                onClick={handlePrint}
                                className="flex items-center justify-center gap-2 px-6 py-3 md:py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl transition-all text-sm font-bold shadow-lg shadow-emerald-600/20"
                            >
                                <Download size={16} aria-hidden="true" /> PDF 저장
                            </button>
                            <button
                                aria-label="리포트 인쇄 미리보기"
                                onClick={handlePrint}
                                className="flex items-center justify-center gap-2 px-6 py-3 md:py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl transition-all text-sm font-bold shadow-lg shadow-slate-900/20"
                            >
                                <Printer size={16} aria-hidden="true" /> 인쇄 미리보기
                            </button>
                        </div>

                        {/* iPad/iPhone PDF Save Guide */}
                        <div className="hidden md:hidden lg:hidden print:hidden md:group-hover:block bg-blue-50 border border-blue-100 p-4 rounded-xl text-xs text-blue-700 mb-8">
                            <p className="font-bold flex items-center gap-2 mb-1">
                                <Info size={14} /> 아이패드/아이폰 PDF 저장 팁
                            </p>
                            <p>프린트 창에서 리포트 미리보기 이미지를 <b>두 손가락으로 펼치거나(Pinch out)</b> 길게 누르면 PDF로 변환되어 저장할 수 있습니다.</p>
                        </div>

                        <div id="report-to-print" className="space-y-16 print-container">
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
                                    <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight leading-tight uppercase">
                                        {visionData ? "Contract Audit Report" : "Legal Consultation Report"}
                                    </h1>
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

                            {/* Query Section (Only for general consultations or if query is meaningful) */}
                            {!visionData && (
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
                            )}

                            {visionData ? (
                                <div className="space-y-16">
                                    {/* 1. Document Info & Risk Assessment */}
                                    <section className="space-y-6">
                                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-lg text-slate-500 font-bold text-[11px] tracking-wider uppercase">
                                            <Info size={14} className="text-slate-400" />
                                            Document Profile & Risk Assessment
                                        </div>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            <div className="p-6 bg-white border border-slate-100 rounded-2xl shadow-sm">
                                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">문서 종류 (Document Type)</span>
                                                <div className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                                                    <BookOpen className="text-blue-500 w-5 h-5" />
                                                    {visionData.document_type || "분석된 계약서"}
                                                </div>
                                            </div>

                                            <div className="p-6 bg-white border border-slate-100 rounded-2xl shadow-sm md:col-span-2">
                                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">위험도 진단 (Risk Assessment)</span>
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                                    <div className={`px-4 py-2 rounded-xl text-center font-black text-lg shrink-0 border ${
                                                        visionData.risk_level === '고' ? 'bg-red-50 text-red-600 border-red-200' :
                                                        visionData.risk_level === '중' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                                                        'bg-green-50 text-green-600 border-green-200'
                                                    }`}>
                                                        등급: {visionData.risk_level || '미정'}
                                                    </div>
                                                    
                                                    <div className="flex-1 space-y-1">
                                                        <div className="flex justify-between text-[10px] font-black text-slate-400 px-1 uppercase tracking-widest">
                                                            <span>LOW</span>
                                                            <span>MEDIUM</span>
                                                            <span>HIGH</span>
                                                        </div>
                                                        <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex p-[2px] border border-slate-200/50">
                                                            <div className={`h-full rounded-full transition-all duration-1000 ${
                                                                visionData.risk_level === '고' ? 'w-full bg-gradient-to-r from-green-500 via-orange-500 to-red-500' :
                                                                visionData.risk_level === '중' ? 'w-[66%] bg-gradient-to-r from-green-500 to-orange-500' :
                                                                'w-[33%] bg-green-500'
                                                            }`} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* 2. Toxic Clauses Analysis */}
                                    {visionData.toxic_clauses && visionData.toxic_clauses.length > 0 && (
                                        <section className="space-y-6">
                                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 rounded-lg text-red-600 font-bold text-[11px] tracking-wider uppercase">
                                                <AlertCircle size={14} className="text-red-500" />
                                                독소 조항 상세 분석 (Toxic Clauses)
                                            </div>
                                            
                                            <div className="space-y-6">
                                                {visionData.toxic_clauses.map((clauseItem: any, idx: number) => (
                                                    <div key={idx} className="bg-white border border-slate-100 rounded-2xl p-6 md:p-8 shadow-sm space-y-4 print:break-inside-avoid">
                                                        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                                                            <span className="w-6 h-6 bg-red-50 text-red-600 rounded-full flex items-center justify-center font-bold text-xs">
                                                                {idx + 1}
                                                            </span>
                                                            <h4 className="font-extrabold text-slate-800 text-sm md:text-base">발견된 독소/리스크 조항</h4>
                                                        </div>
                                                        
                                                        <div className="p-4 bg-slate-50 border-l-4 border-slate-300 rounded-r-xl">
                                                            <p className="text-sm md:text-base font-serif italic text-slate-600 leading-relaxed break-keep">
                                                                "{clauseItem.clause}"
                                                            </p>
                                                        </div>
                                                        
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                                            <div className="space-y-1">
                                                                <span className="text-[11px] font-black text-red-500 uppercase tracking-widest block">위험 사유 (Risk Analysis)</span>
                                                                <p className="text-xs md:text-sm text-slate-600 leading-relaxed break-keep">
                                                                    {clauseItem.reason}
                                                                </p>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <span className="text-[11px] font-black text-green-600 uppercase tracking-widest block">추천 수정안 (Revision Suggestion)</span>
                                                                <p className="text-xs md:text-sm text-slate-700 font-bold leading-relaxed break-keep">
                                                                    {clauseItem.suggestion}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}

                                    {/* 3. Missing Required Provisions */}
                                    {visionData.missing_items && visionData.missing_items.length > 0 && (
                                        <section className="space-y-6">
                                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-orange-50 rounded-lg text-orange-600 font-bold text-[11px] tracking-wider uppercase">
                                                <AlertCircle size={14} className="text-orange-500" />
                                                누락된 필수 항목 (Missing Provisions)
                                            </div>
                                            
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {visionData.missing_items.map((item: string, idx: number) => (
                                                    <div key={idx} className="p-4 bg-white border border-slate-100 rounded-2xl flex items-start gap-3 shadow-sm print:break-inside-avoid">
                                                        <div className="w-5 h-5 bg-orange-50 text-orange-500 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                                            <span className="font-bold text-xs">!</span>
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wider">Missing Item {idx + 1}</span>
                                                            <span className="text-sm font-semibold text-slate-800 leading-relaxed mt-0.5">{item}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}

                                    {/* 4. Overall Counsel Opinion */}
                                    {visionData.overall_opinion && (
                                        <section className="space-y-6">
                                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-lg text-blue-600 font-bold text-[11px] tracking-wider uppercase">
                                                <Zap size={14} className="text-blue-500 animate-pulse" />
                                                변호사 종합 의견 (Overall Opinion)
                                            </div>
                                            
                                            <div className="relative bg-gradient-to-br from-blue-50/30 to-indigo-50/20 border border-blue-100 p-8 md:p-12 rounded-[1.5rem] md:rounded-[2.5rem] shadow-sm print:break-inside-avoid">
                                                <div className="absolute top-6 left-6 text-blue-500/10 pointer-events-none select-none">
                                                    <Scale size={80} />
                                                </div>
                                                <div className="relative text-base md:text-lg text-slate-700 leading-relaxed font-serif break-keep whitespace-pre-wrap">
                                                    {visionData.overall_opinion}
                                                </div>
                                            </div>
                                        </section>
                                    )}
                                </div>
                            ) : (
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

                                        {/* Citation Verification (환각 검증) */}
                                        {(verifying || citations.length > 0) && (
                                            <section className="space-y-4">
                                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-lg text-slate-500 font-bold text-[11px] tracking-wider uppercase">
                                                    <ShieldCheck size={14} className="text-slate-400" />
                                                    인용 법령 검증
                                                </div>
                                                {verifying ? (
                                                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                                                        <Loader2 size={16} className="animate-spin" /> law.go.kr 원문과 대조 중...
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {citations.map((c, i) => {
                                                            const ok = c.status === "verified";
                                                            const label = ok ? "확인됨" : c.status === "article_not_found" ? "조문 확인 안 됨" : c.status === "law_not_found" ? "법령 확인 안 됨" : "확인 실패";
                                                            return (
                                                                <div key={i} className={`flex items-center justify-between p-3 rounded-xl border text-sm ${ok ? "bg-emerald-50 border-emerald-100" : c.status === "error" ? "bg-slate-50 border-slate-100" : "bg-amber-50 border-amber-100"}`}>
                                                                    <div className="flex items-center gap-2 font-bold text-slate-700">
                                                                        {ok ? <ShieldCheck size={16} className="text-emerald-600 shrink-0" /> : <AlertCircle size={16} className={`shrink-0 ${c.status === "error" ? "text-slate-400" : "text-amber-500"}`} />}
                                                                        {c.url ? (
                                                                            <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.law} {c.article}</a>
                                                                        ) : (
                                                                            <span>{c.law} {c.article}</span>
                                                                        )}
                                                                    </div>
                                                                    <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${ok ? "text-emerald-600" : c.status === "error" ? "text-slate-400" : "text-amber-600"}`}>{label}</span>
                                                                </div>
                                                            );
                                                        })}
                                                        {citations.some((c) => c.status !== "verified") && (
                                                            <p className="text-[11px] text-amber-600 font-bold flex items-center gap-1.5 pt-1">
                                                                <AlertCircle size={12} /> 확인되지 않은 인용은 원문(law.go.kr)에서 직접 검토하세요.
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </section>
                                        )}

                                        {/* Sources & Subscription Section */}
                                        {sources && sources.length > 0 && (
                                            <section className="space-y-6">
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-lg text-slate-500 font-bold text-[11px] tracking-wider uppercase">
                                                        <BookOpen size={14} className="text-slate-400" />
                                                        Relevant Laws & Sources
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] text-blue-500 font-bold bg-blue-50 px-3 py-1 rounded-full animate-pulse">
                                                        <Info size={12} /> 'Watch'를 눌러 개정 정보를 알림받으세요.
                                                    </div>
                                                </div>

                                                {/* 내가 업로드한 자료가 실제로 분석에 참고됐는지 표시 */}
                                                {sources.some((s) => s.type === "user_upload") && (
                                                    <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 text-xs font-bold">
                                                        <Upload size={14} className="shrink-0" />
                                                        내가 업로드한 자료 {sources.filter((s) => s.type === "user_upload").length}건이 이 분석에 참고되었습니다.
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {sources.map((src, idx) => {
                                                        const sourceName = src.source || "";
                                                        const isUpload = src.type === "user_upload";
                                                        const isLaw = !isUpload && (src.type === "law" || (sourceName && (
                                                            sourceName.endsWith("법") ||
                                                            sourceName.endsWith("령") ||
                                                            sourceName.endsWith("규칙") ||
                                                            sourceName.endsWith("률") ||
                                                            sourceName.includes("법 [") || // Matches "민법 [제750조]"
                                                            sourceName.includes("령 [")
                                                        )));

                                                        // Clean law name for subscription (remove article parts)
                                                        const cleanLawName = sourceName.split(" [")[0].trim();
                                                        const isSubscribed = subscribedLaws.includes(cleanLawName);
                                                        const isSubmitting = submittingLaw === cleanLawName;

                                                        return (
                                                            <div key={idx} className="p-4 bg-white border border-slate-100 rounded-2xl flex items-center justify-between group hover:border-blue-200 transition-all shadow-sm">
                                                                <div className="flex items-center gap-3">
                                                                    <div className={`p-2 rounded-lg ${isUpload ? "bg-emerald-50 text-emerald-600" : isLaw ? "bg-blue-50 text-blue-500" : "bg-slate-50 text-slate-400"}`}>
                                                                        {isUpload ? <Upload size={18} /> : <Scale size={18} />}
                                                                    </div>
                                                                    <div className="flex flex-col min-w-0">
                                                                        {isLaw ? (
                                                                            <a
                                                                                href={`https://www.law.go.kr/법령/${encodeURIComponent(cleanLawName)}`}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                title="law.go.kr에서 원문 확인"
                                                                                className="text-sm font-bold text-slate-800 tracking-tight hover:text-blue-600 hover:underline inline-flex items-center gap-1"
                                                                            >
                                                                                <span className="truncate">{src.source}</span>
                                                                                <ExternalLink size={12} className="shrink-0 opacity-60" aria-hidden="true" />
                                                                            </a>
                                                                        ) : (
                                                                            <span className="text-sm font-bold text-slate-800 tracking-tight">{src.source}</span>
                                                                        )}
                                                                        <span className={`text-[10px] font-bold uppercase tracking-widest ${isUpload ? "text-emerald-600" : isLaw ? "text-blue-500" : "text-slate-400"}`}>{isUpload ? "내 업로드 자료" : isLaw ? "법령 · 원문 보기" : "Document"}</span>
                                                                    </div>
                                                                </div>
                                                                {isLaw && user && (
                                                                    <button
                                                                        aria-label={`${cleanLawName} 법령 구독 ${isSubscribed ? "취소" : "설정"}`}
                                                                        onClick={() => toggleSubscription(cleanLawName)}
                                                                        disabled={isSubmitting}
                                                                        className={`p-2 rounded-xl transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${isSubscribed
                                                                            ? "bg-blue-50 text-blue-600 border border-blue-100"
                                                                            : "bg-slate-50 text-slate-400 border border-transparent hover:bg-blue-50 hover:text-blue-500"
                                                                            }`}
                                                                    >
                                                                        {isSubmitting ? (
                                                                            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                                                                        ) : isSubscribed ? (
                                                                            <BookmarkCheck size={14} aria-hidden="true" />
                                                                        ) : (
                                                                            <BookmarkPlus size={14} aria-hidden="true" />
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
                            )}

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

                        {/* Integrated Follow-up Chat */}
                        {/* Chatbot Section - Show if we have a valid reportId (number or JL- prefix) */}
                        {(reportId && (reportId.startsWith("JL-") || !isNaN(parseInt(reportId)))) && (
                            <div className="mt-12 pt-12 border-t border-black/10 print:hidden">
                                <ReportChatSection
                                    reportId={!isNaN(parseInt(reportId)) ? parseInt(reportId) : 0}
                                    initialHistory={chat_history}
                                    query={query}
                                    answer={answer}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
