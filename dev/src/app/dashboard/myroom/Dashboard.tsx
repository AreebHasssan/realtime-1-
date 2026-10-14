"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDashboard } from "../../../providers/DashboardContext";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");

export default function MyRoomsPage() {
  const router = useRouter();
  const { rooms, loadingRooms, setRooms, showToast } = useDashboard();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCopyLink = (roomId: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/realtime/${roomId}`);
    showToast(`Copied room link: ${roomId}`);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const roomId = deleteId;
    setDeleteId(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings/${roomId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setRooms((prev) => prev.filter((r) => r.roomId !== roomId));
        showToast("Room deleted successfully");
      } else {
        showToast("Failed to delete room");
      }
    } catch {
      showToast("Error deleting room");
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage your meeting rooms and start video conferences
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/join-room"
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 border border-slate-700/80 hover:bg-slate-800 text-slate-200 transition"
          >
            Join Room
          </Link>
          <Link
            href="/dashboard/create-room"
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/25"
          >
            + Create Room
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-950/60 text-indigo-400 border border-indigo-800/40 flex items-center justify-center text-xl">
            📋
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Total Rooms</p>
            <p className="text-xl font-bold text-white mt-0.5">{rooms.length}</p>
          </div>
        </div>

        <Link
          href="/dashboard/create-room"
          className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 transition flex items-center gap-4 group cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xl group-hover:scale-105 transition">
            ➕
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Quick Action</p>
            <p className="text-sm font-bold text-white group-hover:text-indigo-400 transition">
              Create New Room
            </p>
          </div>
        </Link>

        <Link
          href="/dashboard/join-room"
          className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 transition flex items-center gap-4 group cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold text-xl group-hover:scale-105 transition">
            🔗
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Quick Action</p>
            <p className="text-sm font-bold text-white group-hover:text-emerald-400 transition">
              Join Existing Room
            </p>
          </div>
        </Link>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Your Meeting Rooms</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Click Join to start a call or copy the invite link for participants
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full border border-slate-700">
            {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
          </span>
        </div>

        {loadingRooms ? (
          <div className="py-12 text-center text-sm text-slate-400 flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span>Loading rooms...</span>
          </div>
        ) : rooms.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl px-4 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 mb-3 text-xl">
              📋
            </div>
            <h3 className="text-base font-semibold text-slate-200">No rooms created yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mt-1 mb-5">
              You haven't created any rooms yet. Click below to create your first meeting room.
            </p>
            <Link
              href="/dashboard/create-room"
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition shadow"
            >
              Create Your First Room
            </Link>
          </div>
        ) : (
          <div
            className="rooms-scroll-container pr-2 divide-y divide-slate-800/80 custom-scrollbar"
            style={{ maxHeight: "250px", overflowY: "auto" }}
          >
            {rooms.map((room) => {
              const createdDate = room.createdAt
                ? new Date(room.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
                : "Recent";

              return (
                <div
                  key={room.roomId}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/40 px-3 rounded-xl transition"
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-sm text-white">
                        {room.name || "Untitled Room"}
                      </span>
                      <span
                        onClick={() => handleCopyLink(room.roomId)}
                        title="Click to copy Room ID"
                        className="text-xs font-mono bg-slate-800 text-indigo-300 hover:bg-slate-700 px-2 py-0.5 rounded-md border border-slate-700 cursor-pointer transition"
                      >
                        {room.roomId}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Created: {createdDate}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      onClick={() => handleCopyLink(room.roomId)}
                      className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                    >
                      Copy Link
                    </button>
                    <button
                      onClick={() => setDeleteId(room.roomId)}
                      className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-700 transition cursor-pointer"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => router.push(`/realtime/${room.roomId}`)}
                      className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow flex items-center gap-1 cursor-pointer"
                    >
                      <span>Join Room</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm w-full shadow-2xl flex flex-col gap-4">
            <h3 className="text-base font-bold text-white">Delete Meeting Room?</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Are you sure you want to delete this room? Anyone currently in the room may be disconnected.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition"
              >
                Delete Room
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}