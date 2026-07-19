import { PulseShell } from "@/components/pulse-shell";
import showroomData from "@/data/showroom.json";
import type { PulseData } from "@/lib/showroom";

export default function Home() {
  return <PulseShell data={showroomData as PulseData} />;
}
