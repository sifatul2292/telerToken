"use client";

import dynamic from "next/dynamic";

const FuelStationMap = dynamic(() => import("@/components/FuelStationMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full items-center justify-center bg-zinc-100 text-sm text-zinc-600">
      Loading map…
    </div>
  ),
});

export default function MapLoader() {
  return <FuelStationMap />;
}
