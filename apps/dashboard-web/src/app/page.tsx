import { ShowroomShell } from "@/components/showroom-shell";
import showroomData from "@/data/showroom.json";
import type { PulseData } from "@/lib/showroom";

export default function Home() {
  return <ShowroomShell data={showroomData as PulseData} />;
}
