function setupSocket(io) {
    const screenSharers = new Map();
    const roomAdmins = new Map();
    const userProfiles = new Map();
    const pendingJoinRequests = new Map();

    io.on("connection", (socket) => {
        let currentRoom = null;

        socket.on("request-join", (data) => {
            const roomId = typeof data === "string" ? data : (data?.roomId || "room");
            const email = data?.email || "Guest";
            const name = data?.name || email;
            const isAdmin = Boolean(data?.isAdmin);
            const admin = roomAdmins.get(roomId);

            if (isAdmin || admin?.socketId === socket.id) {
                socket.emit("join-approved");
            } else if (admin) {
                io.to(admin.socketId).emit("join-request", { socketId: socket.id, email, name });
            } else {
                const pending = pendingJoinRequests.get(roomId) || [];
                if (!pending.some((p) => p.socketId === socket.id)) {
                    pending.push({ socketId: socket.id, email, name });
                    pendingJoinRequests.set(roomId, pending);
                }
            }
        });

        socket.on("accept-join", ({ targetSocketId, roomId }) => {
            if (roomAdmins.get(roomId)?.socketId === socket.id) {
                const pending = pendingJoinRequests.get(roomId) || [];
                pendingJoinRequests.set(roomId, pending.filter((p) => p.socketId !== targetSocketId));
                io.to(targetSocketId).emit("join-approved");
            }
        });

        socket.on("deny-join", ({ targetSocketId, roomId }) => {
            if (roomAdmins.get(roomId)?.socketId === socket.id) {
                const pending = pendingJoinRequests.get(roomId) || [];
                pendingJoinRequests.set(roomId, pending.filter((p) => p.socketId !== targetSocketId));
                io.to(targetSocketId).emit("join-denied");
            }
        });

        socket.on("remove-participant", ({ targetSocketId, roomId }) => {
            if (roomAdmins.get(roomId)?.socketId === socket.id) {
                io.to(targetSocketId).emit("removed-by-admin");
            }
        });

        socket.on("request-to-speak", (data) => {
            const roomId = data?.roomId || currentRoom;
            const email = data?.email || userProfiles.get(socket.id)?.email || "Guest";
            const name = data?.name || userProfiles.get(socket.id)?.name || email;

            const admin = roomAdmins.get(roomId);
            if (admin) {
                io.to(admin.socketId).emit("speak-request", {
                    socketId: socket.id,
                    email,
                    name,
                });
            }
        });

        socket.on("cancel-speak-request", (data) => {
            const roomId = data?.roomId || currentRoom;
            const admin = roomAdmins.get(roomId);
            if (admin) {
                io.to(admin.socketId).emit("speak-request-cancelled", {
                    socketId: socket.id,
                });
            }
        });

        socket.on("allow-speak", ({ targetSocketId, roomId }) => {
            const rId = roomId || currentRoom;
            const admin = roomAdmins.get(rId);
            const isAdminSocket = admin?.socketId === socket.id;
            const isUserAdminProfile = userProfiles.get(socket.id)?.email && userProfiles.get(socket.id)?.email === admin?.email;

            if (isAdminSocket || isUserAdminProfile) {
                if (admin && admin.socketId !== socket.id) {
                    admin.socketId = socket.id;
                }
                const profile = userProfiles.get(targetSocketId);
                if (profile) profile.canSpeak = true;

                io.to(targetSocketId).emit("speak-allowed");
                io.to(rId).emit("user-speak-state", { socketId: targetSocketId, canSpeak: true });
            }
        });

        socket.on("deny-speak", ({ targetSocketId, roomId }) => {
            const rId = roomId || currentRoom;
            const admin = roomAdmins.get(rId);
            const isAdminSocket = admin?.socketId === socket.id;
            const isUserAdminProfile = userProfiles.get(socket.id)?.email && userProfiles.get(socket.id)?.email === admin?.email;

            if (isAdminSocket || isUserAdminProfile) {
                io.to(targetSocketId).emit("speak-denied");
            }
        });

        socket.on("revoke-speak", ({ targetSocketId, roomId }) => {
            const rId = roomId || currentRoom;
            const admin = roomAdmins.get(rId);
            const isAdminSocket = admin?.socketId === socket.id;
            const isUserAdminProfile = userProfiles.get(socket.id)?.email && userProfiles.get(socket.id)?.email === admin?.email;

            if (isAdminSocket || isUserAdminProfile) {
                const profile = userProfiles.get(targetSocketId);
                if (profile) profile.canSpeak = false;

                io.to(targetSocketId).emit("admin-muted");
                io.to(rId).emit("user-speak-state", { socketId: targetSocketId, canSpeak: false });
            }
        });

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

        socket.on("toggle-video-state", ({ isVideoOff, roomId }) => {
            const rId = roomId || currentRoom;
            const profile = userProfiles.get(socket.id);
            if (profile) profile.isVideoOff = isVideoOff;
            if (rId) {
                socket.to(rId).emit("user-video-state", { socketId: socket.id, isVideoOff });
            }
        });

        socket.on("joined-room", (data) => {
            const roomId = typeof data === "string" ? data : (data?.roomId || "room");
            const isAdmin = Boolean(data?.isAdmin);
            const userName = data?.name || data?.email || "User";
            const userEmail = data?.email || "";

            currentRoom = roomId;
            socket.join(roomId);

            const isVideoOff = Boolean(data?.isVideoOff);
            const canSpeak = isAdmin;

            userProfiles.set(socket.id, {
                email: userEmail,
                name: userName,
                roomId,
                isVideoOff,
                canSpeak,
            });

            if (isAdmin) {
                roomAdmins.set(roomId, { socketId: socket.id, name: userName, email: userEmail });
                const pending = pendingJoinRequests.get(roomId) || [];
                if (pending.length > 0) {
                    pending.forEach((req) => {
                        io.to(socket.id).emit("join-request", req);
                    });
                }
            }

            const otherUsers = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
                .filter((id) => id !== socket.id && io.sockets.sockets.has(id));

            const peersProfiles = {};
            otherUsers.forEach((id) => {
                peersProfiles[id] = userProfiles.get(id) || { email: "Participant", name: "Participant", isVideoOff: false, canSpeak: false };
            });

            socket.emit("all-users", otherUsers);
            socket.emit("all-profiles", peersProfiles);

            socket.to(roomId).emit("peer-joined-profile", {
                socketId: socket.id,
                profile: userProfiles.get(socket.id),
            });

            if (screenSharers.has(roomId)) {
                socket.emit("screen-share-started", { userId: screenSharers.get(roomId) });
            }

            io.to(roomId).emit("room-admin", roomAdmins.get(roomId) || null);
        });

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
                socket.leave(roomId);
                io.to(roomId).emit("user-left", socket.id);
                if (currentRoom === roomId) currentRoom = null;
            }
        });

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
            for (const [rId, reqs] of pendingJoinRequests.entries()) {
                const remaining = reqs.filter((r) => r.socketId !== socket.id);
                if (remaining.length > 0) {
                    pendingJoinRequests.set(rId, remaining);
                } else {
                    pendingJoinRequests.delete(rId);
                }
            }
        });
    });
}

module.exports = setupSocket;