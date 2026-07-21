import type { Metadata } from "next";

import { TopicsView } from "@/components/topics-view";

export const metadata: Metadata = {
  title: "Topics",
};

export default function TopicsPage() {
  return <TopicsView />;
}
