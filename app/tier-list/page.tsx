import type { Metadata } from "next";
import TierListView from "@/features/tier-list/tier-list-view";

export const metadata: Metadata = {
  title: "My tier list — TokenTier",
  description:
    "Rank AI models and subscription plans yourself. Your own opinion, kept separate from the calculated rankings.",
  alternates: { canonical: "tier-list/" },
};

export default function TierListPage() {
  return <TierListView />;
}
