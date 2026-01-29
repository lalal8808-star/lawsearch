"use client";

import { useState, useEffect } from "react";
import { X, Bell, Bookmark, Trash2, CheckCircle2, Info, ExternalLink, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

interface Notification {
    id: number;
    type: string;
    title: string;
    message: string;
    is_read: number;
    link: string;
    created_at: string;
}

interface Subscription {
    id: number;
    law_name: string;
    last_enforced_date: string;
}

interface LegalWatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: "notifications" | "subscriptions";
}

export default function LegalWatchModal({ isOpen, onClose, initialTab = "notifications" }: LegalWatchModalProps) {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<"notifications" | "subscriptions">(initialTab);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && user) {
            fetchData();
        }
    }, [isOpen, user]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [notifRes, subRes] = await Promise.all([
                api.get("/notifications"),
                api.get("/subscriptions")
            ]);
            setNotifications(notifRes.data);
            setSubscriptions(subRes.data);
        } catch (error) {
            console.error("Failed to fetch legal watch data:", error);
        } finally {
            setLoading(false);
        }
    };

    const markAsRead = async (id: number) => {
        try {
            await api.patch(`/notifications/${id}/read`);
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
        } catch (error) {
            console.error("Failed to mark as read:", error);
        }
    };

    const markAllAsRead = async () => {
        try {
            await api.post("/notifications/read-all");
            setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
        } catch (error) {
            console.error("Failed to mark all as read:", error);
        }
    };

    const unsubscribe = async (lawName: string) => {
        if (!confirm(`'${lawName}' 구독을 해지하시겠습니까?`)) return;
        try {
            await api.delete(`/subscriptions?law_name=${encodeURIComponent(lawName)}`);
            setSubscriptions(prev => prev.filter(s => s.law_name !== lawName));
        } catch (error) {
            console.error("Failed to unsubscribe:", error);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl bg-[#0f0f0f] border border-white/10 rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                >
                    {/* Header */}
                    <div className="p-8 border-b border-white/10 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-600/20 rounded-2xl flex items-center justify-center">
                                <Bell className="text-blue-500" size={24} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-white tracking-tight">Legal Watch</h2>
                                <p className="text-xs text-muted font-bold uppercase tracking-widest">사후 법령 관리 센터</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                            <X className="text-muted" size={24} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex px-8 border-b border-white/10">
                        <button
                            onClick={() => setActiveTab("notifications")}
                            className={`px-6 py-4 text-xs font-black tracking-widest uppercase transition-all border-b-2 ${activeTab === "notifications" ? "text-blue-500 border-blue-500" : "text-muted border-transparent hover:text-white"
                                }`}
                        >
                            Notifications ({notifications.filter(n => !n.is_read).length})
                        </button>
                        <button
                            onClick={() => setActiveTab("subscriptions")}
                            className={`px-6 py-4 text-xs font-black tracking-widest uppercase transition-all border-b-2 ${activeTab === "subscriptions" ? "text-blue-500 border-blue-500" : "text-muted border-transparent hover:text-white"
                                }`}
                        >
                            My Subscriptions ({subscriptions.length})
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar min-h-[400px]">
                        {loading ? (
                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-50">
                                <Loader2 className="animate-spin text-blue-500" size={40} />
                                <span className="text-xs font-bold tracking-widest uppercase">Fetching updates...</span>
                            </div>
                        ) : activeTab === "notifications" ? (
                            <div className="space-y-4">
                                {notifications.length > 0 && (
                                    <div className="flex justify-end mb-4">
                                        <button
                                            onClick={markAllAsRead}
                                            className="text-[10px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-widest transition-colors"
                                        >
                                            Mark all as read
                                        </button>
                                    </div>
                                )}
                                {notifications.length === 0 ? (
                                    <div className="h-40 flex flex-col items-center justify-center text-center opacity-30">
                                        <Bell size={48} className="mb-4" />
                                        <p className="text-sm font-bold">새로운 알림이 없습니다.</p>
                                    </div>
                                ) : (
                                    notifications.map((notif) => (
                                        <div
                                            key={notif.id}
                                            className={`p-6 rounded-2xl border transition-all ${notif.is_read
                                                    ? "bg-white/5 border-white/5 opacity-60"
                                                    : "bg-blue-600/5 border-blue-600/20 shadow-lg shadow-blue-500/5"
                                                }`}
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        {!notif.is_read && <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
                                                        <h4 className="text-sm font-black text-white">{notif.title}</h4>
                                                    </div>
                                                    <p className="text-xs text-muted leading-relaxed">{notif.message}</p>
                                                    <div className="flex items-center gap-3 pt-2">
                                                        <span className="text-[10px] font-mono text-white/30">
                                                            {new Date(notif.created_at).toLocaleDateString()}
                                                        </span>
                                                        {!notif.is_read && (
                                                            <button
                                                                onClick={() => markAsRead(notif.id)}
                                                                className="text-[10px] font-black text-blue-500 hover:underline uppercase tracking-widest"
                                                            >
                                                                [Mark Read]
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                {notif.link && (
                                                    <a
                                                        href={notif.link}
                                                        className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white transition-all shadow-lg"
                                                        onClick={() => markAsRead(notif.id)}
                                                    >
                                                        <ExternalLink size={16} />
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {subscriptions.length === 0 ? (
                                    <div className="h-40 flex flex-col items-center justify-center text-center opacity-30">
                                        <Bookmark size={48} className="mb-4" />
                                        <p className="text-sm font-bold">구독 중인 법령이 없습니다.</p>
                                        <p className="text-[10px] uppercase tracking-widest mt-2">리포트에서 법령을 구독해보세요.</p>
                                    </div>
                                ) : (
                                    subscriptions.map((sub) => (
                                        <div
                                            key={sub.id}
                                            className="p-6 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between group hover:border-blue-500/50 transition-all"
                                        >
                                            <div className="space-y-1">
                                                <h4 className="text-sm font-black text-white">{sub.law_name}</h4>
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted uppercase tracking-widest">
                                                    <CheckCircle2 size={12} className="text-blue-500" />
                                                    Monitoring active
                                                    <span className="text-white/20 mx-1">|</span>
                                                    Enforced: {sub.last_enforced_date}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => unsubscribe(sub.law_name)}
                                                className="p-2 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                                title="구독 취소"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer Info */}
                    <div className="p-6 bg-black/40 border-t border-white/5 flex items-center gap-3">
                        <Info size={14} className="text-blue-500" />
                        <p className="text-[9px] font-bold text-muted uppercase tracking-[0.2em]">
                            Updates are monitored via LAW.GO.KR API in real-time.
                        </p>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
