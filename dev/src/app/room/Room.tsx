
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
export default function Room() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [roomNumber, setRoomNumber] = useState("");
    const handleJoinRoom = () => {
        if (!email.trim() || !roomNumber.trim()) return;
        let clean = roomNumber.trim();
        if (clean.includes("/realtime/")) {
            clean = clean.split("/realtime/").pop() || "";
        }
        clean = clean.split("?")[0].replace(/[^a-zA-Z0-9_-]/g, "");
        if (!clean) return;
        router.push(`/realtime/${clean}`);
    };

    return (
        <div className="mt-10 flex min-h-screen flex-col items-center justify-center gap-4">
            <input
                className="w-72 rounded-lg border border-slate-300 bg-white p-3 text-slate-900 placeholder-slate-400 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="Enter your email"
            />

            <input
                className="w-72 rounded-lg border border-slate-300 bg-white p-3 text-slate-900 placeholder-slate-400 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                type="text"
                placeholder="Enter your room number"
            />

            <button
                className="rounded bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
                onClick={handleJoinRoom}
            >
                Join Room
            </button>
        </div>
    );
}
