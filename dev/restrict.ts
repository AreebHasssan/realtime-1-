import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
    const tokenFromCookie = req.cookies.get("token")?.value;
    const tokenFromQuery = req.nextUrl.searchParams.get("token");
    const token = tokenFromCookie || tokenFromQuery;
    const path = req.nextUrl.pathname;


    if (tokenFromQuery) {
        const cleanUrl = new URL(req.nextUrl.pathname, req.url);
        req.nextUrl.searchParams.forEach((val, key) => {
            if (key !== "token") {
                cleanUrl.searchParams.set(key, val);
            }
        });
        const res = NextResponse.redirect(cleanUrl);
        res.cookies.set("token", tokenFromQuery, {
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
            sameSite: "lax",
            httpOnly: false,
        });
        return res;
    }

    const isPublic =
        path === "/" ||
        path === "/auth" ||
        path === "/realtimes" ||
        path.startsWith("/_next") ||
        path.startsWith("/api") ||
        path === "/favicon.ico";

    if (!token && !isPublic) {
        return NextResponse.redirect(new URL("/auth", req.url));
    }
    if (token && path === "/auth") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
}

export default middleware;
