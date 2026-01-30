"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lock, User, Mail, Loader2, Scale } from "lucide-react";
import api from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

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
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-md bg-[#0f0f0f] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
                    >
                        <div className="p-8">
                            <div className="flex justify-between items-center mb-8">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                                        <Scale size={18} className="text-white" />
                                    </div>
                                    <h2 className="text-xl font-black tracking-tight uppercase">
                                        {mode === "login" ? "Account Login" : mode === "signup" ? "Create Account" : "My Profile"}
                                    </h2>
                                </div>
                                <button onClick={onClose} className="text-muted hover:text-white transition-colors">
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
                                            className={`w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${mode === "profile" ? "opacity-50 cursor-not-allowed" : ""}`}
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
                                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                                placeholder="Nickname"
                                            />
                                        </div>
                                    </div>
                                )}

                                {mode === "profile" && (
                                    <div className="space-y-2 pt-4 border-t border-white/5">
                                        <label className="text-[10px] font-bold text-white uppercase tracking-widest pl-1">Change Password (Optional)</label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                            <input
                                                type="password"
                                                value={currentPassword}
                                                onChange={(e) => setCurrentPassword(e.target.value)}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
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
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
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
                                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
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
                                    className="w-full bg-primary hover:bg-primary/90 text-white font-black py-4 rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest"
                                >
                                    {loading ? <Loader2 className="animate-spin" size={18} /> : mode === "login" ? "Sign In" : mode === "signup" ? "Register Now" : "Update Profile"}
                                </button>
                            </form>

                            {mode !== "profile" && (
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
                            )}
                        </div>

                        <div className="bg-white/5 p-4 text-center border-t border-white/5">
                            <span className="text-[9px] font-bold text-muted uppercase tracking-[0.2em]">Secure Authentication System</span>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
