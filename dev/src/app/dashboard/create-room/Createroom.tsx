"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard, MeetingItem } from "../../../providers/DashboardContext";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");

export default function CreateRoomPage() {
    const router = useRouter();
    const { user, setRooms, setCreatedRoom, showToast } = useDashboard();
    const [roomName, setRoomName] = useState("");
    const [creating, setCreating] = useState(false);

    const handleCreateRoom = async (e: React.FormEvent) => {
        e.preventDefault();

        const titleToUse = roomName.trim() || `${user?.name ? user.name + "'s" : "My"} Room`;

        try {
            setCreating(true);
            const res = await fetch(`${BACKEND_URL}/api/meetings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name: titleToUse }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to create room");
            }

            const data = await res.json();
            const newMeeting: MeetingItem = data.meeting;

            setRooms((prev) => [newMeeting, ...prev]);
            setCreatedRoom(newMeeting);
            showToast(`Room "${newMeeting.name}" created successfully!`);

            router.push(`/dashboard?created=${newMeeting.roomId}`);
        } catch (err: any) {
            showToast(err.message || "Could not create room");
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-wide">
                    Create Room
                </span>
                <h1 className="text-2xl font-bold text-white mt-2">Create a New Meeting Room</h1>
                <p className="text-sm text-slate-400 mt-1">
                    Enter a room title below to generate a new meeting room. Once created, it will be added and displayed directly in your Dashboard.
                </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
                <form onSubmit={handleCreateRoom} className="flex flex-col gap-5">
                    <div>
                        <label className="block text-xs font-medium text-slate-300 mb-2">
                            Room Name
                        </label>
                        <input
                            type="text"
                            autoFocus
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                            placeholder="e.g. Project Discussion, Team Standup, Client Review"
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition shadow-inner font-medium"
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={creating}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-xl text-sm transition shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer"
                        >
                            {creating ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>Creating Room & Redirecting to Dashboard...</span>
                                </>
                            ) : (
                                <span>Create Room</span>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
