import axios from "axios";

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

// Add a request interceptor to attach the token
api.interceptors.request.use(
    (config) => {
        if (typeof window !== "undefined") {
            const token = localStorage.getItem("jonglaw_token");
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add a response interceptor to handle 401 errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            const isSync = error.config?.url?.includes("/auth/sync");
            if (typeof window !== "undefined" && localStorage.getItem("jonglaw_token") && !isSync) {
                localStorage.removeItem("jonglaw_token");
                localStorage.removeItem("jonglaw_user");
                localStorage.removeItem("jonglaw_nickname");

                // Only reload if not already reloaded in the last 10 seconds to avoid loops
                const lastReload = sessionStorage.getItem("last_401_reload");
                const now = Date.now();
                if (!lastReload || now - parseInt(lastReload) > 10000) {
                    sessionStorage.setItem("last_401_reload", now.toString());
                    window.location.reload();
                }
            }
        }
        return Promise.reject(error);
    }
);

export default api;
