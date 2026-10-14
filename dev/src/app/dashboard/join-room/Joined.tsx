"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinRoomPage() {
    const router = useRouter();
    const [joinCode, setJoinCode] = useState("");
    const [joinError, setJoinError] = useState("");

    const handleJoinRoom = (e: React.FormEvent) => {
        e.preventDefault();
        setJoinError("");

        if (!joinCode.trim()) {
            setJoinError("Please enter a room code or link");
            return;
        }

        let clean = joinCode.trim();
        if (clean.includes("/realtime/")) {
            clean = clean.split("/realtime/").pop() || "";
        }
        clean = clean.split("?")[0].replace(/[^a-zA-Z0-9_-]/g, "");

        if (!clean) {
            setJoinError("Invalid room code format");
            return;
        }

        router.push(`/realtime/${clean}`);
    };

    return (
        <div className="max-w-2xl mx-auto flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">
                    Join Room
                </span>
                <h1 className="text-2xl font-bold text-white mt-2">Join an Existing Room</h1>
                <p className="text-sm text-slate-400 mt-1">
                    Enter the room ID or paste the complete meeting link to jump straight into the video call.
                </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
                <form onSubmit={handleJoinRoom} className="flex flex-col gap-5">
                    <div>
                        <label className="block text-xs font-medium text-slate-300 mb-2">
                            Room Code or Meeting Link
                        </label>
                        <input
                            type="text"
                            autoFocus
                            value={joinCode}
                            onChange={(e) => {
                                setJoinCode(e.target.value);
                                if (joinError) setJoinError("");
                            }}
                            placeholder="e.g. abc123 or http://localhost:3000/realtime/abc123"
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition shadow-inner font-mono font-medium"
                        />
                        {joinError && (
                            <p className="text-xs text-rose-400 mt-2 font-medium">{joinError}</p>
                        )}
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={!joinCode.trim()}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-xl text-sm transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
                        >
                            <span>Join Meeting Room →</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
