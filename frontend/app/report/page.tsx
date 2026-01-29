"use client";

import { useEffect, useState } from "react";
import LegalReportView from "@/components/LegalReportView";
import { Loader2, AlertCircle } from "lucide-react";

export default function ReportPage() {
    const [reportData, setReportData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Read data from sessionStorage
        const data = sessionStorage.getItem("jonglaw_last_report");
        if (data) {
            try {
                setReportData(JSON.parse(data));
            } catch (e) {
                setError("데이터를 불러오는 중 오류가 발생했습니다.");
            }
        } else {
            setError("리포트 정보를 찾을 수 없습니다.");
        }
    }, []);

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8 text-center">
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
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    <span className="text-slate-500 font-bold">리포트를 구성하는 중...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-100 min-h-screen">
            <LegalReportView
                reportId={reportData.reportId}
                query={reportData.query}
                answer={reportData.answer}
                sources={reportData.sources}
                engine={reportData.engine}
                chat_history={reportData.chat_history || []}
            />
        </div>
    );
}
