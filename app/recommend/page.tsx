import type { Metadata } from "next";
import RecommendView from "@/features/recommend/recommend-view";

export const metadata: Metadata = {
  title: "Recommend — TokenTier",
  description:
    "Enter your workload, budget, and access requirement to get a cost-first API or subscription recommendation.",
  alternates: { canonical: "recommend/" },
};

export default function RecommendPage() {
  return <RecommendView />;
}
