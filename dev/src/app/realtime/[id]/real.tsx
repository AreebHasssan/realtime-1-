"use client";

import { useSocket } from "../../../providers/Sockets";
import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000";

const ICE_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] },
];

const VIDEO_CONTAINER_STYLE: React.CSSProperties = {
    width: "360px",
    height: "260px",
    background: "#0f172a",
    borderRadius: "12px",
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
    border: "1px solid #1e293b",
};

const MAIN_VIDEO_CONTAINER_STYLE: React.CSSProperties = {
    width: "100%",
    maxWidth: "1280px",
    height: "min(72vh, 680px)",
    background: "#020617",
    borderRadius: "16px",
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.35)",
    border: "2px solid #3b82f6",
};

const THUMBNAIL_CONTAINER_STYLE: React.CSSProperties = {
    width: "220px",
    height: "150px",
    background: "#0f172a",
    borderRadius: "10px",
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.15)",
    border: "1px solid #334155",
    flexShrink: 0,
};

type PeerConnections = Record<string, RTCPeerConnection>;
type IceQueues = Record<string, RTCIceCandidateInit[]>;
type RemoteStreams = Record<string, MediaStream>;

interface PeerProfile {
    email: string;
    name: string;
    isVideoOff?: boolean;
}

interface ChatMessage {
    id: string;
    text: string;
    senderEmail: string;
    time: string;
    isMe?: boolean;
}

interface JoinRequest {
    socketId: string;
    email: string;
    name: string;
}

function stopStream(stream: MediaStream | null) {
    stream?.getTracks().forEach((track) => track.stop());
}

function removePeer(peers: PeerConnections, queues: IceQueues, peerId: string) {
    peers[peerId]?.close();
    delete peers[peerId];
    delete queues[peerId];
}

function withoutRemoteStream(streams: RemoteStreams, peerId: string): RemoteStreams {
    if (!streams[peerId]) return streams;
    const updated = { ...streams };
    delete updated[peerId];
    return updated;
}

function createFallbackStream() {
    if (typeof window === "undefined" || typeof document === "undefined" || typeof MediaStream === "undefined") {
        return null as any;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 260;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, 0, 360, 260);
    }
    return (canvas as any).captureStream ? (canvas as any).captureStream(1) : new MediaStream();
}

// Remote Video Tile
function RemoteVideo({
    stream,
    peerId,
    isMain,
    isThumbnail,
    profile,
    isAdmin,
    onRemove,
}: {
    stream: MediaStream;
    peerId: string;
    isMain?: boolean;
    isThumbnail?: boolean;
    profile?: PeerProfile;
    isAdmin: boolean;
    onRemove?: (peerId: string) => void;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const email = profile?.email || "Participant";

    // Track whether stream has a live enabled video track
    const [hasLiveVideoTrack, setHasLiveVideoTrack] = useState(false);

    useEffect(() => {
        const checkTracks = () => {
            const tracks = stream?.getVideoTracks() || [];
            const isLive = tracks.some((t) => t.enabled && t.readyState === "live");
            setHasLiveVideoTrack(isLive);
        };

        checkTracks();
        stream?.addEventListener("addtrack", checkTracks);
        stream?.addEventListener("removetrack", checkTracks);

        const tracks = stream?.getVideoTracks() || [];
        tracks.forEach((t) => {
            t.addEventListener("mute", checkTracks);
            t.addEventListener("unmute", checkTracks);
            t.addEventListener("ended", checkTracks);
        });

        return () => {
            stream?.removeEventListener("addtrack", checkTracks);
            stream?.removeEventListener("removetrack", checkTracks);
            tracks.forEach((t) => {
                t.removeEventListener("mute", checkTracks);
                t.removeEventListener("unmute", checkTracks);
                t.removeEventListener("ended", checkTracks);
            });
        };
    }, [stream]);

    // Video is off if profile says so OR if there is no live video track
    const isVideoOff = Boolean(profile?.isVideoOff) || !hasLiveVideoTrack;

    // Keep stream attached to video element
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.srcObject !== stream) {
            video.srcObject = stream;
        }
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => { });
        });
    }, [stream]);

    // Keep audio element active so mic audio plays even when video is off
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.srcObject !== stream) {
            audio.srcObject = stream;
        }
        audio.play().catch(() => { });
    }, [stream]);

    const containerStyle = isMain
        ? MAIN_VIDEO_CONTAINER_STYLE
        : isThumbnail
        ? THUMBNAIL_CONTAINER_STYLE
        : VIDEO_CONTAINER_STYLE;

    return (
        <div style={containerStyle}>
            {/* Audio stream for mic audio even when camera is disabled */}
            <audio ref={audioRef} autoPlay playsInline />

            {/* Header with peer email & Admin remove button */}
            <div
                style={{
                    position: "absolute",
                    top: "8px",
                    left: "8px",
                    right: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    zIndex: 2,
                }}
            >
                <span
                    style={{
                        background: isMain ? "rgba(37, 99, 235, 0.9)" : "rgba(15, 23, 42, 0.75)",
                        color: "#f8fafc",
                        fontSize: isThumbnail ? "11px" : "12px",
                        fontWeight: 600,
                        padding: "3px 8px",
                        borderRadius: "6px",
                        backdropFilter: "blur(4px)",
                    }}
                >
                    {isMain ? `🖥️ ${email}'s Screen` : email}
                </span>

                {isAdmin && onRemove && !isMain && (
                    <button
                        onClick={() => onRemove(peerId)}
                        title="Remove user from meeting"
                        style={{
                            background: "rgba(220, 38, 38, 0.9)",
                            color: "#fff",
                            border: "none",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                        }}
                    >
                        ✕ Remove
                    </button>
                )}
            </div>

            {/* Video element is ALWAYS mounted to preserve track stream decoding */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: isMain ? "contain" : "cover",
                    display: isVideoOff ? "none" : "block",
                }}
            />

            {/* Email Avatar Card when Video is Off */}
            {isVideoOff && (
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#1e293b",
                        color: "#fff",
                        padding: isThumbnail ? "10px" : "20px",
                        boxSizing: "border-box",
                        textAlign: "center",
                    }}
                >
                    <div
                        style={{
                            width: isThumbnail ? "44px" : "72px",
                            height: isThumbnail ? "44px" : "72px",
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: isThumbnail ? "18px" : "28px",
                            fontWeight: 700,
                            marginBottom: isThumbnail ? "4px" : "10px",
                            boxShadow: "0 4px 6px rgba(0,0,0,0.2)",
                        }}
                    >
                        {(email[0] || "U").toUpperCase()}
                    </div>
                    <p style={{ margin: 0, fontSize: isThumbnail ? "11px" : "14px", fontWeight: 600, color: "#f8fafc", wordBreak: "break-all" }}>
                        {email}
                    </p>
                    <span style={{ fontSize: isThumbnail ? "9px" : "12px", color: "#94a3b8", marginTop: "2px" }}>
                        Camera Off
                    </span>
                </div>
            )}
        </div>
    );
}

