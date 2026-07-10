import axios from "axios";
import { supabase } from "./supabase";

const getBaseUrl = () => {
    let url = process.env.NEXT_PUBLIC_API_URL;
    if (url) {
        return url.endsWith("/") ? url.slice(0, -1) : url;
    }
    if (typeof window !== "undefined") {
        return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
    return "http://localhost:8000";
};

const api = axios.create({
    baseURL: getBaseUrl(),
});

/**
 * 항상 유효한 인증 토큰을 반환한다.
 * localStorage의 jonglaw_token은 Supabase access token의 "복사본"이라 ~1시간이면 만료된다.
 * supabase-js는 세션을 캐시하고 만료 시 자동 갱신하므로, 세션에서 직접 꺼내는 것이 정답.
 * (세션이 없으면 레거시 로그인 토큰을 localStorage에서 폴백으로 사용)
 */
export async function getAuthToken(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    try {
        if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token || null;
            if (token) {
                localStorage.setItem("jonglaw_token", token); // 레거시 소비처를 위해 최신화
                return token;
            }
        }
    } catch {
        // ignore — 폴백으로 진행
    }
    const legacy = localStorage.getItem("jonglaw_token");
    return legacy && legacy !== "null" && legacy !== "undefined" ? legacy : null;
}

// 요청마다 갱신된 토큰을 부착 (만료된 localStorage 복사본 사용 금지)
api.interceptors.request.use(
    async (config) => {
        const token = await getAuthToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// 401 처리: 절대 페이지를 리로드하지 않는다 (작성 중인 입력이 날아가므로).
// 1) 세션 refresh 후 원 요청을 1회 재시도
// 2) 그래도 실패하면 조용히 인증 정리 + 'auth-expired' 이벤트만 발생
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const config = error.config || {};
        if (error.response?.status === 401 && typeof window !== "undefined") {
            if (!config._retried && supabase) {
                config._retried = true;
                try {
                    const { data, error: refreshErr } = await supabase.auth.refreshSession();
                    const newToken = data?.session?.access_token;
                    if (newToken && !refreshErr) {
                        localStorage.setItem("jonglaw_token", newToken);
                        config.headers = { ...(config.headers || {}), Authorization: `Bearer ${newToken}` };
                        return api(config);
                    }
                } catch {
                    // refresh 실패 → 아래에서 정리
                }
            }
            const isSync = config?.url?.includes("/auth/sync");
            if (!isSync && localStorage.getItem("jonglaw_token")) {
                localStorage.removeItem("jonglaw_token");
                localStorage.removeItem("jonglaw_user");
                localStorage.removeItem("jonglaw_nickname");
                window.dispatchEvent(new CustomEvent("auth-expired"));
            }
        }
        return Promise.reject(error);
    }
);

export default api;
