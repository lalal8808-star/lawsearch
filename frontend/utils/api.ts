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
            if (typeof window !== "undefined" && localStorage.getItem("jonglaw_token")) {
                localStorage.removeItem("jonglaw_token");
                localStorage.removeItem("jonglaw_user");
                localStorage.removeItem("jonglaw_nickname");
                // Only reload if we're not already on a page that handles login
                window.location.reload();
            }
        }
        return Promise.reject(error);
    }
);

export default api;
