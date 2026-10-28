import { useState, useEffect } from "react";
import { currentIsMobile, subscribeIsMobile } from "../lib/viewport";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(currentIsMobile);
  useEffect(() => {
    setIsMobile(currentIsMobile());
    return subscribeIsMobile(setIsMobile);
  }, []);
  return isMobile;
}
