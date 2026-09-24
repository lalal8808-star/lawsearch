"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Send, Bot, Scale, FileText, X, AlertTriangle, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import api, { getAuthToken } from "@/utils/api";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import ImageUpload from "./ImageUpload";
import { isStructuredReport, streamingProgress, usagePercent } from "@/utils/generation";

type ChatMessage = {
    role: string;
    content: string;
    sources?: any[];
    intent?: string;
    engine?: string;
    reportId?: number;
    clientRequestId?: string;
    saveStatus?: "saving" | "saved" | "failed";
    saveError?: string;
    jobId?: string;
    visionData?: any;
};

export default function AIPanel() {
    const [query, setQuery] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [loadingStage, setLoadingStage] = useState("");
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [usage, setUsage] = useState<any>(null);
    const [mounted, setMounted] = useState(false);
    const { user } = useAuth();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // 답변 스트림을 받기 시작하면 받은 분량 자체가 진행 신호이므로 서버 폴링 값으로 덮어쓰지 않는다.
    const streamingRef = useRef(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Auto-expand textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [query]);

    // 서버에 저장된 실제 작업 단계만 표시한다. 임의 증가 타이머는 사용하지 않는다.
    useEffect(() => {
        if (!loading || !currentJobId) return;
        let active = true;
        const poll = async () => {
            try {
                const res = await api.get(`/jobs/${currentJobId}`);
                if (!active || streamingRef.current) return;
                const nextProgress = Number(res.data?.progress) || 0;
                const nextStage = res.data?.stage || "처리 중...";
                setProgress((previous) => Math.max(previous, nextProgress));
                setLoadingStage((previous) => previous === nextStage ? previous : nextStage);
            } catch { }
        };
        poll();
        const timer = window.setInterval(poll, 1500);
        return () => { active = false; window.clearInterval(timer); };
    }, [loading, currentJobId]);

    useEffect(() => {
        if (!user) return;
        api.get('/usage').then((res) => setUsage(res.data)).catch(() => { });
        api.get('/jobs', { params: { recoverable: true, limit: 3 } }).then((res) => {
            const recoverable = (res.data?.items || []).find((job: any) => job.result && !job.report_id);
            if (!recoverable) return;
            setMessages((prev) => {
                if (prev.some((msg) => msg.jobId === recoverable.id)) return prev;
                return [
                    ...prev,
                    { role: 'user', content: recoverable.query },
                    {
                        role: 'assistant', content: recoverable.result, sources: recoverable.sources || [],
                        intent: recoverable.intent || 'REPORT', engine: recoverable.model || 'gpt-5.6-sol',
                        clientRequestId: recoverable.id, jobId: recoverable.id,
                        saveStatus: 'failed', saveError: '이전에 생성되었지만 히스토리에 저장되지 않은 보고서를 복구했습니다.',
                    },
                ];
            });
        }).catch(() => { });
    }, [user]);


    const openReportWindow = (q: string, a: string, s: any[], e?: string, ch?: any[], realId?: number, visionData?: any, clientRequestId?: string, saveStatus?: "saved" | "failed", generationJobId?: string) => {
        const reportId = realId ? realId.toString() : `JL-${new Date().getTime().toString().slice(-6)}`;
        const report = {
            reportId,
            query: q,
            answer: a,
            sources: s,
            engine: e,
            chat_history: ch || [],
            visionData: visionData || null,
            clientRequestId,
            saveStatus: saveStatus || (realId ? "saved" : undefined),
            generationJobId,
        };
        sessionStorage.setItem("jonglaw_last_report", JSON.stringify(report));
        // 저장 실패 보고서는 탭을 닫거나 새로고침해도 같은 기기에서 재시도할 수 있게 보관한다.
        if (clientRequestId && saveStatus === "failed") {
            const pendingKey = `jonglaw_pending_report:${clientRequestId}`;
            localStorage.setItem(pendingKey, JSON.stringify(report));
            localStorage.setItem("jonglaw_pending_report_latest", pendingKey);
        }
        window.open(realId ? `/report?id=${realId}` : generationJobId ? `/report?id=${encodeURIComponent(generationJobId)}` : "/report", "_blank");
    };

    const persistAndOpenGeneratedReport = async (
        reportQuery: string,
        answer: string,
        sources: any[],
        jobId: string,
        engine = "gpt-5.6-sol"
    ) => {
        const clientRequestId = jobId;
        setProgress((previous) => Math.max(previous, 90));
        setLoadingStage("보고서 저장 중");
        setMessages((previous) => {
            const updated = [...previous];
            let targetIndex = -1;
            for (let index = updated.length - 1; index >= 0; index -= 1) {
                if (updated[index].role === "assistant" && (updated[index].jobId === jobId || !updated[index].jobId)) {
                    targetIndex = index;
                    break;
                }
            }
            const reportMessage: ChatMessage = {
                role: "assistant",
                content: answer,
                sources,
                intent: "REPORT",
                engine,
                clientRequestId,
                jobId,
                saveStatus: "saving",
            };
            if (targetIndex >= 0) updated[targetIndex] = { ...updated[targetIndex], ...reportMessage };
            else updated.push(reportMessage);
            return updated;
        });

        let realId: number | undefined;
        let saveError: string | undefined;
        try {
            const saveRes = await api.post('/history', {
                query: reportQuery,
                answer,
                engine,
                sources,
                client_request_id: clientRequestId,
                generation_job_id: jobId,
            });
            realId = saveRes.data?.id;
            if (!realId) throw new Error("저장된 보고서 ID를 받지 못했습니다.");
            const pendingKey = `jonglaw_pending_report:${clientRequestId}`;
            localStorage.removeItem(pendingKey);
            if (localStorage.getItem("jonglaw_pending_report_latest") === pendingKey) {
                localStorage.removeItem("jonglaw_pending_report_latest");
            }
            setMessages((previous) => previous.map((message) => message.jobId === jobId
                ? { ...message, reportId: realId, saveStatus: "saved", saveError: undefined }
                : message));
            api.patch(`/jobs/${jobId}`, {
                status: 'complete', stage: '보고서 저장 완료', progress: 100, report_id: realId,
            }).catch(() => { });
            window.dispatchEvent(new CustomEvent('report-generated'));
        } catch (saveErr: any) {
            console.error('Failed to save report to history', saveErr);
            saveError = saveErr.response?.status === 401
                ? "로그인이 만료되어 저장하지 못했습니다. 다시 로그인한 뒤 재시도해 주세요."
                : "히스토리 저장에 실패했습니다. 보고서는 보존되며 다시 저장할 수 있습니다.";
            setMessages((previous) => previous.map((message) => message.jobId === jobId
                ? { ...message, saveStatus: "failed", saveError }
                : message));
        }

        openReportWindow(
            reportQuery, answer, sources, engine, [], realId, undefined,
            clientRequestId, realId ? "saved" : "failed", jobId
        );
        return { reportId: realId, saveError };
    };

    const retryReportSave = async (messageIndex: number) => {
        const msg = messages[messageIndex];
        if (!msg || msg.intent !== "REPORT" || msg.saveStatus === "saving") return;
        const clientRequestId = msg.clientRequestId || crypto.randomUUID();
        setMessages(prev => prev.map((m, i) => i === messageIndex
            ? { ...m, clientRequestId, saveStatus: "saving", saveError: undefined }
            : m));
        try {
            const saveRes = await api.post('/history', {
                query: messages[messageIndex - 1]?.content || "질의 사항",
                answer: msg.content,
                engine: msg.engine || 'gpt-5.6-sol',
                sources: msg.sources || [],
                client_request_id: clientRequestId,
                generation_job_id: msg.jobId,
            });
            const reportId = saveRes.data?.id;
            if (!reportId) throw new Error("저장된 보고서 ID를 받지 못했습니다.");
            const pendingKey = `jonglaw_pending_report:${clientRequestId}`;
            localStorage.removeItem(pendingKey);
            if (localStorage.getItem("jonglaw_pending_report_latest") === pendingKey) {
                localStorage.removeItem("jonglaw_pending_report_latest");
            }
            setMessages(prev => prev.map((m, i) => i === messageIndex
                ? { ...m, reportId, clientRequestId, saveStatus: "saved", saveError: undefined }
                : m));
            if (msg.jobId) await api.patch(`/jobs/${msg.jobId}`, { status: 'complete', stage: '보고서 저장 완료', progress: 100, report_id: reportId });
            window.dispatchEvent(new CustomEvent('report-generated'));
        } catch (error: any) {
            const reason = error.response?.status === 401
                ? "로그인이 만료되어 저장하지 못했습니다. 다시 로그인한 뒤 재시도해 주세요."
                : "히스토리 저장에 실패했습니다. 보고서는 보존되며 다시 저장할 수 있습니다.";
            setMessages(prev => prev.map((m, i) => i === messageIndex
                ? { ...m, clientRequestId, saveStatus: "failed", saveError: reason }
                : m));
        }
    };

    const handleCancel = () => {
        if (abortController) {
            abortController.abort();
            setAbortController(null);
            setLoading(false);
            if (currentJobId) api.patch(`/jobs/${currentJobId}`, { status: 'cancelled', stage: '사용자 취소', progress }).catch(() => { });
            setCurrentJobId(null);
            setMessages(prev => [
                ...prev,
                { role: "assistant", content: "요청이 취소되었습니다." }
            ]);
        }
    };

    const handle401Error = () => {
        // 리로드 금지: 작성 중인 입력이 날아간다. 스토리지 정리는 api 인터셉터가 담당하고,
        // 여기서는 10초 스로틀로 안내만 한다. (세션 refresh 재시도도 인터셉터가 이미 수행)
        if (typeof window !== "undefined") {
            const lastAlert = sessionStorage.getItem("last_401_alert");
            const now = Date.now();
            if (!lastAlert || now - parseInt(lastAlert) > 10000) {
                sessionStorage.setItem("last_401_alert", now.toString());
                alert("인증 정보가 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.");
            }
        }
    };

    const handleSend = async () => {
        if ((!query.trim() && !selectedImage) || loading) return;

        setLoading(true);
        setProgress(0);
        setLoadingStage("요청 등록 중...");
        const currentQuery = query.trim() || (selectedImage ? `${selectedImage.name} 분석 요청` : "");
        const userMsg = { role: "user", content: currentQuery };
        setMessages((prev) => [...prev, userMsg]);
        setQuery("");
        const controller = new AbortController();
        setAbortController(controller);
        let activeJobId: string | null = null;

        try {
            if (selectedImage) {
                const formData = new FormData();
                formData.append("file", selectedImage);
                if (query.trim()) formData.append("description", query.trim());

                const token = await getAuthToken(); // 항상 갱신된 세션 토큰 사용
                const res = await axios.post(`/api/analyze`, formData, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    signal: controller.signal
                });

                const assistantMsg = {
                    role: "assistant",
                    content: `${selectedImage.name} 분석 결과입니다.`,
                    visionData: res.data,
                    intent: "VISION_ANALYSIS",
                    engine: "gpt-5.6-sol"
                };
                setMessages((prev) => [...prev, assistantMsg]);
                setSelectedImage(null); // Clear after send
            } else {
                const jobRes = await api.post('/jobs', { query: currentQuery, kind: 'consultation', model: 'openai/gpt-5.6-sol' });
                const jobId: string = jobRes.data.id;
                activeJobId = jobId;
                streamingRef.current = false;
                setCurrentJobId(jobId);
                setProgress(jobRes.data.progress || 5);
                setLoadingStage(jobRes.data.stage || "요청 접수");
                const token = await getAuthToken(); // 항상 갱신된 세션 토큰 사용
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({
                        messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
                        jobId,
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        setMessages((prev) => prev.slice(0, -1)); // 401 오류 시 방금 추가된 빈 버블 제거
                        handle401Error();
                        return;
                    }
                    // 504(타임아웃) 등은 본문이 JSON이 아닌 HTML이라 json() 파싱이 또 터진다.
                    // 상태코드 기반으로 원인을 알 수 있게 처리한다.
                    let detail = '';
                    try {
                        detail = (await response.json())?.error || '';
                    } catch {
                        detail = response.status === 504 || response.status === 502
                            ? '응답 시간이 초과되었습니다. 질문을 더 짧게 나눠서 다시 시도해 주세요.'
                            : `서버 오류(${response.status})가 발생했습니다.`;
                    }
                    throw new Error(detail || '채팅 응답에 실패했습니다.');
                }

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                if (!reader) throw new Error('응답 스트림 리더를 생성할 수 없습니다.');

                // RAG 소스/intent는 서버가 응답 헤더로 전달 (toTextStreamResponse)
                let sources: any[] = [];
                try {
                    const sourcesHeader = response.headers.get('X-RAG-Sources');
                    if (sourcesHeader) sources = JSON.parse(decodeURIComponent(sourcesHeader));
                } catch (e) {
                    console.error('X-RAG-Sources parse error:', e);
                }
                const intent = response.headers.get('X-RAG-Intent') || 'CHAT';

                let assistantAnswer = '';
                let firstChunkReceived = false;

                // Append an empty assistant message for streaming
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: "", sources, intent, engine: "gpt-5.6-sol", jobId }
                ]);

                // 서버는 순수 텍스트 스트림을 보냄 → 청크를 그대로 누적
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    assistantAnswer += decoder.decode(value, { stream: true });
                    if (!firstChunkReceived && assistantAnswer.trim()) {
                        firstChunkReceived = true;
                        streamingRef.current = true;
                        api.patch(`/jobs/${jobId}`, { status: 'running', stage: 'AI 초안 수신 중', progress: 70 }).catch(() => { });
                    }
                    if (firstChunkReceived) {
                        const received = assistantAnswer.length;
                        setProgress((previous) => Math.max(previous, streamingProgress(received)));
                        setLoadingStage(`AI 답변 작성 중 · ${received.toLocaleString()}자 수신`);
                    }

                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === 'assistant') {
                            last.content = assistantAnswer;
                        }
                        return updated;
                    });
                }

                // If no response content was received, throw an error to be handled in catch block
                if (!assistantAnswer.trim()) {
                    throw new Error("서버로부터 답변을 수신하지 못했습니다. API Key 또는 AI Gateway 설정을 확인해 주십시오.");
                }

                // intent가 CHAT으로 와도 답변이 구조화된 보고서면 보고서로 처리한다.
                // (백엔드 intent 분류 실패나 RAG 미도달로 intent가 CHAT으로 떨어져도
                //  보고서가 채팅창에 그대로 출력되지 않고 새 창으로 열리도록 하는 안전망)
                const isReport = isStructuredReport(assistantAnswer, intent);

                if (isReport) {
                    await persistAndOpenGeneratedReport(currentQuery, assistantAnswer, sources, jobId);
                } else {
                    setProgress(100);
                }
            }

        } catch (error: any) {
            if (error.name === 'CanceledError') return;
            console.error("AI Query Error:", error);
            
            if (error.response?.status === 401 || error.status === 401) {
                handle401Error();
                return;
            }
            
            const detail = error.response?.data?.detail || error.response?.data?.error || error.message;
            const message = typeof detail === "string" ? detail : "서버 통신 중 오류가 발생했습니다.";
            // 모바일 Safari/PWA가 응답 스트림만 끊는 경우 서버에는 완성본이 남아 있다.
            // 실패로 덮어쓰기 전에 서버 작업을 조회해 완성본을 히스토리에 저장하고 연다.
            if (activeJobId) {
                try {
                    setLoadingStage("완성된 보고서 확인 중");
                    const jobResponse = await api.get(`/jobs/${activeJobId}`);
                    const recoveredJob = jobResponse.data;
                    const recoveredAnswer = typeof recoveredJob?.result === "string" ? recoveredJob.result : "";
                    if (recoveredAnswer && isStructuredReport(recoveredAnswer, recoveredJob?.intent)) {
                        await persistAndOpenGeneratedReport(
                            recoveredJob.query || currentQuery,
                            recoveredAnswer,
                            Array.isArray(recoveredJob.sources) ? recoveredJob.sources : [],
                            activeJobId,
                            recoveredJob.model?.replace(/^openai\//, "") || "gpt-5.6-sol"
                        );
                        return;
                    }
                } catch (recoveryError) {
                    console.error("Generated report recovery failed:", recoveryError);
                }
                api.patch(`/jobs/${activeJobId}`, {
                    status: 'error', stage: '클라이언트 수신 실패', error: message,
                }).catch(() => { });
            }
            
            setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                // Reuse the last empty assistant bubble if available to avoid duplicate empty bubbles
                if (last && last.role === 'assistant' && !last.content) {
                    last.content = `죄송합니다. 오류가 발생했습니다: ${message}`;
                    return updated;
                } else {
                    return [
                        ...updated,
                        { role: "assistant", content: `죄송합니다. 오류가 발생했습니다: ${message}` }
                    ];
                }
            });
        } finally {
            setLoading(false);
            setAbortController(null);
            setCurrentJobId(null);
            api.get('/usage').then((res) => setUsage(res.data)).catch(() => { });
        }
    };

    let latestAssistantIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "assistant") {
            latestAssistantIndex = index;
            break;
        }
    }
    const latestAssistant = latestAssistantIndex >= 0 ? messages[latestAssistantIndex] : null;
    let latestQuery = "";
    for (let index = (latestAssistantIndex >= 0 ? latestAssistantIndex : messages.length) - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") {
            latestQuery = messages[index].content;
            break;
        }
    }

    const isCompletedReport = Boolean(latestAssistant && (latestAssistant.intent === "REPORT" || latestAssistant.intent === "VISION_ANALYSIS"));
    const hasError = Boolean(latestAssistant?.content?.startsWith("죄송합니다. 오류가 발생했습니다"));
    const statusProgress = loading ? Math.max(4, progress) : isCompletedReport ? 100 : 0;
    const statusTitle = loading
        ? (loadingStage || "보고서 작성 중")
        : latestAssistant?.saveStatus === "failed"
            ? "보고서 생성 완료 · 저장 확인 필요"
            : isCompletedReport
                ? "법률 검토 보고서가 완성되었습니다"
                : hasError
                    ? "보고서 생성 중 오류가 발생했습니다"
                    : "검토할 사안을 입력해 주세요";
    const statusDescription = loading
        ? "최신 법령·판례와 관련 자료를 대조하여 보고서를 구성하고 있습니다."
        : latestAssistant?.saveStatus === "failed"
            ? (latestAssistant.saveError || "보고서는 보존되어 있으며 히스토리 저장을 다시 시도할 수 있습니다.")
            : isCompletedReport
                ? "상세 검토 결과는 별도의 보고서 창에서 확인할 수 있습니다."
                : hasError
                    ? latestAssistant?.content.replace("죄송합니다. ", "") || "잠시 후 다시 시도해 주세요."
                    : "질의를 접수하면 진행 상태만 표시하고, 완성된 보고서는 새 창으로 열어드립니다.";

    const openLatestReport = () => {
        if (!latestAssistant || latestAssistantIndex < 0 || !isCompletedReport) return;
        openReportWindow(
            latestQuery || "질의 사항",
            latestAssistant.content,
            latestAssistant.sources || [],
            latestAssistant.engine,
            [],
            latestAssistant.reportId,
            latestAssistant.visionData,
            latestAssistant.clientRequestId,
            latestAssistant.saveStatus === "failed" ? "failed" : "saved",
            latestAssistant.jobId
        );
    };

    if (!mounted) return <div className="flex-1 editorial-chat animate-pulse" />;

    return (
        <div className="flex flex-col h-full editorial-chat overflow-hidden">
            <div className="shrink-0 px-5 py-4 border-b border-white/10 bg-white/[0.025] flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-[#d7b77b]/10 border border-[#d7b77b]/25 rounded-lg flex items-center justify-center">
                        <Scale className="text-[#d7b77b] w-[18px] h-[18px]" />
                    </div>
                    <div className="flex flex-col">
                        <h2 className="editorial-serif font-semibold text-[15px] leading-none tracking-tight">JongLaw AI</h2>
                        <span className="text-[8px] text-[#d7b77b]/80 font-bold uppercase tracking-[0.17em] mt-1">Counsel Workspace</span>
                    </div>
                </div>
                {usage && (
                    <div className="text-right" title={`이번 달 ${Number(usage.total_tokens || 0).toLocaleString()} / ${Number(usage.token_limit || 0).toLocaleString()} 토큰`}>
                        <p className="text-[8px] font-bold text-muted uppercase tracking-[0.12em]">Monthly AI</p>
                        <p className="text-[10px] font-semibold text-[#d7b77b]">{usagePercent(usage.total_tokens || 0, usage.token_limit || 0)}% 사용</p>
                    </div>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 sm:px-6" aria-live="polite">
                    <div className="flex h-full min-h-0 flex-col justify-between gap-3">
                        <div className="flex items-start gap-4">
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${hasError ? "border-red-400/25 bg-red-400/10 text-red-300" : isCompletedReport && !loading ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300" : "border-[#d7b77b]/20 bg-[#d7b77b]/[0.07] text-[#d7b77b]"}`}>
                                {loading ? <Loader2 size={20} className="animate-spin" /> : isCompletedReport ? <CheckCircle2 size={20} /> : hasError ? <AlertCircle size={20} /> : <Bot size={20} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-center justify-between gap-3">
                                    <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#d7b77b]">Report Status</span>
                                    {loading && <span className="text-[10px] font-bold tabular-nums text-[#d7b77b]">{Math.round(statusProgress)}%</span>}
                                </div>
                                <h3 className="editorial-serif text-[16px] font-semibold leading-snug text-[#f3eee4]">{statusTitle}</h3>
                                <p className="mt-1.5 max-w-xl text-[10px] leading-relaxed text-muted">{statusDescription}</p>
                            </div>
                        </div>

                        <div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                                <motion.div className={`h-full rounded-full ${hasError ? "bg-red-400" : isCompletedReport && !loading ? "bg-emerald-400" : "bg-[#d7b77b]"}`} animate={{ width: `${statusProgress}%` }} transition={{ duration: 0.45, ease: "easeOut" }} />
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-[8px] font-bold uppercase tracking-[0.09em] text-muted">
                                <span className={loading || isCompletedReport ? "text-[#d7b77b]" : ""}>질의 접수</span>
                                <span className={`text-center ${statusProgress >= 35 ? "text-[#d7b77b]" : ""}`}>근거 분석</span>
                                <span className={`text-right ${statusProgress >= 85 || isCompletedReport ? "text-[#d7b77b]" : ""}`}>보고서 완성</span>
                            </div>
                        </div>

                        {!loading && (latestQuery || isCompletedReport) && (
                            <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                                <div className="min-w-0">
                                    <p className="text-[8px] font-bold uppercase tracking-[0.13em] text-muted">최근 검토 사안</p>
                                    <p className="mt-0.5 truncate text-[11px] font-medium text-[#eee8dc]" title={latestQuery}>{latestQuery || "계약서 분석"}</p>
                                </div>
                                {isCompletedReport && !loading && (
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        {latestAssistant?.saveStatus === "failed" && <button type="button" onClick={() => retryReportSave(latestAssistantIndex)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2.5 text-[9px] font-bold text-amber-200"><AlertTriangle size={12} /> 다시 저장</button>}
                                        <button type="button" onClick={openLatestReport} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#d7b77b] px-3 text-[9px] font-bold text-[#172239] transition-colors hover:bg-[#e1c58f]"><FileText size={12} /> 보고서 열기</button>
                                    </div>
                                )}
                            </div>
                        )}
                        {loading && <button type="button" onClick={handleCancel} aria-label="보고서 생성 취소" className="self-end text-[9px] font-bold text-muted transition-colors hover:text-white"><X size={12} className="mr-1 inline" />생성 취소</button>}
                    </div>
            </div>

            <div className="shrink-0 p-3.5 sm:p-4 bg-[#0d1728]/90 border-t border-white/10 backdrop-blur-md">
                <div className="flex gap-2 items-end">
                    <ImageUpload
                        onUpload={setSelectedImage}
                        onClear={() => setSelectedImage(null)}
                        busy={loading}
                    />
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        className="editorial-input flex-1 rounded-[10px] px-4 py-3 text-sm focus:outline-none placeholder:text-white/30 resize-none min-h-[44px] max-h-[112px] custom-scrollbar leading-relaxed"
                        placeholder={selectedImage ? (window.innerWidth < 640 ? "이미지 설명 입력..." : "이미지 분석을 위한 설명을 입력하거나(선택), 전송 버튼을 눌러주세요...") : "법률 질문을 입력해보세요..."}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={loading}
                        aria-label="질문 전송"
                        className="bg-[#d7b77b] hover:bg-[#e1c58f] text-secondary p-3 rounded-[10px] transition-all disabled:opacity-50 shadow-[0_10px_24px_rgba(167,125,54,0.2)] active:scale-95"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div >
    );
}
