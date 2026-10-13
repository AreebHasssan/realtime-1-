"use client";

import { Suspense, use } from "react";
import dynamic from "next/dynamic";

const Real = dynamic(() => import("./real"), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#94a3b8", fontWeight: 500 }}>
      Loading Meeting...
    </div>
  ),
});

function RealtimeRoom({ paramsPromise }: { paramsPromise: Promise<{ id: string }> }) {
  const { id } = use(paramsPromise);
  return <Real roomId={id} />;
}

export default function Rpage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#94a3b8", fontWeight: 500 }}>
          Loading Meeting...
        </div>
      }
    >
      <RealtimeRoom paramsPromise={params} />
    </Suspense>
  );
}