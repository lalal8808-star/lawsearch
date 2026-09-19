"use client";

import { motion } from "framer-motion";
import AIPanel from "@/components/AIPanel";
import UploadSection from "@/components/UploadSection";
import HistorySidebar from "@/components/HistorySidebar";
import MobileHistory from "@/components/MobileHistory";
import { Scale, ShieldCheck, Download, Zap, Bell } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useState } from "react";
import AuthModal from "@/components/AuthModals";
import LegalWatchModal from "@/components/LegalWatchModal";
import api from "@/utils/api";
import { useEffect } from "react";

export default function Home() {
  const { user, logout } = useAuth();
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; mode: "login" | "signup" | "profile" }>({ isOpen: false, mode: "login" });
  const [isWatchModalOpen, setIsWatchModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.get("/notifications");
      const unread = res.data.filter((n: any) => !n.is_read).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error("Failed to fetch unread count:", error);
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      fetchUnreadCount();
      interval = setInterval(fetchUnreadCount, 120000); // 2분 간격
    };
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    // 탭이 보일 때만 폴링 (백그라운드/새벽에 방치된 탭이 계속 호출하지 않도록)
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [user, fetchUnreadCount]);

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col editorial-paper-grid">
      {/* Navbar */}
      <nav className="border-b border-secondary/10 glass sticky top-0 z-50 shrink-0">
        <div className="max-w-[1500px] mx-auto px-3 sm:px-6 lg:px-8 h-[72px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-secondary rounded-[10px] flex items-center justify-center shadow-[0_10px_24px_rgba(23,34,57,0.16)]">
              <Scale size={20} className="text-[#d7b77b]" />
            </div>
            <div className="flex flex-col border-l border-secondary/15 pl-3">
              <span className="editorial-serif font-bold text-[15px] sm:text-lg tracking-[-0.02em] leading-none shrink-0">JongLaw AI</span>
              <span className="hidden min-[430px]:block text-[8px] text-accent font-bold uppercase tracking-[0.18em] mt-1">Legal Intelligence</span>
            </div>
          </div>

          <div className="flex items-center gap-8">
            <div className="hidden md:flex items-center gap-6 text-[11px] font-semibold tracking-wide text-muted">
              {user && (
                <button
                  onClick={() => setAuthModal({ isOpen: true, mode: "profile" })}
                  className="hover:text-secondary transition-colors"
                >
                  내정보
                </button>
              )}
              {user && (
                <button
                  onClick={() => setIsWatchModalOpen(true)}
                  className="relative group flex items-center gap-2 hover:text-secondary transition-colors"
                >
                  <Bell size={16} className={unreadCount > 0 ? "text-accent animate-bounce" : "text-muted group-hover:text-secondary"} />
                  Legal Watch
                  {unreadCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-accent text-white text-[8px] px-1.5 py-0.5 rounded-full font-black shadow-lg">
                      {unreadCount}
                    </span>
                  )}
                </button>
              )}
            </div>

            <div className="h-6 w-px bg-secondary/10 mx-2" />

            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-end">
                  <span className="hidden sm:block text-[9px] font-bold tracking-[0.12em] text-accent uppercase">Authenticated</span>
                  <span className="text-[10px] sm:text-xs font-semibold text-secondary max-w-[80px] sm:max-w-none truncate">{user.username}</span>
                </div>
                <button
                  onClick={logout}
                  className="bg-transparent hover:bg-secondary/5 border border-secondary/15 px-4 py-2 rounded-lg font-bold text-[10px] tracking-wide transition-all"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAuthModal({ isOpen: true, mode: "login" })}
                  className="text-[10px] font-bold tracking-wide text-muted hover:text-secondary transition-all"
                >
                  로그인
                </button>
                <button
                  onClick={() => setAuthModal({ isOpen: true, mode: "signup" })}
                  className="editorial-button px-3.5 sm:px-5 py-2.5 font-bold text-[10px] transition-all tracking-wide"
                >
                  시작하기
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
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-7 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-x-7 gap-y-8 lg:gap-x-10 lg:gap-y-7 items-start">
            {/* Compact report-status panel - First on mobile */}
            <div className="lg:col-span-7 h-[340px] order-1 lg:order-2">
              <AIPanel />
            </div>

            {/* Intro - Second on mobile, aligned to the status panel on desktop */}
            <section className="lg:col-span-5 lg:h-[340px] lg:flex lg:flex-col lg:justify-between order-2 lg:order-1">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-7 lg:mb-0 pt-1"
                >
                  <div className="editorial-eyebrow mb-3">Professional Legal Review</div>
                  <h1 className="editorial-serif text-[2.35rem] lg:text-[2.55rem] xl:text-[3.15rem] font-semibold mb-4 tracking-[-0.045em] leading-[1.08] text-secondary">
                    법률 검토를 위한<br />새로운 기준
                  </h1>
                  <div className="editorial-rule w-24 mb-4" />
                  <p className="text-muted text-[13px] lg:text-[13px] leading-[1.75] font-medium max-w-xl">
                    국가법령정보센터의 최신 법령과 사용자가 제공한 자료를 정교하게 교차 분석하여,
                    근거가 분명한 법률 검토 보고서를 작성합니다.
                  </p>
                </motion.div>

                <div className="grid grid-cols-3 gap-2.5 lg:gap-3">
                  {[
                    { icon: ShieldCheck, label: "신뢰성", sub: "공식 법령 기반" },
                    { icon: Download, label: "접근성", sub: "자유로운 다운로드" },
                    { icon: Zap, label: "신속성", sub: "AI 실시간 분석" },
                  ].map((item, idx) => (
                    <div key={idx} className="bg-card border border-border p-3 lg:p-3.5 flex flex-col items-start text-left group hover:border-accent/50 transition-colors shadow-[0_10px_30px_rgba(42,37,29,0.045)]">
                      <div className="w-8 h-8 bg-secondary/[0.055] rounded-lg flex items-center justify-center mb-2.5 group-hover:bg-accent/10 transition-colors">
                        <item.icon className="text-accent" size={16} />
                      </div>
                      <span className="text-[10px] lg:text-[11px] font-bold text-secondary">{item.label}</span>
                      <span className="text-[8px] lg:text-[9px] text-muted font-medium mt-0.5 leading-snug">{item.sub}</span>
                    </div>
                  ))}
                </div>
            </section>

            <div className="lg:col-span-12 order-3">
              <UploadSection />
            </div>

            <div className="lg:col-span-12 order-4">
              <MobileHistory />
            </div>
          </div>

          <footer className="py-10 border-t border-secondary/10 text-center text-muted text-[9px] font-semibold tracking-[0.12em] opacity-70">
            <p>© 2026 JONGLAW AI · 대한민국 국가법령정보센터 데이터를 기반으로 합니다.</p>
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
