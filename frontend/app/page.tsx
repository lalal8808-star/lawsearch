"use client";

import { motion } from "framer-motion";
import AIPanel from "@/components/AIPanel";
import UploadSection from "@/components/UploadSection";
import HistorySidebar from "@/components/HistorySidebar";
import MobileHistory from "@/components/MobileHistory";
import { Scale, ShieldCheck, Download, Zap, User, Bell, History, Clock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import AuthModal from "@/components/AuthModals";
import LegalWatchModal from "@/components/LegalWatchModal";
import api from "@/utils/api";
import { useEffect } from "react";

export default function Home() {
  const { user, logout } = useAuth();
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; mode: "login" | "signup" | "profile" }>({ isOpen: false, mode: "login" });
  const [isWatchModalOpen, setIsWatchModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (user) {
      fetchUnreadCount();
      // Poll for notifications every 2 minutes
      const interval = setInterval(fetchUnreadCount, 120000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const fetchUnreadCount = async () => {
    try {
      const res = await api.get("/notifications");
      const unread = res.data.filter((n: any) => !n.is_read).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error("Failed to fetch unread count:", error);
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-white/10 glass sticky top-0 z-50 shrink-0">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <Scale size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-black text-base sm:text-lg tracking-tighter leading-none shrink-0">JongLaw AI</span>
              <span className="text-[7px] sm:text-[8px] text-primary font-bold uppercase tracking-[0.15em] sm:tracking-widest mt-0.5">Legal Intelligence</span>
            </div>
          </div>

          <div className="flex items-center gap-8">
            <div className="hidden md:flex items-center gap-6 text-[11px] font-bold uppercase tracking-widest text-muted">
              {user && (
                <button
                  onClick={() => setAuthModal({ isOpen: true, mode: "profile" })}
                  className="hover:text-white transition-colors uppercase"
                >
                  내정보
                </button>
              )}
              {user && (
                <button
                  onClick={() => setIsWatchModalOpen(true)}
                  className="relative group flex items-center gap-2 hover:text-white transition-colors"
                >
                  <Bell size={16} className={unreadCount > 0 ? "text-blue-500 animate-bounce" : "text-muted group-hover:text-white"} />
                  Legal Watch
                  {unreadCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black animate-pulse shadow-lg shadow-blue-500/20">
                      {unreadCount}
                    </span>
                  )}
                </button>
              )}
            </div>

            <div className="h-6 w-px bg-white/10 mx-2" />

            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-end">
                  <span className="hidden sm:block text-[10px] font-black tracking-widest text-primary uppercase">Authenticated</span>
                  <span className="text-[10px] sm:text-xs font-bold text-white max-w-[80px] sm:max-w-none truncate">{user.username}</span>
                </div>
                <button
                  onClick={logout}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-full font-bold text-[10px] uppercase tracking-widest transition-all"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAuthModal({ isOpen: true, mode: "login" })}
                  className="text-[10px] font-bold uppercase tracking-widest text-muted hover:text-white transition-all"
                >
                  Sign In
                </button>
                <button
                  onClick={() => setAuthModal({ isOpen: true, mode: "signup" })}
                  className="bg-primary hover:scale-105 active:scale-95 px-5 py-2 rounded-full font-black text-[10px] text-white shadow-lg shadow-primary/20 transition-all uppercase tracking-widest"
                >
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {/* History Sidebar - Only visible for users */}
        <HistorySidebar />

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-7xl mx-auto px-6 py-6 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            {/* AI Panel - First on Mobile */}
            <div className="lg:col-span-7 h-[600px] lg:h-[650px] lg:sticky lg:top-8 order-1 lg:order-2">
              <AIPanel />
            </div>

            {/* Upload & Info - Second on Mobile */}
            <div className="lg:col-span-5 space-y-8 lg:space-y-12 order-2 lg:order-1">
              <section>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 lg:mb-8"
                >
                  <h1 className="text-3xl lg:text-5xl font-black mb-4 text-gradient tracking-tight leading-tight uppercase">Legal Analysis Engine</h1>
                  <p className="text-muted text-[13px] lg:text-[14px] leading-relaxed font-medium">
                    국가법령정보센터의 실시간 법령 정보와 사용자의 문서를 기반으로 <br className="hidden lg:block" />
                    정부 기관 급의 정확하고 전문적인 법률 분석 서비스를 제공합니다.
                  </p>
                </motion.div>

                <div className="grid grid-cols-3 gap-3 lg:gap-4 mb-8 lg:mb-12">
                  {[
                    { icon: ShieldCheck, label: "신뢰성", sub: "공식 법령 기반" },
                    { icon: Download, label: "접근성", sub: "자유로운 다운로드" },
                    { icon: Zap, label: "신속성", sub: "AI 실시간 분석" },
                  ].map((item, idx) => (
                    <div key={idx} className="glass-card p-3 lg:p-4 flex flex-col items-center text-center group hover:border-primary/50 transition-colors">
                      <div className="w-8 h-8 lg:w-10 lg:h-10 bg-white/5 rounded-xl flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                        <item.icon className="text-primary" size={16} />
                      </div>
                      <span className="text-[10px] lg:text-[11px] font-black">{item.label}</span>
                      <span className="text-[8px] lg:text-[9px] text-muted font-bold tracking-tighter lg:tracking-normal">{item.sub}</span>
                    </div>
                  ))}
                </div>
              </section>

              <UploadSection />

              {/* Mobile History View - Logic moved to MobileHistory component */}
              <MobileHistory />
            </div>
          </div>

          <footer className="py-12 border-t border-white/5 text-center text-muted text-[10px] font-bold tracking-widest opacity-40">
            <p>© 2026 JONGLAW AI TECHNOLOGY. ALL RIGHTS RESERVED. EVERY LAW DATA IS POWERED BY LAW.GO.KR OPEN API.</p>
          </footer>
        </div>
      </div>

      <AuthModal
        isOpen={authModal.isOpen}
        onClose={() => setAuthModal({ ...authModal, isOpen: false })}
        initialMode={authModal.mode}
      />

      <LegalWatchModal
        isOpen={isWatchModalOpen}
        onClose={() => {
          setIsWatchModalOpen(false);
          fetchUnreadCount();
        }}
      />
    </main>
  );
}
