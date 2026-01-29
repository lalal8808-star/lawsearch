"use client";

import { useEffect, useState } from "react";
import { Search, RotateCcw, CloudDownload, Scale, CheckCircle2, Sparkles } from "lucide-react";
import axios from "axios";
import { motion } from "framer-motion";

export default function LawSearch() {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState<string | null>(null);
    const [syncedMsts, setSyncedMsts] = useState<string[]>([]);
    const [recommending, setRecommending] = useState(false);
    const [recommendations, setRecommendations] = useState<string[]>([]);
    const [caseDesc, setCaseDesc] = useState("");

    const fetchSyncedMsts = async () => {
        try {
            const res = await axios.get("http://127.0.0.1:8000/laws/synced");
            setSyncedMsts(res.data);
        } catch (error) {
            console.error("Failed to fetch synced MSTs", error);
        }
    };

    // Correctly use useEffect for initial data fetching
    useEffect(() => {
        fetchSyncedMsts();
    }, []);

    const handleSearch = async () => {
        if (!query.trim()) return;
        setLoading(true);
        try {
            const res = await axios.get(`http://127.0.0.1:8000/laws/search?query=${query}`);
            const list = res.data.law || [];
            const resultList = Array.isArray(list) ? list : [list];

            // Mark as synced if MST is in the synced list
            const processedList = resultList.map(item => ({
                ...item,
                synced: syncedMsts.includes(String(item.법령일련번호))
            }));
            setResults(processedList);
        } catch (error) {
            console.error("Search failed", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async (mst: string) => {
        setSyncing(mst);
        try {
            await axios.post(`http://127.0.0.1:8000/laws/sync?mst=${mst}`);
            setSyncedMsts(prev => [...prev, String(mst)]);
            setResults(prev => prev.map(item => String(item.법령일련번호) === String(mst) ? { ...item, synced: true } : item));
        } catch (error) {
            console.error("Sync failed", error);
        } finally {
            setSyncing(null);
        }
    };

    const handleRecommend = async () => {
        if (!caseDesc.trim()) return;
        setRecommending(true);
        try {
            const formData = new FormData();
            formData.append("case", caseDesc);
            const res = await axios.post("http://127.0.0.1:8000/laws/recommend", formData);
            setRecommendations(res.data);
        } catch (error) {
            console.error("Recommendation failed", error);
        } finally {
            setRecommending(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Case-based Recommendation */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-primary font-medium">
                    <Sparkles className="w-4 h-4" />
                    <span>사례 기반 법령 추천</span>
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={caseDesc}
                        onChange={(e) => setCaseDesc(e.target.value)}
                        placeholder="사례를 입력하세요 (예: 층간소음 문제, 전세사기 등)"
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        onKeyDown={(e) => e.key === 'Enter' && handleRecommend()}
                    />
                    <button
                        onClick={handleRecommend}
                        disabled={recommending}
                        className="bg-primary hover:bg-primary/80 disabled:opacity-50 text-black px-4 py-2 rounded-lg text-sm font-medium transition-all"
                    >
                        {recommending ? "분석 중..." : "추천받기"}
                    </button>
                </div>
                {recommendations.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                        {recommendations.map((law, idx) => (
                            <button
                                key={idx}
                                onClick={() => {
                                    setQuery(law);
                                    // Using a timeout to ensure state update for query is handled
                                    setTimeout(handleSearch, 0);
                                }}
                                className="text-[10px] bg-primary/20 hover:bg-primary/30 text-primary px-2 py-1 rounded transition-colors"
                            >
                                #{law}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex gap-2">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="법령명을 입력하세요..."
                    className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button
                    onClick={handleSearch}
                    disabled={loading}
                    className="bg-primary hover:bg-primary/80 disabled:opacity-50 text-black px-6 py-3 rounded-xl font-medium transition-all flex items-center gap-2"
                >
                    <Search className="w-4 h-4" />
                    {loading ? "검색 중..." : "검색"}
                </button>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {loading ? (
                    <div className="py-20 text-center text-muted animate-pulse">검색 중...</div>
                ) : (
                    results.map((item, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="group p-4 rounded-xl bg-white/5 border border-white/10 hover:border-primary/50 transition-all"
                        >
                            <div className="flex justify-between items-start gap-4">
                                <div className="flex-1">
                                    <h4 className="text-sm font-semibold mb-1 group-hover:text-primary transition-colors">
                                        {item.법령명한글 || item.법령명_한글}
                                    </h4>
                                    <div className="flex items-center gap-2 text-[10px] text-muted">
                                        <span>{item.소관부처명 || item.소관부처}</span>
                                        <span>•</span>
                                        <span>{item.법종구분}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleSync(String(item.법령일련번호))}
                                    disabled={syncing === String(item.법령일련번호) || item.synced}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${item.synced
                                        ? "bg-green-500/20 text-green-500 cursor-default"
                                        : "bg-primary/10 text-primary hover:bg-primary hover:text-black"
                                        }`}
                                >
                                    {syncing === String(item.법령일련번호) ? "동기화 중..." : item.synced ? "동기화됨" : "AI 학습시키기"}
                                </button>
                            </div>
                        </motion.div>
                    ))
                )}
                {results.length === 0 && !loading && !query && recommendations.length === 0 && (
                    <div className="py-20 text-center text-muted italic">
                        법령명을 검색하거나 사례를 입력해 추천받으세요.
                    </div>
                )}
                {results.length === 0 && !loading && query && (
                    <div className="py-20 text-center text-muted italic">
                        검색 결과가 없습니다.
                    </div>
                )}
            </div>
        </div>
    );
}
