import { describe, expect, it } from "vitest";
import { isStructuredReport, streamingProgress, usagePercent } from "./generation";

describe("isStructuredReport", () => {
    it("trusts an explicit REPORT intent", () => {
        expect(isStructuredReport("짧은 답변", "REPORT")).toBe(true);
    });

    it("recognizes a structured legal report even if intent fallback says CHAT", () => {
        const answer = "## 사건 개요\n내용\n## 법률 분석\n내용\n## 결론\n내용";
        expect(isStructuredReport(answer, "CHAT")).toBe(true);
    });

    it("does not turn ordinary chat into a report", () => {
        expect(isStructuredReport("안녕하세요. 무엇을 도와드릴까요?", "CHAT")).toBe(false);
    });
});

describe("usagePercent", () => {
    it("clamps values to 0-100", () => {
        expect(usagePercent(500, 1000)).toBe(50);
        expect(usagePercent(1200, 1000)).toBe(100);
        expect(usagePercent(0, 1000)).toBe(0);
    });
});

describe("streamingProgress", () => {
    it("starts at the first-chunk stage and rises with received text", () => {
        expect(streamingProgress(0)).toBe(70);
        expect(streamingProgress(1500)).toBeGreaterThan(70);
        expect(streamingProgress(6000)).toBeGreaterThan(streamingProgress(1500));
    });

    it("never reaches the completion stage before the stream ends", () => {
        expect(streamingProgress(1_000_000)).toBe(88);
        expect(streamingProgress(Number.NaN)).toBe(70);
    });
});
