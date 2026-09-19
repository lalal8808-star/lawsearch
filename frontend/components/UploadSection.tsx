"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, X, CheckCircle, Trash2, Database, AlertCircle, Search, Eye, RotateCcw, Archive, Loader2 } from "lucide-react";
import api from "@/utils/api";
import { motion, AnimatePresence } from "framer-motion";

type SourceStatus = "active" | "archived" | "deleted" | "error";
type UploadSource = {
    id: string;
    source: string;
    status: SourceStatus;
};

const tabs: { value: SourceStatus; label: string }[] = [
    { value: "active", label: "사용 중" },
    { value: "archived", label: "이전 버전" },
    { value: "deleted", label: "휴지통" },
];

export default function UploadSection() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
    const [isDragging, setIsDragging] = useState(false);
    const [sources, setSources] = useState<UploadSource[]>([]);
    const [sourceStatus, setSourceStatus] = useState<SourceStatus>("active");
    const [sourceSearch, setSourceSearch] = useState("");
    const [errorMsg, setErrorMsg] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [previewSource, setPreviewSource] = useState<UploadSource | null>(null);
    const [previewChunks, setPreviewChunks] = useState<string[]>([]);
    const [previewSearch, setPreviewSearch] = useState("");

    const fetchSources = useCallback(async () => {
        try {
            const res = await api.get("/uploads", { params: { status: sourceStatus, q: sourceSearch || undefined } });
            setSources(Array.isArray(res.data?.items) ? res.data.items : []);
        } catch (error) {
            console.error("Failed to fetch sources", error);
            setErrorMsg("학습 소스 목록을 불러오지 못했습니다.");
        }
    }, [sourceStatus, sourceSearch]);

    useEffect(() => {
        const timer = window.setTimeout(fetchSources, 300);
        return () => window.clearTimeout(timer);
    }, [fetchSources]);

    const moveToTrash = async (source: UploadSource) => {
        if (!confirm(`'${source.source}'을 휴지통으로 이동하시겠습니까?`)) return;
        setBusyId(source.id);
        try {
            await api.delete(`/uploads/${encodeURIComponent(source.id)}`);
            await fetchSources();
        } catch (error: any) {
            setErrorMsg(error?.response?.data?.detail || "소스 삭제에 실패했습니다.");
        } finally { setBusyId(null); }
    };

    const restoreSource = async (source: UploadSource) => {
        setBusyId(source.id);
        try {
            await api.post(`/uploads/${encodeURIComponent(source.id)}/restore`);
            await fetchSources();
        } catch (error: any) {
            setErrorMsg(error?.response?.data?.detail || "소스 복원에 실패했습니다.");
        } finally { setBusyId(null); }
    };

    const activateVersion = async (source: UploadSource) => {
        setBusyId(source.id);
        try {
            await api.post(`/uploads/${encodeURIComponent(source.id)}/activate`);
            await fetchSources();
        } catch (error: any) {
            setErrorMsg(error?.response?.data?.detail || "이전 버전 활성화에 실패했습니다.");
        } finally { setBusyId(null); }
    };

    const purgeSource = async (source: UploadSource) => {
        if (!confirm(`'${source.source}'을 영구 삭제하시겠습니까? 이 작업은 복구할 수 없습니다.`)) return;
        setBusyId(source.id);
        try {
            await api.delete(`/uploads/${encodeURIComponent(source.id)}/purge`);
            await fetchSources();
        } catch (error: any) {
            setErrorMsg(error?.response?.data?.detail || "영구 삭제에 실패했습니다.");
        } finally { setBusyId(null); }
    };

    const openPreview = async (source: UploadSource, query = "") => {
        setPreviewSource(source);
        setBusyId(source.id);
        try {
            const res = await api.get(`/uploads/${encodeURIComponent(source.id)}/preview`, { params: { q: query || undefined } });
            setPreviewChunks((res.data?.chunks || []).map((item: any) => item.content));
        } catch (error: any) {
            setErrorMsg(error?.response?.data?.detail || "미리보기를 불러오지 못했습니다.");
            setPreviewChunks([]);
        } finally { setBusyId(null); }
    };

    const selectFile = (next: File) => {
        const lower = next.name.toLowerCase();
        if (lower.endsWith(".pdf") || lower.endsWith(".hwpx")) {
            setFile(next);
            setStatus("idle");
            setErrorMsg("");
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setStatus("uploading");
        setErrorMsg("");
        try {
            const formData = new FormData();
            formData.append("file", file);
            await api.post("/upload", formData, { timeout: 300000 });
            setStatus("success");
            setSourceStatus("active");
            setFile(null);
            await fetchSources();
            window.setTimeout(() => setStatus("idle"), 3500);
        } catch (error: any) {
            const detail = error?.response?.data?.detail || (error?.code === "ECONNABORTED" ? "처리 시간이 초과되었습니다." : error?.message) || "업로드에 실패했습니다.";
            setErrorMsg(typeof detail === "string" ? detail : "업로드에 실패했습니다.");
            setStatus("error");
        }
    };

    return (
        <div className="glass-card p-4 lg:p-5">
            <div className="flex items-center justify-between gap-3 mb-4 shrink-0"><div><span className="editorial-eyebrow block mb-1">Knowledge Workspace</span><h2 className="editorial-serif font-semibold text-[18px] text-secondary">학습 소스 관리</h2></div><div className="w-8 h-8 bg-accent/10 rounded-lg flex items-center justify-center"><Upload className="text-accent w-4 h-4" /></div></div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(250px,0.78fr)_minmax(0,1.65fr)] lg:gap-5">
            <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-muted"><Upload size={13} /><span className="text-[10px] font-bold tracking-wide">새 자료 추가</span></div>

            {!file ? (
                <label onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }} onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]); }} className={`flex items-center justify-center gap-3 w-full min-h-[104px] border border-dashed rounded-[10px] cursor-pointer transition-all shrink-0 ${isDragging ? "border-accent bg-accent/10" : "border-secondary/20 hover:border-accent/60 hover:bg-accent/[0.035]"}`}>
                    <Upload className="w-5 h-5 text-accent shrink-0" /><p className="text-[11px] text-muted px-2 leading-relaxed">PDF 또는 HWPX 파일을<br className="sm:hidden" /> 끌어놓거나 선택하세요.</p>
                    <input type="file" className="hidden" accept=".pdf,.hwpx" onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])} />
                </label>
            ) : (
                <div className="space-y-3 shrink-0">
                    <div className="flex items-center justify-between bg-secondary/[0.035] p-3 rounded-lg border border-secondary/10"><div className="flex items-center gap-3 min-w-0"><FileText className="text-accent shrink-0" /><div className="min-w-0"><p className="text-sm font-medium truncate">{file.name}</p><p className="text-[10px] text-muted">{(file.size / 1024).toFixed(1)} KB</p></div></div><button onClick={() => setFile(null)}><X size={16} /></button></div>
                    <button onClick={handleUpload} disabled={status === "uploading"} className={`w-full py-2.5 rounded-[9px] font-semibold ${status === "error" ? "bg-red-600" : status === "success" ? "bg-emerald-700" : "bg-primary"} text-white disabled:opacity-70`}>{status === "uploading" ? "추출·임베딩·저장 중..." : status === "success" ? "분석 완료" : status === "error" ? "다시 시도" : "AI에게 학습시키기"}</button>
                </div>
            )}

            <AnimatePresence>
                {status === "success" && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-xs text-green-500 mt-2 flex items-center justify-center gap-1"><CheckCircle size={12} /> 학습과 저장이 완료되었습니다.</motion.p>}
                {errorMsg && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 flex items-start gap-2 rounded-lg border border-red-700/15 bg-red-700/[0.06] p-3 text-[11px] text-red-700"><AlertCircle size={14} className="shrink-0" /><span>{errorMsg}</span><button className="ml-auto" aria-label="오류 메시지 닫기" onClick={() => setErrorMsg("")}><X size={12} /></button></motion.div>}
            </AnimatePresence>
            </div>

            <div className="mt-4 pt-4 border-t border-secondary/10 overflow-hidden flex flex-col min-h-0 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                <div className="flex items-center justify-between gap-3 mb-2.5"><div className="flex items-center gap-2 text-muted"><Database size={13} /><span className="text-[10px] font-bold tracking-wide">학습된 소스</span><span className="rounded-full bg-secondary/[0.06] px-1.5 py-0.5 text-[8px] font-bold text-secondary">{sources.length}</span></div><div className="relative w-32"><Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><input value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder="파일 검색" aria-label="학습된 소스 검색" className="w-full bg-secondary/[0.035] border border-secondary/10 rounded-lg py-1.5 pl-7 pr-2 text-[10px] focus:outline-none focus:border-accent/50" /></div></div>
                <div className="flex gap-1 mb-2.5 p-0.5 bg-secondary/[0.035] rounded-[8px]">{tabs.map((tab) => <button key={tab.value} onClick={() => setSourceStatus(tab.value)} className={`flex-1 py-1 rounded-md text-[9px] font-bold transition-colors ${sourceStatus === tab.value ? "bg-secondary text-white shadow-sm" : "text-muted hover:text-secondary"}`}>{tab.label}</button>)}</div>
                <div className="grid max-h-[230px] grid-cols-1 gap-1 overflow-y-auto pr-1 custom-scrollbar min-h-0 xl:grid-cols-2">
                    {sources.length ? sources.map((source, index) => (
                        <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index * 0.015, 0.12) }} key={source.id} className="group flex min-h-10 items-center gap-2 rounded-lg border border-secondary/[0.07] bg-secondary/[0.022] px-2.5 py-1.5 hover:border-accent/35 hover:bg-accent/[0.025]">
                            <FileText size={13} className="text-primary/65 shrink-0" />
                            <p className="min-w-0 flex-1 truncate text-[10px] font-medium leading-none" title={source.source}>{source.source}</p>
                            {busyId === source.id ? <Loader2 size={13} className="animate-spin text-primary shrink-0" /> : (
                            <div className="flex shrink-0 items-center gap-0.5">
                                <button type="button" onClick={() => openPreview(source)} aria-label={`${source.source} 미리보기`} title="미리보기" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-secondary/[0.07] hover:text-secondary"><Eye size={12} /></button>
                                {sourceStatus === "deleted" ? <><button type="button" onClick={() => restoreSource(source)} aria-label={`${source.source} 복원`} title="복원" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-700 transition-colors hover:bg-emerald-700/10"><RotateCcw size={12} /></button><button type="button" onClick={() => purgeSource(source)} aria-label={`${source.source} 영구 삭제`} title="영구 삭제" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-red-700 transition-colors hover:bg-red-700/10"><Trash2 size={12} /></button></> : <>{sourceStatus === "archived" && <button type="button" onClick={() => activateVersion(source)} aria-label={`${source.source} 활성화`} title="이 버전 사용" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-700 transition-colors hover:bg-emerald-700/10"><RotateCcw size={12} /></button>}<button type="button" onClick={() => moveToTrash(source)} aria-label={`${source.source} 휴지통으로 이동`} title="휴지통" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-red-700 transition-colors hover:bg-red-700/10"><Archive size={12} /></button></>}
                            </div>
                            )}
                        </motion.div>
                    )) : <div className="text-center py-6 text-muted text-[10px] font-bold tracking-wide">등록된 소스가 없습니다.</div>}
                </div>
            </div>
            </div>

            {previewSource && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
                    onClick={() => setPreviewSource(null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="source-preview-title"
                        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-[0_30px_100px_rgba(0,0,0,0.55)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-slate-700/80 pb-4">
                            <div className="min-w-0">
                                <h3 id="source-preview-title" className="truncate text-sm font-bold text-white" title={previewSource.source}>{previewSource.source}</h3>
                                <p className="mt-1 text-[11px] font-medium text-slate-400">추출된 원문 텍스트 미리보기</p>
                            </div>
                            <button type="button" onClick={() => setPreviewSource(null)} aria-label="미리보기 닫기" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"><X size={18} /></button>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); openPreview(previewSource, previewSearch); }} className="my-4 flex gap-2">
                            <input value={previewSearch} onChange={(e) => setPreviewSearch(e.target.value)} placeholder="이 소스 안에서 검색" aria-label="미리보기 내용 검색" className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-xs text-white placeholder:text-slate-500 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300/20" />
                            <button type="submit" className="min-h-10 rounded-xl bg-amber-300 px-4 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200">검색</button>
                        </form>
                        <div className="min-h-0 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                            {previewChunks.length ? previewChunks.map((chunk, i) => (
                                <article key={i} className="whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/80 p-4 text-[13px] font-medium leading-7 text-slate-100 shadow-inner">
                                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">Chunk {i + 1}</span>
                                    {chunk}
                                </article>
                            )) : <p className="py-10 text-center text-xs font-medium text-slate-400">일치하는 텍스트가 없습니다.</p>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
