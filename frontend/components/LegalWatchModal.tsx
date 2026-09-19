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
                    className="absolute inset-0 bg-secondary/35 backdrop-blur-sm"
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl bg-card text-secondary border border-border rounded-[18px] shadow-[0_30px_90px_rgba(23,34,57,0.2)] overflow-hidden flex flex-col max-h-[82vh]"
                >
                    {/* Header */}
                    <div className="p-6 sm:p-8 border-b border-secondary/10 flex items-center justify-between bg-secondary/[0.02]">
                        <div className="flex items-center gap-4">
                            <div className="w-11 h-11 bg-accent/10 border border-accent/15 rounded-lg flex items-center justify-center">
                                <Bell className="text-accent" size={21} />
                            </div>
                            <div>
                                <h2 className="editorial-serif text-2xl font-semibold text-secondary tracking-tight">Legal Watch</h2>
                                <p className="text-[10px] text-muted font-semibold tracking-wide mt-1">사후 법령 관리 센터</p>
                            </div>
                        </div>
                        <button onClick={onClose} aria-label="닫기" className="p-2 hover:bg-secondary/5 rounded-full transition-colors">
                            <X className="text-muted" size={24} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex px-6 sm:px-8 border-b border-secondary/10">
                        <button
                            onClick={() => setActiveTab("notifications")}
                            className={`px-5 py-4 text-xs font-bold tracking-wide transition-all border-b-2 ${activeTab === "notifications" ? "text-accent border-accent" : "text-muted border-transparent hover:text-secondary"
                                }`}
                        >
                            Notifications ({notifications.filter(n => !n.is_read).length})
                        </button>
                        <button
                            onClick={() => setActiveTab("subscriptions")}
                            className={`px-5 py-4 text-xs font-bold tracking-wide transition-all border-b-2 ${activeTab === "subscriptions" ? "text-accent border-accent" : "text-muted border-transparent hover:text-secondary"
                                }`}
                        >
                            My Subscriptions ({subscriptions.length})
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar min-h-[400px]">
                        {loading ? (
                            <div className="h-full flex flex-col items-center justify-center gap-4 opacity-50">
                                <Loader2 className="animate-spin text-accent" size={40} />
                                <span className="text-xs font-bold tracking-widest uppercase">Fetching updates...</span>
                            </div>
                        ) : activeTab === "notifications" ? (
                            <div className="space-y-4">
                                {notifications.length > 0 && (
                                    <div className="flex justify-end mb-4">
                                        <button
                                            onClick={markAllAsRead}
                                            className="text-[10px] font-bold text-primary hover:text-secondary tracking-wide transition-colors"
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
                                            className={`p-5 rounded-[10px] border transition-all ${notif.is_read
                                                    ? "bg-secondary/[0.025] border-secondary/[0.06] opacity-65"
                                                    : "bg-accent/[0.045] border-accent/20 shadow-sm"
                                                }`}
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        {!notif.is_read && <div className="w-2 h-2 bg-accent rounded-full" />}
                                                        <h4 className="text-sm font-bold text-secondary">{notif.title}</h4>
                                                    </div>
                                                    <p className="text-xs text-muted leading-relaxed">{notif.message}</p>
                                                    <div className="flex items-center gap-3 pt-2">
                                                        <span className="text-[10px] font-mono text-secondary/35">
                                                            {new Date(notif.created_at).toLocaleDateString()}
                                                        </span>
                                                        {!notif.is_read && (
                                                            <button
                                                                onClick={() => markAsRead(notif.id)}
                                                                className="text-[10px] font-bold text-primary hover:underline tracking-wide"
                                                            >
                                                                [Mark Read]
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                {notif.link && (
                                                    <a
                                                        href={notif.link}
                                                        className="p-2 bg-secondary/[0.05] hover:bg-secondary/10 rounded-lg text-secondary transition-all"
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
                                            className="p-5 bg-secondary/[0.025] border border-secondary/[0.08] rounded-[10px] flex items-center justify-between group hover:border-accent/40 transition-all"
                                        >
                                            <div className="space-y-1">
                                                <h4 className="text-sm font-bold text-secondary">{sub.law_name}</h4>
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted uppercase tracking-widest">
                                                    <CheckCircle2 size={12} className="text-accent" />
                                                    Monitoring active
                                                    <span className="text-secondary/20 mx-1">|</span>
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
                    <div className="p-5 bg-secondary/[0.025] border-t border-secondary/[0.08] flex items-center gap-3">
                        <Info size={14} className="text-accent" />
                        <p className="text-[9px] font-bold text-muted uppercase tracking-[0.2em]">
                            Updates are monitored via LAW.GO.KR API in real-time.
                        </p>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
