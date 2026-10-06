import { useEffect } from "react";

export function useTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Padok` : "Padok · F1 dla początkujących kibiców";
  }, [title]);
}
