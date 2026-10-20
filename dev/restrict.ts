import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
    const token = req.cookies.get("token")?.value;
    const path = req.nextUrl.pathname;


    if (!token && path !== "/auth" && path !== "/realtimes" && path !== "/") {
        return NextResponse.redirect(new URL("/auth", req.url));
    }


    if (token && path === "/auth") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
}

export default middleware;
