export type CachedReport = {
    reportId?: string | number;
    answer?: unknown;
    [key: string]: unknown;
};

/**
 * 보고서 화면은 본문이 있는, 현재 URL과 동일한 보고서 캐시만 즉시 렌더링한다.
 * 히스토리 목록의 요약 데이터(ID/질의만 있음)를 완성본으로 오인하면 첫 렌더가 깨진다.
 */
export function isUsableReportCache(report: CachedReport | null, resolvedId?: string | null): boolean {
    if (!report || typeof report.answer !== "string" || !report.answer.trim()) return false;
    if (!resolvedId) return true;
    return String(report.reportId || "") === String(resolvedId);
}