export default function Real({ roomId: propRoomId }: { roomId?: string }) {
    const socket = useSocket();
    const router = useRouter();
    const [mounted, setMounted] = useState(false);

    const currentRoomId = (propRoomId || "room").replace(/[^a-zA-Z0-9_-]/g, "") || "room";
    const roomId = currentRoomId;

    const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [joinStatus, setJoinStatus] = useState<"loading" | "waiting" | "approved" | "denied">("loading");
    const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);

    const [myStream, setMyStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({});
    const [remoteProfiles, setRemoteProfiles] = useState<Record<string, PeerProfile>>({});

    const [isVideoOff, setIsVideoOff] = useState(false);
    const [permissionBlocked, setPermissionBlocked] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [canShareScreen, setCanShareScreen] = useState(true);
    const [screenSharerId, setScreenSharerId] = useState<string | null>(null);

    // Ephemeral Chat state
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [unreadCount, setUnreadCount] = useState(0);

    const [copied, setCopied] = useState(false);

    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const myStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<PeerConnections>({});
    const iceQueuesRef = useRef<IceQueues>({});
    const screenTrackRef = useRef<MediaStreamTrack | null>(null);
    const hasJoinedRef = useRef(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Ensure local stream is always attached to localVideoRef
    useEffect(() => {
        if (localVideoRef.current && myStream) {
            localVideoRef.current.srcObject = myStream;
            localVideoRef.current.play().catch(() => { });
        }
    }, [myStream]);

    // 1. Initial Backend Auth & Meeting Validation
    useEffect(() => {

        const verify = async () => {
            try {
                // Get authenticated user
                const authRes = await fetch(`${BACKEND_URL}/api/auth/check-auth`, { credentials: "include" });
                let currentUser: any = null;
                if (authRes.ok) {
                    const data = await authRes.json();
                    currentUser = data.user;
                    setUser(currentUser);
                }

                // Check meeting admin status
                const meetRes = await fetch(`${BACKEND_URL}/api/meetings/${roomId}`, { credentials: "include" });
                let meetingIsAdmin = false;
                if (meetRes.ok) {
                    const meetData = await meetRes.json();
                    meetingIsAdmin = Boolean(meetData.isAdmin);
                    if (meetingIsAdmin) setIsAdmin(true);
                }

                // Request admission via socket
                if (socket) {
                    if (meetingIsAdmin) {
                        setJoinStatus("approved");
                    } else {
                        setJoinStatus("waiting");
                        socket.emit("request-join", {
                            roomId,
                            email: currentUser?.email || "Guest",
                            name: currentUser?.name || currentUser?.email || "Guest",
                            isAdmin: meetingIsAdmin,
                        });
                    }
                }
            } catch {
                setJoinStatus("waiting");
            }
        };

        if (socket) verify();
    }, [socket]);

    // Acquire Camera stream once approved
    const getCamera = useCallback(async () => {
        if (myStreamRef.current && myStreamRef.current.active) return myStreamRef.current;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            myStreamRef.current = stream;
            setMyStream(stream);
            setPermissionBlocked(false);
            setIsVideoOff(false);
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
                localVideoRef.current.play().catch(() => { });
            }
            return stream;
        } catch {
            // Camera/Mic blocked by browser: do NOT crash, show email avatar instead!
            setPermissionBlocked(true);
            setIsVideoOff(true);
            try {
                const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                myStreamRef.current = audioOnly;
                setMyStream(audioOnly);
                return audioOnly;
            } catch {
                // Both video and audio blocked: use fallback stream so user joins and email avatar displays
                const fallback = createFallbackStream();
                myStreamRef.current = fallback;
                setMyStream(fallback);
                return fallback;
            }
        }
    }, []);

    useEffect(() => {
        if (joinStatus === "approved") {
            getCamera();
        }
    }, [joinStatus, getCamera]);

    // Socket Event Handling
    useEffect(() => {
        if (!socket) return;

        // Join approval & rejection
        const onJoinApproved = () => {
            setJoinStatus("approved");
        };
        const onJoinDenied = () => {
            setJoinStatus("denied");
        };
        const onRemovedByAdmin = () => {
            alert("You have been removed from the meeting by the Host.");
            stopStream(myStreamRef.current);
            router.push("/dashboard");
        };

        // Admin receives join requests
        const onJoinRequest = (req: JoinRequest) => {
            setJoinRequests((prev) => [...prev.filter((r) => r.socketId !== req.socketId), req]);
        };

        // Chat messages (Volatile UDP-like, not stored in DB)
        const onReceiveMessage = (msg: ChatMessage) => {
            setMessages((prev) => [...prev, msg]);
            if (!isChatOpen) {
                setUnreadCount((c) => c + 1);
            }
        };

        // Peer video state changes
        const onUserVideoState = ({ socketId, isVideoOff }: { socketId: string; isVideoOff: boolean }) => {
            setRemoteProfiles((prev) => ({
                ...prev,
                [socketId]: { ...prev[socketId], isVideoOff },
            }));
        };

        const onAllProfiles = (profiles: Record<string, PeerProfile>) => {
            setRemoteProfiles(profiles);
        };

        const onPeerJoinedProfile = ({ socketId, profile }: { socketId: string; profile: PeerProfile }) => {
            setRemoteProfiles((prev) => ({ ...prev, [socketId]: profile }));
        };

        const onScreenShareStarted = ({ userId }: { userId: string }) => {
            setScreenSharerId(userId);
        };
        const onScreenShareStopped = () => {
            setScreenSharerId(null);
        };

        socket.on("join-approved", onJoinApproved);
        socket.on("join-denied", onJoinDenied);
        socket.on("removed-by-admin", onRemovedByAdmin);
        socket.on("join-request", onJoinRequest);
        socket.on("receive-message", onReceiveMessage);
        socket.on("user-video-state", onUserVideoState);
        socket.on("all-profiles", onAllProfiles);
        socket.on("peer-joined-profile", onPeerJoinedProfile);
        socket.on("screen-share-started", onScreenShareStarted);
        socket.on("screen-share-stopped", onScreenShareStopped);

        return () => {
            socket.off("join-approved", onJoinApproved);
            socket.off("join-denied", onJoinDenied);
            socket.off("removed-by-admin", onRemovedByAdmin);
            socket.off("join-request", onJoinRequest);
            socket.off("receive-message", onReceiveMessage);
            socket.off("user-video-state", onUserVideoState);
            socket.off("all-profiles", onAllProfiles);
            socket.off("peer-joined-profile", onPeerJoinedProfile);
            socket.off("screen-share-started", onScreenShareStarted);
            socket.off("screen-share-stopped", onScreenShareStopped);
        };
    }, [socket, router, isChatOpen]);

    // WebRTC connection logic
    const createPeer = useCallback(
        (targetId: string, stream: MediaStream) => {
            removePeer(peersRef.current, iceQueuesRef.current, targetId);
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            const activeStream = myStreamRef.current || stream;

            activeStream.getAudioTracks().forEach((track) => pc.addTrack(track, activeStream));
            const videoTrack = screenTrackRef.current || activeStream.getVideoTracks()[0];
            if (videoTrack) pc.addTrack(videoTrack, activeStream);

            pc.onicecandidate = (event) => {
                if (event.candidate && socket) {
                    socket.emit("send-ice", { to: targetId, candidate: event.candidate });
                }
            };

            pc.ontrack = (event) => {
                const incomingStream = event.streams?.[0] || new MediaStream([event.track]);
                setRemoteStreams((prev) => {
                    const existing = prev[targetId];
                    if (existing && event.streams?.[0] && existing.id === event.streams[0].id) {
                        return prev;
                    }
                    return { ...prev, [targetId]: incomingStream };
                });
            };

            peersRef.current[targetId] = pc;
            return pc;
        },
        [socket]
    );

    // Join room when approved and stream is ready (only emit once per session)
    useEffect(() => {
        if (!socket || !myStream || joinStatus !== "approved" || hasJoinedRef.current) return;
        hasJoinedRef.current = true;

        const isVideoActuallyOff =
            isVideoOff ||
            permissionBlocked ||
            !myStream?.getVideoTracks().length ||
            !myStream.getVideoTracks().some((t) => t.enabled);

        socket.emit("joined-room", {
            roomId,
            isAdmin,
            name: user?.name || user?.email || "Participant",
            email: user?.email || "Participant",
            isVideoOff: isVideoActuallyOff,
        });

        if (isVideoActuallyOff) {
            socket.emit("toggle-video-state", { isVideoOff: true, roomId });
        }
    }, [socket, myStream, joinStatus, isAdmin, user, roomId, isVideoOff, permissionBlocked]);

    // WebRTC Socket Listeners with ICE Queue
    useEffect(() => {
        if (!socket) return;

        const onAllUsers = async (users: string[]) => {
            for (const userId of users) {
                try {
                    const activeStream = myStreamRef.current;
                    if (!activeStream) continue;
                    const pc = createPeer(userId, activeStream);
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.emit("send-offer", { to: userId, offer });
                } catch (err) {
                    console.error("Error creating offer", err);
                }
            }
        };

        const onReceiveOffer = async ({ from, offer }: any) => {
            const activeStream = myStreamRef.current;
            if (!activeStream) return;
            let pc = peersRef.current[from] || createPeer(from, activeStream);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            // Flush any queued ICE candidates that arrived before the offer
            const queue = iceQueuesRef.current[from] || [];
            for (const cand of queue) {
                await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => { });
            }
            iceQueuesRef.current[from] = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("send-answer", { to: from, answer });
        };

        const onReceiveAnswer = async ({ from, answer }: any) => {
            const pc = peersRef.current[from];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));

                // Flush any queued ICE candidates that arrived before the answer
                const queue = iceQueuesRef.current[from] || [];
                for (const cand of queue) {
                    await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => { });
                }
                iceQueuesRef.current[from] = [];
            }
        };

        const onReceiveIce = async ({ from, candidate }: any) => {
            const pc = peersRef.current[from];
            if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { });
            } else {
                if (!iceQueuesRef.current[from]) iceQueuesRef.current[from] = [];
                iceQueuesRef.current[from].push(candidate);
            }
        };

        const onUserLeft = (userId: string) => {
            removePeer(peersRef.current, iceQueuesRef.current, userId);
            setRemoteStreams((prev) => withoutRemoteStream(prev, userId));
            setRemoteProfiles((prev) => {
                const u = { ...prev };
                delete u[userId];
                return u;
            });
        };

        const onMeetingEnded = () => {
            alert("The Host has ended the meeting.");
            stopStream(myStreamRef.current);
            router.push("/dashboard");
        };

        socket.on("all-users", onAllUsers);
        socket.on("receive-offer", onReceiveOffer);
        socket.on("receive-answer", onReceiveAnswer);
        socket.on("receive-ice", onReceiveIce);
        socket.on("user-left", onUserLeft);
        socket.on("meeting-ended", onMeetingEnded);

        return () => {
            socket.off("all-users", onAllUsers);
            socket.off("receive-offer", onReceiveOffer);
            socket.off("receive-answer", onReceiveAnswer);
            socket.off("receive-ice", onReceiveIce);
            socket.off("user-left", onUserLeft);
            socket.off("meeting-ended", onMeetingEnded);
        };
    }, [socket, createPeer, router]);

    // Teardown WebRTC on unmount
    useEffect(() => {
        return () => {
            if (socket) {
                socket.emit("leave-room", { roomId });
            }
            Object.values(peersRef.current).forEach((pc) => pc.close());
            peersRef.current = {};
        };
    }, [socket, roomId]);

    // Toggles
    const toggleVideo = () => {
        const stream = myStreamRef.current || myStream;
        if (!stream) return;
        const nextState = !isVideoOff;
        stream.getVideoTracks().forEach((t) => (t.enabled = !nextState));
        setIsVideoOff(nextState);

        socket?.emit("toggle-video-state", { isVideoOff: nextState, roomId });
    };

    const toggleMic = () => {
        const stream = myStreamRef.current || myStream;
        if (!stream) return;
        stream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
        setIsMuted((prev) => !prev);
    };

    // Screen sharing
    const stopScreenShare = useCallback(() => {
        const cameraTrack = myStreamRef.current?.getVideoTracks()[0];
        if (screenTrackRef.current && cameraTrack) {
            Object.values(peersRef.current).forEach((pc) => {
                const sender = pc.getSenders().find((s) => s.track?.kind === "video");
                sender?.replaceTrack(cameraTrack).catch(() => { });
            });
        }
        screenTrackRef.current?.stop();
        screenTrackRef.current = null;
        socket?.emit("stop-screen-share", { roomId });
        if (localVideoRef.current && myStreamRef.current) {
            localVideoRef.current.srcObject = myStreamRef.current;
        }
        setIsSharing(false);
        setScreenSharerId((prev) => (prev === socket?.id || prev === "me" ? null : prev));
    }, [socket, roomId]);

    const startScreenShare = useCallback(async () => {
        try {
            const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screen.getVideoTracks()[0];
            if (!screenTrack) return;

            await Promise.all(
                Object.values(peersRef.current).map((pc) => {
                    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
                    return sender?.replaceTrack(screenTrack);
                })
            );

            screenTrackRef.current = screenTrack;
            screenTrack.onended = stopScreenShare;
            if (localVideoRef.current) localVideoRef.current.srcObject = screen;
            setIsSharing(true);
            setScreenSharerId(socket?.id || "me");
            socket?.emit("request-screen-share", { roomId });
        } catch {
            socket?.emit("stop-screen-share", { roomId });
        }
    }, [socket, roomId, stopScreenShare]);

    // Admin Accept / Deny join request
    const handleAcceptJoin = (targetSocketId: string) => {
        socket?.emit("accept-join", { targetSocketId, roomId });
        setJoinRequests((prev) => prev.filter((r) => r.socketId !== targetSocketId));
    };

    const handleDenyJoin = (targetSocketId: string) => {
        socket?.emit("deny-join", { targetSocketId, roomId });
        setJoinRequests((prev) => prev.filter((r) => r.socketId !== targetSocketId));
    };

    // Admin Remove Participant
    const handleRemoveParticipant = (targetSocketId: string) => {
        if (confirm("Are you sure you want to remove this participant?")) {
            socket?.emit("remove-participant", { targetSocketId, roomId });
        }
    };

    // Send ephemeral chat message
    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim()) return;

        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const senderEmail = user?.email || "Me";

        const newMsg: ChatMessage = {
            id: Math.random().toString(36).substring(2, 9),
            text: chatInput.trim(),
            senderEmail,
            time,
            isMe: true,
        };

        // Relay live via socket (UDP-like, not stored in DB)
        socket?.emit("send-message", { roomId, text: chatInput.trim(), senderEmail, time });
        setMessages((prev) => [...prev, newMsg]);
        setChatInput("");
    };

    const handleLeaveCall = () => {
        stopScreenShare();
        stopStream(myStreamRef.current);
        myStreamRef.current = null;
        router.push("/dashboard");
    };

    const handleEndMeeting = () => {
        if (confirm("Are you sure you want to end this meeting for everyone?")) {
            socket?.emit("end-meeting", { roomId });
            handleLeaveCall();
        }
    };

    const copyMeetingLink = () => {
        const link = `${FRONTEND_URL}/realtime/${currentRoomId}`;
        navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!mounted) {
        return (
            <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                Loading Meeting...
            </div>
        );
    }

    // Screen: Waiting for host admission
    if (joinStatus === "waiting") {
        return (
            <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
                <div className="bg-slate-800 p-8 rounded-2xl max-w-md w-full border border-slate-700 shadow-xl space-y-4">
                    <div className="w-16 h-16 bg-blue-600/20 text-blue-400 rounded-full flex items-center justify-center text-3xl mx-auto animate-pulse">
                        ⏳
                    </div>
                    <h2 className="text-xl font-bold">Waiting for Host Approval</h2>
                    <p className="text-sm text-slate-400">
                        The Host has been notified. You will be admitted once they approve your request.
                    </p>
                    <div className="bg-slate-900 p-3 rounded-lg text-xs font-mono text-slate-300">
                        Room: {currentRoomId}
                    </div>
                    <button
                        onClick={() => router.push("/dashboard")}
                        className="w-full py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold rounded-lg transition"
                    >
                        Cancel & Return to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // Screen: Request Denied
    if (joinStatus === "denied") {
        return (
            <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
                <div className="bg-slate-800 p-8 rounded-2xl max-w-md w-full border border-slate-700 shadow-xl space-y-4">
                    <div className="w-16 h-16 bg-red-600/20 text-red-400 rounded-full flex items-center justify-center text-3xl mx-auto">
                        🚫
                    </div>
                    <h2 className="text-xl font-bold">Join Request Declined</h2>
                    <p className="text-sm text-slate-400">
                        The Host declined your request to join this meeting.
                    </p>
                    <button
                        onClick={() => router.push("/dashboard")}
                        className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
                    >
                        Return to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: "16px 20px 100px", fontFamily: "sans-serif", background: "#f8fafc", minHeight: "100vh" }}>
            {/* Admin Admission Banner */}
            {isAdmin && joinRequests.length > 0 && (
                <div
                    style={{
                        position: "fixed",
                        top: "16px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 50,
                        background: "#1e293b",
                        color: "#fff",
                        padding: "12px 20px",
                        borderRadius: "12px",
                        boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
                        border: "1px solid #334155",
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                        maxWidth: "90vw",
                    }}
                >
                    <span style={{ fontSize: "14px", fontWeight: 600 }}>
                        👋 {joinRequests[0].name} ({joinRequests[0].email}) wants to join
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={() => handleAcceptJoin(joinRequests[0].socketId)}
                            style={{
                                background: "#16a34a",
                                color: "#fff",
                                border: "none",
                                padding: "6px 14px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            ✓ Accept
                        </button>
                        <button
                            onClick={() => handleDenyJoin(joinRequests[0].socketId)}
                            style={{
                                background: "#dc2626",
                                color: "#fff",
                                border: "none",
                                padding: "6px 14px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            ✕ Deny
                        </button>
                    </div>
                </div>
            )}

            {/* Meeting Top Bar */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "12px",
                    padding: "12px 18px",
                    background: "#ffffff",
                    borderRadius: "12px",
                    marginBottom: "16px",
                    border: "1px solid #e2e8f0",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontWeight: 700, fontSize: "15px", color: "#1e293b" }}>
                        Meeting: <span style={{ color: "#2563eb" }}>{currentRoomId}</span>
                    </span>
                    {isAdmin ? (
                        <span
                            style={{
                                background: "#fef3c7",
                                color: "#92400e",
                                padding: "3px 10px",
                                borderRadius: "9999px",
                                fontSize: "12px",
                                fontWeight: 700,
                            }}
                        >
                            Admin (Host)
                        </span>
                    ) : (
                        <span
                            style={{
                                background: "#e0f2fe",
                                color: "#0369a1",
                                padding: "3px 10px",
                                borderRadius: "9999px",
                                fontSize: "12px",
                                fontWeight: 600,
                            }}
                        >
                            👥 Participant
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                    <button
                        onClick={copyMeetingLink}
                        style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#334155",
                        }}
                    >
                        {copied ? "✓ Copied!" : "📋 Copy Link"}
                    </button>
                    <button
                        onClick={() => router.push("/dashboard")}
                        style={{
                            padding: "6px 12px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#334155",
                        }}
                    >
                        Dashboard
                    </button>
                </div>
            </div>

            {/* Video Tiles Grid & Chat Drawer */}
            <div style={{ display: "flex", gap: "20px", alignItems: "start" }}>
                {/* Videos Container */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
                    {isSharing || (screenSharerId && screenSharerId !== socket?.id && remoteStreams[screenSharerId]) ? (
                        <>
                            {/* Main Presentation Stage */}
                            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                                {isSharing ? (
                                    /* My local screen share as Main Stage */
                                    <div style={MAIN_VIDEO_CONTAINER_STYLE}>
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: "10px",
                                                left: "12px",
                                                zIndex: 2,
                                                background: "rgba(37, 99, 235, 0.9)",
                                                color: "#f8fafc",
                                                fontSize: "13px",
                                                fontWeight: 700,
                                                padding: "4px 10px",
                                                borderRadius: "6px",
                                                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                                            }}
                                        >
                                            🖥️ You are sharing your screen
                                        </div>
                                        <video
                                            ref={localVideoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                                        />
                                    </div>
                                ) : (
                                    /* Remote peer's screen share as Main Stage */
                                    <RemoteVideo
                                        key={screenSharerId!}
                                        peerId={screenSharerId!}
                                        stream={remoteStreams[screenSharerId!]}
                                        isMain={true}
                                        profile={remoteProfiles[screenSharerId!]}
                                        isAdmin={isAdmin}
                                        onRemove={handleRemoveParticipant}
                                    />
                                )}
                            </div>

                            {/* Participant Thumbnails Filmstrip below Main Stage */}
                            <div
                                style={{
                                    display: "flex",
                                    gap: "12px",
                                    overflowX: "auto",
                                    padding: "6px 0 12px",
                                    alignItems: "center",
                                    width: "100%",
                                }}
                            >
                                {/* Local user thumbnail if not the one sharing */}
                                {!isSharing && (
                                    <div style={THUMBNAIL_CONTAINER_STYLE}>
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: "6px",
                                                left: "6px",
                                                zIndex: 2,
                                                background: "rgba(15, 23, 42, 0.75)",
                                                color: "#f8fafc",
                                                fontSize: "11px",
                                                fontWeight: 600,
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                            }}
                                        >
                                            You ({user?.email || "Me"})
                                        </div>

                                        <video
                                            ref={localVideoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                objectFit: "cover",
                                                display: (isVideoOff || permissionBlocked || !myStream?.getVideoTracks().some((t) => t.enabled)) ? "none" : "block",
                                            }}
                                        />

                                        {(isVideoOff || permissionBlocked || !myStream || !myStream.getVideoTracks().some((t) => t.enabled)) && (
                                            <div
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    background: "#1e293b",
                                                    color: "#fff",
                                                    padding: "8px",
                                                    textAlign: "center",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: "40px",
                                                        height: "40px",
                                                        borderRadius: "50%",
                                                        background: "#10b981",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        fontSize: "16px",
                                                        fontWeight: 700,
                                                        marginBottom: "4px",
                                                    }}
                                                >
                                                    {((user?.email || "Y")[0] || "Y").toUpperCase()}
                                                </div>
                                                <p style={{ margin: 0, fontSize: "11px", fontWeight: 600, color: "#f8fafc" }}>
                                                    {user?.email || "You"}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* All other remote peers who are not the screen sharer */}
                                {Object.entries(remoteStreams)
                                    .filter(([peerId]) => peerId !== screenSharerId)
                                    .map(([peerId, stream]) => (
                                        <RemoteVideo
                                            key={peerId}
                                            peerId={peerId}
                                            stream={stream}
                                            isThumbnail={true}
                                            profile={remoteProfiles[peerId]}
                                            isAdmin={isAdmin}
                                            onRemove={handleRemoveParticipant}
                                        />
                                    ))}
                            </div>
                        </>
                    ) : (
                        /* Normal Video Grid when no screen is shared */
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "start" }}>
                            {/* My Video Tile */}
                            <div style={VIDEO_CONTAINER_STYLE}>
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "8px",
                                        left: "8px",
                                        zIndex: 2,
                                        background: "rgba(15, 23, 42, 0.75)",
                                        color: "#f8fafc",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        padding: "3px 8px",
                                        borderRadius: "6px",
                                    }}
                                >
                                    You ({user?.email || "Me"}) {isAdmin ? "👑" : ""}
                                </div>

                                <video
                                    ref={localVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: (isVideoOff || permissionBlocked || !myStream?.getVideoTracks().some((t) => t.enabled)) ? "none" : "block",
                                    }}
                                />

                                {(isVideoOff || permissionBlocked || !myStream || !myStream.getVideoTracks().some((t) => t.enabled)) && (
                                    <div
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            background: "#1e293b",
                                            color: "#fff",
                                            padding: "20px",
                                            boxSizing: "border-box",
                                            textAlign: "center",
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: "72px",
                                                height: "72px",
                                                borderRadius: "50%",
                                                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                fontSize: "28px",
                                                fontWeight: 700,
                                                marginBottom: "10px",
                                                boxShadow: "0 4px 6px rgba(0,0,0,0.2)",
                                            }}
                                        >
                                            {((user?.email || "Y")[0] || "Y").toUpperCase()}
                                        </div>
                                        <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#f8fafc", wordBreak: "break-all" }}>
                                            {user?.email || "You"}
                                        </p>
                                        <span style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                                            {permissionBlocked ? "Camera Blocked by Browser" : "Your Camera is Off"}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Remote Peers Video Tiles */}
                            {Object.entries(remoteStreams).map(([peerId, stream]) => (
                                <RemoteVideo
                                    key={peerId}
                                    peerId={peerId}
                                    stream={stream}
                                    profile={remoteProfiles[peerId]}
                                    isAdmin={isAdmin}
                                    onRemove={handleRemoveParticipant}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* In-Meeting Live Chat Drawer (Volatile UDP-like) */}
                {isChatOpen && (
                    <div
                        style={{
                            width: "320px",
                            height: "500px",
                            background: "#ffffff",
                            borderRadius: "16px",
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                        }}
                    >
                        {/* Chat Header */}
                        <div
                            style={{
                                padding: "12px 16px",
                                background: "#f8fafc",
                                borderBottom: "1px solid #e2e8f0",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <span style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b" }}>
                                💬 Live Chat
                            </span>
                            <button
                                onClick={() => setIsChatOpen(false)}
                                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "#64748b" }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Messages List */}
                        <div
                            style={{
                                flex: 1,
                                padding: "12px",
                                overflowY: "auto",
                                display: "flex",
                                flexDirection: "column",
                                gap: "10px",
                            }}
                        >
                            {messages.length === 0 ? (
                                <p style={{ fontSize: "12px", color: "#94a3b8", textAlign: "center", marginTop: "40px" }}>
                                    No messages yet. Send a message to participants!
                                </p>
                            ) : (
                                messages.map((m) => (
                                    <div
                                        key={m.id}
                                        style={{
                                            alignSelf: m.isMe ? "flex-end" : "flex-start",
                                            maxWidth: "85%",
                                            background: m.isMe ? "#2563eb" : "#f1f5f9",
                                            color: m.isMe ? "#fff" : "#1e293b",
                                            padding: "8px 12px",
                                            borderRadius: "10px",
                                            fontSize: "13px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: "10px",
                                                color: m.isMe ? "#bfdbfe" : "#64748b",
                                                marginBottom: "2px",
                                            }}
                                        >
                                            {m.senderEmail} • {m.time}
                                        </div>
                                        <div>{m.text}</div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Chat Input */}
                        <form
                            onSubmit={handleSendMessage}
                            style={{ padding: "10px", borderTop: "1px solid #e2e8f0", display: "flex", gap: "6px" }}
                        >
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Type a message..."
                                style={{
                                    flex: 1,
                                    padding: "8px 12px",
                                    fontSize: "13px",
                                    borderRadius: "8px",
                                    border: "1px solid #cbd5e1",
                                    outline: "none",
                                }}
                            />
                            <button
                                type="submit"
                                style={{
                                    background: "#2563eb",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: "8px",
                                    padding: "0 12px",
                                    fontWeight: 600,
                                    fontSize: "12px",
                                    cursor: "pointer",
                                }}
                            >
                                Send
                            </button>
                        </form>
                    </div>
                )}
            </div>

            {/* Footer Control Bar with Modern Icons */}
            <footer
                style={{
                    position: "fixed",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 20,
                    padding: "14px 20px",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                    background: "rgba(255, 255, 255, 0.98)",
                    borderTop: "1px solid #e2e8f0",
                    boxShadow: "0 -4px 6px -1px rgba(0, 0, 0, 0.05)",
                }}
            >
                {/* Video Toggle Button (Icon + Label) */}
                <button
                    onClick={toggleVideo}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 18px",
                        borderRadius: "12px",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "#fff",
                        background: isVideoOff ? "#ef4444" : "#2563eb",
                        transition: "all 0.2s",
                    }}
                >
                    {isVideoOff ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                            <path d="M21 21l-3.2-3.2M16 16l-3.2-3.2M8 8L2 2"></path>
                            <rect x="2" y="5" width="15" height="14" rx="2"></rect>
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="23 7 16 12 23 17 23 7"></polygon>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                    )}
                    {isVideoOff ? "Video Off" : "Video On"}
                </button>

                {/* Mic Toggle Button (Icon + Label) */}
                <button
                    onClick={toggleMic}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 18px",
                        borderRadius: "12px",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "#fff",
                        background: isMuted ? "#ef4444" : "#2563eb",
                        transition: "all 0.2s",
                    }}
                >
                    {isMuted ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                            <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                    )}
                    {isMuted ? "Mic Off" : "Mic On"}
                </button>

                {/* Share Screen Button (Icon + Label) */}
                <button
                    onClick={isSharing ? stopScreenShare : startScreenShare}
                    disabled={!isSharing && !canShareScreen}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 18px",
                        borderRadius: "12px",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "#fff",
                        background: isSharing ? "#f59e0b" : canShareScreen ? "#0d9488" : "#94a3b8",
                        transition: "all 0.2s",
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                    </svg>
                    {isSharing ? "Stop Share" : "Share Screen"}
                </button>

                {/* Chat Button (Icon + Label + Unread Badge) */}
                <button
                    onClick={() => {
                        setIsChatOpen((prev) => !prev);
                        setUnreadCount(0);
                    }}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 18px",
                        borderRadius: "12px",
                        border: "1px solid #cbd5e1",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "#334155",
                        background: isChatOpen ? "#e2e8f0" : "#ffffff",
                        position: "relative",
                        transition: "all 0.2s",
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    Chat
                    {unreadCount > 0 && !isChatOpen && (
                        <span
                            style={{
                                position: "absolute",
                                top: "-6px",
                                right: "-6px",
                                background: "#ef4444",
                                color: "#fff",
                                fontSize: "11px",
                                fontWeight: 700,
                                width: "18px",
                                height: "18px",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            {unreadCount}
                        </span>
                    )}
                </button>

                {/* Admin End Meeting Button */}
                {isAdmin && (
                    <button
                        onClick={handleEndMeeting}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "10px 18px",
                            borderRadius: "12px",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: "13px",
                            color: "#fff",
                            background: "#991b1b",
                            transition: "all 0.2s",
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="5" y="5" width="14" height="14" rx="2"></rect>
                        </svg>
                        End Meeting
                    </button>
                )}

                {/* Leave Call Button */}
                <button
                    onClick={handleLeaveCall}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 18px",
                        borderRadius: "12px",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "#fff",
                        background: "#dc2626",
                        transition: "all 0.2s",
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 11.38 11.38 0 0 0 3.58.57 2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A19.93 19.93 0 0 1 3 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2 11.38 11.38 0 0 0 .58 3.58 2 2 0 0 1-.45 2.11L8.86 10.96"></path>
                        <line x1="23" y1="1" x2="1" y2="23"></line>
                    </svg>
                    Leave
                </button>
            </footer>
        </div>
    );
}