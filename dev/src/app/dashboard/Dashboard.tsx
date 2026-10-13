"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");

interface MeetingItem {
  _id?: string;
  roomId: string;
  name: string;
  creatorEmail: string;
  creatorName?: string;
  createdAt: string;
}

interface UserProfile {
  id: string;
  name?: string;
  email: string;
}

type TabType = "create" | "join" | "list";

export default function Dashboard() {
  const router = useRouter();

  // Active view tab: "create" | "join" | "list"
  const [activeTab, setActiveTab] = useState<TabType>("create");

  // User state
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Create room state
  const [roomName, setRoomName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<MeetingItem | null>(null);

  // Join room state
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");

  // Rooms list state
  const [rooms, setRooms] = useState<MeetingItem[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => {
      setToast((prev) => (prev === message ? null : prev));
    }, 3000);
  };

  // Auth check & initial rooms fetch
  useEffect(() => {
    const init = async () => {
      try {
        const authRes = await fetch(`${BACKEND_URL}/api/auth/check-auth`, {
          credentials: "include",
        });

        if (!authRes.ok) {
          router.push("/auth");
          return;
        }

        const authData = await authRes.json();
        setUser(authData.user);
        setLoadingUser(false);

        loadRooms();
      } catch {
        router.push("/auth");
      }
    };

    init();
  }, [router]);

  // Load created rooms from backend
  const loadRooms = async () => {
    try {
      setLoadingRooms(true);
      const res = await fetch(`${BACKEND_URL}/api/meetings`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setRooms(data.meetings || []);
      }
    } catch (err) {
      console.error("Error loading rooms:", err);
    } finally {
      setLoadingRooms(false);
    }
  };

  // 1. Create Room Handler
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    const titleToUse =
      roomName.trim() || `${user?.name ? user.name + "'s" : "My"} Room`;

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

      // Add to rooms list
      setRooms((prev) => [newMeeting, ...prev]);
      setCreatedRoom(newMeeting);
      setRoomName("");
      showToast(`Room "${newMeeting.name}" created successfully!`);
    } catch (err: any) {
      showToast(err.message || "Could not create room");
    } finally {
      setCreating(false);
    }
  };

  // 2. Join Room Handler
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

  // Copy Link Handler
  const handleCopyLink = (roomId: string) => {
    const url = `${window.location.origin}/realtime/${roomId}`;
    navigator.clipboard.writeText(url);
    showToast(`Copied room link: ${roomId}`);
  };

  // Delete Room Handler
  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm("Are you sure you want to delete this room?")) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings/${roomId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setRooms((prev) => prev.filter((r) => r.roomId !== roomId));
        if (createdRoom?.roomId === roomId) {
          setCreatedRoom(null);
        }
        showToast("Room deleted");
      } else {
        showToast("Failed to delete room");
      }
    } catch {
      showToast("Error deleting room");
    }
  };

  // Sign Out Handler
  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      router.push("/auth");
    } catch {
      router.push("/auth");
    }
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading Dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Toast Alert */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-indigo-500/50 text-slate-100 px-4 py-2.5 rounded-xl shadow-2xl text-sm flex items-center gap-2 backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toast}</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow">
              RM
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white leading-none">Dashboard</h1>
              <span className="text-[11px] text-slate-400">Real-Time Conference</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs sm:text-sm text-slate-400">
              {user?.name || user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 border border-slate-700 transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-4xl w-full mx-auto px-4 py-8 flex flex-col gap-6 flex-1">
        {/* Navigation Tabs (Separate UI Triggers) */}
        <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 bg-slate-900/90 border border-slate-800 rounded-xl shadow-lg">
          <button
            onClick={() => setActiveTab("create")}
            className={`flex-1 min-w-[130px] py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 ${
              activeTab === "create"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <span>+ Create Room</span>
          </button>

          <button
            onClick={() => setActiveTab("join")}
            className={`flex-1 min-w-[130px] py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 ${
              activeTab === "join"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <span>→ Join Room</span>
          </button>

          <button
            onClick={() => setActiveTab("list")}
            className={`flex-1 min-w-[130px] py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 ${
              activeTab === "list"
                ? "bg-sky-600 text-white shadow-md shadow-sky-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <span>📋 Created Rooms</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-xs font-mono ${
                activeTab === "list"
                  ? "bg-white/20 text-white"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {rooms.length}
            </span>
          </button>
        </div>

        {/* 1. SEPARATE VIEW: CREATE ROOM */}
        {activeTab === "create" && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
              <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-wide">
                Create Room
              </span>
              <h2 className="text-2xl font-bold text-white mt-2">Create a New Meeting Room</h2>
              <p className="text-sm text-slate-400 mt-1">
                Enter a room title below to generate a new meeting room. Once created, it will be added to your Created Rooms list.
              </p>
            </div>

            <form onSubmit={handleCreateRoom} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Room Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. Project Discussion, Team Standup, Client Review"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition shadow-inner"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-xl text-sm transition shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Creating Room...</span>
                    </>
                  ) : (
                    <span>Create Room</span>
                  )}
                </button>
              </div>
            </form>

            {/* Created Room Preview Card if room was just created */}
            {createdRoom && (
              <div className="mt-4 p-5 rounded-xl bg-slate-950/80 border border-indigo-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                      Room Created!
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white mt-1">
                    {createdRoom.name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    Room ID: <span className="text-indigo-300">{createdRoom.roomId}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyLink(createdRoom.roomId)}
                    className="px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                  >
                    Copy Link
                  </button>
                  <button
                    onClick={() => router.push(`/realtime/${createdRoom.roomId}`)}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow"
                  >
                    Join Room Now →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. SEPARATE VIEW: JOIN ROOM */}
        {activeTab === "join" && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col gap-6 animate-in fade-in duration-200">
            <div>
              <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">
                Join Room
              </span>
              <h2 className="text-2xl font-bold text-white mt-2">Join an Existing Room</h2>
              <p className="text-sm text-slate-400 mt-1">
                Enter the room ID or paste the complete meeting link to jump straight into the video call.
              </p>
            </div>

            <form onSubmit={handleJoinRoom} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
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
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition shadow-inner font-mono"
                />
                {joinError && (
                  <p className="text-xs text-rose-400 mt-2 font-medium">{joinError}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-xl text-sm transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2"
              >
                <span>Join Room →</span>
              </button>
            </form>

            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800 text-xs text-slate-400 flex items-center gap-3">
              <span className="text-base">💡</span>
              <span>
                Tip: You can join with just the room ID (like <code className="text-slate-200 font-mono">x9y2z1</code>) or by pasting the full invitation URL.
              </span>
            </div>
          </div>
        )}

        {/* 3. SEPARATE VIEW: ROOMS LIST */}
        {activeTab === "list" && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col gap-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30 uppercase tracking-wide">
                  Created Rooms
                </span>
                <h2 className="text-2xl font-bold text-white mt-1">Your Meeting Rooms</h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  Click Join to enter any of your created rooms or copy the link to share.
                </p>
              </div>
              <button
                onClick={() => setActiveTab("create")}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow"
              >
                <span>+ New Room</span>
              </button>
            </div>

            {loadingRooms ? (
              <div className="py-12 text-center text-sm text-slate-400">
                Loading your rooms...
              </div>
            ) : rooms.length === 0 ? (
              <div className="py-14 text-center border border-dashed border-slate-800 rounded-xl px-4 flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 mb-3 text-xl">
                  📋
                </div>
                <h3 className="text-base font-semibold text-slate-200">No rooms created yet</h3>
                <p className="text-xs text-slate-400 max-w-sm mt-1 mb-5">
                  You haven't created any rooms yet. Click below to create your first meeting room.
                </p>
                <button
                  onClick={() => setActiveTab("create")}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition shadow"
                >
                  Create Your First Room
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
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
                          <span className="text-xs font-mono bg-slate-800 text-indigo-300 px-2 py-0.5 rounded-md border border-slate-700">
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
                          className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                        >
                          Copy Link
                        </button>
                        <button
                          onClick={() => handleDeleteRoom(room.roomId)}
                          className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-700 transition"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => router.push(`/realtime/${room.roomId}`)}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow flex items-center gap-1"
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
        )}
      </main>
    </div>
  );
}
