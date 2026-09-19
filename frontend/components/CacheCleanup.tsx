"use client";

import { useEffect } from "react";

export default function CacheCleanup() {
    useEffect(() => {
        // 과거 PWA Service Worker가 인증 응답과 오래된 JS를 계속 제공하지 않도록
        // 등록을 해제하고 Workbox 캐시를 정리한다. 정적 manifest/icon은 그대로 유지된다.
        if ("serviceWorker" in navigator) {
            void navigator.serviceWorker.getRegistrations().then((registrations) =>
                Promise.all(registrations.map((registration) => registration.unregister()))
            );
        }
        if ("caches" in window) {
            void caches.keys().then((keys) => Promise.all(
                keys.filter((key) => /workbox|next-pwa|cross-origin|apis/i.test(key)).map((key) => caches.delete(key))
            ));
        }
    }, []);

    return null;
}
