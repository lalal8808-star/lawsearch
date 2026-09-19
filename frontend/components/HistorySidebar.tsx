"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { History, Trash2, FileText, ChevronLeft, ChevronRight, Clock, Search, X, Tag, CalendarDays } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

type HistoryItem = {
    id: number;
    query: string;
    answer_preview?: string;
    engine?: string;
    tags?: string[];
    created_at: string;
};

export default function HistorySidebar() {
    const [reports, setReports] = useState<HistoryItem[]>([]);
    const [isOpen, setIsOpen] = useState(true);
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [search, setSearch] = useState("");
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [fetchError, setFetchError] = useState(false);
    const cacheLoaded = useRef(false);
    const { user, token, loading: authLoading } = useAuth();
    const cacheKey = `jonglaw_history_cache:${user?.supabase_id || user?.username || "anonymous"}`;

    useEffect(() => setMounted(true), []);

    const fetchHistory = useCallback(async (targetPage = 1, append = false) => {
        if (!token) return;
        setLoading(true);
        setFetchError(false);
        try {
            const res = await api.get("/history", {
                params: {
                    q: search.trim() || undefined,
                    tag: activeTag || undefined,
                    date_from: dateFrom || undefined,
                    date_to: dateTo || undefined,
                    page: targetPage,
                    limit: 20,
                    _ts: Date.now(),
                },
                headers: { "Cache-Control": "no-cache" },
            });
            const data = res.data;
            if (!data || !Array.isArray(data.items)) throw new Error("Invalid history response");
            setReports((prev) => append ? [...prev, ...data.items] : data.items);
            setPage(data.page || targetPage);
            setTotal(data.total || 0);
            setHasMore(Boolean(data.has_more));
            setAvailableTags(Array.isArray(data.available_tags) ? data.available_tags : []);
            if (!search && !activeTag && !dateFrom && !dateTo && targetPage === 1) {
                try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { }
            }
        } catch (error) {
            console.error("Failed to fetch history", error);
            setFetchError(true);
        } finally {
            setLoading(false);
        }
    }, [token, search, activeTag, dateFrom, dateTo, cacheKey]);

    useEffect(() => {
        if (!mounted) return;
        if (!user && !authLoading) {
            setReports([]);
            setTotal(0);
            cacheLoaded.current = false;
            try { localStorage.removeItem(cacheKey); } catch { }
            return;
        }
        if (!user || !token) return;

        if (!cacheLoaded.current) {
            cacheLoaded.current = true;
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
                if (cached?.items && Array.isArray(cached.items)) {
                    setReports(cached.items);
                    setTotal(cached.total || cached.items.length);
                    setHasMore(Boolean(cached.has_more));
                    setAvailableTags(cached.available_tags || []);
                }
            } catch { }
        }
        const timer = window.setTimeout(() => fetchHistory(1, false), 350);
        return () => window.clearTimeout(timer);
    }, [user, token, mounted, authLoading, fetchHistory, cacheKey]);

    useEffect(() => {
        if (!mounted) return;
        const refresh = () => fetchHistory(1, false);
        window.addEventListener("report-generated", refresh);
        return () => window.removeEventListener("report-generated", refresh);
    }, [mounted, fetchHistory]);

    const deleteReport = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("이 보고서를 정말 삭제하시겠습니까?")) return;
        try {
            await api.delete(`/history/${id}`);
            setReports((prev) => prev.filter((r) => r.id !== id));
            setTotal((prev) => Math.max(0, prev - 1));
        } catch {
            alert("삭제에 실패했습니다.");
        }
    };

    const patchTags = async (report: HistoryItem, newTags: string[]) => {
        try {
            const res = await api.patch(`/history/${report.id}/tags`, { tags: newTags });
            setReports((prev) => prev.map((r) => r.id === report.id ? { ...r, tags: res.data.tags } : r));
            setAvailableTags((prev) => Array.from(new Set([...prev, ...(res.data.tags || [])])).sort());
        } catch {
            alert("태그 업데이트에 실패했습니다.");
        }
    };

    const addTag = (report: HistoryItem, e: React.MouseEvent) => {
        e.stopPropagation();
        const tag = prompt("태그 입력:")?.trim();
        if (!tag || (report.tags || []).includes(tag)) return;
        patchTags(report, [...(report.tags || []), tag]);
    };

    const removeTag = (report: HistoryItem, tag: string, e: React.MouseEvent) => {
        e.stopPropagation();
        patchTags(report, (report.tags || []).filter((item) => item !== tag));
    };

    const openReport = (report: HistoryItem) => {
        // 히스토리 목록에는 본문이 없으므로 이를 완성된 보고서 캐시로 저장하지 않는다.
        // 새 탭은 URL의 ID로 서버에서 전문을 불러온다.
        window.open(`/report?id=${report.id}`, "_blank");
    };

    if (!mounted || !user) return null;

    return (
        <div className="relative h-full hidden lg:flex items-start">
            <motion.div animate={{ width: isOpen ? 320 : 0 }} className="h-full bg-[#111c2f] text-[#f5f0e7] border-r border-white/10 shadow-[16px_0_45px_rgba(17,28,47,0.09)] flex flex-col overflow-hidden relative">
                <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/[0.025]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#d7b77b]/10 border border-[#d7b77b]/20 rounded-lg flex items-center justify-center"><History size={16} className="text-[#d7b77b]" /></div>
                        <div>
                            <h3 className="editorial-serif font-semibold text-[15px] tracking-tight">검토 기록</h3>
                            <p className="text-[9px] text-[#aab3bf] mt-0.5 tracking-wide">{total.toLocaleString()}건의 보고서</p>
                        </div>
                    </div>
                    {loading && <div className="w-4 h-4 border-2 border-[#d7b77b] border-t-transparent rounded-full animate-spin" />}
                </div>

                <div className="px-4 pt-4 shrink-0 space-y-3">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8793a3]" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="질의·보고서 내용 검색" className="w-full bg-white/[0.055] border border-white/10 rounded-[9px] py-2.5 pl-9 pr-8 text-xs placeholder:text-white/30 focus:outline-none focus:border-[#d7b77b]/50" />
                        {search && <button onClick={() => setSearch("")} aria-label="검색어 지우기" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8793a3] hover:text-white p-1"><X size={12} /></button>}
                    </div>
                    <div className="grid min-w-0 grid-cols-1 gap-2">
                        <label className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2">
                            <span className="flex items-center gap-1.5 text-[9px] font-semibold text-[#8793a3]">
                                <CalendarDays size={11} aria-hidden="true" /> 시작일
                            </span>
                            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="검색 시작일" className="history-date-input min-w-0 max-w-full bg-white/[0.055] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-[#bdc5ce]" />
                        </label>
                        <label className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2">
                            <span className="flex items-center gap-1.5 text-[9px] font-semibold text-[#8793a3]">
                                <CalendarDays size={11} aria-hidden="true" /> 종료일
                            </span>
                            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="검색 종료일" className="history-date-input min-w-0 max-w-full bg-white/[0.055] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-[#bdc5ce]" />
                        </label>
                    </div>
                    {availableTags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 max-h-14 overflow-y-auto custom-scrollbar">
                            {availableTags.map((tag) => <button key={tag} onClick={() => setActiveTag(activeTag === tag ? null : tag)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${activeTag === tag ? "bg-[#d7b77b] text-secondary border-[#d7b77b]" : "bg-white/5 text-[#aab3bf] border-white/10"}`}>#{tag}</button>)}
                            {activeTag && <button onClick={() => setActiveTag(null)} className="px-2 py-0.5 text-[10px] text-[#aab3bf] flex items-center gap-1"><X size={10} /> 해제</button>}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {fetchError && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[10px] text-amber-200"><p className="font-bold">최신 히스토리를 불러오지 못했습니다.</p><button onClick={() => fetchHistory(1, false)} className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 font-black text-white">다시 불러오기</button></div>}
                    {!loading && reports.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-6"><FileText size={40} className="mb-4" /><p className="text-[10px] font-bold uppercase tracking-widest">No reports found.</p></div>
                    ) : reports.map((report) => (
                        <motion.div key={report.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} onClick={() => openReport(report)} className="group p-4 bg-white/[0.045] border border-white/[0.075] rounded-[10px] hover:bg-white/[0.07] hover:border-[#d7b77b]/35 cursor-pointer transition-colors">
                            <p className="text-xs font-semibold leading-relaxed line-clamp-2 pr-5 text-[#f2eee6]">“{report.query}”</p>
                            {report.answer_preview && <p className="mt-2 text-[10px] leading-relaxed text-[#9fa9b7] line-clamp-2">{report.answer_preview}</p>}
                            <div className="flex flex-wrap items-center gap-1 mt-2">
                                {(report.tags || []).map((tag) => <span key={tag} onClick={(e) => { e.stopPropagation(); setActiveTag(activeTag === tag ? null : tag); }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#d7b77b]/10 text-[#d7b77b]">#{tag}<button onClick={(e) => removeTag(report, tag, e)} aria-label={`${tag} 태그 삭제`}><X size={9} /></button></span>)}
                                <button onClick={(e) => addTag(report, e)} className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-[9px] text-[#9fa9b7] border border-dashed border-white/15 rounded-full flex items-center gap-1"><Tag size={9} /> 태그</button>
                            </div>
                            <div className="flex items-center justify-between mt-2"><span className="flex items-center gap-2 text-[9px] text-[#7f8b9c] font-semibold"><Clock size={10} />{new Date(report.created_at).toLocaleDateString()}</span><button type="button" onClick={(e) => deleteReport(report.id, e)} aria-label={`${report.query} 보고서 삭제`} title="보고서 삭제" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9aa5b4] transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"><Trash2 size={14} /></button></div>
                        </motion.div>
                    ))}
                    {hasMore && <button onClick={() => fetchHistory(page + 1, true)} disabled={loading} className="w-full py-2.5 rounded-[9px] border border-white/10 text-[10px] font-bold text-[#9fa9b7] hover:text-white hover:border-[#d7b77b]/35 disabled:opacity-50">{loading ? "불러오는 중..." : "더 보기"}</button>}
                </div>
            </motion.div>
            <button onClick={() => setIsOpen(!isOpen)} className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-12 bg-[#172239] text-[#d7b77b] border border-white/10 rounded-r-lg flex items-center justify-center z-10 shadow-lg">{isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
        </div>
    );
}
