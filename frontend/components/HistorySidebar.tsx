"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { History, Trash2, FileText, ChevronLeft, ChevronRight, Scale, Clock, ExternalLink, Search, X, Tag } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

export default function HistorySidebar() {
    const [reports, setReports] = useState<any[]>([]);
    const [isOpen, setIsOpen] = useState(true);
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [search, setSearch] = useState("");
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const { user, token, loading: authLoading } = useAuth();

    useEffect(() => {
        setMounted(true);
    }, []);


    const CACHE_KEY = "jonglaw_history_cache";

    const fetchHistory = async () => {
        if (!token) return;
        setLoading(true);
        try {
            const res = await api.get(`/history`);
            setReports(res.data);
            // 다음 접속 때 백엔드(콜드스타트) 응답을 기다리지 않고 즉시 보여주기 위한 캐시
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(res.data)); } catch { }
        } catch (error) {
            console.error("Failed to fetch history", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user && mounted) {
            // 캐시가 있으면 즉시 표시(백엔드 콜드스타트 수십 초를 기다리지 않음), 백그라운드에서 갱신
            try {
                const cached = localStorage.getItem(CACHE_KEY);
                if (cached) setReports(JSON.parse(cached));
            } catch { }
            fetchHistory();
        } else if (mounted && !user && !authLoading) {
            // 인증 확인이 끝났는데도 미로그인일 때만 비운다
            // (초기 로딩 중 user=null 순간에 캐시를 지우면 즉시 표시 효과가 사라짐)
            setReports([]);
            try { localStorage.removeItem(CACHE_KEY); } catch { }
        }

        // Listen for new reports
        const handleRefresh = () => fetchHistory();
        window.addEventListener('report-generated', handleRefresh);
        return () => window.removeEventListener('report-generated', handleRefresh);
    }, [user, token, mounted, authLoading]);

    const deleteReport = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("이 보고서를 정말 삭제하시겠습니까?")) return;

        try {
            await api.delete(`/history/${id}`);
            setReports(reports.filter(r => r.id !== id));
        } catch (error) {
            alert("삭제에 실패했습니다.");
        }
    };

    const patchTags = async (report: any, newTags: string[]) => {
        try {
            const res = await api.patch(`/history/${report.id}/tags`, { tags: newTags });
            setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, tags: res.data.tags } : r)));
        } catch (e) {
            alert("태그 업데이트에 실패했습니다.");
        }
    };

    const addTag = (report: any, e: React.MouseEvent) => {
        e.stopPropagation();
        const t = prompt("태그 입력:")?.trim();
        if (!t) return;
        const cur: string[] = report.tags || [];
        if (cur.includes(t)) return;
        patchTags(report, [...cur, t]);
    };

    const removeTag = (report: any, tag: string, e: React.MouseEvent) => {
        e.stopPropagation();
        patchTags(report, (report.tags || []).filter((x: string) => x !== tag));
    };

    const openReport = async (report: any) => {
        // 목록 응답에는 chat_history가 빠져 있으므로(payload 절감) 열 때 상세를 가져온다.
        let chatHistory: any[] = report.chat_history || [];
        if (!report.chat_history) {
            try {
                const res = await api.get(`/history/${report.id}`);
                chatHistory = res.data?.chat_history || [];
            } catch { /* 상세 조회 실패 시 후속대화 없이 연다 */ }
        }
        sessionStorage.setItem("jonglaw_last_report", JSON.stringify({
            reportId: report.id.toString(),
            query: report.query,
            answer: report.answer,
            sources: report.sources,
            engine: report.engine,
            chat_history: chatHistory
        }));
        window.open("/report", "_blank");
    };

    if (!mounted || !user) return null;

    const q = search.trim().toLowerCase();
    const filtered = reports.filter((r) => {
        if (activeTag && !(r.tags || []).includes(activeTag)) return false;
        if (q && !((r.query || "").toLowerCase().includes(q) || (r.answer || "").toLowerCase().includes(q))) return false;
        return true;
    });
    const allTags = Array.from(new Set(reports.flatMap((r) => r.tags || []))) as string[];

    return (
        <div className="relative h-full hidden lg:flex items-start">
            <motion.div
                animate={{ width: isOpen ? 320 : 0 }}
                className="h-full bg-white/5 border-r border-white/10 flex flex-col overflow-hidden relative"
            >
                <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
                            <History size={18} className="text-primary" />
                        </div>
                        <h3 className="font-black text-sm uppercase tracking-widest">History</h3>
                    </div>
                    {loading && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
                </div>

                {reports.length > 0 && (
                    <div className="px-4 pt-4 shrink-0">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="보고서 검색..."
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-9 pr-8 text-xs focus:outline-none focus:border-primary/50 transition-all"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    aria-label="검색어 지우기"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>

                        {allTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {allTags.map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => setActiveTag(activeTag === t ? null : t)}
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all border ${activeTag === t ? "bg-primary text-white border-primary" : "bg-white/5 text-muted border-white/10 hover:border-primary/40"}`}
                                    >
                                        #{t}
                                    </button>
                                ))}
                                {activeTag && (
                                    <button onClick={() => setActiveTag(null)} className="px-2 py-0.5 rounded-full text-[10px] font-bold text-muted hover:text-white flex items-center gap-1">
                                        <X size={10} /> 해제
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {reports.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-6">
                            <FileText size={40} className="mb-4" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No reports found.</p>
                            <p className="text-[9px] mt-2">질문을 남기고 전문가 보고서를 생성해보세요.</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-6">
                            <Search size={32} className="mb-3" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">검색 결과 없음</p>
                            <p className="text-[9px] mt-2">'{search}'와 일치하는 보고서가 없습니다.</p>
                        </div>
                    ) : (
                        filtered.map((report) => (
                            <motion.div
                                key={report.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                onClick={() => openReport(report)}
                                className="group p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-primary/50 transition-all cursor-pointer relative"
                            >
                                <div className="flex flex-col gap-2">
                                    <p className="text-xs font-semibold leading-relaxed line-clamp-2 pr-6">
                                        "{report.query}"
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1">
                                        {(report.tags || []).map((t: string) => (
                                            <span
                                                key={t}
                                                onClick={(e) => { e.stopPropagation(); setActiveTag(activeTag === t ? null : t); }}
                                                className="group/tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-primary/15 text-primary hover:bg-primary/25 transition-all cursor-pointer"
                                            >
                                                #{t}
                                                <button onClick={(e) => removeTag(report, t, e)} aria-label={`${t} 태그 삭제`} className="opacity-50 hover:opacity-100">
                                                    <X size={9} />
                                                </button>
                                            </span>
                                        ))}
                                        <button
                                            onClick={(e) => addTag(report, e)}
                                            className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-muted hover:text-primary border border-dashed border-white/15 transition-all"
                                        >
                                            <Tag size={9} /> 태그
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-[9px] text-muted font-bold">
                                            <Clock size={10} />
                                            {new Date(report.created_at).toLocaleDateString()}
                                        </div>
                                        <button
                                            onClick={(e) => deleteReport(report.id, e)}
                                            className="opacity-0 group-hover:opacity-100 p-2 text-muted hover:text-red-500 transition-all"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </motion.div>

            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-12 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-all z-10 backdrop-blur-md"
            >
                {isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
        </div>
    );
}
