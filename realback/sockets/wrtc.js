function setupSocket(io) {
    const screenSharers = new Map();
    const roomAdmins = new Map(); // roomId -> { socketId, name, email }
    const userProfiles = new Map(); // socketId -> { email, name, roomId, isVideoOff }

    io.on("connection", (socket) => {
        let currentRoom = null;

        // Peer requests to join room (Admin acceptance flow)
        socket.on("request-join", (data) => {
            const roomId = typeof data === "string" ? data : (data?.roomId || "room");
            const email = data?.email || "Guest";
            const name = data?.name || email;
            const isAdmin = Boolean(data?.isAdmin);

            const admin = roomAdmins.get(roomId);

            // If user is Admin or no Admin is in the room yet, admit directly
            if (isAdmin || !admin || admin.socketId === socket.id) {
                socket.emit("join-approved");
            } else {
                // Send knock request to the Admin
                io.to(admin.socketId).emit("join-request", {
                    socketId: socket.id,
                    email,
                    name,
                });
            }
        });

        // Admin accepts join request
        socket.on("accept-join", ({ targetSocketId, roomId }) => {
            if (roomAdmins.get(roomId)?.socketId === socket.id) {
                io.to(targetSocketId).emit("join-approved");
            }
        });

        // Admin denies join request
        socket.on("deny-join", ({ targetSocketId, roomId }) => {
            if (roomAdmins.get(roomId)?.socketId === socket.id) {
                io.to(targetSocketId).emit("join-denied");
            }
        });

        // Admin removes a participant from meeting
        socket.on("remove-participant", ({ targetSocketId, roomId }) => {
            if (roomAdmins.get(roomId)?.socketId === socket.id) {
                io.to(targetSocketId).emit("removed-by-admin");
            }
        });

        // Volatile UDP-like in-meeting chat message (not stored in DB)
        socket.on("send-message", ({ roomId, text, senderEmail, time }) => {
            if (roomId && text) {
                socket.to(roomId).emit("receive-message", {
                    id: Math.random().toString(36).substring(2, 9),
                    senderSocketId: socket.id,
                    text,
                    senderEmail,
                    time: time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                });
            }
        });

        // Video toggle state broadcast
        socket.on("toggle-video-state", ({ isVideoOff, roomId }) => {
            const rId = roomId || currentRoom;
            const profile = userProfiles.get(socket.id);
            if (profile) profile.isVideoOff = isVideoOff;
            if (rId) {
                socket.to(rId).emit("user-video-state", { socketId: socket.id, isVideoOff });
            }
        });

        // Peer joins the room officially after admission
        socket.on("joined-room", (data) => {
            const roomId = typeof data === "string" ? data : (data?.roomId || "room");
            const isAdmin = Boolean(data?.isAdmin);
            const userName = data?.name || data?.email || "User";
            const userEmail = data?.email || "";

            currentRoom = roomId;
            socket.join(roomId);

            const isVideoOff = Boolean(data?.isVideoOff);

            userProfiles.set(socket.id, {
                email: userEmail,
                name: userName,
                roomId,
                isVideoOff,
            });

            console.log(`Socket ${socket.id} joined room ${roomId} (Admin: ${isAdmin})`);

            if (isAdmin && !roomAdmins.has(roomId)) {
                roomAdmins.set(roomId, { socketId: socket.id, name: userName, email: userEmail });
            }

            // Get all other active peers in room with their profiles
            const otherUsers = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
                .filter((id) => id !== socket.id && io.sockets.sockets.has(id));

            // Map user profiles for existing peers
            const peersProfiles = {};
            otherUsers.forEach((id) => {
                peersProfiles[id] = userProfiles.get(id) || { email: "Participant", name: "Participant", isVideoOff: false };
            });

            socket.emit("all-users", otherUsers);
            socket.emit("all-profiles", peersProfiles);

            // Broadcast new user profile to room
            socket.to(roomId).emit("peer-joined-profile", {
                socketId: socket.id,
                profile: userProfiles.get(socket.id),
            });

            if (screenSharers.has(roomId)) {
                socket.emit("screen-share-started", { userId: screenSharers.get(roomId) });
            }

            io.to(roomId).emit("room-admin", roomAdmins.get(roomId) || null);
        });

        // Leave room
        socket.on("leave-room", (data) => {
            const roomId = typeof data === "string" ? data : (data?.roomId || currentRoom);
            if (roomId) {
                if (screenSharers.get(roomId) === socket.id) {
                    screenSharers.delete(roomId);
                    socket.to(roomId).emit("screen-share-stopped");
                }
                if (roomAdmins.get(roomId)?.socketId === socket.id) {
                    roomAdmins.delete(roomId);
                    io.to(roomId).emit("room-admin", null);
                }
                userProfiles.delete(socket.id);
                console.log(`Socket ${socket.id} left room ${roomId}`);
                socket.leave(roomId);
                io.to(roomId).emit("user-left", socket.id);
                if (currentRoom === roomId) currentRoom = null;
            }
        });

        // Admin ends meeting
        socket.on("end-meeting", (data) => {
            const roomId = typeof data === "string" ? data : (data?.roomId || currentRoom);
            if (roomId && roomAdmins.get(roomId)?.socketId === socket.id) {
                roomAdmins.delete(roomId);
                if (screenSharers.has(roomId)) {
                    screenSharers.delete(roomId);
                }
                io.to(roomId).emit("meeting-ended");
            }
        });

        socket.on("request-screen-share", (data) => {
            const rId = data?.roomId || currentRoom;
            if (!rId) return;
            const screenSharer = screenSharers.get(rId);
            if (screenSharer && screenSharer !== socket.id) {
                socket.emit("screen-share-denied");
                return;
            }

            screenSharers.set(rId, socket.id);
            socket.emit("screen-share-granted");
            socket.to(rId).emit("screen-share-started", { userId: socket.id });
        });

        socket.on("stop-screen-share", (data) => {
            const rId = data?.roomId || currentRoom;
            if (!rId) return;
            if (screenSharers.get(rId) === socket.id) {
                screenSharers.delete(rId);
                socket.to(rId).emit("screen-share-stopped");
            }
        });

        socket.on("send-offer", ({ to, offer }) => {
            if (to) socket.to(to).emit("receive-offer", { from: socket.id, offer });
        });

        socket.on("send-answer", ({ to, answer }) => {
            if (to) socket.to(to).emit("receive-answer", { from: socket.id, answer });
        });

        socket.on("send-ice", ({ to, candidate }) => {
            if (to) socket.to(to).emit("receive-ice", { from: socket.id, candidate });
        });

        socket.on("disconnecting", () => {
            for (const room of socket.rooms) {
                if (room !== socket.id) {
                    if (roomAdmins.get(room)?.socketId === socket.id) {
                        roomAdmins.delete(room);
                        io.to(room).emit("room-admin", null);
                    }
                    io.to(room).emit("user-left", socket.id);
                }
            }
            userProfiles.delete(socket.id);
        });

        socket.on("disconnect", () => {
            if (currentRoom) {
                if (screenSharers.get(currentRoom) === socket.id) {
                    screenSharers.delete(currentRoom);
                    socket.to(currentRoom).emit("screen-share-stopped");
                }
                if (roomAdmins.get(currentRoom)?.socketId === socket.id) {
                    roomAdmins.delete(currentRoom);
                    io.to(currentRoom).emit("room-admin", null);
                }
                io.to(currentRoom).emit("user-left", socket.id);
            }
            userProfiles.delete(socket.id);
        });
    });
}

module.exports = setupSocket;