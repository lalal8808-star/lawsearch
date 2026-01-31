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

    useEffect(() => {
        // 1. Auth State Listener
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
            console.log("Auth event:", event);
            if (session) {
                if (lastTokenRef.current !== session.access_token) {
                    await handleSupabaseSession(session);
                }
            } else if (event === 'SIGNED_OUT') {
                clearAuth();
            }
            setLoading(false);
        });

        // 2. Initial Session Check (in case onAuthStateChange doesn't fire INITIAL_SESSION)
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session && lastTokenRef.current !== session.access_token) {
                await handleSupabaseSession(session);
            } else if (!session) {
                // Fallback to local storage (legacy auth)
                const savedToken = localStorage.getItem("jonglaw_token");
                const savedUser = localStorage.getItem("jonglaw_user");
                if (savedToken && savedUser) {
                    setToken(savedToken);
                    setUser({ username: savedUser, nickname: localStorage.getItem("jonglaw_nickname") || "User" });
                }
            }
            setLoading(false);
        };

        initAuth();
        return () => subscription.unsubscribe();
    }, []);

    const handleSupabaseSession = async (session: Session) => {
        const token = session.access_token;
        lastTokenRef.current = token;
        const supabaseUser = session.user;

        const nickname = supabaseUser.user_metadata?.full_name || supabaseUser.email?.split('@')[0] || "User";
        const email = supabaseUser.email || supabaseUser.id; // Fallback to ID if email is missing

        // Sync with backend
        try {
            const res = await api.post("/auth/sync", {
                supabase_id: supabaseUser.id,
                username: email,
                nickname: nickname
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const userData: User = {
                username: email,
                nickname: res.data.nickname || nickname,
                supabase_id: supabaseUser.id
            };
            setToken(token);
            setUser(userData);

            localStorage.setItem("jonglaw_token", token);
            localStorage.setItem("jonglaw_user", email);
            localStorage.setItem("jonglaw_nickname", userData.nickname);
        } catch (err) {
            console.error("Auth sync failed:", err);
        }
    };

    const clearAuth = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem("jonglaw_token");
        localStorage.removeItem("jonglaw_user");
        localStorage.removeItem("jonglaw_nickname");
    };

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
        await supabase.auth.signOut();
        clearAuth();
        window.location.reload();
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
