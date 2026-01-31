"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/utils/supabase";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
    const router = useRouter();

    useEffect(() => {
        const handleAuth = async () => {
            const { data, error } = await supabase.auth.getSession();
            if (error) {
                console.error("Auth callback error:", error);
                router.push("/");
                return;
            }
            if (data?.session) {
                // AuthContext will handle the session via onAuthStateChange
                router.push("/");
            } else {
                router.push("/");
            }
        };

        handleAuth();
    }, [router]);

    return (
        <div className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center p-4">
            <div className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center mb-6">
                <Loader2 className="animate-spin text-primary" size={24} />
            </div>
            <h1 className="text-xl font-black text-white uppercase tracking-widest mb-2">Authenticating</h1>
            <p className="text-sm text-muted">Please wait while we set up your session...</p>
        </div>
    );
}
