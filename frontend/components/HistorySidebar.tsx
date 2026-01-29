"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { History, Trash2, FileText, ChevronLeft, ChevronRight, Scale, Clock, ExternalLink } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

export default function HistorySidebar() {
    const [reports, setReports] = useState<any[]>([]);
    const [isOpen, setIsOpen] = useState(true);
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const { user, token } = useAuth();

    useEffect(() => {
        setMounted(true);
    }, []);


    const fetchHistory = async () => {
        if (!token) return;
        setLoading(true);
        try {
            const res = await api.get(`/history`);
            setReports(res.data);
        } catch (error) {
            console.error("Failed to fetch history", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user && mounted) {
            fetchHistory();
        } else {
            setReports([]);
        }
    }, [user, token, mounted]);

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

    const openReport = (report: any) => {
        sessionStorage.setItem("jonglaw_last_report", JSON.stringify({
            reportId: report.id.toString(),
            query: report.query,
            answer: report.answer,
            sources: report.sources,
            engine: report.engine,
            chat_history: report.chat_history || []
        }));
        window.open("/report", "_blank");
    };

    if (!mounted || !user) return null;

    return (
        <div className="relative h-full flex items-start">
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

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {reports.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-6">
                            <FileText size={40} className="mb-4" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No reports found.</p>
                            <p className="text-[9px] mt-2">질문을 남기고 전문가 보고서를 생성해보세요.</p>
                        </div>
                    ) : (
                        reports.map((report) => (
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
