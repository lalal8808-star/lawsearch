"use client";

import { useState, useEffect } from "react";
import { Upload, FileText, X, CheckCircle, Trash2, Database } from "lucide-react";
import api from "@/utils/api";
import { motion, AnimatePresence } from "framer-motion";

export default function UploadSection() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
    const [isDragging, setIsDragging] = useState(false);
    const [uploadedSources, setUploadedSources] = useState<string[]>([]);

    useEffect(() => {
        fetchSources();
    }, []);

    const fetchSources = async () => {
        try {
            const res = await api.get("/uploads");
            setUploadedSources(res.data);
        } catch (error) {
            console.error("Failed to fetch sources", error);
        }
    };

    const handleDeleteSource = async (sourceName: string) => {
        try {
            await api.delete(`/uploads/${encodeURIComponent(sourceName)}`);
            fetchSources();
        } catch (error) {
            console.error("Failed to delete source", error);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setStatus("idle");
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type === "application/pdf" || droppedFile.name.endsWith(".pdf")) {
                setFile(droppedFile);
                setStatus("idle");
            }
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setStatus("uploading");
        try {
            const formData = new FormData();
            formData.append("file", file);
            await api.post("/upload", formData);
            setStatus("success");
            fetchSources();
            setTimeout(() => {
                setFile(null);
                setStatus("idle");
            }, 3000);
        } catch (error) {
            console.error("Upload failed", error);
            setStatus("error");
        }
    };

    return (
        <div className="glass-card p-6 h-full flex flex-col">
            <div className="flex items-center gap-3 mb-6 shrink-0">
                <Upload className="text-primary w-5 h-5" />
                <h2 className="font-semibold text-lg">추가 소스 업로드</h2>
            </div>

            {!file ? (
                <label
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center w-full min-h-[140px] border-2 border-dashed rounded-xl cursor-pointer transition-all shrink-0 ${isDragging
                        ? "border-primary bg-primary/10 scale-[1.02]"
                        : "border-white/10 hover:border-primary/50 hover:bg-white/5"
                        }`}
                >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Upload className="w-8 h-8 text-muted mb-2" />
                        <p className="text-xs text-muted text-center px-4">PDF 파일을 드래그하거나 클릭하여 업로드</p>
                    </div>
                    <input type="file" className="hidden" accept=".pdf" onChange={handleFileChange} />
                </label>
            ) : (
                <div className="space-y-4 shrink-0">
                    <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10">
                        <div className="flex items-center gap-3">
                            <FileText className="text-primary" />
                            <div className="max-w-[150px] overflow-hidden">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-[10px] text-muted">{(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                        </div>
                        <button onClick={() => setFile(null)} className="text-muted hover:text-white">
                            <X size={16} />
                        </button>
                    </div>

                    <button
                        onClick={handleUpload}
                        disabled={status === "uploading"}
                        className={`w-full py-2.5 rounded-lg font-medium transition-all ${status === "success"
                            ? "bg-green-500 text-white"
                            : "bg-primary hover:bg-primary/80 text-white"
                            }`}
                    >
                        {status === "uploading" ? "업로드 중..." : status === "success" ? "분석 완료" : "AI에게 학습시키기"}
                    </button>
                </div>
            )}

            <AnimatePresence>
                {status === "success" && (
                    <motion.p
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-center text-xs text-green-500 mt-2 flex items-center justify-center gap-1 shrink-0"
                    >
                        <CheckCircle size={12} /> 문서가 AI 데이터베이스에 추가되었습니다.
                    </motion.p>
                )}
            </AnimatePresence>

            {/* Managed Source List Section */}
            <div className="mt-8 pt-6 border-t border-white/10 flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-4 opacity-60 shrink-0">
                    <Database size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">학습된 소스 목록</span>
                </div>

                <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
                    {uploadedSources.length > 0 ? (
                        uploadedSources.map((source, i) => (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                key={source}
                                className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-lg border border-white/5 group hover:border-primary/30 transition-colors"
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <FileText size={14} className="text-primary/70 shrink-0" />
                                    <span className="text-[11px] font-medium truncate opacity-80">{source}</span>
                                </div>
                                <button
                                    onClick={() => handleDeleteSource(source)}
                                    className="text-muted hover:text-red-400 p-1 md:opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                    title="소스 삭제"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </motion.div>
                        ))
                    ) : (
                        <div className="text-center py-8 opacity-20 text-[10px] font-bold uppercase tracking-widest grayscale italic">
                            No additional sources
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
