"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { History, FileText, Clock, ChevronRight, Trash2 } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

export default function MobileHistory() {
    const [reports, setReports] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const { user, token } = useAuth();

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
        if (user) {
            fetchHistory();
        } else {
            setReports([]);
        }
    }, [user, token]);

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

    if (!user) return null;

    return (
        <div className="block lg:hidden pt-12 border-t border-white/5 pb-20">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                        <History size={20} className="text-primary" />
                    </div>
                    <div>
                        <h3 className="font-black text-sm uppercase tracking-[0.2em] text-white">Recent Case Files</h3>
                        <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-0.5">Your Legal Intelligence Archive</p>
                    </div>
                </div>
                {loading && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
            </div>

            <div className="space-y-4">
                {reports.length === 0 ? (
                    <div className="glass-card p-10 flex flex-col items-center justify-center text-center opacity-30">
                        <FileText size={40} className="mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No archives found</p>
                        <p className="text-[9px] mt-2 font-bold">Start an AI consultation to generate reports.</p>
                    </div>
                ) : (
                    reports.slice(0, 10).map((report) => (
                        <motion.div
                            key={report.id}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => openReport(report)}
                            className="glass-card p-5 group flex items-start justify-between gap-4 active:border-primary/50"
                        >
                            <div className="flex-1 space-y-2">
                                <p className="text-xs font-bold leading-relaxed line-clamp-2 text-white/90">
                                    "{report.query}"
                                </p>
                                <div className="flex items-center gap-3 text-[9px] text-muted font-black uppercase tracking-widest">
                                    <Clock size={10} className="text-primary" />
                                    {new Date(report.created_at).toLocaleDateString()}
                                </div>
                            </div>
                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center group-active:bg-primary group-active:text-white transition-colors">
                                <ChevronRight size={16} />
                            </div>
                        </motion.div>
                    ))
                )}
            </div>
        </div>
    );
}
