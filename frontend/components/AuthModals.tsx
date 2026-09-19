"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lock, User, Loader2, Scale } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/utils/supabase";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMode?: "login" | "signup" | "profile";
}

export default function AuthModal({ isOpen, onClose, initialMode = "login" }: AuthModalProps) {
    const [mode, setMode] = useState<"login" | "signup" | "profile">(initialMode);
    const [username, setUsername] = useState("");
    const [nickname, setNickname] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const { login, user, updateUser } = useAuth();

    useEffect(() => {
        if (isOpen) {
            setMode(initialMode);
            setError("");
            setPassword("");
            setConfirmPassword("");
            setCurrentPassword("");
        }
    }, [isOpen, initialMode]);

    useEffect(() => {
        if (mode === "profile" && user) {
            setNickname(user.nickname);
            setUsername(user.username);
        }
    }, [mode, user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        if (mode === "signup" && password !== confirmPassword) {
            setError("비밀번호가 일치하지 않습니다.");
            setLoading(false);
            return;
        }

        try {
            if (mode === "profile") {
                const formData = new FormData();
                if (nickname !== user?.nickname) formData.append("nickname", nickname);
                if (password) {
                    formData.append("current_password", currentPassword);
                    formData.append("new_password", password);
                }

                await api.patch("/auth/profile", formData);
                updateUser(nickname);
                onClose();
                return;
            }

            const formData = new FormData();
            formData.append("username", username);
            formData.append("password", password);
            if (mode === "signup") {
                formData.append("nickname", nickname);
            }

            const endpoint = mode === "login" ? "/auth/login" : "/auth/signup";
            const res = await api.post(endpoint, formData);

            login(res.data.access_token, res.data.username, res.data.nickname);
            onClose();
        } catch (err: any) {
            console.error("Auth error:", err);
            const detail = err.response?.data?.detail;
            const message = typeof detail === "string" ? detail : (err.message || "작업에 실패했습니다. (서버 연결 확인 필요)");
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
                        className="relative w-full max-w-md bg-card text-secondary border border-border rounded-[18px] shadow-[0_30px_90px_rgba(23,34,57,0.2)] overflow-hidden"
                    >
                        <div className="p-8">
                            <div className="flex justify-between items-center mb-8">
                                <div className="flex items-center gap-2">
                                    <div className="w-9 h-9 bg-secondary rounded-lg flex items-center justify-center">
                                        <Scale size={18} className="text-[#d7b77b]" />
                                    </div>
                                    <h2 className="editorial-serif text-xl font-semibold tracking-tight">
                                        {mode === "login" ? "로그인" : mode === "signup" ? "계정 만들기" : "내 정보"}
                                    </h2>
                                </div>
                                <button onClick={onClose} aria-label="닫기" className="text-muted hover:text-secondary transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Username</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                        <input
                                            type="text"
                                            required
                                            disabled={mode === "profile"}
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            className={`w-full bg-secondary/[0.035] border border-secondary/10 rounded-[9px] py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/50 transition-all ${mode === "profile" ? "opacity-50 cursor-not-allowed" : ""}`}
                                            placeholder="Username"
                                        />
                                    </div>
                                </div>

                                {(mode === "signup" || mode === "profile") && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">Nickname</label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                            <input
                                                type="text"
                                                required
                                                value={nickname}
                                                onChange={(e) => setNickname(e.target.value)}
                                                className="w-full bg-secondary/[0.035] border border-secondary/10 rounded-[9px] py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/50 transition-all"
                                                placeholder="Nickname"
                                            />
                                        </div>
                                    </div>
                                )}

                                {mode === "profile" && (
                                    <div className="space-y-2 pt-4 border-t border-secondary/10">
                                        <label className="text-[10px] font-bold text-secondary uppercase tracking-widest pl-1">Change Password (Optional)</label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                            <input
                                                type="password"
                                                value={currentPassword}
                                                onChange={(e) => setCurrentPassword(e.target.value)}
                                                className="w-full bg-secondary/[0.035] border border-secondary/10 rounded-[9px] py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/50 transition-all"
                                                placeholder="Current Password"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">
                                        {mode === "profile" ? "New Password" : "Password"}
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                        <input
                                            type="password"
                                            required={mode !== "profile"}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-secondary/[0.035] border border-secondary/10 rounded-[9px] py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/50 transition-all"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </div>

                                {(mode === "signup" || mode === "profile") && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-muted uppercase tracking-widest pl-1">
                                            {mode === "profile" ? "Confirm New Password" : "Confirm Password"}
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                            <input
                                                type="password"
                                                required={mode === "signup" || (mode === "profile" && password !== "")}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="w-full bg-secondary/[0.035] border border-secondary/10 rounded-[9px] py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/50 transition-all"
                                                placeholder="••••••••"
                                            />
                                        </div>
                                    </div>
                                )}

                                {error && (
                                    <p className="text-red-500 text-xs font-bold bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                                        {error}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full editorial-button font-bold py-3.5 transition-all flex items-center justify-center gap-2 text-sm tracking-wide"
                                >
                                    {loading ? <Loader2 className="animate-spin" size={18} /> : mode === "login" ? "Sign In" : mode === "signup" ? "Register Now" : "Update Profile"}
                                </button>
                            </form>

                            {mode !== "profile" && (
                                <>
                                    <div className="relative my-8 text-center">
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full border-t border-secondary/10"></div>
                                        </div>
                                        <div className="relative inline-block px-4 bg-card text-[10px] font-bold text-muted uppercase tracking-widest">
                                            Or continue with
                                        </div>
                                    </div>

                                    <button
                                        onClick={async () => {
                                            setError("");
                                            const { error } = await supabase.auth.signInWithOAuth({
                                                provider: 'google',
                                                options: {
                                                    redirectTo: `${window.location.origin}/auth/callback`
                                                }
                                            });
                                            if (error) setError(error.message);
                                        }}
                                        className="w-full bg-white hover:bg-secondary/[0.035] text-secondary font-bold py-3 rounded-[9px] border border-secondary/15 transition-all flex items-center justify-center gap-3 text-sm"
                                    >
                                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                                            <path
                                                fill="currentColor"
                                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18c-.71 1.44-1.12 3.06-1.12 4.94s.41 3.5 1.12 4.94l3.66-2.84z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                            />
                                        </svg>
                                        Google
                                    </button>

                                    <div className="mt-8 text-center">
                                        <p className="text-xs text-muted">
                                            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
                                            <button
                                                onClick={() => {
                                                    setMode(mode === "login" ? "signup" : "login");
                                                    setError("");
                                                }}
                                                className="text-primary font-bold hover:underline"
                                            >
                                                {mode === "login" ? "Sign Up" : "Login"}
                                            </button>
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="bg-secondary/[0.025] p-4 text-center border-t border-secondary/10">
                            <span className="text-[9px] font-bold text-muted uppercase tracking-[0.16em]">Secure Authentication</span>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
