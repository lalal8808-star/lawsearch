"use client";

import { useState, useRef } from "react";
import { Image as ImageIcon, X, FileText, UploadCloud, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ImageUploadProps {
    onUpload: (file: File) => void;
    onClear: () => void;
    busy: boolean;
}

export default function ImageUpload({ onUpload, onClear, busy }: ImageUploadProps) {
    const [preview, setPreview] = useState<string | null>(null);
    const [fileType, setFileType] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const isImage = file.type.startsWith("image/");
            const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

            if (!isImage && !isPdf) {
                alert("이미지 또는 PDF 파일만 업로드 가능합니다.");
                return;
            }

            setFileType(isPdf ? "pdf" : "image");

            if (isImage) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    setPreview(reader.result as string);
                    onUpload(file);
                };
                reader.readAsDataURL(file);
            } else {
                setPreview("pdf-placeholder"); // Marker for PDF icon
                onUpload(file);
            }
        }
    };

    const clearImage = () => {
        setPreview(null);
        setFileType(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        onClear();
    };

    return (
        <div className="relative">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*,.pdf"
                className="hidden"
            />

            <AnimatePresence>
                {preview ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="relative w-11 h-11 rounded-xl overflow-hidden border-2 border-primary/50 group shadow-lg flex items-center justify-center bg-white/5"
                    >
                        {fileType === "image" ? (
                            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-1">
                                <FileText className="text-primary w-5 h-5" />
                                <span className="text-[10px] font-bold text-primary/80 uppercase">PDF</span>
                            </div>
                        )}
                        <button
                            onClick={clearImage}
                            disabled={busy}
                            className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <X size={12} />
                        </button>
                        {busy && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                    </motion.div>
                ) : (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                        className="w-11 h-11 flex items-center justify-center bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-muted hover:text-primary active:scale-95 disabled:opacity-50"
                        title="계약서(이미지/PDF) 업로드"
                    >
                        <UploadCloud size={20} />
                    </button>
                )}
            </AnimatePresence>
        </div>
    );
}
