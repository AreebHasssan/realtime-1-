"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");

export interface MeetingItem {
  _id?: string;
  roomId: string;
  name: string;
  creatorEmail: string;
  creatorName?: string;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  name?: string;
  email: string;
}

interface DashboardContextType {
  user: UserProfile | null;
  loadingUser: boolean;
  rooms: MeetingItem[];
  loadingRooms: boolean;
  setRooms: React.Dispatch<React.SetStateAction<MeetingItem[]>>;
  createdRoom: MeetingItem | null;
  setCreatedRoom: (room: MeetingItem | null) => void;
  toast: string | null;
  showToast: (msg: string) => void;
  handleLogout: () => Promise<void>;
  fetchRooms: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [rooms, setRooms] = useState<MeetingItem[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<MeetingItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => {
      setToast((prev) => (prev === message ? null : prev));
    }, 3000);
  };

  const fetchRooms = async () => {
    try {
      setLoadingRooms(true);
      const res = await fetch(`${BACKEND_URL}/api/meetings`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setRooms(data.meetings || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingRooms(false);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/check-auth`, {
          credentials: "include",
        });
        if (!res.ok) {
          router.push("/auth");
          return;
        }
        const data = await res.json();
        setUser(data.user);
        await fetchRooms();
      } catch {
        router.push("/auth");
      } finally {
        setLoadingUser(false);
      }
    };
    initAuth();
  }, [router]);

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

  return (
    <DashboardContext.Provider
      value={{
        user,
        loadingUser,
        rooms,
        loadingRooms,
        setRooms,
        createdRoom,
        setCreatedRoom,
        toast,
        showToast,
        handleLogout,
        fetchRooms,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return context;
}
