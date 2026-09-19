import { describe, expect, it } from "vitest";
import { isUsableReportCache } from "./report-cache";

describe("isUsableReportCache", () => {
    it("rejects history summary data without a report body", () => {
        expect(isUsableReportCache({ reportId: "42", answer: undefined }, "42")).toBe(false);
    });

    it("rejects a complete cache that belongs to another report", () => {
        expect(isUsableReportCache({ reportId: "41", answer: "보고서 본문" }, "42")).toBe(false);
    });

    it("accepts a complete cache for the requested report", () => {
        expect(isUsableReportCache({ reportId: "42", answer: "보고서 본문" }, "42")).toBe(true);
    });
});
