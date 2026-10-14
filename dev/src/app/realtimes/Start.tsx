"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export default function Start() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Animated background neural particle mesh on canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationFrameId: number;
        let width = (canvas.width = window.innerWidth);
        let height = (canvas.height = window.innerHeight);

        const handleResize = () => {
            if (!canvas) return;
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        };
        window.addEventListener("resize", handleResize);

        const particles: { x: number; y: number; vx: number; vy: number; radius: number; color: string }[] = [];
        const colors = ["rgba(99, 102, 241, 0.45)", "rgba(56, 189, 248, 0.45)", "rgba(168, 85, 247, 0.4)"];

        for (let i = 0; i < 50; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                color: colors[Math.floor(Math.random() * colors.length)],
            });
        }

        const render = () => {
            ctx.clearRect(0, 0, width, height);

            // Draw connecting lines
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 140) {
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(99, 102, 241, ${0.18 * (1 - dist / 140)})`;
                        ctx.lineWidth = 0.8;
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.stroke();
                    }
                }
            }

            // Draw and update particles
            particles.forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();

                p.x += p.vx;
                p.y += p.vy;

                if (p.x < 0) p.x = width;
                if (p.x > width) p.x = 0;
                if (p.y < 0) p.y = height;
                if (p.y > height) p.y = 0;
            });

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            window.removeEventListener("resize", handleResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <div className="relative min-h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
            <div
                className="fixed inset-0 z-0 bg-cover bg-center opacity-40 pointer-events-none scale-105 animate-pulse-glow"
                style={{ backgroundImage: `url('/ambient-bg.jpg')` }}
            />
            <canvas
                ref={canvasRef}
                className="fixed inset-0 z-0 pointer-events-none opacity-80"
            />
            <div className="fixed top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-600/20 blur-[130px] pointer-events-none" />
            <div className="fixed bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-cyan-600/15 blur-[150px] pointer-events-none" />
            <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center font-bold text-white text-base shadow-lg shadow-indigo-500/30">
                        RM
                    </div>
                    <div>
                        <span className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                            RealTime
                            <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                LIVE WEBRTC
                            </span>
                        </span>
                        <p className="text-[11px] text-slate-400">High-Definition Conference Hub</p>
                    </div>
                </div>

                <div>
                    <Link
                        href="/auth"
                        className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600/90 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/25 border border-indigo-400/20 flex items-center gap-1.5"
                    >
                        <span>Get Started</span>
                        <span>→</span>
                    </Link>
                </div>
            </header>
            <main className="relative z-10 w-full max-w-5xl mx-auto px-6 py-12 flex flex-col items-center text-center my-auto">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-950/70 border border-indigo-500/30 text-indigo-300 text-xs font-semibold mb-6 backdrop-blur-md shadow-inner">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    <span> Spatial Video Conferencing</span>
                </div>
                <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white max-w-4xl leading-[1.1]">
                    Connect, Collaborate & Stream in{" "}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-300 to-purple-400">
                        Ultra Low-Latency
                    </span>
                </h1>


                <div className="mt-10">
                    <Link
                        href="/auth"
                        className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-base font-bold transition shadow-xl shadow-indigo-600/35 hover:scale-105 active:scale-95 duration-200 cursor-pointer"
                    >
                        <span>Get Started</span>
                        <span className="text-lg">→</span>
                    </Link>
                </div>
            </main>
            <footer className="relative z-10 w-full border-t border-slate-800/80 py-6 px-6 text-center text-xs text-slate-500 backdrop-blur-sm bg-slate-950/40">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">
                            RM
                        </div>
                        <span className="font-semibold text-slate-400">RealTime Conference Hub</span>
                    </div>
                    <p>© {new Date().getFullYear()} RealTime. All rights reserved..</p>
                </div>
            </footer>
        </div>
    );
}