import type { Metadata } from "next";
import RankingsView from "@/features/rankings/rankings-view";

export const metadata: Metadata = {
  title: "TokenTier — Rankings of AI APIs and plans",
  description:
    "Tier lists and price books for AI API models and subscription plans, evaluated against workload presets.",
  alternates: { canonical: "./" },
};

export default function RankingsPage() {
  return <RankingsView />;
}
