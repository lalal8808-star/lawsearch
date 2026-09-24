export function isStructuredReport(answer: string, intent?: string): boolean {
    if (intent === "REPORT") return true;
    const headingCount = (answer.match(/(^|\n)#{2,6}\s+\S/g) || []).length;
    const reportKeywords = /(사건\s*개요|법률\s*분석|판례\s*분석|핵심\s*결론|향후\s*조치|법적\s*근거|결론)/;
    return headingCount >= 2 || (headingCount >= 1 && reportKeywords.test(answer));
}

/**
 * 답변 스트림 수신 중 진행률. 실제로 받은 글자 수에 따라 70%에서 88%로 다가가며,
 * 생성이 끝나기 전에는 88%를 넘지 않는다(완료·저장 단계가 90~100%).
 */
export function streamingProgress(receivedChars: number): number {
    if (!Number.isFinite(receivedChars) || receivedChars <= 0) return 70;
    return Math.min(88, Math.round(70 + 18 * (1 - Math.exp(-receivedChars / 3000))));
}

export function usagePercent(totalTokens: number, tokenLimit: number): number {
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
    if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round(totalTokens / tokenLimit * 100)));
}
