"use client";

import { useSocket } from "../../../providers/Sockets";
import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
const FRONTEND_URL = (process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");

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
    canSpeak?: boolean;
}

interface SpeakRequest {
    socketId: string;
    email: string;
    name: string;
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

function createSilentAudioTrack(): MediaStreamTrack | null {
    if (typeof window === "undefined") return null;
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;
        const ctx = new AudioCtx();
        const oscillator = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        oscillator.connect(dst);
        oscillator.start();
        const track = dst.stream.getAudioTracks()[0];
        if (track) {
            track.enabled = false;
            (track as any).__isFallback = true;
            return track;
        }
    } catch { }
    return null;
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
    const stream = (canvas as any).captureStream ? (canvas as any).captureStream(1) : new MediaStream();
    stream.getVideoTracks().forEach((track: any) => {
        track.__isFallback = true;
        track.enabled = false;
    });

    const silentAudio = createSilentAudioTrack();
    if (silentAudio) {
        stream.addTrack(silentAudio);
    }

    return stream;
}

// Multi-tier media acquisition optimized for mobile and desktop browsers
async function acquireUserMedia(preferredFacingMode: "user" | "environment" = "user"): Promise<{
    stream: MediaStream;
    hasVideo: boolean;
    hasAudio: boolean;
}> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        const fallback = createFallbackStream() || new MediaStream();
        return { stream: fallback, hasVideo: false, hasAudio: false };
    }

    const mobileVideoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: preferredFacingMode },
    };

    // Tier 1: Front camera (facingMode) + Audio
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: mobileVideoConstraints,
            audio: { echoCancellation: true, noiseSuppression: true },
        });
        return {
            stream,
            hasVideo: stream.getVideoTracks().length > 0,
            hasAudio: stream.getAudioTracks().length > 0,
        };
    } catch (e1) {
        console.warn("Tier 1 (facingMode + audio) failed on device:", e1);
    }

    // Tier 2: Generic combined { video: true, audio: true }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
        });
        return {
            stream,
            hasVideo: stream.getVideoTracks().length > 0,
            hasAudio: stream.getAudioTracks().length > 0,
        };
    } catch (e2) {
        console.warn("Tier 2 (generic video + audio) failed:", e2);
    }

    // Tier 3: Separate acquisition (fixes mobile dual-hardware lock / split permissions)
    let audioTrack: MediaStreamTrack | null = null;
    let videoTrack: MediaStreamTrack | null = null;

    try {
        const vStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: preferredFacingMode } },
        });
        videoTrack = vStream.getVideoTracks()[0] || null;
    } catch {
        try {
            const vStream = await navigator.mediaDevices.getUserMedia({ video: true });
            videoTrack = vStream.getVideoTracks()[0] || null;
        } catch (eVideo) {
            console.warn("Separate video request failed on mobile:", eVideo);
        }
    }

    try {
        const aStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
        }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
        audioTrack = aStream.getAudioTracks()[0] || null;
    } catch (eAudio) {
        console.warn("Separate audio request failed:", eAudio);
    }

    const tracks: MediaStreamTrack[] = [
        ...(audioTrack ? [audioTrack] : []),
        ...(videoTrack ? [videoTrack] : []),
    ];

    if (tracks.length > 0) {
        const stream = new MediaStream(tracks);
        return {
            stream,
            hasVideo: stream.getVideoTracks().length > 0,
            hasAudio: stream.getAudioTracks().length > 0,
        };
    }

    // Tier 4: Fallback placeholder stream so user can still join room smoothly
    const fallback = createFallbackStream() || new MediaStream();
    return { stream: fallback, hasVideo: false, hasAudio: false };
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
    onMuteParticipant,
    onAllowSpeak,
    isSpeakRequested,
}: {
    stream?: MediaStream;
    peerId: string;
    isMain?: boolean;
    isThumbnail?: boolean;
    profile?: PeerProfile;
    isAdmin: boolean;
    onRemove?: (peerId: string) => void;
    onMuteParticipant?: (peerId: string) => void;
    onAllowSpeak?: (peerId: string) => void;
    isSpeakRequested?: boolean;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const email = profile?.email || "Participant";

    // Track whether stream has a live enabled video track
    const [hasLiveVideoTrack, setHasLiveVideoTrack] = useState(false);
    const [audioBlocked, setAudioBlocked] = useState(false);

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

        const timer = setInterval(checkTracks, 500);

        return () => {
            clearInterval(timer);
            stream?.removeEventListener("addtrack", checkTracks);
            stream?.removeEventListener("removetrack", checkTracks);
            tracks.forEach((t) => {
                t.removeEventListener("mute", checkTracks);
                t.removeEventListener("unmute", checkTracks);
                t.removeEventListener("ended", checkTracks);
            });
        };
    }, [stream]);

    // Presentation stage (isMain) is NEVER considered "video off". Only regular peer camera tiles check profile.isVideoOff.
    const isVideoOff = isMain ? false : (Boolean(profile?.isVideoOff) || !hasLiveVideoTrack);

    // Keep stream attached to video element (muted so it never interferes with audio element)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const currentSrc = video.srcObject;
        const nextSrc = stream || null;
        if (currentSrc !== nextSrc) {
            video.srcObject = nextSrc;
        }
        if (stream) {
            video.muted = true;
            video.play().catch(() => { });
        }
    }, [stream]);

    // Keep audio element active so mic audio plays even when video is off
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const currentSrc = audio.srcObject;
        const nextSrc = stream || null;
        if (currentSrc !== nextSrc) {
            audio.srcObject = nextSrc;
        }
        if (stream) {
            audio.volume = 1.0;
            audio.muted = false;
            const playAudio = () => {
                audio.play().then(() => {
                    setAudioBlocked(false);
                }).catch((err) => {
                    console.warn("Autoplay audio blocked by browser:", err);
                    setAudioBlocked(true);
                });
            };
            playAudio();
            window.addEventListener("click", playAudio, { once: true });
            window.addEventListener("touchstart", playAudio, { once: true });
            return () => {
                window.removeEventListener("click", playAudio);
                window.removeEventListener("touchstart", playAudio);
            };
        }
    }, [stream]);

    const containerStyle = isMain
        ? MAIN_VIDEO_CONTAINER_STYLE
        : isThumbnail
            ? THUMBNAIL_CONTAINER_STYLE
            : VIDEO_CONTAINER_STYLE;

    return (
        <div style={containerStyle}>
            {/* Audio stream for mic audio even when camera is disabled */}
            <audio ref={audioRef} autoPlay playsInline controls={false} />

            {/* Tap to Unmute Banner if Browser Blocked Autoplay */}
            {audioBlocked && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (audioRef.current) {
                            audioRef.current.play().then(() => setAudioBlocked(false)).catch(() => { });
                        }
                    }}
                    style={{
                        position: "absolute",
                        bottom: "8px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 4,
                        background: "#2563eb",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
                    }}
                >
                    🔊 Tap to hear voice
                </button>
            )}

            {/* Header with peer email & Admin controls */}
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
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    {isMain ? `🖥️ ${email}'s Screen` : (
                        <>
                            <span>{email}</span>
                            <span>{profile?.canSpeak ? "🎤" : "🔇"}</span>
                        </>
                    )}
                </span>

                {isAdmin && !isMain && (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        {/* Admin Mute Button for speaking participants */}
                        {profile?.canSpeak && onMuteParticipant && (
                            <button
                                onClick={() => onMuteParticipant(peerId)}
                                title="Close / Mute this user's microphone"
                                style={{
                                    background: "rgba(239, 68, 68, 0.9)",
                                    color: "#fff",
                                    border: "none",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                🔇 Mute
                            </button>
                        )}

                        {/* Admin Allow Mic button if participant requested to speak */}
                        {isSpeakRequested && onAllowSpeak && (
                            <button
                                onClick={() => onAllowSpeak(peerId)}
                                title="Allow this user to speak"
                                style={{
                                    background: "rgba(22, 163, 74, 0.9)",
                                    color: "#fff",
                                    border: "none",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                ✋ Allow Mic
                            </button>
                        )}

                        {onRemove && (
                            <button
                                onClick={() => onRemove(peerId)}
                                title="Remove user from meeting"
                                style={{
                                    background: "rgba(71, 85, 105, 0.9)",
                                    color: "#fff",
                                    border: "none",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Video element is ALWAYS mounted to preserve track stream decoding */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: isMain ? "contain" : "cover",
                    position: (!isMain && isVideoOff) ? "absolute" : "relative",
                    opacity: (!isMain && isVideoOff) ? 0 : 1,
                    pointerEvents: (!isMain && isVideoOff) ? "none" : "auto",
                    zIndex: (!isMain && isVideoOff) ? 0 : 1,
                }}
            />

            {/* Email Avatar Card when Video is Off (ONLY for camera tiles, NEVER for screen presentation) */}
            {!isMain && isVideoOff && (
                <div
                    style={{
                        position: "relative",
                        zIndex: 1,
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
    const [speakRequests, setSpeakRequests] = useState<SpeakRequest[]>([]);
    const [canSpeak, setCanSpeak] = useState(false);
    const [speakRequestPending, setSpeakRequestPending] = useState(false);
    const [speakNotice, setSpeakNotice] = useState<string | null>(null);

    const [myStream, setMyStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({});
    const [remoteProfiles, setRemoteProfiles] = useState<Record<string, PeerProfile>>({});

    const [isVideoOff, setIsVideoOff] = useState(false);
    const [permissionBlocked, setPermissionBlocked] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [canShareScreen, setCanShareScreen] = useState(true);
    const [screenSharerId, setScreenSharerId] = useState<string | null>(null);
    const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
    const [isMobile, setIsMobile] = useState(false);

    // Ephemeral Chat state
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [unreadCount, setUnreadCount] = useState(0);

    const [copied, setCopied] = useState(false);

    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    const myStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<PeerConnections>({});
    const iceQueuesRef = useRef<IceQueues>({});
    const screenTrackRef = useRef<MediaStreamTrack | null>(null);
    const hasJoinedRef = useRef(false);

    useEffect(() => {
        setMounted(true);
        if (typeof navigator !== "undefined") {
            setCanShareScreen(Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function"));
            setIsMobile(
                /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
                (typeof window !== "undefined" && window.innerWidth <= 768)
            );
        }

        const resumeMedia = () => {
            document.querySelectorAll("audio, video").forEach((el) => {
                const mediaEl = el as HTMLMediaElement;
                if (mediaEl.paused && mediaEl.srcObject) {
                    mediaEl.play().catch(() => { });
                }
            });
        };
        window.addEventListener("click", resumeMedia, { passive: true });
        window.addEventListener("touchstart", resumeMedia, { passive: true });
        return () => {
            window.removeEventListener("click", resumeMedia);
            window.removeEventListener("touchstart", resumeMedia);
        };
    }, []);

    // Ensure local stream is always attached to localVideoRef
    useEffect(() => {
        if (localVideoRef.current && myStream) {
            localVideoRef.current.srcObject = myStream;
            localVideoRef.current.play().catch(() => { });
        }
    }, [myStream, screenSharerId, isSharing, isVideoOff]);

    // Ensure local screen share stream is attached to screenVideoRef
    useEffect(() => {
        if (screenVideoRef.current && screenStream) {
            screenVideoRef.current.srcObject = screenStream;
            screenVideoRef.current.play().catch(() => { });
        }
    }, [screenStream, isSharing]);

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
                    if (meetingIsAdmin) {
                        setIsAdmin(true);
                        setCanSpeak(true);
                    }
                }

                if (meetingIsAdmin) {
                    setJoinStatus("approved");
                } else {
                    setJoinStatus("waiting");
                    socket?.emit("request-join", {
                        roomId,
                        email: currentUser?.email || "Guest",
                        name: currentUser?.name || currentUser?.email || "Guest",
                        isAdmin: false,
                    });
                }
            } catch {
                setJoinStatus("waiting");
                socket?.emit("request-join", {
                    roomId,
                    email: "Guest",
                    name: "Guest",
                    isAdmin: false,
                });
            }
        };

        if (socket) verify();
    }, [socket]);

    // Acquire Camera stream once approved
    const getCamera = useCallback(async (targetFacing: "user" | "environment" = facingMode) => {
        if (
            myStreamRef.current &&
            myStreamRef.current.active &&
            myStreamRef.current.getVideoTracks().some((t) => t.readyState === "live" && !(t as any).__isFallback)
        ) {
            return myStreamRef.current;
        }

        try {
            const { stream, hasVideo, hasAudio } = await acquireUserMedia(targetFacing);

            if (!hasVideo) {
                // Attach a silent fallback video track so RTCPeerConnection ALWAYS has a video sender ready to be replaced later
                const fallback = createFallbackStream();
                const fallbackTrack = fallback?.getVideoTracks()[0];
                if (fallbackTrack) {
                    fallbackTrack.enabled = false;
                    stream.addTrack(fallbackTrack);
                }
                setPermissionBlocked(true);
                setIsVideoOff(true);
            } else {
                setPermissionBlocked(false);
                setIsVideoOff(false);
            }

            // Host has mic open by default; participants join with mic muted and locked unless granted speaking permission
            const allowedToSpeak = isAdmin || canSpeak;
            if (!allowedToSpeak) {
                stream.getAudioTracks().forEach((t) => {
                    t.enabled = false;
                });
                setIsMuted(true);
            } else if (!hasAudio) {
                setIsMuted(true);
            } else {
                setIsMuted(false);
            }

            myStreamRef.current = stream;
            setMyStream(stream);

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
                localVideoRef.current.play().catch(() => { });
            }

            return stream;
        } catch (err) {
            console.warn("Failed to acquire media on entry:", err);
            const fallback = createFallbackStream() || new MediaStream();
            myStreamRef.current = fallback;
            setMyStream(fallback);
            setPermissionBlocked(true);
            setIsVideoOff(true);
            setIsMuted(true);
            return fallback;
        }
    }, [facingMode, isAdmin, canSpeak]);

    useEffect(() => {
        if (joinStatus === "approved") {
            getCamera();
        }
    }, [joinStatus, getCamera]);

    // Automatically detect when user grants Camera permission in Android settings
    useEffect(() => {
        if (typeof navigator !== "undefined" && Boolean((navigator as any).permissions?.query)) {
            try {
                (navigator as any).permissions.query({ name: "camera" }).then((status: any) => {
                    status.onchange = () => {
                        if (status.state === "granted") {
                            getCamera();
                        }
                    };
                }).catch(() => { });
            } catch { }
        }
    }, [getCamera]);

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

        // Admin receives speaking requests
        const onSpeakRequest = (req: SpeakRequest) => {
            setSpeakRequests((prev) => [...prev.filter((r) => r.socketId !== req.socketId), req]);
        };

        const onSpeakRequestCancelled = ({ socketId }: { socketId: string }) => {
            setSpeakRequests((prev) => prev.filter((r) => r.socketId !== socketId));
        };

        // Participant is granted speaking permission by Admin
        const onSpeakAllowed = async () => {
            setCanSpeak(true);
            setSpeakRequestPending(false);
            setIsMuted(false);

            let stream = myStreamRef.current;
            let liveAudio = stream?.getAudioTracks().find((t) => !(t as any).__isFallback && t.readyState === "live");

            if (!liveAudio) {
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({
                        audio: { echoCancellation: true, noiseSuppression: true },
                    }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
                    const newAudioTrack = audioStream.getAudioTracks()[0];
                    if (newAudioTrack) {
                        if (!stream) {
                            stream = new MediaStream();
                            myStreamRef.current = stream;
                            setMyStream(stream);
                        }
                        stream.addTrack(newAudioTrack);
                        liveAudio = newAudioTrack;

                        Object.entries(peersRef.current).forEach(([peerId, pc]) => {
                            const transceiver = pc.getTransceivers().find((t) => t.receiver?.track?.kind === "audio");
                            if (transceiver) {
                                if (transceiver.direction !== "sendrecv") {
                                    transceiver.direction = "sendrecv";
                                }
                                transceiver.sender.replaceTrack(newAudioTrack).catch(() => {});
                            } else {
                                try {
                                    pc.addTrack(newAudioTrack, stream!);
                                } catch {}
                            }
                            if (pc.signalingState === "stable") {
                                pc.createOffer().then((offer) => {
                                    pc.setLocalDescription(offer);
                                    socket?.emit("send-offer", { to: peerId, offer });
                                }).catch(() => {});
                            }
                        });
                    }
                } catch (err) {
                    console.warn("Could not acquire audio track after host approved speaking:", err);
                }
            }

            if (liveAudio) {
                liveAudio.enabled = true;
            }

            setSpeakNotice("Host allowed you to speak. Your mic is now active.");
            setTimeout(() => setSpeakNotice(null), 5000);
        };

        // Participant's speak request was denied by Admin
        const onSpeakDenied = () => {
            setSpeakRequestPending(false);
            setSpeakNotice("Host declined your request to speak.");
            setTimeout(() => setSpeakNotice(null), 5000);
        };

        // Admin closed/muted participant's microphone
        const onAdminMuted = () => {
            setCanSpeak(false);
            setSpeakRequestPending(false);
            const stream = myStreamRef.current;
            if (stream) {
                stream.getAudioTracks().forEach((t) => (t.enabled = false));
            }
            setIsMuted(true);
            setSpeakNotice("Host has muted your microphone.");
            setTimeout(() => setSpeakNotice(null), 5000);
        };

        // Broadcast of any peer's speaking permission state
        const onUserSpeakState = ({ socketId, canSpeak: peerCanSpeak }: { socketId: string; canSpeak: boolean }) => {
            if (socket && socketId === socket.id) {
                setCanSpeak(peerCanSpeak);
                return;
            }
            setRemoteProfiles((prev) => {
                if (!prev[socketId]) return prev;
                return {
                    ...prev,
                    [socketId]: { ...prev[socketId], canSpeak: peerCanSpeak },
                };
            });
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
            if (socket && socketId === socket.id) return;
            setRemoteProfiles((prev) => {
                if (!prev[socketId]) return prev;
                return {
                    ...prev,
                    [socketId]: { ...prev[socketId], isVideoOff },
                };
            });
        };

        const onAllProfiles = (profiles: Record<string, PeerProfile>) => {
            const filtered: Record<string, PeerProfile> = {};
            for (const [id, prof] of Object.entries(profiles)) {
                if (!socket || id !== socket.id) {
                    filtered[id] = prof;
                }
            }
            setRemoteProfiles(filtered);
        };

        const onPeerJoinedProfile = ({ socketId, profile }: { socketId: string; profile: PeerProfile }) => {
            if (socket && socketId === socket.id) return;
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
        socket.on("speak-request", onSpeakRequest);
        socket.on("speak-request-cancelled", onSpeakRequestCancelled);
        socket.on("speak-allowed", onSpeakAllowed);
        socket.on("speak-denied", onSpeakDenied);
        socket.on("admin-muted", onAdminMuted);
        socket.on("user-speak-state", onUserSpeakState);
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
            socket.off("speak-request", onSpeakRequest);
            socket.off("speak-request-cancelled", onSpeakRequestCancelled);
            socket.off("speak-allowed", onSpeakAllowed);
            socket.off("speak-denied", onSpeakDenied);
            socket.off("admin-muted", onAdminMuted);
            socket.off("user-speak-state", onUserSpeakState);
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
        (targetId: string, stream?: MediaStream) => {
            removePeer(peersRef.current, iceQueuesRef.current, targetId);
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            const activeStream = myStreamRef.current || stream;

            // Audio: add live track if available, otherwise add transceiver
            let audioAdded = false;
            const liveAudioTrack = activeStream?.getAudioTracks().find((t) => !(t as any).__isFallback && t.readyState === "live");
            if (liveAudioTrack) {
                try {
                    pc.addTrack(liveAudioTrack, activeStream!);
                    audioAdded = true;
                } catch (e) {
                    console.warn("Could not add audio track, falling back to transceiver:", e);
                }
            }
            if (!audioAdded) {
                try {
                    pc.addTransceiver("audio", { direction: "sendrecv" });
                } catch (e) {
                    console.warn("Could not add audio transceiver:", e);
                }
            }

            // Video: add live track if available, otherwise add transceiver
            let videoAdded = false;
            const liveVideoTrack = screenTrackRef.current || activeStream?.getVideoTracks().find((t) => !(t as any).__isFallback && t.readyState === "live");
            if (liveVideoTrack) {
                try {
                    pc.addTrack(liveVideoTrack, activeStream!);
                    videoAdded = true;
                } catch (e) {
                    console.warn("Could not add video track, falling back to transceiver:", e);
                }
            }
            if (!videoAdded) {
                try {
                    pc.addTransceiver("video", { direction: "sendrecv" });
                } catch (e) {
                    console.warn("Could not add video transceiver:", e);
                }
            }

            pc.onicecandidate = (event) => {
                if (event.candidate && socket) {
                    socket.emit("send-ice", { to: targetId, candidate: event.candidate });
                }
            };

            pc.ontrack = (event) => {
                setRemoteStreams((prev) => {
                    const current = prev[targetId];
                    if (current) {
                        if (!current.getTracks().some((t) => t.id === event.track.id)) {
                            current.addTrack(event.track);
                        }
                        return {
                            ...prev,
                            [targetId]: new MediaStream(current.getTracks()),
                        };
                    }
                    const newStream = event.streams?.[0] || new MediaStream([event.track]);
                    return {
                        ...prev,
                        [targetId]: newStream,
                    };
                });
            };

            peersRef.current[targetId] = pc;
            return pc;
        },
        [socket]
    );

    // Join room when approved (only emit once per session)
    useEffect(() => {
        if (!socket || joinStatus !== "approved" || hasJoinedRef.current) return;
        hasJoinedRef.current = true;

        const isVideoActuallyOff =
            isVideoOff ||
            permissionBlocked ||
            !myStream?.getVideoTracks().length ||
            !myStream?.getVideoTracks().some((t) => t.enabled && !(t as any).__isFallback);

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
    }, [socket, joinStatus, isAdmin, user, roomId, isVideoOff, permissionBlocked, myStream]);

    // WebRTC Socket Listeners with ICE Queue
    useEffect(() => {
        if (!socket) return;

        const onAllUsers = async (users: string[]) => {
            for (const userId of users) {
                try {
                    const activeStream = myStreamRef.current || new MediaStream();
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
            try {
                const activeStream = myStreamRef.current || new MediaStream();
                const pc = peersRef.current[from] || createPeer(from, activeStream);
                await pc.setRemoteDescription(new RTCSessionDescription(offer));

                // Bind active live tracks to the negotiated transceivers
                const liveAudio = activeStream?.getAudioTracks().find((t) => !(t as any).__isFallback && t.readyState === "live");
                if (liveAudio) {
                    const audioTransceiver = pc.getTransceivers().find((t) => t.receiver?.track?.kind === "audio");
                    if (audioTransceiver) {
                        audioTransceiver.direction = "sendrecv";
                        await audioTransceiver.sender.replaceTrack(liveAudio).catch(() => {});
                    }
                }

                const liveVideo = screenTrackRef.current || activeStream?.getVideoTracks().find((t) => !(t as any).__isFallback && t.readyState === "live");
                if (liveVideo) {
                    const videoTransceiver = pc.getTransceivers().find((t) => t.receiver?.track?.kind === "video");
                    if (videoTransceiver) {
                        videoTransceiver.direction = "sendrecv";
                        await videoTransceiver.sender.replaceTrack(liveVideo).catch(() => {});
                    }
                }

                // Flush any queued ICE candidates that arrived before the offer
                const queue = iceQueuesRef.current[from] || [];
                for (const cand of queue) {
                    await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => { });
                }
                iceQueuesRef.current[from] = [];

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit("send-answer", { to: from, answer });
            } catch (err) {
                console.error("Error handling offer", err);
            }
        };

        const onReceiveAnswer = async ({ from, answer }: any) => {
            try {
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
            } catch (err) {
                console.error("Error handling answer", err);
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
    const toggleVideo = async () => {
        const stream = myStreamRef.current || myStream;
        const nextState = !isVideoOff; // true = turn off, false = turn on

        if (nextState) {
            // Turning OFF video
            if (stream) {
                stream.getVideoTracks().forEach((t) => {
                    t.enabled = false;
                });
            }
            setIsVideoOff(true);
            socket?.emit("toggle-video-state", { isVideoOff: true, roomId });
        } else {
            // Turning ON video
            let liveTrack = stream?.getVideoTracks().find((t) => t.readyState === "live" && !(t as any).__isFallback);

            // If no active real camera track exists (e.g. mobile was audio-only initially or track was stopped)
            if (!liveTrack) {
                try {
                    let newVideoStream: MediaStream | null = null;
                    try {
                        newVideoStream = await navigator.mediaDevices.getUserMedia({
                            video: { facingMode: { ideal: facingMode } },
                        });
                    } catch {
                        newVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    }

                    const newTrack = newVideoStream?.getVideoTracks()[0];
                    if (newTrack) {
                        liveTrack = newTrack;
                        if (stream) {
                            // Stop and remove old or fallback video tracks
                            stream.getVideoTracks().forEach((oldTrack) => {
                                oldTrack.stop();
                                stream.removeTrack(oldTrack);
                            });
                            stream.addTrack(newTrack);
                        } else {
                            const newStream = new MediaStream([newTrack]);
                            myStreamRef.current = newStream;
                            setMyStream(newStream);
                        }
                    }
                } catch (err: any) {
                    console.error("Camera access failed on toggle:", err);
                    if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
                        alert(
                            "📷 Camera is currently blocked by your phone settings.\n\nTo enable it:\n1. Open your phone's Settings → Apps → Chrome\n2. Tap Permissions → Camera → Allow while using app\n3. Tap the address bar lock icon → Permissions → Enable Camera\n4. Refresh the page."
                        );
                    } else {
                        alert(`Could not start camera: ${err?.message || err?.name || "Access denied"}. Please check phone permissions.`);
                    }
                    return;
                }
            }

            if (liveTrack) {
                liveTrack.enabled = true;
                setPermissionBlocked(false);
                setIsVideoOff(false);

                // Update local video element
                const activeStream = myStreamRef.current || stream;
                if (localVideoRef.current && activeStream) {
                    localVideoRef.current.srcObject = activeStream;
                    localVideoRef.current.play().catch(() => { });
                }

                // Update all peers with the active video track if not sharing screen
                if (!isSharing) {
                    Object.values(peersRef.current).forEach((pc) => {
                        const sender =
                            pc.getSenders().find((s) => s.track?.kind === "video") ||
                            pc.getTransceivers().find((t) => t.receiver?.track?.kind === "video")?.sender;
                        if (sender) {
                            sender.replaceTrack(liveTrack!).catch((e) => console.error("replaceTrack error:", e));
                        } else if (activeStream) {
                            try {
                                pc.addTrack(liveTrack!, activeStream);
                            } catch (e) {
                                console.error("addTrack error:", e);
                            }
                        }
                    });
                }

                socket?.emit("toggle-video-state", { isVideoOff: false, roomId });
            }
        }
    };

    const flipCamera = async () => {
        const nextMode = facingMode === "user" ? "environment" : "user";
        setFacingMode(nextMode);

        const stream = myStreamRef.current || myStream;
        if (!stream) return;

        try {
            let newStream: MediaStream | null = null;
            try {
                newStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { exact: nextMode } },
                });
            } catch {
                newStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: nextMode } },
                });
            }

            const newTrack = newStream?.getVideoTracks()[0];
            if (!newTrack) return;

            stream.getVideoTracks().forEach((t) => {
                t.stop();
                stream.removeTrack(t);
            });
            stream.addTrack(newTrack);

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
                localVideoRef.current.play().catch(() => { });
            }

            Object.values(peersRef.current).forEach((pc) => {
                const sender =
                    pc.getSenders().find((s) => s.track?.kind === "video") ||
                    pc.getTransceivers().find((t) => t.receiver?.track?.kind === "video")?.sender;
                sender?.replaceTrack(newTrack).catch((e) => console.error("Flip camera replaceTrack error:", e));
            });

            setIsVideoOff(false);
            setPermissionBlocked(false);
            socket?.emit("toggle-video-state", { isVideoOff: false, roomId });
        } catch (err) {
            console.error("Failed to flip camera:", err);
            setFacingMode(facingMode);
        }
    };

    const toggleMic = async () => {
        if (!isAdmin && !canSpeak) {
            handleRequestToSpeak();
            return;
        }
        let stream = myStreamRef.current || myStream;
        let audioTrack = stream?.getAudioTracks().find((t) => !(t as any).__isFallback && t.readyState === "live");
        if (!audioTrack && isMuted) {
            try {
                const aStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true },
                }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
                const newAudioTrack = aStream.getAudioTracks()[0];
                if (newAudioTrack) {
                    if (!stream) {
                        stream = new MediaStream();
                        myStreamRef.current = stream;
                        setMyStream(stream);
                    }
                    stream.addTrack(newAudioTrack);
                    Object.entries(peersRef.current).forEach(([peerId, pc]) => {
                        const transceiver = pc.getTransceivers().find((t) => t.receiver?.track?.kind === "audio");
                        if (transceiver) {
                            if (transceiver.direction !== "sendrecv") {
                                transceiver.direction = "sendrecv";
                            }
                            transceiver.sender.replaceTrack(newAudioTrack).catch(() => { });
                        } else {
                            try {
                                pc.addTrack(newAudioTrack, stream!);
                            } catch { }
                        }
                        if (pc.signalingState === "stable") {
                            pc.createOffer().then((offer) => {
                                pc.setLocalDescription(offer);
                                socket?.emit("send-offer", { to: peerId, offer });
                            }).catch(() => { });
                        }
                    });
                    setIsMuted(false);
                    return;
                }
            } catch (e) {
                console.warn("Could not acquire mic on unmute:", e);
            }
        }
        if (stream) {
            stream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
            setIsMuted((prev) => !prev);
        }
    };

    // Screen sharing
    const stopScreenShare = useCallback(() => {
        const cameraTrack = myStreamRef.current?.getVideoTracks().find((t) => !(t as any).__isFallback);
        if (screenTrackRef.current) {
            Object.values(peersRef.current).forEach((pc) => {
                const sender =
                    pc.getSenders().find((s) => s.track?.kind === "video") ||
                    pc.getTransceivers().find((t) => t.receiver?.track?.kind === "video")?.sender;
                if (sender) {
                    if (cameraTrack && !isVideoOff) {
                        sender.replaceTrack(cameraTrack).catch(() => { });
                    } else {
                        const fallback = createFallbackStream();
                        const fallbackTrack = fallback?.getVideoTracks()[0];
                        if (fallbackTrack) {
                            fallbackTrack.enabled = false;
                            sender.replaceTrack(fallbackTrack).catch(() => { });
                        }
                    }
                }
            });
        }
        screenTrackRef.current?.stop();
        screenTrackRef.current = null;

        if (screenStream) {
            screenStream.getTracks().forEach((t) => t.stop());
        }
        setScreenStream(null);

        socket?.emit("stop-screen-share", { roomId });
        setIsSharing(false);
        setScreenSharerId((prev) => (prev === socket?.id || prev === "me" ? null : prev));
    }, [socket, roomId, screenStream, isVideoOff]);

    const startScreenShare = useCallback(async () => {
        try {
            const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screen.getVideoTracks()[0];
            if (!screenTrack) return;

            await Promise.all(
                Object.entries(peersRef.current).map(async ([peerId, pc]) => {
                    const sender =
                        pc.getSenders().find((s) => s.track?.kind === "video") ||
                        pc.getTransceivers().find((t) => t.receiver?.track?.kind === "video")?.sender;
                    if (sender) {
                        return sender.replaceTrack(screenTrack);
                    } else {
                        try {
                            pc.addTrack(screenTrack, screen);
                            const offer = await pc.createOffer();
                            await pc.setLocalDescription(offer);
                            socket?.emit("send-offer", { to: peerId, offer });
                        } catch (e) {
                            console.error("addTrack/renegotiate error:", e);
                        }
                    }
                })
            );

            screenTrackRef.current = screenTrack;
            screenTrack.onended = () => {
                stopScreenShare();
            };
            setScreenStream(screen);
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

    // Speaking permission handlers
    const handleRequestToSpeak = () => {
        if (!socket) return;
        socket.emit("request-to-speak", {
            roomId,
            name: user?.name || user?.email || "Participant",
            email: user?.email || "Participant",
        });
        setSpeakRequestPending(true);
        setSpeakNotice("Request to speak sent to Host. Please wait for approval...");
    };

    const handleCancelSpeakRequest = () => {
        if (!socket) return;
        socket.emit("cancel-speak-request", { roomId });
        setSpeakRequestPending(false);
        setSpeakNotice(null);
    };

    const handleAllowSpeak = (targetSocketId: string) => {
        if (!socket) return;
        socket.emit("allow-speak", { targetSocketId, roomId });
        setSpeakRequests((prev) => prev.filter((r) => r.socketId !== targetSocketId));
    };

    const handleDenySpeak = (targetSocketId: string) => {
        if (!socket) return;
        socket.emit("deny-speak", { targetSocketId, roomId });
        setSpeakRequests((prev) => prev.filter((r) => r.socketId !== targetSocketId));
    };

    const handleRevokeSpeak = (targetSocketId: string) => {
        if (!socket) return;
        socket.emit("revoke-speak", { targetSocketId, roomId });
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

            {/* Admin Speak Requests Banner */}
            {isAdmin && speakRequests.length > 0 && (
                <div
                    style={{
                        position: "fixed",
                        top: joinRequests.length > 0 ? "76px" : "16px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 50,
                        background: "#0f172a",
                        color: "#fff",
                        padding: "12px 20px",
                        borderRadius: "12px",
                        boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
                        border: "1px solid #3b82f6",
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                        maxWidth: "90vw",
                    }}
                >
                    <span style={{ fontSize: "14px", fontWeight: 600 }}>
                        🎤 <strong>{speakRequests[0].name}</strong> ({speakRequests[0].email}) wants to speak
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={() => handleAllowSpeak(speakRequests[0].socketId)}
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
                            ✓ Allow Mic
                        </button>
                        <button
                            onClick={() => handleDenySpeak(speakRequests[0].socketId)}
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

            {/* Participant Speak Notification Toast */}
            {speakNotice && (
                <div
                    style={{
                        position: "fixed",
                        bottom: "90px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 50,
                        background: "#1e293b",
                        color: "#fff",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                        border: "1px solid #3b82f6",
                        fontSize: "13px",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                    }}
                >
                    <span>{speakNotice}</span>
                    <button
                        onClick={() => setSpeakNotice(null)}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: "#94a3b8",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 700,
                        }}
                    >
                        ✕
                    </button>
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
                </div>
            </div>

            {/* Video Tiles Grid & Chat Drawer */}
            <div style={{ display: "flex", gap: "20px", alignItems: "start" }}>
                {/* Videos Container */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
                    {isSharing || (screenSharerId && screenSharerId !== socket?.id) ? (
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
                                            ref={screenVideoRef}
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
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                            }}
                                        >
                                            <span>You ({user?.email || "Me"})</span>
                                            <span>{isAdmin ? "👑 Host" : (canSpeak ? (isMuted ? "🔇" : "🎤") : "🔇 Locked")}</span>
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
                                                display: (isVideoOff || permissionBlocked || !myStream?.getVideoTracks().some((t) => t.enabled && !(t as any).__isFallback)) ? "none" : "block",
                                            }}
                                        />

                                        {(isVideoOff || permissionBlocked || !myStream || !myStream.getVideoTracks().some((t) => t.enabled && !(t as any).__isFallback)) && (
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
                                {Object.keys(remoteProfiles)
                                    .filter((peerId) => (!socket || peerId !== socket.id) && peerId !== screenSharerId)
                                    .map((peerId) => (
                                        <RemoteVideo
                                            key={peerId}
                                            peerId={peerId}
                                            stream={remoteStreams[peerId]}
                                            isThumbnail={true}
                                            profile={remoteProfiles[peerId]}
                                            isAdmin={isAdmin}
                                            onRemove={handleRemoveParticipant}
                                            onMuteParticipant={handleRevokeSpeak}
                                            onAllowSpeak={handleAllowSpeak}
                                            isSpeakRequested={speakRequests.some((r) => r.socketId === peerId)}
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
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px",
                                    }}
                                >
                                    <span>You ({user?.email || "Me"})</span>
                                    <span>{isAdmin ? "👑 Host" : (canSpeak ? (isMuted ? "🔇" : "🎤") : "🔇 Locked")}</span>
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
                                        display: (isVideoOff || permissionBlocked || !myStream?.getVideoTracks().some((t) => t.enabled && !(t as any).__isFallback)) ? "none" : "block",
                                    }}
                                />

                                {(isVideoOff || permissionBlocked || !myStream || !myStream.getVideoTracks().some((t) => t.enabled && !(t as any).__isFallback)) && (
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
                                        <button
                                            onClick={toggleVideo}
                                            style={{
                                                marginTop: "12px",
                                                background: "#2563eb",
                                                color: "#fff",
                                                border: "none",
                                                padding: "6px 14px",
                                                borderRadius: "8px",
                                                fontSize: "12px",
                                                fontWeight: 600,
                                                cursor: "pointer",
                                                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                                            }}
                                        >
                                            📷 Turn On Camera
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Remote Peers Video Tiles */}
                            {Object.keys(remoteProfiles)
                                .filter((peerId) => !socket || peerId !== socket.id)
                                .map((peerId) => (
                                <RemoteVideo
                                    key={peerId}
                                    peerId={peerId}
                                    stream={remoteStreams[peerId]}
                                    profile={remoteProfiles[peerId]}
                                    isAdmin={isAdmin}
                                    onRemove={handleRemoveParticipant}
                                    onMuteParticipant={handleRevokeSpeak}
                                    onAllowSpeak={handleAllowSpeak}
                                    isSpeakRequested={speakRequests.some((r) => r.socketId === peerId)}
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

                {/* Flip Camera Button (Mobile only, active when video is on) */}
                {isMobile && !isVideoOff && (
                    <button
                        onClick={flipCamera}
                        title="Switch Front / Rear Camera"
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
                            background: "#475569",
                            transition: "all 0.2s",
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 4v6h6" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                        Flip Cam
                    </button>
                )}

                {/* Mic Control: Request to Speak for participants without mic access, or Mic Toggle for Host / Approved speakers */}
                {!isAdmin && !canSpeak ? (
                    <button
                        onClick={speakRequestPending ? handleCancelSpeakRequest : handleRequestToSpeak}
                        title={speakRequestPending ? "Cancel your request to speak" : "Ask Host permission to unmute mic"}
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
                            background: speakRequestPending ? "#d97706" : "#64748b",
                            transition: "all 0.2s",
                        }}
                    >
                        {speakRequestPending ? (
                            <>
                                <span>⏳</span>
                                <span>Request Sent (Cancel)</span>
                            </>
                        ) : (
                            <>
                                <span>✋</span>
                                <span>Request to Speak</span>
                            </>
                        )}
                    </button>
                ) : (
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
                )}

                {/* Share Screen Button (Icon + Label) */}
                <button
                    onClick={() => {
                        if (isSharing) {
                            stopScreenShare();
                        } else if (!canShareScreen) {
                            alert(
                                "🖥️ Screen Sharing is not supported by mobile browsers on Android & iOS.\n\nTo share your screen, please join this meeting using Chrome, Edge, or Brave on a Laptop or Desktop computer."
                            );
                        } else {
                            startScreenShare();
                        }
                    }}
                    title={!canShareScreen ? "Screen sharing is only supported on Desktop / Laptop computers" : "Share Screen"}
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
                        background: isSharing ? "#f59e0b" : canShareScreen ? "#0d9488" : "#64748b",
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