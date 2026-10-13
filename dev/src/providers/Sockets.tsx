
"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

const SocketContext = createContext<Socket | null>(null);

export const useSocket = () => {
    return useContext(SocketContext);
};

const SocketProvider = ({ children }: { children: React.ReactNode }) => {
    const [socket, setSocket] = useState<Socket | null>(null);

    useEffect(() => {
        const backendUrl =
            process.env.NEXT_PUBLIC_BACKEND_URL ||
            "http://localhost:8000";

        const newSocket = io(backendUrl, {
            withCredentials: true,
            transports: ["websocket", "polling"],
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, []);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
};

export default SocketProvider;
