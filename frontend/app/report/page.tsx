"use client";

import { useEffect, useState } from "react";
import LegalReportView from "@/components/LegalReportView";
import { Loader2, AlertCircle, CheckCircle2, RotateCw } from "lucide-react";
import LegalWatchModal from "@/components/LegalWatchModal";
import { AuthProvider } from "@/context/AuthContext";
import api from "@/utils/api";
import { isUsableReportCache } from "@/utils/report-cache";

export default function ReportPage() {
    const [reportData, setReportData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const [isWatchModalOpen, setIsWatchModalOpen] = useState(false);

    useEffect(() => {
        const urlId = new URLSearchParams(window.location.search).get("id");
        // Read data from sessionStorage
        let data = sessionStorage.getItem("jonglaw_last_report");
        // 저장 실패 후 탭까지 닫힌 경우, 이 기기에 남겨둔 최신 미저장 보고서를 복구한다.
        if (!data) {
            const pendingKey = localStorage.getItem("jonglaw_pending_report_latest");
            if (pendingKey) data = localStorage.getItem(pendingKey);
        }
        let parsed: any = null;
        if (data) {
            try {
                parsed = JSON.parse(data);
            } catch {
                // URL에 저장된 보고서 ID가 있으면 손상된 캐시는 무시하고 서버에서 다시 읽는다.
                if (!urlId) setError("데이터를 불러오는 중 오류가 발생했습니다.");
            }
        }

        const resolvedId = urlId || parsed?.reportId;
        const hasUsableCache = isUsableReportCache(parsed, resolvedId);
        if (hasUsableCache) setReportData(parsed);
        const numericId = resolvedId && /^\d+$/.test(String(resolvedId)) ? Number(resolvedId) : null;
        if (numericId) {
            api.get(`/history/${numericId}`)
                .then((res) => {
                    const detail = res.data;
                    const full = {
                        reportId: String(detail.id),
                        query: detail.query,
                        answer: detail.answer,
                        sources: detail.sources || [],
                        evidenceManifest: detail.evidence_manifest || [],
                        engine: detail.engine,
                        chat_history: detail.chat_history || [],
                        saveStatus: "saved",
                        clientRequestId: detail.client_request_id,
                        generationJobId: detail.generation_job_id,
                    };
                    setReportData(full);
                    sessionStorage.setItem("jonglaw_last_report", JSON.stringify(full));
                })
                .catch(() => {
                    if (!hasUsableCache) setError("저장된 보고서를 불러오지 못했습니다.");
                });
        } else if (resolvedId && !hasUsableCache) {
            api.get(`/jobs/${encodeURIComponent(String(resolvedId))}`)
                .then((res) => {
                    const job = res.data;
                    if (!job.result) throw new Error("No generated result");
                    setReportData({
                        reportId: job.report_id ? String(job.report_id) : `JL-${String(job.id).slice(0, 8)}`,
                        query: job.query,
                        answer: job.result,
                        sources: job.sources || [],
                        evidenceManifest: [],
                        engine: job.model,
                        chat_history: [],
                        generationJobId: job.id,
                        saveStatus: job.report_id ? "saved" : "failed",
                    });
                })
                .catch(() => setError("복구할 보고서 정보를 찾을 수 없습니다."));
        } else if (!hasUsableCache) {
            setError("리포트 정보를 찾을 수 없습니다.");
        }

        const handleOpenWatch = () => setIsWatchModalOpen(true);
        window.addEventListener('open-legal-watch', handleOpenWatch);
        return () => window.removeEventListener('open-legal-watch', handleOpenWatch);
    }, []);

    const retrySave = async () => {
        if (!reportData || saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            const clientRequestId = reportData.clientRequestId || crypto.randomUUID();
            const res = await api.post('/history', {
                query: reportData.query,
                answer: reportData.answer,
                engine: reportData.engine,
                sources: reportData.sources || [],
                client_request_id: clientRequestId,
                generation_job_id: reportData.generationJobId,
            });
            const id = res.data?.id;
            if (!id) throw new Error("저장된 보고서 ID를 받지 못했습니다.");
            const saved = { ...reportData, reportId: String(id), clientRequestId, saveStatus: "saved" };
            setReportData(saved);
            sessionStorage.setItem("jonglaw_last_report", JSON.stringify(saved));
            window.history.replaceState(null, "", `/report?id=${id}`);
            const pendingKey = `jonglaw_pending_report:${clientRequestId}`;
            localStorage.removeItem(pendingKey);
            if (localStorage.getItem("jonglaw_pending_report_latest") === pendingKey) {
                localStorage.removeItem("jonglaw_pending_report_latest");
            }
        } catch (e: any) {
            setSaveError(e.response?.status === 401
                ? "로그인이 만료되었습니다. 다시 로그인한 뒤 이 창에서 재시도해 주세요."
                : "저장에 실패했습니다. 보고서 내용은 이 기기에 보존되어 있습니다.");
        } finally {
            setSaving(false);
        }
    };

    if (error) {
        return (
            <div className="min-h-screen bg-background editorial-paper-grid flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-4">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
                    <h1 className="text-2xl font-bold text-slate-800">{error}</h1>
                    <p className="text-slate-500">챗봇 창에서 '전문 자문 보고서 보기' 버튼을 다시 클릭해 주세요.</p>
                </div>
            </div>
        );
    }

    if (!reportData) {
        return (
            <div className="min-h-screen bg-background editorial-paper-grid flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    <span className="text-slate-500 font-bold">리포트를 구성하는 중...</span>
                </div>
            </div>
        );
    }

    return (
        <AuthProvider>
            <div className="bg-background min-h-screen">
                {reportData.saveStatus === "failed" && (
                    <div className="print:hidden sticky top-0 z-50 bg-amber-50 border-b border-amber-200 px-4 py-3">
                        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900">
                            <div className="flex items-start gap-2 text-sm font-bold">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                <span>{saveError || "이 보고서는 아직 히스토리에 저장되지 않았습니다. 내용은 현재 기기에 임시 보존되어 있습니다."}</span>
                            </div>
                            <button onClick={retrySave} disabled={saving} className="flex items-center justify-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                                {saving ? "저장 중..." : "히스토리에 다시 저장"}
                            </button>
                        </div>
                    </div>
                )}
                {reportData.saveStatus === "saved" && saveError === null && reportData.clientRequestId && (
                    <div className="sr-only" role="status"><CheckCircle2 />히스토리 저장 완료</div>
                )}
                <LegalReportView
                    reportId={reportData.reportId}
                    query={reportData.query}
                    answer={reportData.answer}
                    sources={reportData.sources}
                    engine={reportData.engine}
                    chat_history={reportData.chat_history || []}
                    evidenceManifest={reportData.evidenceManifest || []}
                    visionData={reportData.visionData}
                />

                <LegalWatchModal
                    isOpen={isWatchModalOpen}
                    onClose={() => setIsWatchModalOpen(false)}
                    initialTab="subscriptions"
                />
            </div>
        </AuthProvider>
    );
}
