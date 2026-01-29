"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import api from "@/utils/api";

interface User {
    username: string;
    nickname: string;
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

    useEffect(() => {
        const savedToken = localStorage.getItem("jonglaw_token");
        const savedUser = localStorage.getItem("jonglaw_user");
        const savedNickname = localStorage.getItem("jonglaw_nickname");

        if (savedToken && savedUser && savedNickname) {
            setToken(savedToken);
            setUser({ username: savedUser, nickname: savedNickname });
        }
        setLoading(false);
    }, []);

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

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem("jonglaw_token");
        localStorage.removeItem("jonglaw_user");
        localStorage.removeItem("jonglaw_nickname");
        window.location.reload(); // Refresh to clear state
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
