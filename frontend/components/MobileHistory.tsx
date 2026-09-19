"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { History, FileText, Clock, ChevronRight, Trash2 } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

export default function MobileHistory() {
    const [reports, setReports] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState(false);
    const { user, token } = useAuth();

    const fetchHistory = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setFetchError(false);
        try {
            const res = await api.get(`/history`, {
                params: { page: 1, limit: 10, _ts: Date.now() },
                headers: { "Cache-Control": "no-cache" },
            });
            if (!Array.isArray(res.data?.items)) throw new Error("Invalid history response");
            setReports(res.data.items);
        } catch (error) {
            console.error("Failed to fetch history", error);
            setFetchError(true);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (user) {
            fetchHistory();
        } else {
            setReports([]);
        }
    }, [user, token, fetchHistory]);

    const openReport = (report: any) => {
        window.open(`/report?id=${report.id}`, "_blank");
    };

    const deleteReport = async (report: any, event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!confirm(`'${report.query}' 보고서를 삭제하시겠습니까?`)) return;
        try {
            await api.delete(`/history/${report.id}`);
            setReports((previous) => previous.filter((item) => item.id !== report.id));
        } catch (error) {
            console.error("Failed to delete report", error);
            alert("보고서 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        }
    };

    if (!user) return null;

    return (
        <div className="block lg:hidden pt-10 border-t border-secondary/10 pb-20">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center border border-accent/15">
                        <History size={18} className="text-accent" />
                    </div>
                    <div>
                        <h3 className="editorial-serif font-semibold text-[17px] text-secondary">최근 검토 기록</h3>
                        <p className="text-[9px] text-muted font-semibold tracking-wide mt-0.5">Legal review archive</p>
                    </div>
                </div>
                {loading && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
            </div>

            <div className="space-y-4">
                {fetchError && (
                    <div className="glass-card border border-amber-600/20 bg-amber-50 p-4 text-xs text-amber-800">
                        <p className="font-bold">최신 히스토리를 불러오지 못했습니다.</p>
                        <button onClick={fetchHistory} className="mt-3 rounded-lg bg-amber-500 px-4 py-2 font-black text-white">
                            다시 불러오기
                        </button>
                    </div>
                )}
                {reports.length === 0 ? (
                    <div className="glass-card p-10 flex flex-col items-center justify-center text-center text-muted">
                        <FileText size={40} className="mb-4" />
                        <p className="text-xs font-semibold">아직 저장된 보고서가 없습니다.</p>
                        <p className="text-[10px] mt-2">법률 검토를 시작하면 여기에 기록됩니다.</p>
                    </div>
                ) : (
                    reports.slice(0, 10).map((report) => (
                        <motion.div
                            key={report.id}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReport(report)}
                            className="glass-card p-5 group flex items-start justify-between gap-4 active:border-accent/50"
                        >
                            <div className="flex-1 space-y-2">
                                <p className="text-xs font-semibold leading-relaxed line-clamp-2 text-secondary">
                                    "{report.query}"
                                </p>
                                <div className="flex items-center gap-3 text-[9px] text-muted font-black uppercase tracking-widest">
                                    <Clock size={10} className="text-accent" />
                                    {new Date(report.created_at).toLocaleDateString()}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <button
                                    type="button"
                                    onClick={(event) => deleteReport(report, event)}
                                    aria-label={`${report.query} 보고서 삭제`}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                >
                                    <Trash2 size={16} />
                                </button>
                                <div className="flex h-11 w-9 items-center justify-center rounded-lg bg-secondary/[0.05] text-muted transition-colors group-active:bg-secondary group-active:text-white">
                                    <ChevronRight size={16} />
                                </div>
                            </div>
                        </motion.div>
                    ))
                )}
            </div>
        </div>
    );
}
