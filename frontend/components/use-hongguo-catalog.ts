"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { combineHongguoCatalogs, HONGGUO_FORMATS, type HongguoCategories, type HongguoTrends } from "@/lib/hongguo-tags";

type Catalog = HongguoCategories | HongguoTrends;
const catalogCache = new Map<string, Catalog>();

function cachedCatalog(kind: string) {
  return combineHongguoCatalogs(HONGGUO_FORMATS.flatMap((format) => {
    const feed = catalogCache.get(`${kind}:${format}`);
    return feed ? [feed] : [];
  }));
}

export function useHongguoCatalog(kind: "categories" | "trending-tags", enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, setLoaded] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    Promise.allSettled(HONGGUO_FORMATS.map((format) => (
      apiRequest<{ data: Catalog }>(`/hongguo/${kind}?format=${format}`, { signal: controller.signal })
    )))
      .then((results) => {
        if (controller.signal.aborted) return;
        results.forEach((result, index) => {
          if (result.status === "fulfilled") catalogCache.set(`${kind}:${HONGGUO_FORMATS[index]}`, result.value.data);
        });
        setFailed(results.some((result) => result.status === "rejected"));
        setLoaded((value) => value + 1);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setRevision((value) => value + 1);
    }, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [kind, enabled, revision]);

  const data = enabled ? cachedCatalog(kind) : null;
  return { data, loading: enabled && loading, stale: Boolean(data?.stale || failed), refresh: () => setRevision((value) => value + 1) };
}
