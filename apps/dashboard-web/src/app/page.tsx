import { ResearchWorkspace } from "@/components/research-workspace";
import showroomData from "@/data/showroom.json";
import type { PulseData } from "@/lib/showroom";

export default function Home() {
  return <ResearchWorkspace data={showroomData as PulseData} />;
}
