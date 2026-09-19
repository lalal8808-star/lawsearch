"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import api from "@/utils/api";

import { supabase } from "@/utils/supabase";
import { AuthChangeEvent, Session } from "@supabase/supabase-js";

interface User {
    username: string;
    nickname: string;
    supabase_id?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (token: string, username: string, nickname: string) => void;
    updateUser: (nickname: string) => void;
    logout: () => void;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const lastTokenRef = React.useRef<string | null>(null);
    const syncingTokenRef = React.useRef<string | null>(null);
    const syncedTokenRef = React.useRef<string | null>(null);

    const clearAuth = React.useCallback(() => {
        setToken(null);
        setUser(null);
        lastTokenRef.current = null;
        syncingTokenRef.current = null;
        syncedTokenRef.current = null;
        localStorage.removeItem("jonglaw_token");
        localStorage.removeItem("jonglaw_user");
        localStorage.removeItem("jonglaw_nickname");
        sessionStorage.removeItem("jonglaw_last_report");

        // 히스토리 캐시는 사용자 데이터이므로 로그아웃 시 다른 계정에 노출되지 않게 제거한다.
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
            const key = localStorage.key(i);
            if (key?.startsWith("jonglaw_history_cache")) localStorage.removeItem(key);
        }
    }, []);

    const applySupabaseSession = React.useCallback((session: Session) => {
        const accessToken = session.access_token;
        const supabaseUser = session.user;
        const nickname = supabaseUser.user_metadata?.full_name || supabaseUser.email?.split('@')[0] || "User";
        const email = supabaseUser.email || supabaseUser.id;

        lastTokenRef.current = accessToken;
        setToken(accessToken);
        setUser({ username: email, nickname, supabase_id: supabaseUser.id });
        localStorage.setItem("jonglaw_token", accessToken);
        localStorage.setItem("jonglaw_user", email);
        localStorage.setItem("jonglaw_nickname", nickname);
    }, []);

    const syncSessionWithBackend = React.useCallback(async (session: Session) => {
        const accessToken = session.access_token;
        if (syncedTokenRef.current === accessToken || syncingTokenRef.current === accessToken) return;
        syncingTokenRef.current = accessToken;

        const supabaseUser = session.user;
        const nickname = supabaseUser.user_metadata?.full_name || supabaseUser.email?.split('@')[0] || "User";
        const email = supabaseUser.email || supabaseUser.id;
        try {
            const res = await api.post("/auth/sync", {
                supabase_id: supabaseUser.id,
                username: email,
                nickname,
            }, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            syncedTokenRef.current = accessToken;
            if (res.data.nickname && res.data.nickname !== nickname) {
                setUser({ username: email, nickname: res.data.nickname, supabase_id: supabaseUser.id });
                localStorage.setItem("jonglaw_nickname", res.data.nickname);
            }
        } catch (err) {
            console.error("Auth sync failed:", err);
        } finally {
            if (syncingTokenRef.current === accessToken) syncingTokenRef.current = null;
        }
    }, []);

    useEffect(() => {
        let active = true;

        // Supabase는 onAuthStateChange 콜백 안에서 다른 async auth 호출을 기다리면
        // 내부 잠금이 교착될 수 있다. 콜백은 반드시 동기적으로 끝내고 백엔드 동기화는
        // 다음 이벤트 루프로 넘긴다.
        const scheduleBackendSync = (session: Session) => {
            window.setTimeout(() => {
                if (active) void syncSessionWithBackend(session);
            }, 0);
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
            console.log("Auth event:", event);
            if (session) {
                applySupabaseSession(session);
                if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") {
                    scheduleBackendSync(session);
                }
            } else if (event === 'SIGNED_OUT') {
                clearAuth();
            }
            setLoading(false);
        });

        // 2. Initial Session Check (in case onAuthStateChange doesn't fire INITIAL_SESSION)
        const initAuth = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!active) return;
                if (session) {
                    applySupabaseSession(session);
                    scheduleBackendSync(session);
                } else {
                    // 레거시 자체 로그인 사용자를 위한 폴백.
                    const savedToken = localStorage.getItem("jonglaw_token");
                    const savedUser = localStorage.getItem("jonglaw_user");
                    if (savedToken && savedUser) {
                        setToken(savedToken);
                        setUser({ username: savedUser, nickname: localStorage.getItem("jonglaw_nickname") || "User" });
                    }
                }
            } catch (err) {
                console.error("Initial auth check failed:", err);
            } finally {
                if (active) setLoading(false);
            }
        };

        initAuth();

        // api 인터셉터가 세션 refresh 재시도까지 실패했을 때 발생시키는 이벤트.
        // 페이지 리로드 없이 로그아웃 상태만 반영한다 (작성 중 입력 보존).
        const onAuthExpired = () => clearAuth();
        window.addEventListener("auth-expired", onAuthExpired);

        return () => {
            active = false;
            subscription.unsubscribe();
            window.removeEventListener("auth-expired", onAuthExpired);
        };
    }, [applySupabaseSession, clearAuth, syncSessionWithBackend]);

    const login = (newToken: string, username: string, nickname: string) => {
        setToken(newToken);
        setUser({ username, nickname });
        localStorage.setItem("jonglaw_token", newToken);
        localStorage.setItem("jonglaw_user", username);
        localStorage.setItem("jonglaw_nickname", nickname);
    };

    const updateUser = (nickname: string) => {
        if (user) {
            const updatedUser = { ...user, nickname };
            setUser(updatedUser);
            localStorage.setItem("jonglaw_nickname", nickname);
        }
    };

    const logout = async () => {
        // UI는 즉시 로그아웃 처리하고, Supabase 세션 삭제가 비정상적으로 지연돼도
        // 버튼이 영원히 멈추지 않도록 로컬 로그아웃에 시간 제한을 둔다.
        clearAuth();
        try {
            await Promise.race([
                supabase.auth.signOut({ scope: "local" }),
                new Promise((resolve) => window.setTimeout(resolve, 3000)),
            ]);
        } catch (err) {
            console.error("Sign out failed:", err);
        } finally {
            window.location.replace("/");
        }
    };

    return (
        <AuthContext.Provider value={{ user, token, login, updateUser, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};
