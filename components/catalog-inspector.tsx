"use client";

import { useEffect, useState } from "react";
import type { Model, Plan } from "@/lib/catalog/types";
import { CompareDialog, CompareTray } from "./compare-dialog";
import { Icon } from "./icon";
import { ItemDetailsModal, type InspectionContext } from "./item-details";

export type { InspectionContext };

// Opening a card and comparing up to three of them is the same behaviour on
// every route, so it is owned here rather than duplicated per feature. Each
// route still keeps its own instance: visiting Rankings must not leave a
// comparison tray open on Recommend.
export function useCatalogInspector(announce: (message: string) => void) {
  const [activeItem, setActiveItem] = useState<Model | Plan | null>(null);
  const [compareList, setCompareList] = useState<Array<Model | Plan>>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // The next list and its announcement are computed together, outside the state
  // updater. An updater runs during render, and announcing from there would be
  // updating one component while rendering another.
  const toggleCompare = (item: Model | Plan) => {
    const isPlan = "kind" in item;
    const wasPlans = compareList.length > 0 && "kind" in compareList[0];

    if (compareList.length > 0 && isPlan !== wasPlans) {
      setCompareList([item]);
      announce(`Switched comparison to ${isPlan ? "plans" : "models"}. ${item.name} added (1/3).`);
      return;
    }
    if (compareList.some((entry) => entry.id === item.id)) {
      const next = compareList.filter((entry) => entry.id !== item.id);
      setCompareList(next);
      announce(`${item.name} removed from comparison, ${next.length} of 3.`);
      return;
    }
    const next = compareList.length >= 3 ? [...compareList.slice(1), item] : [...compareList, item];
    setCompareList(next);
    announce(`${item.name} added to comparison, ${next.length} of 3.`);
  };

  return {
    activeItem,
    inspect: setActiveItem,
    close: () => setActiveItem(null),
    compareList,
    compareOpen,
    setCompareOpen,
    clearCompare: () => setCompareList([]),
    toggleCompare,
    isCompared: (id: string) => compareList.some((entry) => entry.id === id),
  };
}

export type CatalogInspector = ReturnType<typeof useCatalogInspector>;

export function CatalogInspectorViews({
  inspector,
  context,
}: {
  inspector: CatalogInspector;
  context: InspectionContext;
}) {
  return (
    <>
      <ItemDetailsModal
        context={context}
        inCompare={inspector.activeItem !== null && inspector.isCompared(inspector.activeItem.id)}
        item={inspector.activeItem}
        onClose={inspector.close}
        onToggleCompare={inspector.toggleCompare}
      />
      <CompareTray
        items={inspector.compareList}
        onClear={inspector.clearCompare}
        onOpen={() => inspector.setCompareOpen(true)}
        onRemove={inspector.toggleCompare}
      />
      <CompareDialog
        context={context}
        isOpen={inspector.compareOpen && inspector.compareList.length > 0}
        items={inspector.compareList}
        onClose={() => inspector.setCompareOpen(false)}
      />
    </>
  );
}

export function BackToTop({ hidden = false }: { hidden?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible || hidden) return null;
  return (
    <button
      aria-label="Back to top"
      className="back-to-top-btn"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      type="button"
    >
      <Icon name="arrow-up" size={14} />
      <span>Top</span>
    </button>
  );
}
