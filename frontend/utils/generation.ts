export function isStructuredReport(answer: string, intent?: string): boolean {
    if (intent === "REPORT") return true;
    const headingCount = (answer.match(/(^|\n)#{2,6}\s+\S/g) || []).length;
    const reportKeywords = /(사건\s*개요|법률\s*분석|판례\s*분석|핵심\s*결론|향후\s*조치|법적\s*근거|결론)/;
    return headingCount >= 2 || (headingCount >= 1 && reportKeywords.test(answer));
}

export function usagePercent(totalTokens: number, tokenLimit: number): number {
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
    if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round(totalTokens / tokenLimit * 100)));
}
