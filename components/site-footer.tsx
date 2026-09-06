"use client";

import Link from "next/link";
import { capabilityIndex } from "@/lib/catalog";
import { routes } from "@/lib/browser/url";
import { Icon } from "./icon";
import { catalogUpdatedLabel } from "./site-header";

// The methodology, price book, and sources all live on Rankings, so the footer
// links to them there by route and fragment rather than by scrolling whatever
// happens to be mounted.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <Link className="brand" href={routes.rankings}>
          <span className="brand-mark">T/T</span>
          <span>TokenTier</span>
        </Link>
        <nav className="footer-nav" aria-label="Footer navigation">
          <Link href={`${routes.rankings}#methodology`}>Methodology</Link>
          <Link href={`${routes.rankings}#prices`}>Price book</Link>
          <Link href={`${routes.rankings}#price-sources`}>Sources</Link>
          <a href="https://github.com/majinwakeup/tokentier" rel="noreferrer" target="_blank">
            <span>GitHub</span>
            <Icon name="external" size={13} />
          </a>
          <a href="https://github.com/majinwakeup/tokentier/issues" rel="noreferrer" target="_blank">
            <span>Report correction</span>
            <Icon name="external" size={13} />
          </a>
        </nav>
      </div>
      <div className="footer-bottom">
        <p className="footer-identity">
          © 2026 Jin Ma · Open-source code under MIT · Independent project · Capability scores by{" "}
          <a href={capabilityIndex.source} rel="noreferrer" target="_blank">Artificial Analysis</a>
        </p>
        <span className="footer-freshness">Data updated {catalogUpdatedLabel}</span>
      </div>
    </footer>
  );
}

export default SiteFooter;
